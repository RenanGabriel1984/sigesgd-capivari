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
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
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

type AreaLocation = { areaId: Id<"stockAreas">; locationId: Id<"storageLocations"> };
type PatchableTable = "lots" | "entryItems" | "stockMovements" | "stockMovementLots" | "returns" | "stockByLocation";
type Patch<T extends PatchableTable> = { id: Id<T>; fields: Partial<Doc<T>> };

const keyOf = (...parts: string[]) => parts.join("|");
const normalize = (value?: string | null) => (value ?? "").trim().toLocaleLowerCase("pt-BR");

function addPatch<T extends PatchableTable>(
  target: Patch<T>[],
  id: Id<T>,
  current: Doc<T>,
  fields: Partial<Doc<T>>,
): void {
  const changed: Partial<Doc<T>> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (current[key as keyof Doc<T>] !== value) Object.assign(changed, { [key]: value });
  }
  if (Object.keys(changed).length) target.push({ id, fields: changed });
}

function resolveLot(
  reference: unknown,
  byId: Map<string, Doc<"lots">>,
  byNumber: Map<string, Doc<"lots">[]>,
  productId?: Id<"products">,
): Doc<"lots"> | null {
  if (typeof reference !== "string" || !reference.trim()) return null;
  const exactId = byId.get(reference);
  if (exactId) return exactId;
  if (!productId) return null;
  const matches = byNumber.get(keyOf(productId, reference)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

async function buildRegularizationPlan(ctx: QueryCtx | MutationCtx) {
  const blockers: string[] = [];
  const addBlocker = (message: string) => {
    if (!blockers.includes(message)) blockers.push(message);
  };

  const areas = await ctx.db.query("stockAreas").collect();
  const areasByName = new Map<string, (typeof areas)[number][]>();
  for (const area of areas) {
    const key = normalize(area.name);
    const matches = areasByName.get(key) ?? [];
    matches.push(area);
    areasByName.set(key, matches);
  }
  const resolveUniqueArea = (name: string) => {
    const matches = areasByName.get(normalize(name)) ?? [];
    if (matches.length > 1) addBlocker(`Existem ${matches.length} cadastros da área "${name}"; regularize a duplicidade.`);
    return matches.length === 1 ? matches[0] : null;
  };
  const generalArea = resolveUniqueArea("TI Geral");
  const printerArea = resolveUniqueArea("Impressoras");
  if (!generalArea?.active) addBlocker('Área ativa "TI Geral" não encontrada ou ambígua.');
  if (!printerArea?.active) addBlocker('Área ativa "Impressoras" não encontrada ou ambígua.');

  const locations = await ctx.db.query("storageLocations").collect();
  const locationsByName = new Map<string, (typeof locations)[number][]>();
  for (const location of locations) {
    const key = normalize(location.name);
    const matches = locationsByName.get(key) ?? [];
    matches.push(location);
    locationsByName.set(key, matches);
  }
  const resolveUniqueLocation = (name: string) => {
    const matches = locationsByName.get(normalize(name)) ?? [];
    if (matches.length > 1) addBlocker(`Existem ${matches.length} cadastros do local "${name}"; regularize a duplicidade.`);
    return matches.length === 1 ? matches[0] : null;
  };
  const cabinet1 = resolveUniqueLocation("Armário TI 01");
  const cabinet2 = resolveUniqueLocation("Armário TI 02");
  if (!cabinet1?.active) addBlocker('Local físico ativo "Armário TI 01" não encontrado ou ambíguo.');
  if (!cabinet2?.active) addBlocker('Local físico ativo "Armário TI 02" não encontrado ou ambíguo.');

  const initialEntries = await ctx.db.query("entries")
    .withIndex("by_number", (q) => q.eq("entryNumber", INITIAL_ENTRY_NUMBER)).collect();
  const gomaqEntries = await ctx.db.query("entries")
    .withIndex("by_number", (q) => q.eq("entryNumber", GOMAQ_ENTRY_NUMBER)).collect();
  if (initialEntries.length !== 1) addBlocker(`Esperada exatamente uma entrada ${INITIAL_ENTRY_NUMBER}; encontradas ${initialEntries.length}.`);
  if (gomaqEntries.length !== 1) addBlocker(`Esperada exatamente uma entrada ${GOMAQ_ENTRY_NUMBER}; encontradas ${gomaqEntries.length}.`);
  const initialEntry = initialEntries.length === 1 ? initialEntries[0] : null;
  const gomaqEntry = gomaqEntries.length === 1 ? gomaqEntries[0] : null;

  const lotPatches: Patch<"lots">[] = [];
  const itemPatches: Patch<"entryItems">[] = [];
  const movementPatches: Patch<"stockMovements">[] = [];
  const movementLotPatches: Patch<"stockMovementLots">[] = [];
  const returnPatches: Patch<"returns">[] = [];
  const sblPatches: Patch<"stockByLocation">[] = [];
  const sblInserts: Array<{ productId: Id<"products">; locationId: Id<"storageLocations">; areaId: Id<"stockAreas">; quantity: number }> = [];
  const targetLotMeta = new Map<string, AreaLocation>();
  const allTouchedProductIds = new Set<Id<"products">>();
  const itemUomChanges: Array<{ productName: string; from: string; to: string }> = [];
  const itemLocationDistribution = new Map<string, { rows: number; quantity: number }>();
  const areaDistribution = new Map<string, { rows: number; quantity: number }>();

  const initialItems = initialEntry
    ? await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", initialEntry._id)).collect()
    : [];
  const initialLots = initialEntry
    ? await ctx.db.query("lots").withIndex("by_entry", (q) => q.eq("entryId", initialEntry._id)).collect()
    : [];
  const gomaqItems = gomaqEntry
    ? await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", gomaqEntry._id)).collect()
    : [];
  const gomaqLots = gomaqEntry
    ? await ctx.db.query("lots").withIndex("by_entry", (q) => q.eq("entryId", gomaqEntry._id)).collect()
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
  const gomaqItemQuantity = gomaqItems.reduce((sum: number, item) => sum + Number(item.quantity), 0);
  const gomaqLotQuantity = gomaqLots.reduce((sum: number, lot) => sum + Number(lot.quantityReceived), 0);
  if (gomaqItemQuantity !== 535 || gomaqLotQuantity !== 535) {
    addBlocker(`NF Gomaq 372043 diverge do total físico auditado de 535 unidades (itens: ${gomaqItemQuantity}; lotes: ${gomaqLotQuantity}).`);
  }

  const manifestByName = new Map(INITIAL_STOCK_MANIFEST.map((row) => [normalize(row.productName), row]));
  const usedManifestNames = new Set<string>();
  const initialLotById = new Map(initialLots.map((lot) => [String(lot._id), lot] as const));
  const initialLotByNumber = new Map<string, Doc<"lots">[]>();
  for (const lot of initialLots) {
    const key = keyOf(lot.productId, lot.lotNumber);
    const matches = initialLotByNumber.get(key) ?? [];
    matches.push(lot);
    initialLotByNumber.set(key, matches);
    if (matches.length > 1) {
      addBlocker(`Lote da entrada inicial duplicado para produto/número ${lot.productId}/${lot.lotNumber}; referência por número não será inferida.`);
    }
  }

  for (const item of initialItems) {
    const product = await ctx.db.get(item.productId);
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

    const location = item.locationId ? await ctx.db.get(item.locationId) : null;
    const expectedLocation = resolveUniqueLocation(manifest.locationName);
    if (!expectedLocation?.active) {
      addBlocker(`Local físico esperado "${manifest.locationName}" não está ativo ou é ambíguo.`);
    }
    if (!location || !location.active) {
      addBlocker(`Item "${productName}" não possui local físico válido registrado.`);
    } else if (normalize(location.name) !== normalize(manifest.locationName)) {
      addBlocker(`Local físico de "${productName}" diverge da planilha (${location.name} / ${manifest.locationName}).`);
    }

    const lot = resolveLot(item.lotId, initialLotById, initialLotByNumber, item.productId);
    if (!lot) {
      addBlocker(`Item "${productName}" não aponta para lote verificável.`);
      continue;
    }
    if (lot.entryId !== initialEntry?._id || lot.productId !== item.productId || Number(lot.quantityReceived) !== manifest.quantity) {
      addBlocker(`Lote ${lot.lotNumber} não corresponde ao item "${productName}" em entrada/produto/quantidade.`);
      continue;
    }
    if (!location || !expectedLocation?.active || !generalArea?.active || !printerArea?.active) continue;

    const area = resolveUniqueArea(manifest.areaName);
    if (!area?.active) {
      addBlocker(`Área esperada "${manifest.areaName}" não está ativa ou é ambígua.`);
      continue;
    }
    const target: AreaLocation = { areaId: area._id, locationId: location._id };
    if (lot.areaId && lot.areaId !== target.areaId) {
      addBlocker(`Lote ${lot.lotNumber} já possui área diferente do manifesto.`);
    }
    if (lot.locationId && lot.locationId !== target.locationId) {
      addBlocker(`Lote ${lot.lotNumber} já possui local físico diferente do item de entrada.`);
    }
    if (item.areaId && item.areaId !== target.areaId) {
      addBlocker(`Item da entrada "${productName}" já possui outra área.`);
    }

    targetLotMeta.set(String(lot._id), target);
    addPatch(lotPatches, lot._id, lot, target);
    addPatch(itemPatches, item._id, item, { areaId: target.areaId });

    allTouchedProductIds.add(item.productId);
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

  const gomaqLotById = new Map(gomaqLots.map((lot) => [String(lot._id), lot] as const));
  const gomaqLotByNumber = new Map<string, Doc<"lots">[]>();
  for (const lot of gomaqLots) {
    const key = keyOf(lot.productId, lot.lotNumber);
    const matches = gomaqLotByNumber.get(key) ?? [];
    matches.push(lot);
    gomaqLotByNumber.set(key, matches);
    if (matches.length > 1) {
      addBlocker(`Lote Gomaq duplicado para produto/número ${lot.productId}/${lot.lotNumber}; vínculo legado não será inferido.`);
    }
  }
  for (const item of gomaqItems) {
    const product = await ctx.db.get(item.productId);
    if (!product) {
      addBlocker(`Produto do item Gomaq ${item._id} não encontrado.`);
      continue;
    }
    const location = item.locationId ? await ctx.db.get(item.locationId) : null;
    if (!location || !location.active || normalize(location.name) !== normalize("Armário TI 02")) {
      addBlocker(`Item Gomaq "${product.name}" não aponta para o Armário TI 02 ativo.`);
    }
    const lot = resolveLot(item.lotId, gomaqLotById, gomaqLotByNumber, item.productId);
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
      const target: AreaLocation = { areaId: printerArea._id, locationId: location._id };
      targetLotMeta.set(String(lot._id), target);
      addPatch(lotPatches, lot._id, lot, target);
      addPatch(itemPatches, item._id, item, { areaId: target.areaId });
      allTouchedProductIds.add(item.productId);
    }
  }

  if (initialItems.length === 53 && initialLots.length === 53 && gomaqItems.length === 8 && gomaqLots.length === 8) {
    const allTargetLots = [...initialLots, ...gomaqLots];
    if (new Set(allTargetLots.map((lot) => lot._id)).size !== 61) {
      addBlocker("Os dois escopos não contêm 61 lotes distintos.");
    }
  }

  // Reservas por lote também bloqueiam a regularização, mesmo se o contador global estiver divergente.
  const activeReservations = await ctx.db.query("requestItemReservations").collect();
  for (const reservation of activeReservations) {
    if (
      allTouchedProductIds.has(reservation.productId) &&
      Number(reservation.quantityRemaining) > 0
    ) {
      addBlocker(`Há ${reservation.quantityRemaining} unidade(s) reservada(s) no lote ${reservation.lotId}; conclua/cancele a solicitação antes da regularização.`);
    }
  }

  // Solicitações aprovadas com saldo pendente bloqueiam a regularização.
  // Mesmo que o saldo reservado global esteja zerado, não se deve reclassificar
  // a origem física enquanto houver entrega aprovada ainda não concluída.
  const approvedRequests = await ctx.db.query("requests")
    .withIndex("by_status", (q) => q.eq("status", "approved")).collect();
  for (const request of approvedRequests) {
    const requestItems = await ctx.db.query("requestItems")
      .withIndex("by_request", (q) => q.eq("requestId", request._id)).collect();
    for (const item of requestItems) {
      if (
        allTouchedProductIds.has(item.productId) &&
        Number(item.quantityApproved) > Number(item.quantityDelivered ?? 0)
      ) {
        addBlocker(`Há solicitação aprovada ${request._id} com entrega pendente do produto ${item.productId}; conclua/cancele antes da regularização.`);
      }
    }
  }

  // Validate and prepare area-aware stockByLocation rows. The sum for each
  // product/location pair MUST remain exactly the same after splitting areas.
  const expectedGroups = new Map<string, { productId: Id<"products">; locationId: Id<"storageLocations">; areaId: Id<"stockAreas">; quantity: number }>();
  const allLotsByProduct = new Map<Id<"products">, Doc<"lots">[]>();
  for (const productId of allTouchedProductIds) {
    const lots = await ctx.db.query("lots").withIndex("by_product", (q) => q.eq("productId", productId)).collect();
    allLotsByProduct.set(productId, lots);
    for (const lot of lots) {
      if (!lot.active || Number(lot.quantityAvailable) <= 0) continue;
      const override = targetLotMeta.get(String(lot._id));
      const areaId = override?.areaId ?? lot.areaId;
      const locationId = override?.locationId ?? lot.locationId;
      if (!areaId || !locationId) {
        addBlocker(`Produto ${productId}: lote ativo ${lot.lotNumber} com saldo ${lot.quantityAvailable} sem área/local; conciliação cancelada.`);
        continue;
      }
      const k = keyOf(productId, locationId, areaId);
      const group = expectedGroups.get(k) ?? {
        productId, locationId, areaId, quantity: 0,
      };
      group.quantity += Number(lot.quantityAvailable);
      expectedGroups.set(k, group);
    }

    const stocks = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", productId)).collect();
    if (stocks.length !== 1) {
      addBlocker(`Produto ${productId}: esperado exatamente um registro global de estoque; encontrados ${stocks.length}.`);
    } else {
      const lotTotal = lots.filter((lot) => lot.active).reduce((sum: number, lot) => sum + Number(lot.quantityAvailable), 0);
      if (Number(stocks[0].physicalQuantity) !== lotTotal) {
        addBlocker(`Produto ${productId}: saldo global (${stocks[0].physicalQuantity}) difere da soma dos lotes (${lotTotal}).`);
      }
      if (Number(stocks[0].reservedQuantity) !== 0) {
        addBlocker(`Produto ${productId}: existem ${stocks[0].reservedQuantity} unidade(s) reservada(s); regularização bloqueada para não afetar solicitações em andamento.`);
      }
    }
  }

  const expectedPairs = new Map<string, Array<{ productId: Id<"products">; locationId: Id<"storageLocations">; areaId: Id<"stockAreas">; quantity: number }>>();
  for (const group of expectedGroups.values()) {
    const pair = keyOf(group.productId, group.locationId);
    const values = expectedPairs.get(pair) ?? [];
    values.push(group);
    expectedPairs.set(pair, values);
  }

  for (const productId of allTouchedProductIds) {
    const rows = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q) => q.eq("productId", productId)).collect();
    const byLocation = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) {
      const list = byLocation.get(String(row.locationId)) ?? [];
      list.push(row);
      byLocation.set(String(row.locationId), list);
    }
    const locationIds = new Set<string>([
      ...rows.map((row) => String(row.locationId)),
      ...Array.from(expectedGroups.values()).filter((group) => group.productId === productId).map((group) => String(group.locationId)),
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

      const groupByArea = new Map(groups.map((group) => [String(group.areaId), group] as const));
      const assigned = new Map<string, (typeof existingRows)[number]>();
      const unassigned: (typeof existingRows)[number][] = [];
      for (const row of existingRows) {
        if (!row.areaId) {
          unassigned.push(row);
          continue;
        }
        if (!groupByArea.has(String(row.areaId))) {
          addBlocker(`Produto ${productId} / local ${locationId}: saldo já classificado em área sem lote correspondente.`);
          continue;
        }
        if (assigned.has(String(row.areaId))) {
          addBlocker(`Produto ${productId} / local ${locationId}: linhas duplicadas para a mesma área.`);
          continue;
        }
        assigned.set(String(row.areaId), row);
      }

      for (const group of groups) {
        let row = assigned.get(String(group.areaId));
        if (!row && unassigned.length) {
          row = unassigned.shift()!;
          assigned.set(String(group.areaId), row);
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

  const lotById = new Map<string, Doc<"lots">>();
  const lotByNumber = new Map<string, Doc<"lots">[]>();
  for (const lots of allLotsByProduct.values()) {
    for (const lot of lots) {
      lotById.set(String(lot._id), lot);
      const key = keyOf(lot.productId, lot.lotNumber);
      const matches = lotByNumber.get(key) ?? [];
      matches.push(lot);
      lotByNumber.set(key, matches);
      if (matches.length > 1) {
        addBlocker(`Lote duplicado para produto/número ${lot.productId}/${lot.lotNumber}; referências por número ficam bloqueadas.`);
      }
    }
  }

  const movements = await ctx.db.query("stockMovements").collect();
  const movementById = new Map(movements.map((movement) => [String(movement._id), movement] as const));
  const movementLotLinks = await ctx.db.query("stockMovementLots").collect();
  const linksByMovement = new Map<string, (typeof movementLotLinks)[number][]>();
  for (const link of movementLotLinks) {
    const key = String(link.movementId);
    const current = linksByMovement.get(key) ?? [];
    current.push(link);
    linksByMovement.set(key, current);
  }
  // Movimentações antigas de transferência não tinham stockMovementLots.
  // Recupera a origem pelo vínculo histórico stockTransfers → stockTransferLots.
  const transfers = await ctx.db.query("stockTransfers").collect();
  const transferLots = await ctx.db.query("stockTransferLots").collect();
  const transferLotsByTransfer = new Map<string, (typeof transferLots)[number][]>();
  for (const link of transferLots) {
    const key = String(link.transferId);
    const current = transferLotsByTransfer.get(key) ?? [];
    current.push(link);
    transferLotsByTransfer.set(key, current);
  }

  for (const movement of movements) {
    if (!allTouchedProductIds.has(movement.productId)) continue;
    const links = linksByMovement.get(String(movement._id)) ?? [];
    const sources: Array<{ lot: Doc<"lots">; link?: Doc<"stockMovementLots"> }> = [];

    if (links.length > 0) {
      const linkedQuantity = links.reduce((sum: number, link) => sum + Number(link.quantity), 0);
      if (Math.abs(linkedQuantity - Number(movement.quantity)) > 1e-9) {
        addBlocker(`Movimentação ${movement._id}: soma dos lotes vinculados (${linkedQuantity}) diverge da quantidade (${movement.quantity}).`);
      }
      for (const link of links) {
        const lot = resolveLot(link.lotId, lotById, lotByNumber, movement.productId);
        if (!lot || lot.productId !== movement.productId) {
          addBlocker(`Movimentação ${movement._id} possui vínculo com lote ausente ou de outro produto.`);
          continue;
        }
        sources.push({ lot, link });
      }
    } else if (movement.type === "transfer") {
      const matches = transfers.filter((transfer) =>
        transfer.productId === movement.productId &&
        Number(transfer.quantity) === Number(movement.quantity) &&
        transfer.fromLocationId === movement.locationId &&
        transfer.toLocationId === movement.toLocationId &&
        (transfer.fromAreaId ?? undefined) === (movement.areaId ?? undefined) &&
        (transfer.toAreaId ?? undefined) === (movement.toAreaId ?? undefined) &&
        transfer.createdAt === movement.timestamp
      );
      if (matches.length !== 1) {
        addBlocker(`Transferência histórica da movimentação ${movement._id} não pôde ser identificada de forma única.`);
        continue;
      }
      const transfer = matches[0];
      const transferLinks = transferLotsByTransfer.get(String(transfer._id)) ?? [];
      if (transferLinks.length > 0) {
        const linkedQuantity = transferLinks.reduce((sum: number, link) => sum + Number(link.quantity), 0);
        if (Math.abs(linkedQuantity - Number(movement.quantity)) > 1e-9) {
          addBlocker(`Transferência ${transfer._id}: soma dos lotes de origem diverge da movimentação.`);
        }
        for (const link of transferLinks) {
          const lot = resolveLot(link.sourceLotId, lotById, lotByNumber, movement.productId);
          if (!lot || lot.productId !== movement.productId) {
            addBlocker(`Transferência ${transfer._id} possui lote de origem ausente ou de outro produto.`);
            continue;
          }
          sources.push({ lot });
        }
      } else {
        const lot = resolveLot(transfer.lotId, lotById, lotByNumber, movement.productId);
        if (!lot || lot.productId !== movement.productId) {
          addBlocker(`Transferência ${transfer._id} não possui vínculo verificável com lote de origem.`);
          continue;
        }
        sources.push({ lot });
      }
    } else {
      const lot = resolveLot(movement.lotId, lotById, lotByNumber, movement.productId);
      if (!lot || lot.productId !== movement.productId) {
        addBlocker(`Movimentação ${movement._id} sem lote verificável correspondente ao produto.`);
        continue;
      }
      sources.push({ lot });
    }

    const pairs: AreaLocation[] = [];
    for (const source of sources) {
      const override = targetLotMeta.get(String(source.lot._id));
      const areaId = override?.areaId ?? source.lot.areaId;
      const locationId = override?.locationId ?? source.lot.locationId;
      if (!areaId || !locationId) {
        addBlocker(`Movimentação ${movement._id}: lote ${source.lot.lotNumber} sem área/local.`);
        continue;
      }
      if (source.link) {
        if (source.link.areaId && source.link.areaId !== areaId) {
          addBlocker(`Vínculo de lote da movimentação ${movement._id} já possui área divergente.`);
        }
        if (source.link.locationId && source.link.locationId !== locationId) {
          addBlocker(`Vínculo de lote da movimentação ${movement._id} já possui local divergente.`);
        }
        addPatch(movementLotPatches, source.link._id, source.link, { areaId, locationId });
      }
      pairs.push({ areaId, locationId });
    }

    const uniquePairs = new Map(pairs.map((pair) => [keyOf(pair.areaId, pair.locationId), pair]));
    if (uniquePairs.size === 1) {
      const pair = [...uniquePairs.values()][0];
      if (movement.areaId && movement.areaId !== pair.areaId) {
        addBlocker(`Movimentação ${movement._id} já possui área diferente dos lotes vinculados.`);
      }
      if (movement.locationId && movement.locationId !== pair.locationId) {
        addBlocker(`Movimentação ${movement._id} já possui local diferente dos lotes vinculados.`);
      }
      addPatch(movementPatches, movement._id, movement, pair);
    } else if (uniquePairs.size > 1 && (movement.areaId || movement.locationId)) {
      // Uma movimentação multi-lote com origens distintas não pode carregar
      // uma única área/local; a trilha individual fica em stockMovementLots.
      addPatch(movementPatches, movement._id, movement, { areaId: undefined, locationId: undefined });
    }
  }

  const returns = await ctx.db.query("returns").collect();
  const returnedByExit = new Map<string, number>();
  const returnedByExitLot = new Map<string, { exitId: string; lotId: string; quantity: number }>();
  for (const returnRow of returns) {
    if (!allTouchedProductIds.has(returnRow.productId)) continue;
    if (!returnRow.exitMovementId) {
      addBlocker(`Devolução ${returnRow._id} não possui vínculo com a saída original.`);
      continue;
    }
    const exit = movementById.get(String(returnRow.exitMovementId));
    if (!exit || exit.type !== "exit" || exit.productId !== returnRow.productId) {
      addBlocker(`Devolução ${returnRow._id} não aponta para uma saída válida do mesmo produto.`);
      continue;
    }
    const exitLinks = linksByMovement.get(String(exit._id)) ?? [];
    const exitLots = exitLinks
      .map((link) => resolveLot(link.lotId, lotById, lotByNumber, exit.productId))
      .filter((lot): lot is Doc<"lots"> => lot !== null && lot.productId === exit.productId);
    if (exitLinks.length > 0 && exitLots.length !== exitLinks.length) {
      addBlocker(`Devolução ${returnRow._id}: a trilha multi-lote da saída original está incompleta.`);
      continue;
    }
    const candidateLots = exitLots.length > 0
      ? exitLots
      : [resolveLot(exit.lotId, lotById, lotByNumber, exit.productId)].filter((candidate): candidate is Doc<"lots"> => candidate !== null);
    const lot = returnRow.lotId
      ? resolveLot(returnRow.lotId, lotById, lotByNumber, returnRow.productId)
      : candidateLots.length === 1 ? candidateLots[0] : null;
    if (!lot || lot.productId !== exit.productId || !candidateLots.some((candidate) => candidate._id === lot._id)) {
      addBlocker(`Devolução ${returnRow._id}: informe/vincule o lote exato consumido pela saída original.`);
      continue;
    }
    const override = targetLotMeta.get(String(lot._id));
    const areaId = override?.areaId ?? lot.areaId;
    const locationId = override?.locationId ?? lot.locationId;
    if (!areaId || !locationId) {
      addBlocker(`Devolução ${returnRow._id}: lote original sem área/local.`);
      continue;
    }
    if (returnRow.areaId && returnRow.areaId !== areaId) {
      addBlocker(`Devolução ${returnRow._id} já possui área divergente.`);
    }
    if (returnRow.locationId && returnRow.locationId !== locationId) {
      addBlocker(`Devolução ${returnRow._id} já possui local físico divergente.`);
    }
    returnedByExit.set(exit._id as string, (returnedByExit.get(exit._id as string) ?? 0) + Number(returnRow.quantity));
    const exitLotKey = keyOf(exit._id as string, lot._id as string);
    const priorLotReturn = returnedByExitLot.get(exitLotKey);
    returnedByExitLot.set(exitLotKey, {
      exitId: exit._id as string,
      lotId: lot._id as string,
      quantity: (priorLotReturn?.quantity ?? 0) + Number(returnRow.quantity),
    });
    addPatch(returnPatches, returnRow._id, returnRow, {
      lotId: lot._id,
      areaId,
      locationId,
    });
  }
  for (const [exitId, returned] of returnedByExit) {
    const exit = movementById.get(exitId);
    if (!exit) {
      addBlocker(`Saída ${exitId} referenciada por devolução não foi encontrada.`);
      continue;
    }
    if (returned > Number(exit.quantity)) {
      addBlocker(`Devoluções vinculadas à saída ${exitId} (${returned}) excedem a quantidade da saída (${exit.quantity}).`);
    }
  }
  for (const returned of returnedByExitLot.values()) {
    const exitLinks = linksByMovement.get(returned.exitId) ?? [];
    const consumedFromLot = exitLinks.length > 0
      ? exitLinks.filter((link) => String(link.lotId) === returned.lotId)
          .reduce((sum: number, link) => sum + Number(link.quantity), 0)
      : Number(movementById.get(returned.exitId)?.quantity ?? 0);
    if (returned.quantity > consumedFromLot) {
      addBlocker(`Devoluções da saída ${returned.exitId} para o lote ${returned.lotId} (${returned.quantity}) excedem o consumo desse lote (${consumedFromLot}).`);
    }
  }

  const patchCount =
    lotPatches.length + itemPatches.length + movementPatches.length +
    movementLotPatches.length + returnPatches.length + sblPatches.length + sblInserts.length;

  return {
    blockers,
    ready: blockers.length === 0,
    changes: {
      lots: lotPatches.length,
      entryItems: itemPatches.length,
      stockByLocationUpdates: sblPatches.length,
      stockByLocationInserts: sblInserts.length,
      stockMovements: movementPatches.length,
      stockMovementLots: movementLotPatches.length,
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
    internal: { lotPatches, itemPatches, movementPatches, movementLotPatches, returnPatches, sblPatches, sblInserts },
  };
}

export const preview = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "stock.view", { entity: "stockRegularization" });
    const plan = await buildRegularizationPlan(ctx);
    const { internal, ...report } = plan;
    void internal;
    return report;
  },
});

export const apply = mutation({
  args: {
    confirmation: v.literal(CONFIRMATION),
  },
  handler: async (ctx, args) => {
    const { userId, role } = await requirePermission(ctx, "stock.mutate", { entity: "stockRegularization" });
    if (role !== "admin") {
      throw new Error("A aplicação da regularização histórica é exclusiva do perfil administrador.");
    }
    if (args.confirmation !== CONFIRMATION) throw new Error("Confirmação de regularização inválida.");

    const plan = await buildRegularizationPlan(ctx);
    if (plan.blockers.length > 0) {
      throw new Error(
        "Regularização interrompida; nenhuma alteração foi aplicada. Corrija primeiro: " +
        plan.blockers.slice(0, 12).join(" | ")
      );
    }

    const {
      lotPatches, itemPatches, movementPatches, movementLotPatches,
      returnPatches, sblPatches, sblInserts,
    } = plan.internal;
    for (const update of lotPatches) await ctx.db.patch(update.id, update.fields);
    for (const update of itemPatches) await ctx.db.patch(update.id, update.fields);
    for (const update of sblPatches) await ctx.db.patch(update.id, update.fields);
    for (const row of sblInserts) await ctx.db.insert("stockByLocation", row);
    for (const update of movementLotPatches) await ctx.db.patch(update.id, update.fields);
    for (const update of movementPatches) await ctx.db.patch(update.id, update.fields);
    for (const update of returnPatches) await ctx.db.patch(update.id, update.fields);

    if (plan.changes.totalWrites > 0) {
      await ctx.db.insert("auditLogs", {
        userId,
        action: "update",
        entity: "stock",
        entityId: "regularizacao-area-local-v1",
        details:
          `Regularização de área/local concluída. Lotes: ${plan.changes.lots}; itens de entrada: ${plan.changes.entryItems}; ` +
          `saldos atualizados: ${plan.changes.stockByLocationUpdates}; saldos criados: ${plan.changes.stockByLocationInserts}; ` +
          `movimentações: ${plan.changes.stockMovements}; vínculos de lotes: ${plan.changes.stockMovementLots}; devoluções: ${plan.changes.returns}. ` +
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
