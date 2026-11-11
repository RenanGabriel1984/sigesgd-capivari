import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

const INITIAL_ENTRY_NUMBER = "ENT-2026-000001";
const GOMAQ_ENTRY_NUMBER = "ENT-2026-000002";

const INITIAL_AREAS: Record<string, "TI Geral" | "Impressoras"> = {
  "Cooler para processador Intel": "TI Geral",
  "Teclado KB 110 com fio": "TI Geral",
  "Teclado com fio": "TI Geral",
  "Kit teclado e mouse": "TI Geral",
  "Teclado numérico": "TI Geral",
  "Leitor de DVD": "TI Geral",
  "Cartão PVC para crachá": "Impressoras",
  "Mouse com fio": "TI Geral",
  "Mouse wireless": "TI Geral",
  "Pasta térmica": "TI Geral",
  "Conector RJ45 Cat5E": "TI Geral",
  "Conector RJ45 blindado CAT5": "TI Geral",
  "Conector RJ45": "TI Geral",
  "Cadeado chave tetra": "TI Geral",
  "Jogo de chaves — 6 peças": "TI Geral",
  "Jogo de chaves — 8 peças": "TI Geral",
  "Módulo para tomada": "TI Geral",
  "Caixa com tampa de sobrepor para tomada": "TI Geral",
  "Limpa contato": "TI Geral",
  "Keystone Jack para RJ45": "TI Geral",
  "Conector linear de emenda para cabo RJ45 CAT6": "TI Geral",
  "Hub USB 3.0": "TI Geral",
  "Fita isolante": "TI Geral",
  "Adaptador HDMI para VGA": "TI Geral",
  "Cabo adaptador DisplayPort para VGA": "TI Geral",
  "Pilha AAA": "TI Geral",
  "Teclado": "TI Geral",
  "Switch JetStream 8 portas": "TI Geral",
  "Switch 26 portas": "TI Geral",
  "Switch 5 portas 10/100 PoE": "TI Geral",
  "Telefone VoIP TIP 125I": "TI Geral",
  "Telefone VoIP V5502": "TI Geral",
  "RouterBoard": "TI Geral",
  "Telefone VoIP TIP 125I — Montado": "TI Geral",
  "Protetor de crachá — caixa fechada": "Impressoras",
  "Protetor de crachá — unidade avulsa": "Impressoras",
  "Mousepad": "TI Geral",
  "Abraçadeira de nylon": "TI Geral",
  "Telefone": "TI Geral",
  "Toner VersaLink — Preto": "Impressoras",
  "Toner VersaLink — Ciano": "Impressoras",
  "Toner VersaLink — Magenta": "Impressoras",
  "Toner VersaLink — Amarelo": "Impressoras",
  "Toner AltaLink — Preto": "Impressoras",
  "Toner AltaLink — Ciano": "Impressoras",
  "Toner AltaLink — Magenta": "Impressoras",
  "Toner AltaLink — Amarelo": "Impressoras",
  "Toner CX735 — Magenta": "Impressoras",
  "Toner CX735 — Amarelo": "Impressoras",
  "Etiqueta para impressão adesiva": "Impressoras",
  "Ribbon para impressora de etiqueta adesiva": "Impressoras",
  "Papel para impressora térmica": "Impressoras",
  "Toner Lexmark XM5365": "Impressoras",
};

const INITIAL_UNIT_CORRECTIONS: Record<string, string> = {
  "Kit teclado e mouse": "kit",
  "Pasta térmica": "pote",
  "Jogo de chaves — 6 peças": "kit",
  "Jogo de chaves — 8 peças": "kit",
  "Fita isolante": "rolo",
  "Protetor de crachá — caixa fechada": "caixa",
  "Abraçadeira de nylon": "pacote",
  "Etiqueta para impressão adesiva": "rolo",
  "Ribbon para impressora de etiqueta adesiva": "rolo",
  "Papel para impressora térmica": "rolo",
};

type PatchAction = { id: any; fields: Record<string, any> };
type StockRowAction =
  | { type: "patch"; id: any; areaId: any; quantity: number }
  | { type: "insert"; productId: any; locationId: any; areaId: any; quantity: number };
type MovementLotAction = { movementId: any; lotId: any; quantity: number; areaId: any; locationId: any };

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.000001;
}

function keyOf(...parts: string[]): string {
  return parts.join("|");
}

async function buildRegularizationPlan(ctx: any) {
  const blockers: string[] = [];
  const entries = await ctx.db.query("entries").collect();
  const initialEntry = entries.find((entry: any) => entry.entryNumber === INITIAL_ENTRY_NUMBER);
  const gomaqEntry = entries.find((entry: any) => entry.entryNumber === GOMAQ_ENTRY_NUMBER);
  if (!initialEntry || !gomaqEntry) {
    throw new Error("As duas entradas auditadas não foram encontradas. Regularização bloqueada.");
  }
  if (initialEntry.status !== "confirmed" || initialEntry.originType !== "initial_inventory") {
    throw new Error("A entrada inicial não está no estado esperado. Regularização bloqueada.");
  }
  if (gomaqEntry.status !== "confirmed" || gomaqEntry.originType !== "purchase") {
    throw new Error("A entrada Gomaq não está no estado esperado. Regularização bloqueada.");
  }

  const areas = await ctx.db.query("stockAreas").collect();
  const printerAreas = areas.filter((area: any) => area.name === "Impressoras" && area.active);
  const generalAreas = areas.filter((area: any) => area.name === "TI Geral" && area.active);
  if (printerAreas.length !== 1 || generalAreas.length !== 1) {
    throw new Error("É necessário existir exatamente uma área ativa chamada Impressoras e uma chamada TI Geral.");
  }
  const printerArea = printerAreas[0];
  const generalArea = generalAreas[0];
  if (gomaqEntry.areaId !== printerArea._id) {
    throw new Error("A entrada Gomaq não está vinculada à área Impressoras esperada. Nenhuma alteração foi preparada.");
  }

  const initialItems = await ctx.db.query("entryItems")
    .withIndex("by_entry", (q: any) => q.eq("entryId", initialEntry._id)).collect();
  const gomaqItems = await ctx.db.query("entryItems")
    .withIndex("by_entry", (q: any) => q.eq("entryId", gomaqEntry._id)).collect();
  if (initialItems.length !== 53 || gomaqItems.length !== 8) {
    throw new Error("A quantidade de itens das entradas auditadas mudou (esperado: 53 iniciais e 8 Gomaq). Regularização bloqueada.");
  }

  const allLots = await ctx.db.query("lots").collect();
  const lotById = new Map<string, any>(allLots.map((lot: any) => [lot._id as string, lot]));
  const lotByNumber = new Map<string, any>(allLots.map((lot: any) => [lot.lotNumber, lot]));
  const locationsCache = new Map<string, any>();
  const productsCache = new Map<string, any>();
  const targetLots = new Map<string, { lot: any; areaId: any; locationId: any; productName: string }>();
  const lotPatches: PatchAction[] = [];
  const unitPatches: PatchAction[] = [];
  const expectedByProductLocationArea = new Map<string, { productId: any; locationId: any; areaId: any; quantity: number }>();
  const targetProductIds = new Set<string>();

  async function getLocation(locationId: any) {
    const id = String(locationId);
    if (!locationsCache.has(id)) locationsCache.set(id, await ctx.db.get(locationId));
    return locationsCache.get(id);
  }
  async function getProduct(productId: any) {
    const id = String(productId);
    if (!productsCache.has(id)) productsCache.set(id, await ctx.db.get(productId));
    return productsCache.get(id);
  }

  const processItems = async (items: any[], entry: any, isInitial: boolean) => {
    for (const item of items) {
      if (!item.lotId || typeof item.lotId !== "string") {
        blockers.push("Há item sem vínculo textual ao lote em " + entry.entryNumber + ".");
        continue;
      }
      const lot = lotById.get(item.lotId);
      if (!lot || lot.entryId !== entry._id || lot.productId !== item.productId) {
        blockers.push("O vínculo item → lote não confere em " + entry.entryNumber + ".");
        continue;
      }
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 ||
          !Number.isFinite(Number(lot.quantityReceived)) || !Number.isFinite(Number(lot.quantityAvailable)) ||
          Number(lot.quantityAvailable) < 0 || Number(lot.quantityAvailable) > Number(lot.quantityReceived)) {
        blockers.push("Quantidade inválida no item/lote " + lot.lotNumber + ".");
        continue;
      }
      const product = await getProduct(item.productId);
      if (!product) {
        blockers.push("Produto não encontrado para o lote " + lot.lotNumber + ".");
        continue;
      }
      const areaName = isInitial ? INITIAL_AREAS[product.name] : "Impressoras";
      if (!areaName) {
        blockers.push("Produto sem classificação original explícita na planilha inicial: " + product.name + ".");
        continue;
      }
      const areaId = areaName === "Impressoras" ? printerArea._id : generalArea._id;
      if (lot.areaId && lot.areaId !== areaId) {
        blockers.push("O lote " + lot.lotNumber + " já possui área diferente da classificação documental.");
        continue;
      }
      if (!item.locationId) {
        blockers.push("O item " + product.name + " da entrada " + entry.entryNumber + " não possui local físico registrado.");
        continue;
      }
      const location = await getLocation(item.locationId);
      if (!location || !location.active) {
        blockers.push("O local físico do item " + product.name + " não existe ou está inativo.");
        continue;
      }
      if (lot.locationId && lot.locationId !== item.locationId) {
        blockers.push("O lote " + lot.lotNumber + " já aponta para um local físico diferente do item da entrada.");
        continue;
      }
      if (!near(Number(lot.quantityReceived), Number(item.quantity))) {
        blockers.push("A quantidade recebida do lote " + lot.lotNumber + " diverge do item da entrada.");
        continue;
      }

      targetProductIds.add(item.productId as string);
      targetLots.set(lot._id as string, { lot, areaId, locationId: item.locationId, productName: product.name });

      const fields: Record<string, any> = {};
      if (lot.areaId !== areaId) fields.areaId = areaId;
      if (lot.locationId !== item.locationId) fields.locationId = item.locationId;
      if (Object.keys(fields).length) lotPatches.push({ id: lot._id, fields });

      if (isInitial && INITIAL_UNIT_CORRECTIONS[product.name]) {
        const expectedUnit = INITIAL_UNIT_CORRECTIONS[product.name];
        if (item.unitOfMeasure === "un") {
          unitPatches.push({ id: item._id, fields: { unitOfMeasure: expectedUnit } });
        } else if (item.unitOfMeasure !== expectedUnit) {
          blockers.push("Unidade divergente inesperada para " + product.name + ": " + item.unitOfMeasure + ".");
        }
      }

      const groupKey = keyOf(item.productId as string, item.locationId as string, areaId as string);
      const current = expectedByProductLocationArea.get(groupKey) ?? {
        productId: item.productId, locationId: item.locationId, areaId, quantity: 0,
      };
      current.quantity += Number(lot.quantityAvailable);
      expectedByProductLocationArea.set(groupKey, current);
    }
  };

  await processItems(initialItems, initialEntry, true);
  await processItems(gomaqItems, gomaqEntry, false);
  if (targetLots.size !== 61) {
    blockers.push("Foram resolvidos " + targetLots.size + " dos 61 lotes auditados.");
  }
  if (blockers.length) {
    throw new Error("Pré-validação interrompida:\n- " + blockers.join("\n- "));
  }

  // Todos os demais lotes dos produtos abrangidos precisam estar classificados.
  // A migração não adivinha a área/local de lotes que não pertencem às duas entradas.
  const allTargetProductLots = allLots.filter((lot: any) => targetProductIds.has(lot.productId as string));
  const expectedPhysicalByProduct = new Map<string, number>();
  for (const lot of allTargetProductLots) {
    const resolved = targetLots.get(lot._id as string);
    const areaId = resolved?.areaId ?? lot.areaId;
    const locationId = resolved?.locationId ?? lot.locationId;
    if (lot.quantityAvailable > 0) {
      if (!lot.active) throw new Error("Lote inativo com saldo positivo encontrado: " + lot.lotNumber + ".");
      if (!areaId || !locationId) {
        throw new Error("Há lote adicional com saldo positivo sem área/local nos produtos abrangidos: " + lot.lotNumber + ". Regularize-o separadamente antes.");
      }
      const location = await getLocation(locationId);
      const area = await ctx.db.get(areaId);
      if (!location?.active || !area?.active) {
        throw new Error("Área ou local inválido no lote " + lot.lotNumber + ".");
      }
      const pKey = lot.productId as string;
      expectedPhysicalByProduct.set(pKey, (expectedPhysicalByProduct.get(pKey) ?? 0) + Number(lot.quantityAvailable));
      const groupKey = keyOf(pKey, String(locationId), String(areaId));
      const current = expectedByProductLocationArea.get(groupKey) ?? {
        productId: lot.productId, locationId, areaId, quantity: 0,
      };
      if (!resolved) current.quantity += Number(lot.quantityAvailable);
      expectedByProductLocationArea.set(groupKey, current);
    }
  }

  const stockRows = await ctx.db.query("stock").collect();
  for (const productId of targetProductIds) {
    const stock = stockRows.find((row: any) => row.productId === productId);
    if (!stock) throw new Error("Registro global de estoque ausente para produto abrangido: " + productId + ".");
    const expected = expectedPhysicalByProduct.get(productId) ?? 0;
    if (!near(Number(stock.physicalQuantity), expected)) {
      throw new Error("Saldo global divergente para produto " + productId + ": banco=" + stock.physicalQuantity + ", lotes=" + expected + ".");
    }
  }

  // Reparticiona o saldo legado por área usando a soma exata dos lotes.
  const sblRows = await ctx.db.query("stockByLocation").collect();
  const stockRowActions: StockRowAction[] = [];
  const expectedLocationKeys = new Set<string>();
  for (const group of expectedByProductLocationArea.values()) {
    if (group.quantity <= 0) continue;
    expectedLocationKeys.add(keyOf(String(group.productId), String(group.locationId)));
  }
  for (const productId of targetProductIds) {
    const productRows = sblRows.filter((row: any) => row.productId === productId);
    const locationIds = new Set<string>([
      ...productRows.map((row: any) => String(row.locationId)),
      ...Array.from(expectedLocationKeys)
        .filter((key) => key.startsWith(String(productId) + "|"))
        .map((key) => key.split("|")[1]),
    ]);
    for (const locationId of locationIds) {
      const rows = productRows.filter((row: any) => String(row.locationId) === locationId);
      const expectedGroups = Array.from(expectedByProductLocationArea.values())
        .filter((group) => String(group.productId) === String(productId) &&
          String(group.locationId) === locationId && group.quantity > 0)
        .sort((a, b) => String(a.areaId).localeCompare(String(b.areaId)));
      const expectedTotal = expectedGroups.reduce((sum, group) => sum + group.quantity, 0);
      const currentTotal = rows.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
      if (rows.some((row: any) => !Number.isFinite(Number(row.quantity)) || Number(row.quantity) < 0)) {
        throw new Error("Saldo por localização inválido para produto " + productId + " / local " + locationId + ".");
      }
      if (!near(currentTotal, expectedTotal)) {
        throw new Error("Saldo por localização não fecha com os lotes para produto " + productId + " / local " + locationId + ": banco=" + currentTotal + ", lotes=" + expectedTotal + ".");
      }
      if (expectedGroups.length === 0) continue;
      const allLegacy = rows.every((row: any) => !row.areaId);
      const allClassified = rows.every((row: any) => !!row.areaId);
      if (allLegacy) {
        if (rows.length !== 1) {
          throw new Error("Há mais de uma linha legada de saldo para produto/local. A distribuição não será inferida.");
        }
        stockRowActions.push({
          type: "patch", id: rows[0]._id,
          areaId: expectedGroups[0].areaId,
          quantity: expectedGroups[0].quantity,
        });
        for (const group of expectedGroups.slice(1)) {
          stockRowActions.push({
            type: "insert", productId: group.productId,
            locationId: group.locationId, areaId: group.areaId, quantity: group.quantity,
          });
        }
      } else if (allClassified) {
        const seenAreas = new Set<string>();
        const currentByArea = new Map<string, number>();
        for (const row of rows) {
          const areaKey = String(row.areaId);
          if (seenAreas.has(areaKey)) {
            throw new Error("Há linhas duplicadas por produto/local/área. Corrija a duplicidade antes da regularização.");
          }
          seenAreas.add(areaKey);
          currentByArea.set(areaKey, Number(row.quantity));
        }
        const expectedByArea = new Map(expectedGroups.map((group) => [String(group.areaId), group.quantity]));
        if (currentByArea.size !== expectedByArea.size ||
            Array.from(expectedByArea.entries()).some(([areaId, quantity]) =>
              !currentByArea.has(areaId) || !near(currentByArea.get(areaId)!, quantity)
            )) {
          throw new Error("A distribuição de saldo por área já classificada diverge dos lotes para produto " + productId + " / local " + locationId + ".");
        }
      } else {
        throw new Error("Há mistura de linhas classificadas e legadas para produto " + productId + " / local " + locationId + ".");
      }
    }
  }

  // Confere reservas e solicitações aprovadas; esta rotina nunca altera reservas.
  const reservations = await ctx.db.query("requestItemReservations").collect();
  const reservationByItem = new Map<string, number>();
  const reservationByProduct = new Map<string, number>();
  const requestItemCache = new Map<string, any>();
  const requestCache = new Map<string, any>();
  for (const reservation of reservations) {
    const itemId = String(reservation.requestItemId);
    if (!requestItemCache.has(itemId)) {
      requestItemCache.set(itemId, await ctx.db.get(reservation.requestItemId));
    }
    const item = requestItemCache.get(itemId);
    if (!item) throw new Error("Reserva aponta para item de solicitação inexistente.");
    const requestId = String(item.requestId);
    if (!requestCache.has(requestId)) requestCache.set(requestId, await ctx.db.get(item.requestId));
    const request = requestCache.get(requestId);
    if (!request) throw new Error("Reserva aponta para solicitação inexistente.");
    if (String(item.productId) !== String(reservation.productId)) {
      throw new Error("A reserva e o item de solicitação apontam para produtos diferentes.");
    }
    const remaining = Number(reservation.quantityRemaining);
    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new Error("Reserva contém quantidade restante inválida.");
    }
    if (remaining > 0 && request.status !== "approved") {
      throw new Error("Existe reserva restante vinculada a solicitação que não está aprovada.");
    }
    if (remaining > 0) {
      const reservedLot = lotById.get(String(reservation.lotId));
      const resolvedLot = reservedLot ? targetLots.get(reservedLot._id as string) : null;
      const reservedAreaId = resolvedLot?.areaId ?? reservedLot?.lot.areaId;
      const reservedLocationId = resolvedLot?.locationId ?? resolvedLot?.lot.locationId;
      if (!reservedLot || reservedLot.productId !== item.productId ||
          reservedAreaId !== item.areaId || reservedLocationId !== item.sourceLocationId ||
          reservation.areaId !== item.areaId || reservation.locationId !== item.sourceLocationId) {
        throw new Error("Reserva ativa não corresponde à área/local/lote do item de solicitação.");
      }
    }
    reservationByItem.set(itemId, (reservationByItem.get(itemId) ?? 0) + remaining);
    const productId = String(reservation.productId);
    reservationByProduct.set(productId, (reservationByProduct.get(productId) ?? 0) + remaining);
  }

  const approvedRequests = await ctx.db.query("requests")
    .withIndex("by_status", (q: any) => q.eq("status", "approved")).collect();
  const legacyOutstandingByProduct = new Map<string, number>();
  for (const request of approvedRequests) {
    const requestItems = await ctx.db.query("requestItems")
      .withIndex("by_request", (q: any) => q.eq("requestId", request._id)).collect();
    for (const item of requestItems) {
      const outstanding = Math.max(0, Number(item.quantityApproved) - Number(item.quantityDelivered ?? 0));
      if (item.areaId) {
        const reserved = reservationByItem.get(item._id as string) ?? 0;
        if (!near(reserved, outstanding)) {
          throw new Error("Reserva por lote não fecha com a quantidade aprovada pendente da solicitação " + request._id + ".");
        }
      } else {
        legacyOutstandingByProduct.set(
          item.productId as string,
          (legacyOutstandingByProduct.get(item.productId as string) ?? 0) + outstanding
        );
      }
    }
  }

  const stockProductIds = new Set(stockRows.map((stock: any) => String(stock.productId)));
  for (const productId of new Set([
    ...Array.from(reservationByProduct.keys()),
    ...Array.from(legacyOutstandingByProduct.keys()),
  ])) {
    if (!stockProductIds.has(productId)) {
      throw new Error("Há solicitação/reserva sem registro global de estoque para o produto " + productId + ".");
    }
  }
  for (const stock of stockRows) {
    const reservedByLots = reservationByProduct.get(stock.productId as string) ?? 0;
    const reservedLegacy = legacyOutstandingByProduct.get(stock.productId as string) ?? 0;
    const expectedReserved = reservedByLots + reservedLegacy;
    if (!near(Number(stock.reservedQuantity), expectedReserved)) {
      throw new Error("Reserva global divergente para produto " + stock.productId + ": banco=" + stock.reservedQuantity + ", reservas/solicitações=" + expectedReserved + ".");
    }
  }

  // Corrige área/local dos movimentos pela referência exata ao lote.
  const allMovements = await ctx.db.query("stockMovements").collect();
  const movementPatches: PatchAction[] = [];
  const movementLotInserts: MovementLotAction[] = [];
  for (const movement of allMovements) {
    if (!targetProductIds.has(movement.productId as string)) continue;
    if (!movement.lotId) throw new Error("Movimentação sem vínculo de lote encontrada no produto abrangido: " + movement._id + ".");
    const lot = lotById.get(String(movement.lotId)) ?? lotByNumber.get(String(movement.lotId));
    if (!lot || lot.productId !== movement.productId) {
      throw new Error("Movimentação não resolve para lote do mesmo produto: " + movement._id + ".");
    }
    const resolved = targetLots.get(lot._id as string);
    const areaId = resolved?.areaId ?? lot.areaId;
    const locationId = resolved?.locationId ?? lot.locationId;
    if (!areaId || !locationId) {
      throw new Error("Movimentação vinculada a lote ainda sem área/local: " + movement._id + ".");
    }
    if (movement.areaId && movement.areaId !== areaId) {
      throw new Error("Movimentação já possui área diferente do lote: " + movement._id + ".");
    }
    if (movement.locationId && movement.locationId !== locationId) {
      throw new Error("Movimentação já possui local diferente do lote: " + movement._id + ".");
    }
    const fields: Record<string, any> = {};
    if (movement.areaId !== areaId) fields.areaId = areaId;
    if (movement.locationId !== locationId) fields.locationId = locationId;
    if (Object.keys(fields).length) movementPatches.push({ id: movement._id, fields });

    if (movement.type === "exit") {
      const links = await ctx.db.query("stockMovementLots")
        .withIndex("by_movement", (q: any) => q.eq("movementId", movement._id)).collect();
      if (links.length === 0) {
        movementLotInserts.push({
          movementId: movement._id, lotId: lot._id,
          quantity: movement.quantity, areaId, locationId,
        });
      } else {
        const linkedQuantity = links.reduce((sum: number, link: any) => sum + Number(link.quantity), 0);
        if (!near(linkedQuantity, Number(movement.quantity))) {
          throw new Error("A rastreabilidade de lotes da saída " + movement._id + " não fecha com sua quantidade.");
        }
      }
    }
  }

  // Corrige o documento de devolução pelo movimento de retorno vinculado à saída original.
  const allReturns = await ctx.db.query("returns").collect();
  const returnPatches: PatchAction[] = [];
  for (const record of allReturns) {
    if (!targetProductIds.has(record.productId as string)) continue;
    const returnMovements = allMovements.filter((movement: any) =>
      movement.type === "return" &&
      movement.exitMovementId === record.exitMovementId &&
      movement.productId === record.productId &&
      near(Number(movement.quantity), Number(record.quantity))
    );
    if (returnMovements.length !== 1) {
      throw new Error("Não foi possível identificar unicamente o movimento da devolução " + record._id + ".");
    }
    const returnMovement = returnMovements[0];
    const lot = returnMovement.lotId
      ? (lotById.get(String(returnMovement.lotId)) ?? lotByNumber.get(String(returnMovement.lotId)))
      : null;
    if (!lot || lot.productId !== record.productId) {
      throw new Error("A devolução " + record._id + " não possui lote recuperável pelo movimento.");
    }
    const resolved = targetLots.get(lot._id as string);
    const areaId = resolved?.areaId ?? lot.areaId;
    const locationId = resolved?.locationId ?? lot.locationId;
    if (!areaId || !locationId) throw new Error("Lote de devolução sem área/local: " + lot.lotNumber + ".");
    if (record.lotId && record.lotId !== lot._id) throw new Error("Devolução já vinculada a outro lote: " + record._id + ".");
    if (record.areaId && record.areaId !== areaId) throw new Error("Área divergente no documento de devolução: " + record._id + ".");
    if (record.locationId && record.locationId !== locationId) throw new Error("Local divergente no documento de devolução: " + record._id + ".");
    const fields: Record<string, any> = {};
    if (record.lotId !== lot._id) fields.lotId = lot._id;
    if (record.areaId !== areaId) fields.areaId = areaId;
    if (record.locationId !== locationId) fields.locationId = locationId;
    if (Object.keys(fields).length) returnPatches.push({ id: record._id, fields });
  }

  const hasChanges = lotPatches.length + unitPatches.length + stockRowActions.length +
    movementPatches.length + movementLotInserts.length + returnPatches.length > 0;
  return {
    hasChanges,
    initialAreaDistribution: {
      tiGeralLots: initialItems.filter((item: any) => {
        const lot = lotById.get(String(item.lotId));
        return lot && (targetLots.get(lot._id as string)?.areaId ?? lot.areaId) === generalArea._id;
      }).length,
      impressorasLots: initialItems.filter((item: any) => {
        const lot = lotById.get(String(item.lotId));
        return lot && (targetLots.get(lot._id as string)?.areaId ?? lot.areaId) === printerArea._id;
      }).length,
    },
    counts: {
      lotsToPatch: lotPatches.length,
      entryUnitsToCorrect: unitPatches.length,
      stockRowsToReclassifyOrCreate: stockRowActions.length,
      movementsToPatch: movementPatches.length,
      exitLotLinksToCreate: movementLotInserts.length,
      returnsToPatch: returnPatches.length,
      productsInScope: targetProductIds.size,
      targetLots: targetLots.size,
    },
    lotPatches,
    unitPatches,
    stockRowActions,
    movementPatches,
    movementLotInserts,
    returnPatches,
  };
}

export const preview = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "stock.view");
    const plan = await buildRegularizationPlan(ctx);
    return {
      ready: true,
      hasChanges: plan.hasChanges,
      initialAreaDistribution: plan.initialAreaDistribution,
      ...plan.counts,
      writesWillNotChangeQuantities: true,
      note: "Prévia somente leitura. Saldos globais, quantidades de lotes e reservas não serão alterados.",
    };
  },
});

export const applyAuditedInitialStockRegularization = mutation({
  args: {
    confirm: v.literal("REGULARIZAR_SIGESGD_2026"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "stock.mutate", { entity: "stockRegularization" });
    if (args.confirm !== "REGULARIZAR_SIGESGD_2026") {
      throw new Error("Confirmação explícita ausente.");
    }
    const plan = await buildRegularizationPlan(ctx);
    if (!plan.hasChanges) {
      return { applied: false, alreadyRegularized: true, ...plan.counts };
    }

    for (const action of plan.lotPatches) await ctx.db.patch(action.id, action.fields);
    for (const action of plan.unitPatches) await ctx.db.patch(action.id, action.fields);
    for (const action of plan.stockRowActions) {
      if (action.type === "patch") {
        await ctx.db.patch(action.id, { areaId: action.areaId, quantity: action.quantity });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: action.productId,
          locationId: action.locationId,
          areaId: action.areaId,
          quantity: action.quantity,
        });
      }
    }
    for (const action of plan.movementPatches) await ctx.db.patch(action.id, action.fields);
    for (const action of plan.movementLotInserts) await ctx.db.insert("stockMovementLots", action);
    for (const action of plan.returnPatches) await ctx.db.patch(action.id, action.fields);

    await ctx.db.insert("auditLogs", {
      userId,
      action: "update",
      entity: "stock",
      entityId: undefined,
      details:
        "Regularização auditada de área/local: " +
        JSON.stringify(plan.counts) +
        ". Quantidades físicas, globais e reservas preservadas.",
      timestamp: Date.now(),
    });

    return { applied: true, alreadyRegularized: false, ...plan.counts };
  },
});
