/**
 * Regularização histórica única de área/local do estoque.
 *
 * A mutation é idempotente e só corrige referências/metadados:
 * - lotes e itens da entrada: área e local físico;
 * - saldos por produto/local: subdivisão por área, preservando o total por par;
 * - movimentos/devoluções: referências à área/local/lote já existente;
 * - 10 unidades de medida comprovadamente divergentes na planilha inicial.
 *
 * NÃO altera stock.physicalQuantity, stock.reservedQuantity, quantityReceived,
 * quantityAvailable, quantidades dos itens de entrada ou quantidade das movimentações.
 * stockByLocation.quantity só pode ser redistribuído entre áreas do MESMO
 * produto/local; o total do par é validado antes de qualquer escrita.
 *
 * Execute somente depois de publicar o schema que inclui entryItems.areaId,
 * requestItemReservations e stockMovementLots.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import {
  INITIAL_ENTRY_NUMBER,
  GOMAQ_ENTRY_NUMBER,
  GOMAQ_INVOICE_NUMBER,
  INITIAL_STOCK_MANIFEST,
  INITIAL_ENTRY_UOM_REPAIRS,
  summarizeInitialStockManifest,
} from "../lib/stock-regularization-manifest";

const CONFIRMATION = "REGULARIZAR_SIGESGD_AREA_LOCAL_V1";

type AreaLocation = { areaId: string; locationId: string };
type Patch = { id: string; fields: Record<string, any> };

const keyOf = (...parts: string[]) => parts.join("|");
const normalize = (value?: string | null) => (value ?? "").trim().toLocaleLowerCase("pt-BR");

function addPatch(target: Patch[], id: string, current: Record<string, any>, fields: Record<string, any>) {
  const changed: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (current[key] !== value) changed[key] = value;
  }
  if (Object.keys(changed).length) target.push({ id, fields: changed });
}

function resolveLot(reference: unknown, byId: Map<string, any>, byNumber: Map<string, any>) {
  if (typeof reference !== "string" || !reference.trim()) return null;
  return byId.get(reference) ?? byNumber.get(reference) ?? null;
}

async function buildRegularizationPlan(ctx: any) {
  const blockers: string[] = [];
  const addBlocker = (message: string) => {
    if (!blockers.includes(message)) blockers.push(message);
  };

  const areas = await ctx.db.query("stockAreas").collect();
  const areaByName = new Map(areas.map((area: any) => [normalize(area.name), area]));
  const generalArea: any = areaByName.get(normalize("TI Geral"));
  const printerArea: any = areaByName.get(normalize("Impressoras"));
  if (!generalArea?.active) addBlocker('Área ativa "TI Geral" não encontrada.');
  if (!printerArea?.active) addBlocker('Área ativa "Impressoras" não encontrada.');

  const locations = await ctx.db.query("storageLocations").collect();
  const locationByName = new Map(locations.map((location: any) => [normalize(location.name), location]));
  const cabinet1: any = locationByName.get(normalize("Armário TI 01"));
  const cabinet2: any = locationByName.get(normalize("Armário TI 02"));
  if (!cabinet1?.active) addBlocker('Local físico ativo "Armário TI 01" não encontrado.');
  if (!cabinet2?.active) addBlocker('Local físico ativo "Armário TI 02" não encontrado.');

  const initialEntry: any = await ctx.db.query("entries")
    .withIndex("by_number", (q: any) => q.eq("entryNumber", INITIAL_ENTRY_NUMBER)).first();
  const gomaqEntry: any = await ctx.db.query("entries")
    .withIndex("by_number", (q: any) => q.eq("entryNumber", GOMAQ_ENTRY_NUMBER)).first();
  if (!initialEntry) addBlocker(`Entrada ${INITIAL_ENTRY_NUMBER} não encontrada.`);
  if (!gomaqEntry) addBlocker(`Entrada ${GOMAQ_ENTRY_NUMBER} não encontrada.`);

  const lotPatches: Patch[] = [];
  const itemPatches: Patch[] = [];
  const movementPatches: Patch[] = [];
  const returnPatches: Patch[] = [];
  const sblPatches: Patch[] = [];
  const sblInserts: Array<{ productId: string; locationId: string; areaId: string; quantity: number }> = [];
  const targetLotMeta = new Map<string, AreaLocation>();
  const allTouchedProductIds = new Set<string>();
  const itemUomChanges: Array<{ productName: string; from: string; to: string }> = [];
  const itemLocationDistribution = new Map<string, { rows: number; quantity: number }>();
  const areaDistribution = new Map<string, { rows: number; quantity: number }>();

  const initialItems: any[] = initialEntry
    ? await ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", initialEntry._id)).collect()
    : [];
  const initialLots: any[] = initialEntry
    ? await ctx.db.query("lots").withIndex("by_entry", (q: any) => q.eq("entryId", initialEntry._id)).collect()
    : [];
  const gomaqItems: any[] = gomaqEntry
    ? await ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", gomaqEntry._id)).collect()
    : [];
  const gomaqLots: any[] = gomaqEntry
    ? await ctx.db.query("lots").withIndex("by_entry", (q: any) => q.eq("entryId", gomaqEntry._id)).collect()
    : [];

  if (initialEntry && (initialEntry.status !== "confirmed" || initialEntry.originType !== "initial_inventory")) {
    addBlocker("A entrada inicial não está confirmada como initial_inventory.");
  }
  if (initialEntry?.areaId) {
    addBlocker("A entrada inicial possui área no cabeçalho, mas a planilha contém áreas mistas. O cabeçalho não será sobrescrito.");
  }
  if (initialItems.length !== 53 || initialLots.length !== 53) {
    addBlocker(`Carga inicial fora do manifesto: encontrados ${initialItems.length} itens e ${initialLots.length} lotes; esperado 53/53.`);
  }
  if (gomaqEntry && (gomaqEntry.status !== "confirmed" || gomaqEntry.invoiceNumber !== GOMAQ_INVOICE_NUMBER)) {
    addBlocker("A entrada Gomaq não corresponde à NF 372043 confirmada.");
  }
  if (gomaqItems.length !== 8 || gomaqLots.length !== 8) {
    addBlocker(`NF Gomaq 372043 fora do esperado: encontrados ${gomaqItems.length} itens e ${gomaqLots.length} lotes; esperado 8/8.`);
  }
  if (gomaqEntry && printerArea && gomaqEntry.areaId !== printerArea._id) {
    addBlocker('A entrada Gomaq 372043 não está vinculada à área "Impressoras".');
  }
  const gomaqItemQuantity = gomaqItems.reduce((sum: number, item: any) => sum + Number(item.quantity), 0);
  const gomaqLotQuantity = gomaqLots.reduce((sum: number, lot: any) => sum + Number(lot.quantityReceived), 0);
  if (gomaqItemQuantity !== 535 || gomaqLotQuantity !== 535) {
    addBlocker(`NF Gomaq 372043 diverge do total físico auditado de 535 unidades (itens: ${gomaqItemQuantity}; lotes: ${gomaqLotQuantity}).`);
  }

  const manifestByName = new Map(INITIAL_STOCK_MANIFEST.map((row) => [normalize(row.productName), row]));
  const usedManifestNames = new Set<string>();
  const initialLotById = new Map(initialLots.map((lot: any) => [lot._id as string, lot]));
  const initialLotByNumber = new Map(initialLots.map((lot: any) => [lot.lotNumber as string, lot]));

  for (const item of initialItems) {
    const product: any = await ctx.db.get(item.productId);
    if (!product) {
      addBlocker(`Produto do item inicial ${item._id} não encontrado.`);
      continue;
    }
    const productName = product.name as string;
    const manifest = manifestByName.get(normalize(productName));
    if (!manifest) {
      addBlocker(`Produto "${productName}" não consta no manifesto da carga inicial.`);
      continue;
    }
    if (usedManifestNames.has(normalize(productName))) {
      addBlocker(`Produto "${productName}" aparece duplicado na entrada inicial, mas o manifesto espera uma linha única.`);
      continue;
    }
    usedManifestNames.add(normalize(productName));

    if (Number(item.quantity) !== manifest.quantity) {
      addBlocker(`Quantidade do item "${productName}" diverge da planilha (${item.quantity} / ${manifest.quantity}).`);
    }
    if (product.unitOfMeasure !== manifest.unitOfMeasure) {
      addBlocker(`Unidade do cadastro de "${productName}" diverge da planilha (${product.unitOfMeasure} / ${manifest.unitOfMeasure}); nenhuma unidade será alterada automaticamente.`);
    }
    if (item.unitOfMeasure !== manifest.unitOfMeasure) {
      if (
        INITIAL_ENTRY_UOM_REPAIRS[productName] === manifest.unitOfMeasure &&
        item.unitOfMeasure === "un" &&
        product.unitOfMeasure === manifest.unitOfMeasure
      ) {
        itemPatches.push({ id: item._id, fields: { unitOfMeasure: manifest.unitOfMeasure } });
        itemUomChanges.push({ productName, from: item.unitOfMeasure, to: manifest.unitOfMeasure });
      } else {
        addBlocker(`Unidade do item "${productName}" diverge da planilha de forma não prevista (${item.unitOfMeasure} / ${manifest.unitOfMeasure}).`);
      }
    }

    const location: any = item.locationId ? await ctx.db.get(item.locationId) : null;
    const expectedLocation = locationByName.get(normalize(manifest.locationName)) as any;
    if (!expectedLocation?.active) {
      addBlocker(`Local físico esperado "${manifest.locationName}" não está ativo.`);
    }
    if (!location || !location.active) {
      addBlocker(`Item "${productName}" não possui local físico válido registrado.`);
    } else if (normalize(location.name) !== normalize(manifest.locationName)) {
      addBlocker(`Local físico de "${productName}" diverge da planilha (${location.name} / ${manifest.locationName}).`);
    }

    const lot = resolveLot(item.lotId, initialLotById, initialLotByNumber);
    if (!lot) {
      addBlocker(`Item "${productName}" não aponta para lote verificável.`);
      continue;
    }
    if (lot.entryId !== initialEntry?._id || lot.productId !== item.productId || Number(lot.quantityReceived) !== manifest.quantity) {
      addBlocker(`Lote ${lot.lotNumber} não corresponde ao item "${productName}" em entrada/produto/quantidade.`);
      continue;
    }
    if (!location || !expectedLocation?.active || !generalArea?.active || !printerArea?.active) continue;

    const area: any = areaByName.get(normalize(manifest.areaName));
    const target = { areaId: area._id as string, locationId: location._id as string };
    if (lot.areaId && lot.areaId !== target.areaId) {
      addBlocker(`Lote ${lot.lotNumber} já possui área diferente do manifesto.`);
    }
    if (lot.locationId && lot.locationId !== target.locationId) {
      addBlocker(`Lote ${lot.lotNumber} já possui local físico diferente do item de entrada.`);
    }
    if (item.areaId && item.areaId !== target.areaId) {
      addBlocker(`Item da entrada "${productName}" já possui outra área.`);
    }

    targetLotMeta.set(lot._id as string, target);
    addPatch(lotPatches, lot._id, lot, target);
    addPatch(itemPatches, item._id, item, { areaId: target.areaId });

    allTouchedProductIds.add(item.productId as string);
    const areaSummary = areaDistribution.get(manifest.areaName) ?? { rows: 0, quantity: 0 };
    areaSummary.rows += 1;
    areaSummary.quantity += manifest.quantity;
    areaDistribution.set(manifest.areaName, areaSummary);
    const locationSummary = itemLocationDistribution.get(manifest.locationName) ?? { rows: 0, quantity: 0 };
    locationSummary.rows += 1;
    locationSummary.quantity += manifest.quantity;
    itemLocationDistribution.set(manifest.locationName, locationSummary);
  }

  for (const row of INITIAL_STOCK_MANIFEST) {
    if (!usedManifestNames.has(normalize(row.productName))) {
      addBlocker(`Produto "${row.productName}" do manifesto não foi encontrado na entrada inicial.`);
    }
  }

  const manifestSummary = summarizeInitialStockManifest();
  const actualAreaRows = areaDistribution.get("Impressoras")?.rows ?? 0;
  const actualAreaQuantity = areaDistribution.get("Impressoras")?.quantity ?? 0;
  const actualGeneralRows = areaDistribution.get("TI Geral")?.rows ?? 0;
  const actualGeneralQuantity = areaDistribution.get("TI Geral")?.quantity ?? 0;
  if (actualAreaRows !== manifestSummary.printerRows || actualAreaQuantity !== manifestSummary.printerQuantity) {
    addBlocker("Distribuição de Impressoras da entrada inicial não fecha com o manifesto 17 lotes / 884 unidades.");
  }
  if (actualGeneralRows !== manifestSummary.generalRows || actualGeneralQuantity !== manifestSummary.generalQuantity) {
    addBlocker("Distribuição de TI Geral da entrada inicial não fecha com o manifesto 36 lotes / 1.919 unidades.");
  }

  const gomaqLotById = new Map(gomaqLots.map((lot: any) => [lot._id as string, lot]));
  const gomaqLotByNumber = new Map(gomaqLots.map((lot: any) => [lot.lotNumber as string, lot]));
  for (const item of gomaqItems) {
    const product: any = await ctx.db.get(item.productId);
    if (!product) {
      addBlocker(`Produto do item Gomaq ${item._id} não encontrado.`);
      continue;
    }
    const location: any = item.locationId ? await ctx.db.get(item.locationId) : null;
    if (!location || !location.active || normalize(location.name) !== normalize("Armário TI 02")) {
      addBlocker(`Item Gomaq "${product.name}" não aponta para o Armário TI 02 ativo.`);
    }
    const lot = resolveLot(item.lotId, gomaqLotById, gomaqLotByNumber);
    if (!lot) {
      addBlocker(`Item Gomaq "${product.name}" não aponta para lote verificável.`);
      continue;
    }
    if (lot.entryId !== gomaqEntry?._id || lot.productId !== item.productId || Number(lot.quantityReceived) !== Number(item.quantity)) {
      addBlocker(`Lote Gomaq ${lot.lotNumber} não corresponde ao item "${product.name}".`);
      continue;
    }
    if (lot.areaId && lot.areaId !== printerArea?._id) {
      addBlocker(`Lote Gomaq ${lot.lotNumber} já possui área diferente de Impressoras.`);
    }
    if (lot.locationId && lot.locationId !== item.locationId) {
      addBlocker(`Lote Gomaq ${lot.lotNumber} já possui local físico diferente do item de entrada.`);
    }
    if (item.areaId && item.areaId !== printerArea?._id) {
      addBlocker(`Item Gomaq "${product.name}" já possui outra área.`);
    }
    if (location?.active && printerArea?.active) {
      const target = { areaId: printerArea._id as string, locationId: location._id as string };
      targetLotMeta.set(lot._id as string, target);
      addPatch(lotPatches, lot._id, lot, target);
      addPatch(itemPatches, item._id, item, { areaId: target.areaId });
      allTouchedProductIds.add(item.productId as string);
    }
  }

  if (initialItems.length === 53 && initialLots.length === 53 && gomaqItems.length === 8 && gomaqLots.length === 8) {
    const allTargetLots = [...initialLots, ...gomaqLots];
    if (new Set(allTargetLots.map((lot: any) => lot._id)).size !== 61) {
      addBlocker("Os dois escopos não contêm 61 lotes distintos.");
    }
  }

  // Solicitações aprovadas com saldo pendente bloqueiam a regularização.
  // Mesmo que o saldo reservado global esteja zerado, não se deve reclassificar
  // a origem física enquanto houver entrega aprovada ainda não concluída.
  const approvedRequests: any[] = await ctx.db.query("requests")
    .withIndex("by_status", (q: any) => q.eq("status", "approved")).collect();
  for (const request of approvedRequests) {
    const requestItems: any[] = await ctx.db.query("requestItems")
      .withIndex("by_request", (q: any) => q.eq("requestId", request._id)).collect();
    for (const item of requestItems) {
      if (
        allTouchedProductIds.has(item.productId as string) &&
        Number(item.quantityApproved) > Number(item.quantityDelivered ?? 0)
      ) {
        addBlocker(`Há solicitação aprovada ${request._id} com entrega pendente do produto ${item.productId}; conclua/cancele antes da regularização.`);
      }
    }
  }

  // Validate and prepare area-aware stockByLocation rows. The sum for each
  // product/location pair MUST remain exactly the same after splitting areas.
  const expectedGroups = new Map<string, { productId: string; locationId: string; areaId: string; quantity: number }>();
  const allLotsByProduct = new Map<string, any[]>();
  for (const productId of allTouchedProductIds) {
    const lots = await ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", productId as any)).collect();
    allLotsByProduct.set(productId, lots);
    for (const lot of lots) {
      if (!lot.active || Number(lot.quantityAvailable) <= 0) continue;
      const override = targetLotMeta.get(lot._id as string);
      const areaId = override?.areaId ?? lot.areaId;
      const locationId = override?.locationId ?? lot.locationId;
      if (!areaId || !locationId) {
        addBlocker(`Produto ${productId}: lote ativo ${lot.lotNumber} com saldo ${lot.quantityAvailable} sem área/local; conciliação cancelada.`);
        continue;
      }
      const k = keyOf(productId, locationId as string, areaId as string);
      const group = expectedGroups.get(k) ?? {
        productId, locationId: locationId as string, areaId: areaId as string, quantity: 0,
      };
      group.quantity += Number(lot.quantityAvailable);
      expectedGroups.set(k, group);
    }

    const stocks = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", productId as any)).collect();
    if (stocks.length !== 1) {
      addBlocker(`Produto ${productId}: esperado exatamente um registro global de estoque; encontrados ${stocks.length}.`);
    } else {
      const lotTotal = lots.filter((lot: any) => lot.active).reduce((sum: number, lot: any) => sum + Number(lot.quantityAvailable), 0);
      if (Number(stocks[0].physicalQuantity) !== lotTotal) {
        addBlocker(`Produto ${productId}: saldo global (${stocks[0].physicalQuantity}) difere da soma dos lotes (${lotTotal}).`);
      }
      if (Number(stocks[0].reservedQuantity) !== 0) {
        addBlocker(`Produto ${productId}: existem ${stocks[0].reservedQuantity} unidade(s) reservada(s); regularização bloqueada para não afetar solicitações em andamento.`);
      }
    }
  }

  const expectedPairs = new Map<string, Array<{ productId: string; locationId: string; areaId: string; quantity: number }>>();
  for (const group of expectedGroups.values()) {
    const pair = keyOf(group.productId, group.locationId);
    const values = expectedPairs.get(pair) ?? [];
    values.push(group);
    expectedPairs.set(pair, values);
  }

  for (const productId of allTouchedProductIds) {
    const rows: any[] = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", productId as any)).collect();
    const byLocation = new Map<string, any[]>();
    for (const row of rows) {
      const list = byLocation.get(row.locationId as string) ?? [];
      list.push(row);
      byLocation.set(row.locationId as string, list);
    }
    const locationIds = new Set<string>([
      ...rows.map((row: any) => row.locationId as string),
      ...Array.from(expectedGroups.values()).filter((group) => group.productId === productId).map((group) => group.locationId),
    ]);

    for (const locationId of locationIds) {
      const existingRows = byLocation.get(locationId) ?? [];
      const groups = expectedPairs.get(keyOf(productId, locationId)) ?? [];
      const expectedTotal = groups.reduce((sum, group) => sum + group.quantity, 0);
      const existingTotal = existingRows.reduce((sum, row) => sum + Number(row.quantity), 0);
      if (Math.abs(existingTotal - expectedTotal) > 1e-9) {
        addBlocker(`Produto ${productId} / local ${locationId}: saldo atual por localização ${existingTotal} difere dos lotes ${expectedTotal}.`);
        continue;
      }
      if (groups.length === 0) {
        if (existingRows.some((row) => Number(row.quantity) !== 0)) {
          addBlocker(`Produto ${productId} / local ${locationId}: há saldo sem lote ativo correspondente.`);
        }
        continue;
      }

      const groupByArea = new Map(groups.map((group) => [group.areaId, group]));
      const assigned = new Map<string, any>();
      const unassigned: any[] = [];
      for (const row of existingRows) {
        if (!row.areaId) {
          unassigned.push(row);
          continue;
        }
        if (!groupByArea.has(row.areaId)) {
          addBlocker(`Produto ${productId} / local ${locationId}: saldo já classificado em área sem lote correspondente.`);
          continue;
        }
        if (assigned.has(row.areaId)) {
          addBlocker(`Produto ${productId} / local ${locationId}: linhas duplicadas para a mesma área.`);
          continue;
        }
        assigned.set(row.areaId, row);
      }

      for (const group of groups) {
        let row = assigned.get(group.areaId);
        if (!row && unassigned.length) {
          row = unassigned.shift();
          assigned.set(group.areaId, row);
        }
        if (row) {
          addPatch(sblPatches, row._id, row, { areaId: group.areaId, quantity: group.quantity });
        } else {
          sblInserts.push(group);
        }
      }
      if (unassigned.length > 0) {
        addBlocker(`Produto ${productId} / local ${locationId}: há linhas de saldo excedentes sem área; não serão apagadas nem mescladas automaticamente.`);
      }
    }
  }

  const lotById = new Map<string, any>();
  const lotByNumber = new Map<string, any>();
  for (const lots of allLotsByProduct.values()) {
    for (const lot of lots) {
      lotById.set(lot._id as string, lot);
      lotByNumber.set(lot.lotNumber as string, lot);
    }
  }

  const movements: any[] = await ctx.db.query("stockMovements").collect();
  const movementById = new Map(movements.map((movement: any) => [movement._id as string, movement]));
  for (const movement of movements) {
    if (!allTouchedProductIds.has(movement.productId as string)) continue;
    const lot = resolveLot(movement.lotId, lotById, lotByNumber);
    if (!lot || lot.productId !== movement.productId) {
      addBlocker(`Movimentação ${movement._id} sem lote verificável correspondente ao produto.`);
      continue;
    }
    const override = targetLotMeta.get(lot._id as string);
    const areaId = override?.areaId ?? lot.areaId;
    const locationId = override?.locationId ?? lot.locationId;
    if (!areaId || !locationId) {
      addBlocker(`Movimentação ${movement._id}: lote ${lot.lotNumber} sem área/local.`);
      continue;
    }
    if (movement.areaId && movement.areaId !== areaId) {
      addBlocker(`Movimentação ${movement._id} já possui área diferente da área do lote.`);
    }
    if (movement.locationId && movement.locationId !== locationId) {
      addBlocker(`Movimentação ${movement._id} já possui local diferente do local do lote.`);
    }
    addPatch(movementPatches, movement._id, movement, { areaId, locationId });
  }

  const returns: any[] = await ctx.db.query("returns").collect();
  const returnedByExit = new Map<string, number>();
  for (const returnRow of returns) {
    if (!allTouchedProductIds.has(returnRow.productId as string)) continue;
    if (!returnRow.exitMovementId) {
      addBlocker(`Devolução ${returnRow._id} não possui vínculo com a saída original.`);
      continue;
    }
    const exit: any = movementById.get(returnRow.exitMovementId as string);
    if (!exit || exit.type !== "exit" || exit.productId !== returnRow.productId) {
      addBlocker(`Devolução ${returnRow._id} não aponta para uma saída válida do mesmo produto.`);
      continue;
    }
    const lot = resolveLot(exit.lotId, lotById, lotByNumber);
    if (!lot) {
      addBlocker(`Devolução ${returnRow._id}: lote da saída original não pode ser resolvido.`);
      continue;
    }
    const override = targetLotMeta.get(lot._id as string);
    const areaId = override?.areaId ?? lot.areaId;
    const locationId = override?.locationId ?? lot.locationId;
    if (!areaId || !locationId) {
      addBlocker(`Devolução ${returnRow._id}: lote original sem área/local.`);
      continue;
    }
    if (returnRow.lotId && returnRow.lotId !== lot._id) {
      addBlocker(`Devolução ${returnRow._id} já aponta para outro lote.`);
    }
    if (returnRow.areaId && returnRow.areaId !== areaId) {
      addBlocker(`Devolução ${returnRow._id} já possui área divergente.`);
    }
    if (returnRow.locationId && returnRow.locationId !== locationId) {
      addBlocker(`Devolução ${returnRow._id} já possui local físico divergente.`);
    }
    returnedByExit.set(exit._id as string, (returnedByExit.get(exit._id as string) ?? 0) + Number(returnRow.quantity));
    addPatch(returnPatches, returnRow._id, returnRow, {
      lotId: lot._id,
      areaId,
      locationId,
    });
  }
  for (const [exitId, returned] of returnedByExit) {
    const exit: any = movementById.get(exitId);
    if (returned > Number(exit.quantity)) {
      addBlocker(`Devoluções vinculadas à saída ${exitId} (${returned}) excedem a quantidade da saída (${exit.quantity}).`);
    }
  }

  const patchCount =
    lotPatches.length + itemPatches.length + movementPatches.length +
    returnPatches.length + sblPatches.length + sblInserts.length;

  return {
    blockers,
    ready: blockers.length === 0,
    changes: {
      lots: lotPatches.length,
      entryItems: itemPatches.length,
      stockByLocationUpdates: sblPatches.length,
      stockByLocationInserts: sblInserts.length,
      stockMovements: movementPatches.length,
      returns: returnPatches.length,
      totalWrites: patchCount,
    },
    source: {
      initialEntry: INITIAL_ENTRY_NUMBER,
      initialItems: initialItems.length,
      initialLots: initialLots.length,
      gomaqEntry: GOMAQ_ENTRY_NUMBER,
      gomaqInvoice: GOMAQ_INVOICE_NUMBER,
      gomaqItems: gomaqItems.length,
      gomaqLots: gomaqLots.length,
    },
    expectedManifest: manifestSummary,
    detectedDistribution: {
      areas: Object.fromEntries(areaDistribution),
      locations: Object.fromEntries(itemLocationDistribution),
      correctedEntryItemUnits: itemUomChanges,
    },
    quantityInvariants: {
      globalStockRowsChecked: allTouchedProductIds.size,
      stockGlobalQuantitiesWillChange: false,
      stockReservedQuantitiesWillChange: false,
      lotQuantitiesWillChange: false,
      entryQuantitiesWillChange: false,
      movementQuantitiesWillChange: false,
      stockByLocationPairTotalsWillChange: false,
    },
    internal: { lotPatches, itemPatches, movementPatches, returnPatches, sblPatches, sblInserts },
  };
}

export const preview = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "stock.view", { entity: "stockRegularization" });
    const plan = await buildRegularizationPlan(ctx);
    const { internal: _internal, ...report } = plan;
    return report;
  },
});

export const apply = mutation({
  args: {
    confirmation: v.literal(CONFIRMATION),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "stock.mutate", { entity: "stockRegularization" });
    if (args.confirmation !== CONFIRMATION) throw new Error("Confirmação de regularização inválida.");

    const plan = await buildRegularizationPlan(ctx);
    if (plan.blockers.length > 0) {
      throw new Error(
        "Regularização interrompida; nenhuma alteração foi aplicada. Corrija primeiro: " +
        plan.blockers.slice(0, 12).join(" | ")
      );
    }

    const {
      lotPatches, itemPatches, movementPatches,
      returnPatches, sblPatches, sblInserts,
    } = plan.internal;
    for (const update of lotPatches) await ctx.db.patch(update.id as any, update.fields);
    for (const update of itemPatches) await ctx.db.patch(update.id as any, update.fields);
    for (const update of sblPatches) await ctx.db.patch(update.id as any, update.fields);
    for (const row of sblInserts) await ctx.db.insert("stockByLocation", row as any);
    for (const update of movementPatches) await ctx.db.patch(update.id as any, update.fields);
    for (const update of returnPatches) await ctx.db.patch(update.id as any, update.fields);

    if (plan.changes.totalWrites > 0) {
      await ctx.db.insert("auditLogs", {
        userId,
        action: "update",
        entity: "stock",
        entityId: "regularizacao-area-local-v1",
        details:
          `Regularização de área/local concluída. Lotes: ${plan.changes.lots}; itens de entrada: ${plan.changes.entryItems}; ` +
          `saldos atualizados: ${plan.changes.stockByLocationUpdates}; saldos criados: ${plan.changes.stockByLocationInserts}; ` +
          `movimentações: ${plan.changes.stockMovements}; devoluções: ${plan.changes.returns}. ` +
          "Quantidades globais, reservas, lotes e movimentos preservados; totais por produto/local preservados.",
        timestamp: Date.now(),
      });
    }

    return {
      applied: plan.changes.totalWrites > 0,
      idempotentNoOp: plan.changes.totalWrites === 0,
      changes: plan.changes,
      quantityInvariants: plan.quantityInvariants,
    };
  },
});
