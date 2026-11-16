import { requirePermission } from "./rbac";
import { INITIAL_STOCK_MANIFEST } from "../lib/stock-regularization-manifest";
import { LEGACY_GENERAL_AREA_CLASSIFICATION_TARGETS } from "../lib/legacy-general-area-classification";
import { isLegacyMovementLocationCompatible } from "../lib/legacy-movement-location";
import { adjustLotLocationBalance } from "../lib/lot-location-balance";
import {
  resolveConsumedLotId,
  formatConsumedLots,
  type LotConsumption,
} from "../lib/stock-consumption";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getOptionalSingleValidGlobalStock, isDiscreteStockUnit } from "../lib/stock-quantity-rules";
import {
  applyImplementationStockStamp,
  generateExitNumber,
  hasInitialInventoryLot,
  IMPLEMENTATION_STOCK_DATE,
  isImplementationStockStamped,
  tonerKitObservation,
} from "./stockHelpers";

async function requireUser(ctx: any) {
  // RBAC central: resumos de implantação/localização exigem visão de estoque.
  return requirePermission(ctx, "stock.view");
}

async function requireAdmin(ctx: any) {
  // RBAC central: carga inicial, importação de planilha e saída rápida.
  return requirePermission(ctx, "stock.mutate", { entity: "stockSetup" });
}

/**
 * Generate lot number: LOT-YYYY-NNNNNN
 */
async function generateLotNumber(ctx: any, _productId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `LOT-${year}-`;
  const existingLots = await ctx.db
    .query("lots")
    .withIndex("by_number", (q: any) => q.gte("lotNumber", prefix))
    .collect();
  const maxSequence = existingLots.reduce((max: number, lot: any) => {
    if (!lot.lotNumber?.startsWith(prefix)) return max;
    const sequence = Number(lot.lotNumber.slice(prefix.length));
    return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(6, "0")}`;
}

/**
 * Initial stock loading (implantação inicial).
 *
 * For each product/location combination:
 *   - Creates a lot (initial_inventory) for FIFO traceability
 *   - Creates stockByLocation
 *   - Creates/updates stock (global)
 *   - Creates stockMovements
 *
 * BLOCKS if product already has an initial_inventory lot (prevents duplication).
 * All quantities from initial load are traceable via the created lot.
 */
/**
 * Núcleo compartilhado da implantação inicial (usado pela carga manual e pela
 * importação da planilha). Gera entrada, lote, saldo por local, saldo global,
 * movimentação e auditoria — sempre com a mesma lógica.
 */
async function performInitialLoad(
  ctx: any,
  userId: string,
  items: Array<{
    productId: string;
    locationId: string;
    areaId?: string;
    quantity: number;
    unitOfMeasure?: string;
    brand?: string;
    model?: string;
    specification?: string;
    observation?: string;
  }>,
  observation: string
) {
  if (!items || items.length === 0) {
    throw new Error("Nenhum item informado para carga inicial");
  }

  // ── Defesa numérica (Int64 → number) ──
  // O validador v.number() do Convex aceita Int64 (bigint) quando a mutation
  // é chamada via CLI com literais JSON inteiros. Normaliza explicitamente
  // para number JS para que nenhuma aritmética misture bigint com number.
  items = items.map((i) => ({ ...i, quantity: Number(i.quantity) }));

  const positiveItems = items.filter((item) => item.quantity > 0);
  if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity < 0)) {
    throw new Error("A carga inicial contém quantidade negativa ou inválida.");
  }
  if (positiveItems.length === 0) {
    throw new Error("Informe ao menos um item com quantidade maior que zero para a carga inicial.");
  }

  // Validar TODO o lote de entrada antes de criar a entrada ou qualquer saldo.
  for (const item of positiveItems) {
    const [location, area, product, productLots, stockRows, locationRows] = await Promise.all([
      ctx.db.get(item.locationId),
      item.areaId ? ctx.db.get(item.areaId as any) : Promise.resolve(null),
      ctx.db.get(item.productId as any),
      ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect(),
      ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect(),
      ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect(),
    ]);
    if (!location || !location.active) {
      throw new Error("A carga inicial precisa apontar para um local físico ativo.");
    }
    if (!item.areaId || !area?.active) {
      throw new Error(`Informe uma área/subestoque ativo para o material armazenado em "${location.name}". O local físico não define a área.`);
    }
    if (!product || !product.active) {
      throw new Error(`O produto "${product?.name ?? item.productId}" não existe ou está inativo.`);
    }
    if (product.hasSerial || productLots.some((lot: any) => lot.materialType === "permanent")) {
      throw new Error(`"${product.name}" é material permanente ou individualizado. Cadastre o equipamento individualmente; não faça carga por quantidade agregada.`);
    }
    const unit = item.unitOfMeasure ?? product.unitOfMeasure;
    if (isDiscreteStockUnit(unit, product.hasSerial) && !Number.isSafeInteger(item.quantity)) {
      throw new Error(`A quantidade inicial de "${product.name}" deve ser inteira para a unidade ${unit}.`);
    }
    if (stockRows.length > 1) {
      throw new Error(`"${product.name}" possui registros globais de estoque duplicados. Regularize antes da carga inicial.`);
    }
    if (stockRows[0] && (
      !Number.isFinite(stockRows[0].physicalQuantity) ||
      !Number.isFinite(stockRows[0].reservedQuantity) ||
      stockRows[0].physicalQuantity < stockRows[0].reservedQuantity ||
      stockRows[0].reservedQuantity < 0
    )) {
      throw new Error(`O saldo global de "${product.name}" está inconsistente.`);
    }
    const locationMatches = locationRows.filter((row: any) =>
      row.locationId === item.locationId && row.areaId === item.areaId
    );
    if (locationMatches.length > 1) {
      throw new Error(`"${product.name}" possui saldos físicos duplicados nessa combinação de área/local.`);
    }
  }

  const now = Date.now();
  const year = new Date().getFullYear();

  // ── Pre-check: block if any product already has initial_inventory lots ──
  // A carga inicial é caracterizada por um lote ativo vinculado a uma entrada
  // com originType "initial_inventory" (não confundir com lotes de compras).
  for (const item of items) {
    if (item.quantity <= 0) continue;

    const existingLots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
      .collect();
    const hasInitialLot = await hasInitialInventoryLot(
      existingLots,
      (entryId) => ctx.db.get(entryId as any)
    );

    if (hasInitialLot) {
      const product = await ctx.db.get(item.productId);
      throw new Error(
        `Produto "${product?.name ?? item.productId}" já possui carga inicial confirmada. ` +
          `Use saída, transferência ou inventário para ajustar.`
      );
    }
  }

  // ── Create entry header for the initial load ──
  const existingEntries = await ctx.db.query("entries").collect();
  const entryPrefix = `ENT-${year}-`;
  const entrySequence = existingEntries.reduce((max: number, entry: any) => {
    const match = String(entry.entryNumber ?? "").match(/^ENT-\d{4}-(\d+)$/);
    if (!match || !String(entry.entryNumber).startsWith(entryPrefix)) return max;
    const sequence = Number(match[1]);
    return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
  }, 0) + 1;
  const entryNumber = `${entryPrefix}${String(entrySequence).padStart(6, "0")}`;
  const entryId = await ctx.db.insert("entries", {
    entryNumber,
    receivedAt: now,
    originType: "initial_inventory",
    responsibleUserId: userId,
    // Estoque de implantação: o carimbo é metadado (data de implantação) e
    // preserva integralmente a observação original.
    observation: applyImplementationStockStamp(observation),
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
  });

  const summary: string[] = [];
  let totalProductsUpdated = 0;
  let totalQuantityLoaded = 0;

  for (const item of items) {
    if (item.quantity === 0) continue;

      const location = await ctx.db.get(item.locationId);
      if (!location || !location.active) {
        throw new Error("O local físico precisa continuar ativo para concluir a carga inicial.");
      }
      const areaId = item.areaId;
      if (!areaId) {
        throw new Error(`Informe a área do produto ${item.productId}; o armário não determina o subestoque.`);
      }
      const area = await ctx.db.get(areaId);
      if (!area || !area.active) throw new Error("A área da carga inicial não existe ou está inativa.");

      // ── 1. Create lot for traceability ──
      const lotNumber = await generateLotNumber(ctx, item.productId);
      const lotId = await ctx.db.insert("lots", {
        lotNumber,
        productId: item.productId,
        entryId,
        quantityReceived: item.quantity,
        quantityAvailable: item.quantity,
        receivedAt: now,
        active: true,
        areaId,
        locationId: item.locationId,
        brand: item.brand?.trim() || undefined,
        model: item.model?.trim() || undefined,
        specification: item.specification?.trim() || undefined,
        observation: item.observation?.trim() || `Carga inicial — ${item.quantity} unidades`,
      });
      await adjustLotLocationBalance(ctx, {
        lotId, productId: item.productId, locationId: item.locationId,
        delta: item.quantity, allowCreate: true,
      });

      // ── 2. Create entry item ──
      await ctx.db.insert("entryItems", {
        entryId,
        productId: item.productId,
        quantity: item.quantity,
        // Preserva a UOM original informada (un, pc, cx, m, rl, pct, po, kt,
        // outro). NUNCA converte: 13 caixas continuam 13 cx, não 650 un.
        unitOfMeasure: item.unitOfMeasure ?? (await ctx.db.get(item.productId))?.unitOfMeasure ?? "un",
        lotId,
        locationId: item.locationId,
        areaId,
        brand: item.brand?.trim() || undefined,
        model: item.model?.trim() || undefined,
        specification: item.specification?.trim() || undefined,
        observation: item.observation?.trim() || undefined,
      });

      // ── 3. stockByLocation ──
      const existingSbl = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
        .collect();
      const sblForLocation = existingSbl.find(
        (s: any) => s.locationId === item.locationId &&
          (s.areaId ?? undefined) === (areaId ?? undefined)
      );

      if (sblForLocation) {
        await ctx.db.patch(sblForLocation._id, {
          quantity: sblForLocation.quantity + item.quantity,
        });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: item.productId,
          locationId: item.locationId,
          quantity: item.quantity,
          areaId,
        });
      }

      // ── 4. stock (global) ──
      const existingStockRows = await ctx.db
        .query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
        .collect();
      const productForLabel = await ctx.db.get(item.productId as any);
      const existingStock = getOptionalSingleValidGlobalStock<any>(existingStockRows, productForLabel?.name ?? String(item.productId));

      const previousGlobal = existingStock?.physicalQuantity ?? 0;
      // Em produtos existentes, somar a carga ao saldo global preserva estoque
      // legado que ainda não possua linha em stockByLocation. Recalcular pela
      // soma dos locais aqui apagaria silenciosamente esse saldo.
      const newGlobal = existingStock
        ? previousGlobal + item.quantity
        : (await ctx.db
            .query("stockByLocation")
            .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
            .collect())
            .reduce((sum: number, row: any) => sum + row.quantity, 0);

      if (existingStock) {
        await ctx.db.patch(existingStock._id, {
          physicalQuantity: newGlobal,
        });
      } else {
        await ctx.db.insert("stock", {
          productId: item.productId,
          physicalQuantity: newGlobal,
          reservedQuantity: 0,
        });
      }

      // ── 5. stockMovement (audit trail) ──
      await ctx.db.insert("stockMovements", {
        productId: item.productId,
        type: "adjustment",
        quantity: item.quantity,
        previousPhysical: previousGlobal,
        newPhysical: newGlobal,
        previousReserved: existingStock?.reservedQuantity ?? 0,
        newReserved: existingStock?.reservedQuantity ?? 0,
        userId,
        entryId,
        lotId: lotId as string,
        areaId,
        locationId: item.locationId,
        observation: `Carga inicial — lote ${lotNumber} — ${item.quantity} unidades`,
        timestamp: now,
      });

      const product = await ctx.db.get(item.productId);
      summary.push(
        `${product?.name ?? item.productId} → ${location?.name ?? item.locationId}: ${item.quantity} (lote ${lotNumber})`
      );
      totalQuantityLoaded += item.quantity;
      totalProductsUpdated++;
    }

    // ── Audit ──
    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "stock",
      entityId: entryId,
      details: `Carga inicial: ${totalProductsUpdated} itens, ${totalQuantityLoaded} unidades total, entrada ${entryNumber}`,
      timestamp: now,
    });

    return {
      message: "Carga inicial concluída",
      entryNumber,
      productsUpdated: totalProductsUpdated,
      totalQuantity: totalQuantityLoaded,
      summary,
    };
}

/**
 * Carga inicial manual (implantação inicial).
 */
export const initialStockLoad = mutation({
  args: {
    items: v.array(
      v.object({
        productId: v.id("products"),
        locationId: v.id("storageLocations"),
        quantity: v.number(),
        unitOfMeasure: v.optional(v.string()),
        areaId: v.optional(v.id("stockAreas")),
      })
    ),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    return performInitialLoad(
      ctx,
      userId,
      args.items,
      args.observation ?? "Carga inicial de estoque"
    );
  },
});

/**
 * Importação da planilha de inventário físico (implantação inicial em massa).
 *
 * Cada linha é associada a um produto existente pelo nome (sem duplicatas) ou
 * cria um produto novo (categoria padrão "Diversos" criada idempotentemente).
 * Depois reutiliza o MESMO núcleo da carga inicial: entrada, lote,
 * stockByLocation, stock, movimentação e auditoria.
 */
export const importInitialSheet = mutation({
  args: {
    rows: v.array(
      v.object({
        locationId: v.id("storageLocations"),
        productName: v.string(),
        brand: v.optional(v.string()),
        quantity: v.number(),
        unitOfMeasure: v.optional(v.string()),
        observation: v.optional(v.string()),
        areaId: v.optional(v.id("stockAreas")),
      })
    ),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);

    if (!args.rows || args.rows.length === 0) {
      throw new Error("Nenhuma linha informada para importação");
    }

    // Categoria padrão para produtos novos (idempotente)
    const allCategories = await ctx.db.query("categories").collect();
    let fallbackCategory: any = allCategories.find(
      (c: any) => c.name.toLowerCase() === "diversos"
    );
    if (!fallbackCategory) {
      const catId = await ctx.db.insert("categories", {
        name: "Diversos",
        description: "Categoria padrão para itens importados da planilha inicial",
        active: true,
      });
      fallbackCategory = await ctx.db.get(catId);
    }

    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .collect();

    const items: Array<{
      productId: string;
      locationId: string;
      quantity: number;
      unitOfMeasure?: string;
      areaId?: string;
      brand?: string;
      observation?: string;
    }> = [];
    let matched = 0;
    let created = 0;

    for (const row of args.rows) {
      const name = (row.productName ?? "").trim();
      if (!name || row.quantity <= 0) continue;

      const existing = products.find(
        (p: any) => p.name.trim().toLowerCase() === name.toLowerCase()
      );
      // Toner de kit original de 4 cores (VersaLink, AltaLink, Lexmark CX735,
      // Lexmark XM5365): a observação padrão é aplicada (informação
      // observacional — nunca altera quantidade física nem agrupa produtos).
      const kitObservation = tonerKitObservation({
        name,
        brand: row.brand,
      });
      let productId: string;
      if (existing) {
        productId = existing._id;
        matched++;
        if (kitObservation && !existing.observation) {
          await ctx.db.patch(existing._id, { observation: kitObservation });
          await ctx.db.insert("auditLogs", {
            userId,
            action: "update",
            entity: "products",
            entityId: existing._id,
            details: `Observação de kit aplicada pela importação: ${kitObservation}`,
            timestamp: Date.now(),
          });
        }
      } else {
        const id = await ctx.db.insert("products", {
          name,
          categoryId: fallbackCategory._id,
          unitOfMeasure: row.unitOfMeasure ?? "un",
          brand: row.brand || undefined,
          observation: row.observation || kitObservation || undefined,
          minimumStock: 0,
          idealStock: 0,
          maximumStock: 0,
          active: true,
        });
        await ctx.db.insert("auditLogs", {
          userId,
          action: "create",
          entity: "products",
          entityId: id,
          details: `Produto criado pela importação da planilha inicial: ${name}`,
          timestamp: Date.now(),
        });
        products.push({ _id: id } as any);
        productId = id;
        created++;
      }

      items.push({
        productId,
        locationId: row.locationId,
        quantity: row.quantity,
        areaId: row.areaId,
        // UOM original da planilha: a quantidade fica semanticamente na
        // unidade registrada (cx permanece cx, pct permanece pct).
        unitOfMeasure: row.unitOfMeasure || (existing?.unitOfMeasure ?? "un"),
        brand: row.brand?.trim() || undefined,
        observation: row.observation?.trim() || undefined,
      });
    }

    if (items.length === 0) {
      throw new Error("Nenhuma linha válida para importar (verifique nomes e quantidades)");
    }

    const result = await performInitialLoad(
      ctx,
      userId,
      items,
      args.observation ?? "Importação da planilha de inventário físico"
    );

    return {
      ...result,
      matched,
      created,
      totalRows: args.rows.length,
    };
  },
});

/**
 * Resumo de localizações por produto (usado no fluxo "Dar saída").
 */
export const productLocationSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("stockByLocation").collect();
    const byProduct = new Map<string, Array<{
      locationId: string; locationName: string; areaId: string | null;
      areaName: string; quantity: number;
    }>>();

    for (const row of rows) {
      const location = await ctx.db.get(row.locationId);
      if (!location) continue;
      const area = row.areaId ? await ctx.db.get(row.areaId) : null;
      const reservations = await ctx.db.query("requestItemReservations")
        .withIndex("by_product", (q: any) => q.eq("productId", row.productId))
        .collect();
      const reserved = reservations
        .filter((reservation: any) =>
          reservation.locationId === row.locationId &&
          reservation.areaId === (row.areaId ?? undefined)
        )
        .reduce((sum: number, reservation: any) => sum + reservation.quantityRemaining, 0);
      const entries = byProduct.get(row.productId) ?? [];
      entries.push({
        locationId: row.locationId,
        locationName: location.name,
        areaId: area ? area._id as string : null,
        areaName: area?.name ?? "Sem área — pendente de classificação",
        quantity: row.quantity - reserved,
      });
      byProduct.set(row.productId, entries);
    }
    return Array.from(byProduct.entries()).map(([productId, locations]) => ({ productId, locations }));
  },
});

/**
 * Auditoria somente leitura dos saldos lote × armário.
 * A área é obtida do lote; o armário não classifica o subestoque.
 */
export const lotLocationBalanceIntegrity = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [lots, balances, localRows, globalRows] = await Promise.all([
      ctx.db.query("lots").collect(),
      ctx.db.query("lotLocationBalances").collect(),
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("stock").collect(),
    ]);
    const lotsById = new Map<string, any>(lots.map((lot: any) => [String(lot._id), lot] as const));
    const balancesByLot = new Map<string, any[]>();
    for (const row of balances as any[]) {
      const key = String(row.lotId);
      const list = balancesByLot.get(key) ?? [];
      list.push(row);
      balancesByLot.set(key, list);
    }

    let orphanBalances = 0;
    let duplicateLotBalances = 0;
    let invalidBalances = 0;
    let invalidLotQuantities = 0;
    let mismatchedLotBalances = 0;
    for (const lot of lots as any[]) {
      if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) invalidLotQuantities++;
    }
    for (const row of balances as any[]) {
      const lot = lotsById.get(String(row.lotId));
      if (!lot) orphanBalances++;
      if (!Number.isFinite(row.quantityAvailable) || row.quantityAvailable < 0) invalidBalances++;
      if (lot && (
        row.productId !== lot.productId ||
        (lot.locationId && row.locationId !== lot.locationId) ||
        !Number.isFinite(lot.quantityAvailable) ||
        Math.abs(row.quantityAvailable - lot.quantityAvailable) > 1e-9
      )) mismatchedLotBalances++;
    }
    for (const rows of balancesByLot.values()) {
      if (rows.length > 1) duplicateLotBalances++;
    }

    const missingLotBalances = lots.filter((lot: any) =>
      !!lot.locationId && lot.quantityAvailable > 0 && !(balancesByLot.get(String(lot._id))?.length)
    ).length;
    const lotsMissingLocationMetadata = lots.filter((lot: any) =>
      !lot.locationId && (balancesByLot.get(String(lot._id))?.length ?? 0) === 1
    ).length;
    const unmappedPositiveLots = lots.filter((lot: any) =>
      Number(lot.quantityAvailable) > 0 && !(balancesByLot.get(String(lot._id))?.length)
    ).length;
    const resolvedLocationByLot = new Map<string, string>();
    for (const [lotId, rows] of balancesByLot) {
      if (rows.length === 1) resolvedLocationByLot.set(lotId, String(rows[0].locationId));
    }

    const scopeKey = (productId: string, areaId: string | undefined, locationId: string) =>
      `${productId}::${areaId ?? ""}::${locationId}`;
    const lotTotalsByScope = new Map<string, number>();
    const lotsByScope = new Map<string, any[]>();
    for (const lot of lots as any[]) {
      const resolvedLocationId = lot.locationId ?? resolvedLocationByLot.get(String(lot._id));
      if (!resolvedLocationId || !Number.isFinite(lot.quantityAvailable)) continue;
      const key = scopeKey(String(lot.productId), lot.areaId ? String(lot.areaId) : undefined, String(resolvedLocationId));
      lotTotalsByScope.set(key, (lotTotalsByScope.get(key) ?? 0) + lot.quantityAvailable);
      const scopedLots = lotsByScope.get(key) ?? [];
      scopedLots.push(lot);
      lotsByScope.set(key, scopedLots);
    }
    const localRowsByScope = new Map<string, any[]>();
    for (const row of localRows as any[]) {
      const key = scopeKey(String(row.productId), row.areaId ? String(row.areaId) : undefined, String(row.locationId));
      const list = localRowsByScope.get(key) ?? [];
      list.push(row);
      localRowsByScope.set(key, list);
    }
    const scopeKeys = new Set([...lotTotalsByScope.keys(), ...localRowsByScope.keys()]);
    let scopeMismatches = 0;
    let duplicateLocalScopes = 0;
    const scopeMismatchDetails: Array<{
      productId: string;
      productName: string;
      areaId: string | null;
      areaName: string;
      locationId: string;
      locationName: string;
      lotsQuantity: number;
      stockByLocationQuantity: number;
      difference: number;
      lots: Array<{ lotId: string; lotNumber: string; quantityAvailable: number; locationId: string | null; areaId: string | null }>;
      localRows: Array<{ rowId: string; quantity: number; locationId: string; areaId: string | null }>;
    }> = [];
    for (const key of scopeKeys) {
      const rows = localRowsByScope.get(key) ?? [];
      if (rows.length > 1) duplicateLocalScopes++;
      const localQuantity = rows.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
      const lotsQuantity = lotTotalsByScope.get(key) ?? 0;
      const hasInvalidLocalQuantity = rows.some((row: any) => !Number.isFinite(row.quantity) || row.quantity < 0);
      if (hasInvalidLocalQuantity || Math.abs(localQuantity - lotsQuantity) > 1e-9) {
        scopeMismatches++;
        const scopedLots = lotsByScope.get(key) ?? [];
        const sample = scopedLots[0] ?? rows[0];
        const productId = String(sample.productId);
        const areaId = sample.areaId ? String(sample.areaId) : null;
        const locationId = String(sample.locationId ?? resolvedLocationByLot.get(String(sample._id)) ?? sample.locationId);
        const [product, area, location]: any[] = await Promise.all([
          ctx.db.get(productId as any),
          areaId ? ctx.db.get(areaId as any) : Promise.resolve(null),
          locationId && locationId !== "undefined" ? ctx.db.get(locationId as any) : Promise.resolve(null),
        ]);
        scopeMismatchDetails.push({
          productId,
          productName: product?.name ?? productId,
          areaId,
          areaName: area?.name ?? (areaId ? "Área não encontrada" : "Sem área"),
          locationId,
          locationName: location?.name ?? "Local não encontrado",
          lotsQuantity,
          stockByLocationQuantity: localQuantity,
          difference: lotsQuantity - localQuantity,
          lots: scopedLots.map((lot: any) => ({
            lotId: String(lot._id),
            lotNumber: String(lot.lotNumber ?? lot._id),
            quantityAvailable: Number(lot.quantityAvailable),
            locationId: lot.locationId ? String(lot.locationId) : null,
            areaId: lot.areaId ? String(lot.areaId) : null,
          })),
          localRows: rows.map((row: any) => ({
            rowId: String(row._id),
            quantity: Number(row.quantity),
            locationId: String(row.locationId),
            areaId: row.areaId ? String(row.areaId) : null,
          })),
        });
      }
    }

    // Classificação legada: identifica saldos stockByLocation sem área que
    // podem ser associados sem ambiguidade à área já registrada nos lotes.
    // Esta etapa é estritamente read-only; não corrige nem altera quantidades.
    const lotAreaTotalsByProductLocation = new Map<string, Map<string, number>>();
    const lotAreaIdsByProductLocation = new Map<string, Set<string>>();
    for (const lot of lots as any[]) {
      const locationId = lot.locationId ?? resolvedLocationByLot.get(String(lot._id));
      if (!locationId || !lot.areaId || !Number.isFinite(lot.quantityAvailable)) continue;
      const key = `${String(lot.productId)}::${String(locationId)}`;
      const areaId = String(lot.areaId);
      const byArea = lotAreaTotalsByProductLocation.get(key) ?? new Map<string, number>();
      byArea.set(areaId, (byArea.get(areaId) ?? 0) + Number(lot.quantityAvailable));
      lotAreaTotalsByProductLocation.set(key, byArea);
      const areaIds = lotAreaIdsByProductLocation.get(key) ?? new Set<string>();
      areaIds.add(areaId);
      lotAreaIdsByProductLocation.set(key, areaIds);
    }
    const localRowsByProductLocation = new Map<string, any[]>();
    for (const row of localRows as any[]) {
      const key = `${String(row.productId)}::${String(row.locationId)}`;
      const rows = localRowsByProductLocation.get(key) ?? [];
      rows.push(row);
      localRowsByProductLocation.set(key, rows);
    }
    const areaClassificationCandidates: Array<{
      productId: string;
      productName: string;
      locationId: string;
      locationName: string;
      rowId: string;
      currentAreaId: null;
      proposedAreaId: string;
      proposedAreaName: string;
      stockByLocationQuantity: number;
      lotsQuantity: number;
      lotIds: string[];
    }> = [];
    let areaClassificationBlocked = 0;
    const areaClassificationBlockedDetails: Array<{
      productId: string;
      productName: string;
      locationId: string;
      locationName: string;
      rowIds: string[];
      stockByLocationQuantities: number[];
      lotIds: string[];
      lotAreas: Array<{ areaId: string | null; quantity: number }>;
      candidateAreaIds: string[];
      reasons: string[];
    }> = [];
    for (const [key, rows] of localRowsByProductLocation) {
      const unclassifiedRows = rows.filter((row: any) => !row.areaId);
      if (unclassifiedRows.length === 0) continue;
      const [productId, locationId] = key.split("::");
      const areaIds = lotAreaIdsByProductLocation.get(key) ?? new Set<string>();
      const byArea = lotAreaTotalsByProductLocation.get(key) ?? new Map<string, number>();
      const allLotsForScope = (lots as any[]).filter((lot: any) =>
        String(lot.productId) === productId &&
        String(lot.locationId ?? resolvedLocationByLot.get(String(lot._id)) ?? "") === locationId &&
        Number(lot.quantityAvailable) > 0
      );
      const onlyAreaId = areaIds.size === 1 ? Array.from(areaIds)[0] : null;
      const safe =
        unclassifiedRows.length === 1 &&
        rows.length === 1 &&
        !!onlyAreaId &&
        allLotsForScope.length > 0 &&
        allLotsForScope.every((lot: any) => !!lot.areaId && String(lot.areaId) === onlyAreaId) &&
        Math.abs(Number(unclassifiedRows[0].quantity) - (byArea.get(onlyAreaId) ?? 0)) <= 1e-9 &&
        Number.isFinite(unclassifiedRows[0].quantity) &&
        unclassifiedRows[0].quantity >= 0;
      if (!safe) {
        areaClassificationBlocked++;
        const reasons: string[] = [];
        if (unclassifiedRows.length !== 1) reasons.push("mais_de_uma_linha_sem_area");
        if (rows.length !== 1) reasons.push("mais_de_uma_linha_no_produto_local");
        if (areaIds.size === 0) reasons.push("nenhum_lote_com_area_identificada");
        if (areaIds.size > 1) reasons.push("lotes_em_areas_diferentes");
        if (allLotsForScope.length === 0) reasons.push("nenhum_lote_positivo_no_produto_local");
        if (allLotsForScope.some((lot: any) => !lot.areaId)) reasons.push("existe_lote_sem_area");
        if (onlyAreaId && allLotsForScope.some((lot: any) => String(lot.areaId ?? "") !== onlyAreaId)) {
          reasons.push("lotes_nao_convergem_para_uma_unica_area");
        }
        if (unclassifiedRows.length === 1 && onlyAreaId &&
            Math.abs(Number(unclassifiedRows[0].quantity) - (byArea.get(onlyAreaId) ?? 0)) > 1e-9) {
          reasons.push("quantidade_do_saldo_diverge_dos_lotes_da_area");
        }
        if (unclassifiedRows.some((row: any) => !Number.isFinite(row.quantity) || row.quantity < 0)) {
          reasons.push("quantidade_do_saldo_invalida");
        }
        const [product, location]: any[] = await Promise.all([
          ctx.db.get(productId as any),
          ctx.db.get(locationId as any),
        ]);
        areaClassificationBlockedDetails.push({
          productId,
          productName: product?.name ?? productId,
          locationId,
          locationName: location?.name ?? locationId,
          rowIds: unclassifiedRows.map((row: any) => String(row._id)),
          stockByLocationQuantities: unclassifiedRows.map((row: any) => Number(row.quantity)),
          lotIds: allLotsForScope.map((lot: any) => String(lot._id)),
          lotAreas: allLotsForScope.map((lot: any) => ({
            areaId: lot.areaId ? String(lot.areaId) : null,
            quantity: Number(lot.quantityAvailable),
          })),
          candidateAreaIds: Array.from(areaIds),
          reasons: reasons.length ? reasons : ["criterios_de_seguranca_nao_atendidos"],
        });
        continue;
      }
      const [product, location, area]: any[] = await Promise.all([
        ctx.db.get(productId as any),
        ctx.db.get(locationId as any),
        ctx.db.get(onlyAreaId as any),
      ]);
      areaClassificationCandidates.push({
        productId,
        productName: product?.name ?? productId,
        locationId,
        locationName: location?.name ?? locationId,
        rowId: String(unclassifiedRows[0]._id),
        currentAreaId: null,
        proposedAreaId: onlyAreaId,
        proposedAreaName: area?.name ?? onlyAreaId,
        stockByLocationQuantity: Number(unclassifiedRows[0].quantity),
        lotsQuantity: byArea.get(onlyAreaId) ?? 0,
        lotIds: allLotsForScope.map((lot: any) => String(lot._id)),
      });
    }

    const lotTotalsByProduct = new Map<string, number>();
    for (const lot of lots as any[]) {
      lotTotalsByProduct.set(String(lot.productId),
        (lotTotalsByProduct.get(String(lot.productId)) ?? 0) + Number(lot.quantityAvailable));
    }
    const globalsByProduct = new Map<string, any[]>();
    for (const row of globalRows as any[]) {
      const key = String(row.productId);
      const list = globalsByProduct.get(key) ?? [];
      list.push(row);
      globalsByProduct.set(key, list);
    }
    let globalMismatches = 0;
    const productIds = new Set([...lotTotalsByProduct.keys(), ...globalsByProduct.keys()]);
    for (const productId of productIds) {
      const rows = globalsByProduct.get(productId) ?? [];
      if (rows.length !== 1 || !Number.isFinite(rows[0]?.physicalQuantity) ||
          Math.abs(Number(rows[0]?.physicalQuantity ?? 0) - (lotTotalsByProduct.get(productId) ?? 0)) > 1e-9) {
        globalMismatches++;
      }
    }

    return {
      readOnly: true,
      generatedAt: Date.now(),
      lotsWithLocation: lots.filter((lot: any) => !!lot.locationId).length,
      lotLocationBalanceRecords: balances.length,
      lotLocationBalanceQuantity: balances.reduce((sum: number, row: any) => sum + Number(row.quantityAvailable), 0),
      missingLotBalances,
      lotsMissingLocationMetadata,
      unmappedPositiveLots,
      orphanBalances,
      duplicateLotBalances,
      invalidBalances,
      invalidLotQuantities,
      mismatchedLotBalances,
      duplicateLocalScopes,
      scopeMismatches,
      scopeMismatchDetails,
      areaClassificationCandidateCount: areaClassificationCandidates.length,
      areaClassificationBlocked,
      areaClassificationCandidates,
      areaClassificationBlockedDetails,
      globalMismatches,
      consistent: missingLotBalances === 0 && lotsMissingLocationMetadata === 0 && unmappedPositiveLots === 0 && orphanBalances === 0 &&
        duplicateLotBalances === 0 && invalidBalances === 0 && invalidLotQuantities === 0 &&
        mismatchedLotBalances === 0 && duplicateLocalScopes === 0 &&
        scopeMismatches === 0 && globalMismatches === 0,
    };
  },
});


/**
 * Corrige somente os 22 saldos locais sem área identificados pela auditoria
 * de 2026-11-16. A operação revalida o conjunto completo dentro de uma única
 * mutation/transação e não altera quantidades, lotes ou movimentações.
 */
export const applyLegacyPrinterAreaClassification = internalMutation({
  args: {
    confirmation: v.literal("CONFIRMAR_CLASSIFICACAO_22_SALDOS_IMPRESSORAS_FIRST_HERRING"),
  },
  handler: async (ctx) => {
    const areaId = "q97b7737gv98ajm8qqpmjmzjs18ezb58";
    const expected = [
      { rowId: "nh70zfec9nvemxf5270pkef8b70btjts", productId: "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f", locationId: "n5711zfag2vgm24hm5qd9yn42s8e54ej", quantity: 700, lotIds: ["n175qg8kj7kkzz3y4mn32zme1sb1ysaa"] },
      { rowId: "nh79vsy23rdr5mb09pvqxq6g69xa19hr", productId: "kd75me863v1ym08hdmrpw7h76eazwxg0", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 13, lotIds: ["n173x352z38x8rrf5fjemc60x8y6ht3h"] },
      { rowId: "nh77v543h6x08pxgnck27dmn3mnh2y2q", productId: "kd7dqfja6nxhcr33qmjw2mg85e76jx65", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 18, lotIds: ["n172yjsdrwrdyd3byt1vweygye6bq3jg"] },
      { rowId: "nh732phxvj02xm19057pg13nt74tddpx", productId: "kd76bdg20hy36kpcebnx7qjeftdaswve", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n17aye5q776nb2rxc6zdayvypmyeys7g"] },
      { rowId: "nh72chw6gkr08wmvk7q7zny3zxjggzkw", productId: "kd7bb198gaf6w02w2d3z57dwc6082f1h", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n17e51hsphchkb2p2ecz21hbxqmnhetz"] },
      { rowId: "nh7cstyjzrwc2m8bz0wpwxnm9g3zdt4e", productId: "kd7b3m5evq8cn91djtqj2rnkcnjh3dkv", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n17ccp2cbjm5angph5enpmxy529fwbs9"] },
      { rowId: "nh720fgr2tmay13zkp3g8d45nhv8kv4w", productId: "kd79s0w1swbe5nsc806f1kfarkec9ah7", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n176bz9cen8wes6cm17mb7zwcrakvj2j"] },
      { rowId: "nh71n0kg3vv91ha0j4wd0strkt60jeh2", productId: "kd7c9nh07rcqy6ep21553jjbdyzfpm1k", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 2, lotIds: ["n17295wb2tya3vtpgbp0p0cyp5qmwyk8"] },
      { rowId: "nh75hs0wedjq0hs1bba9xb0zyye36qvm", productId: "kd73hh4taw6qmfkefmdn9aw2x2d4dths", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 2, lotIds: ["n17bc8v58sqbcmt6hsr95f3axetegx3y", "n17d8s4n6ct1e20gjjnagct7jx8f34eb"] },
      { rowId: "nh7eyybbvsr8k5tw7vp64nxfxx1f0jgj", productId: "kd77q3s07rwr3tb5vannbh7y0xp6sn49", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 2, lotIds: ["n17etzdakgv8aj2nypq5qra3xm6xkwrw"] },
      { rowId: "nh70h4x4x9vbk8r09zm3tvkv23t3n45r", productId: "kd7cm0h4dy5c04kxzt6tqnpnkc7ny2yv", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 4, lotIds: ["n174fc7029m6xtnjwadhe2qyvetgx2zj"] },
      { rowId: "nh78nvbahyxnt0mqbcyv9ekhe30pmbav", productId: "kd74zphr0t1ettp589avsqdmabafkw83", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n17d9cp1derj7688q0nf0tsve90x66zc"] },
      { rowId: "nh7b5y7eqn6q10n9pn8ez5sqr8hdkdn0", productId: "kd7a1824vydkd3jrpqz2vy3q6tga9k4v", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 2, lotIds: ["n17bdgdky96v84j42egsz3dyxmqs7djv", "n1707jnyahtmc1vrgv9pbm8g1n8f3z08"] },
      { rowId: "nh73qcngzzm57s9cqbah6mgzz60kka1q", productId: "kd7ekp0q766xv75xtakn0ewvjrcfr1pd", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 23, lotIds: ["n176f3shs4d5zscb7e5q7m16wgsydyyb"] },
      { rowId: "nh7c3jx1nxph4fa54q821zem1p5cc6kq", productId: "kd77k3sc9cgvrf2svjdmms95ht2b9ts1", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 24, lotIds: ["n177722mn5cyrxe2rcx4b5zxrs27nh4e"] },
      { rowId: "nh75wt4trnvkkkv91j1v9ns3cw4b0rtt", productId: "kd75k6hz4gj7szvar4d44nxnwp9a52qa", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 180, lotIds: ["n175veer6ay3p3zqpbbegnwfswe3s427", "n176cm1d59ehjgabncnmveryd98f3b43"] },
      { rowId: "nh7cyxppzhen3mdd7egv93cj5jd4vzsv", productId: "kd73jm219xh8099kywwtvhc4rca38v8x", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n1702b889rb4hpcb25v7jwqm45ngwf3x"] },
      { rowId: "nh72rc9acgqwnf59m17rrk286n8f3j5d", productId: "kd7fjr7m20vp7p285vn02nqv9h8f3xs4", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n172h5nab411khjjch5mdbxdy18f2v1k"] },
      { rowId: "nh7efd71zbh9xk4mw57t1g85wx8f23q0", productId: "kd70ck3e4c396bnsy529k04wkx8f25qh", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n17drm4hmjjgjg2t6d5s7kmbfx8f3jeg"] },
      { rowId: "nh7epqvxcybwefde7gx2avcj8s8f34ps", productId: "kd75fnwnxdcwyvjejt14wkae718f3xah", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 1, lotIds: ["n179gyd557t976j2a3nf1y0jn98f2nzw"] },
      { rowId: "nh76288mp9a1t0yfe28gdd0qxd8f30y8", productId: "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 400, lotIds: ["n178nsmp5pjbwn52e8jqq42vn18f2sx3"] },
      { rowId: "nh7dncv3jax17yf87wdajkcfxh8f2dar", productId: "kd7dd58stasmw3rvrsz3c0cn6h8f3vza", locationId: "n576x4v2v08tyzvzef21qk3m8h8e5y2f", quantity: 40, lotIds: ["n17a09daac7max0egvda6sq82h8f2d60"] },
    ];
    if (expected.length !== 22) throw new Error("Lista autorizada inválida; nenhuma gravação realizada.");

    const area: any = await ctx.db.get(areaId as any);
    if (!area || !area.active || area.name !== "Impressoras") {
      throw new Error("Área Impressoras ausente, inativa ou alterada; operação abortada.");
    }
    const [allLots, allBalances, allLocalRows] = await Promise.all([
      ctx.db.query("lots").collect(),
      ctx.db.query("lotLocationBalances").collect(),
      ctx.db.query("stockByLocation").collect(),
    ]);
    const balancesByLot = new Map<string, any[]>();
    for (const balance of allBalances as any[]) {
      const key = String(balance.lotId);
      const list = balancesByLot.get(key) ?? [];
      list.push(balance);
      balancesByLot.set(key, list);
    }

    const patches: Array<{ rowId: string; productId: string; quantity: number; lotIds: string[] }> = [];
    for (const item of expected) {
      const row: any = await ctx.db.get(item.rowId as any);
      if (!row || String(row.productId) !== item.productId ||
          String(row.locationId) !== item.locationId ||
          row.areaId != null || !Number.isFinite(row.quantity) ||
          Math.abs(Number(row.quantity) - item.quantity) > 1e-9) {
        throw new Error(`Saldo local ${item.rowId} mudou desde a auditoria; nenhuma classificação foi aplicada.`);
      }

      const productRows = (allLocalRows as any[]).filter((candidate: any) =>
        String(candidate.productId) === item.productId &&
        String(candidate.locationId) === item.locationId
      );
      if (productRows.length !== 1 || String(productRows[0]._id) !== item.rowId) {
        throw new Error(`Escopo produto/local possui registros adicionais: ${item.productId}; operação abortada.`);
      }

      const positiveLots = (allLots as any[]).filter((lot: any) => {
        if (String(lot.productId) !== item.productId || !(Number(lot.quantityAvailable) > 0)) return false;
        const lotBalances = balancesByLot.get(String(lot._id)) ?? [];
        const resolvedLocation = lot.locationId ?? (lotBalances.length === 1 ? lotBalances[0].locationId : null);
        return String(resolvedLocation ?? "") === item.locationId;
      });
      const actualLotIds = positiveLots.map((lot: any) => String(lot._id)).sort();
      const expectedLotIds = [...item.lotIds].sort();
      if (JSON.stringify(actualLotIds) !== JSON.stringify(expectedLotIds)) {
        throw new Error(`Conjunto de lotes do produto ${item.productId} mudou; operação abortada.`);
      }
      let lotsQuantity = 0;
      for (const lot of positiveLots as any[]) {
        const lotBalances = balancesByLot.get(String(lot._id)) ?? [];
        if (!lot.areaId || String(lot.areaId) !== areaId ||
            lotBalances.length !== 1 ||
            String(lotBalances[0].productId) !== item.productId ||
            String(lotBalances[0].locationId) !== item.locationId ||
            !Number.isFinite(lot.quantityAvailable) ||
            !Number.isFinite(lotBalances[0].quantityAvailable) ||
            Math.abs(Number(lotBalances[0].quantityAvailable) - Number(lot.quantityAvailable)) > 1e-9) {
          throw new Error(`Lote ${lot.lotNumber} não confirma área/local/quantidade; operação abortada.`);
        }
        lotsQuantity += Number(lot.quantityAvailable);
      }
      if (Math.abs(lotsQuantity - Number(row.quantity)) > 1e-9) {
        throw new Error(`Quantidade dos lotes diverge do saldo de ${item.productId}; operação abortada.`);
      }
      patches.push({ rowId: item.rowId, productId: item.productId, quantity: Number(row.quantity), lotIds: actualLotIds });
    }

    // Todas as 22 condições foram verificadas antes da primeira gravação.
    for (const item of patches) {
      await ctx.db.patch(item.rowId as any, { areaId: areaId as any });
    }
    const now = Date.now();
    await ctx.db.insert("auditLogs", {
      action: "update",
      entity: "stockByLocation",
      details: "Classificação histórica controlada: 22 saldos locais sem área foram associados à área Impressoras após revalidação transacional. Quantidades, estoque global, lotes, entradas e movimentações não foram alterados. Registros: " +
        patches.map((item) => item.rowId).join(", "),
      timestamp: now,
    });
    return {
      applied: true,
      updatedRows: patches.length,
      area: "Impressoras",
      totalQuantityClassified: patches.reduce((sum, item) => sum + item.quantity, 0),
      physicalQuantitiesChanged: false,
      lotsChanged: false,
      movementsChanged: false,
      auditLogged: true,
    };
  },
});

/**
 * Classifica exclusivamente os 36 saldos históricos documentados como TI Geral.
 * Revalida lote, item, saldo local, vínculo de lote/localização e movimento
 * original antes de qualquer escrita. Não altera quantidades nem saldos físicos.
 */
export const applyLegacyGeneralAreaClassification = internalMutation({
  args: {
    confirmation: v.literal("CONFIRMAR_CLASSIFICACAO_36_SALDOS_TI_GERAL_FIRST_HERRING"),
  },
  handler: async (ctx) => {
    const targets = LEGACY_GENERAL_AREA_CLASSIFICATION_TARGETS;
    const manifestRows = INITIAL_STOCK_MANIFEST.filter((row) => row.areaName === "TI Geral");
    const expectedQuantity = targets.reduce((sum, row) => sum + row.quantity, 0);
    const unique = (values: readonly string[]) => new Set(values).size === values.length;

    if (
      targets.length !== 36 ||
      manifestRows.length !== 36 ||
      expectedQuantity !== 1919 ||
      !unique(targets.map((row) => row.rowId)) ||
      !unique(targets.map((row) => row.productId)) ||
      !unique(targets.map((row) => row.lotId))
    ) {
      throw new Error("Manifesto fechado de TI Geral inválido; nenhuma alteração realizada.");
    }

    const areas: any[] = await ctx.db.query("stockAreas").collect();
    const matchingAreas = areas.filter((area) => area.name === "TI Geral" && area.active);
    if (matchingAreas.length !== 1) {
      throw new Error('Deve existir exatamente uma área ativa chamada "TI Geral".');
    }
    const area = matchingAreas[0];
    const areaId = String(area._id);

    const entry: any = await ctx.db
      .query("entries")
      .withIndex("by_number", (q: any) => q.eq("entryNumber", "ENT-2026-000001"))
      .first();
    if (
      !entry ||
      entry.status !== "confirmed" ||
      entry.originType !== "initial_inventory" ||
      entry.areaId != null
    ) {
      throw new Error("A entrada inicial ENT-2026-000001 não corresponde ao registro histórico esperado.");
    }

    const [
      initialItems,
      initialLots,
      allLots,
      allBalances,
      allLocalRows,
      allMovements,
      allMovementLotLinks,
      allReservations,
    ]: any[][] = await Promise.all([
      ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", entry._id)).collect(),
      ctx.db.query("lots").withIndex("by_entry", (q: any) => q.eq("entryId", entry._id)).collect(),
      ctx.db.query("lots").collect(),
      ctx.db.query("lotLocationBalances").collect(),
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("stockMovements").collect(),
      ctx.db.query("stockMovementLots").collect(),
      ctx.db.query("requestItemReservations").collect(),
    ]);

    const initialMovements = allMovements.filter((movement: any) => String(movement.entryId) === String(entry._id));
    if (initialItems.length !== 53 || initialLots.length !== 53 || initialMovements.length !== 53) {
      throw new Error(
        "Entrada inicial fora do manifesto: itens=" + initialItems.length +
        ", lotes=" + initialLots.length + ", movimentos=" + initialMovements.length +
        "; esperado 53/53/53."
      );
    }

    const manifestByName = new Map(INITIAL_STOCK_MANIFEST.map((row) => [row.productName, row]));
    const balancesByLot = new Map<string, any[]>();
    for (const balance of allBalances) {
      const key = String(balance.lotId);
      const list = balancesByLot.get(key) ?? [];
      list.push(balance);
      balancesByLot.set(key, list);
    }
    const linksByMovement = new Map<string, any[]>();
    for (const link of allMovementLotLinks) {
      const key = String(link.movementId);
      const list = linksByMovement.get(key) ?? [];
      list.push(link);
      linksByMovement.set(key, list);
    }
    const reservationsByLot = new Map<string, any[]>();
    for (const reservation of allReservations) {
      const key = String(reservation.lotId);
      const list = reservationsByLot.get(key) ?? [];
      list.push(reservation);
      reservationsByLot.set(key, list);
    }

    const patches: Array<{
      target: (typeof targets)[number];
      itemId: string;
      movementId: string;
      linkIds: string[];
    }> = [];
    let alreadyClassified = 0;

    for (const target of targets) {
      const manifest = manifestByName.get(target.productName);
      if (
        !manifest ||
        manifest.areaName !== "TI Geral" ||
        manifest.brand !== target.brand ||
        manifest.quantity !== target.quantity ||
        manifest.locationName !== target.locationName
      ) {
        throw new Error('O item "' + target.productName + '" não confere com a planilha oficial; operação abortada.');
      }

      const [product, location, lot, localRow]: any[] = await Promise.all([
        ctx.db.get(target.productId as any),
        ctx.db.get(target.locationId as any),
        ctx.db.get(target.lotId as any),
        ctx.db.get(target.rowId as any),
      ]);
      if (!product || product.name !== target.productName) {
        throw new Error('Produto de "' + target.productName + '" não corresponde ao ID da auditoria.');
      }
      if (!location || !location.active || location.name !== target.locationName) {
        throw new Error('Local físico de "' + target.productName + '" não corresponde à planilha.');
      }
      if (!lot || !lot.active ||
          String(lot.productId) !== target.productId ||
          String(lot.entryId) !== String(entry._id) ||
          String(lot.locationId) !== target.locationId ||
          !Number.isFinite(lot.quantityAvailable) ||
          !Number.isFinite(lot.quantityReceived) ||
          Math.abs(lot.quantityAvailable - target.quantity) > 1e-9 ||
          Math.abs(lot.quantityReceived - target.quantity) > 1e-9) {
        throw new Error('Lote de "' + target.productName + '" não corresponde à entrada, localização ou quantidade da planilha.');
      }
      if (lot.brand && lot.brand.trim().toLocaleLowerCase("pt-BR") !== target.brand.toLocaleLowerCase("pt-BR")) {
        throw new Error('Marca do lote de "' + target.productName + '" diverge da planilha.');
      }
      if (!localRow ||
          String(localRow.productId) !== target.productId ||
          String(localRow.locationId) !== target.locationId ||
          !Number.isFinite(localRow.quantity) ||
          Math.abs(localRow.quantity - target.quantity) > 1e-9) {
        throw new Error('Saldo por localização de "' + target.productName + '" mudou desde a auditoria.');
      }

      const localScopeRows = allLocalRows.filter((row: any) =>
        String(row.productId) === target.productId &&
        String(row.locationId) === target.locationId &&
        (row.areaId == null || String(row.areaId) === areaId)
      );
      if (localScopeRows.length !== 1 || String(localScopeRows[0]._id) !== target.rowId) {
        throw new Error('Escopo produto/local de "' + target.productName + '" possui saldos adicionais ou duplicados.');
      }

      const areaLessLots = allLots.filter((candidate: any) =>
        String(candidate.productId) === target.productId &&
        String(candidate.locationId) === target.locationId &&
        (candidate.areaId == null || String(candidate.areaId) === areaId) &&
        Number(candidate.quantityAvailable) > 0
      );
      if (areaLessLots.length !== 1 || String(areaLessLots[0]._id) !== target.lotId) {
        throw new Error('Conjunto de lotes positivos de "' + target.productName + '" mudou desde a auditoria.');
      }

      const lotBalances = balancesByLot.get(target.lotId) ?? [];
      if (
        lotBalances.length !== 1 ||
        String(lotBalances[0].productId) !== target.productId ||
        String(lotBalances[0].locationId) !== target.locationId ||
        !Number.isFinite(lotBalances[0].quantityAvailable) ||
        Math.abs(lotBalances[0].quantityAvailable - target.quantity) > 1e-9
      ) {
        throw new Error('Saldo lote/localização de "' + target.productName + '" não fecha com a quantidade documental.');
      }

      const entryItemMatches = initialItems.filter((item: any) =>
        String(item.productId) === target.productId &&
        (String(item.lotId) === target.lotId || String(item.lotId) === String(lot.lotNumber)) &&
        String(item.locationId) === target.locationId &&
        Number(item.quantity) === target.quantity
      );
      if (entryItemMatches.length !== 1) {
        throw new Error('Item da entrada inicial de "' + target.productName + '" não pôde ser identificado de forma única.');
      }
      const entryItem = entryItemMatches[0];
      if (
        entryItem.brand &&
        entryItem.brand.trim().toLocaleLowerCase("pt-BR") !== target.brand.toLocaleLowerCase("pt-BR")
      ) {
        throw new Error('Marca do item da entrada de "' + target.productName + '" diverge da planilha.');
      }

      const reservations = reservationsByLot.get(target.lotId) ?? [];
      for (const reservation of reservations) {
        if (String(reservation.areaId) !== areaId ||
            String(reservation.productId) !== target.productId ||
            String(reservation.locationId) !== target.locationId) {
          throw new Error('Há reserva vinculada a "' + target.productName + '" com área/local divergente; operação abortada.');
        }
      }

      const movementMatches = initialMovements.filter((movement: any) =>
        String(movement.productId) === target.productId &&
        String(movement.lotId) === target.lotId
      );
      if (movementMatches.length !== 1) {
        throw new Error('Movimentação original de "' + target.productName + '" não pôde ser identificada de forma única.');
      }
      const movement = movementMatches[0];
      // Movimentos iniciais históricos podem não ter locationId. Nessa situação,
      // lote, item da entrada e saldo por localização já foram conferidos acima
      // contra a mesma localização documental. Um locationId preenchido e
      // divergente continua bloqueando a operação.
      if (
        movement.type !== "adjustment" ||
        Math.abs(Number(movement.quantity) - target.quantity) > 1e-9 ||
        !isLegacyMovementLocationCompatible(movement.locationId, target.locationId)
      ) {
        throw new Error('Movimentação original de "' + target.productName + '" não confere com a carga inicial.');
      }

      const movementLinks = linksByMovement.get(String(movement._id)) ?? [];
      if (movementLinks.length > 0) {
        const linkedQuantity = movementLinks.reduce((sum: number, link: any) => sum + Number(link.quantity), 0);
        if (
          movementLinks.length !== 1 ||
          String(movementLinks[0].lotId) !== target.lotId ||
          Math.abs(linkedQuantity - target.quantity) > 1e-9 ||
          String(movementLinks[0].locationId) !== target.locationId
        ) {
          throw new Error('Vínculos de lote da movimentação de "' + target.productName + '" divergem da origem documental.');
        }
      }

      const metadataStates = [
        lot.areaId,
        entryItem.areaId,
        localRow.areaId,
        movement.areaId,
        ...movementLinks.map((link: any) => link.areaId),
      ].map((value) => value == null ? "unset" : String(value));
      if (metadataStates.some((value) => value !== "unset" && value !== areaId)) {
        throw new Error('"' + target.productName + '" já possui metadado de área conflitante; operação abortada.');
      }
      const uniqueStates = new Set(metadataStates);
      if (uniqueStates.size !== 1) {
        throw new Error('"' + target.productName + '" tem metadados parcialmente classificados; operação abortada.');
      }

      if (metadataStates[0] === areaId) {
        alreadyClassified++;
      } else {
        patches.push({
          target,
          itemId: String(entryItem._id),
          movementId: String(movement._id),
          linkIds: movementLinks.map((link: any) => String(link._id)),
        });
      }
    }

    if (alreadyClassified === targets.length) {
      return {
        applied: false,
        idempotentNoOp: true,
        area: "TI Geral",
        updatedLots: 0,
        updatedEntryItems: 0,
        updatedRows: 0,
        updatedInitialMovements: 0,
        totalQuantityClassified: expectedQuantity,
        physicalQuantitiesChanged: false,
        movementQuantitiesChanged: false,
        auditLogged: false,
      };
    }
    if (alreadyClassified !== 0 || patches.length !== targets.length) {
      throw new Error("Classificação parcial detectada. Nenhuma alteração foi aplicada.");
    }

    // Todas as 36 linhas e seus vínculos históricos foram validados antes da primeira escrita.
    for (const patch of patches) {
      await ctx.db.patch(patch.target.lotId as any, { areaId: area._id });
      await ctx.db.patch(patch.itemId as any, { areaId: area._id });
      await ctx.db.patch(patch.target.rowId as any, { areaId: area._id });
      await ctx.db.patch(patch.movementId as any, { areaId: area._id });
      for (const linkId of patch.linkIds) {
        await ctx.db.patch(linkId as any, { areaId: area._id });
      }
    }

    await ctx.db.insert("auditLogs", {
      action: "update",
      entity: "stock",
      entityId: String(entry._id),
      details:
        "Classificação documental dos 36 itens da carga inicial como TI Geral, conforme docs/planilha-carga-inicial.csv. " +
        "Metadados atualizados em lotes, itens da entrada, saldos por localização e movimentos originais. " +
        "Quantidade total classificada: 1.919. Nenhuma quantidade física, reserva ou saldo global foi alterado.",
      timestamp: Date.now(),
    });

    return {
      applied: true,
      area: "TI Geral",
      updatedLots: patches.length,
      updatedEntryItems: patches.length,
      updatedRows: patches.length,
      updatedInitialMovements: patches.length,
      totalQuantityClassified: patches.reduce((sum, patch) => sum + patch.target.quantity, 0),
      physicalQuantitiesChanged: false,
      movementQuantitiesChanged: false,
      auditLogged: true,
    };
  },
});

/**
 * Backfill controlado de lots.locationId usando exclusivamente os vínculos
 * já conciliados em lotLocationBalances. Não altera quantidades, áreas,
 * estoque global, saldos por área/local, entradas ou movimentações.
 */
export const applyLotLocationMetadataBackfill = internalMutation({
  args: {
    confirmation: v.literal("CONFIRMAR_ATUALIZACAO_LOCALIZACAO_LOTES_FIRST_HERRING"),
  },
  handler: async (ctx) => {
    const [lots, balances, locations] = await Promise.all([
      ctx.db.query("lots").collect(),
      ctx.db.query("lotLocationBalances").collect(),
      ctx.db.query("storageLocations").collect(),
    ]);
    const lotById = new Map<string, any>(lots.map((lot: any) => [String(lot._id), lot] as const));
    const locationById = new Map<string, any>(locations.map((location: any) => [String(location._id), location] as const));
    const rowsByLot = new Map<string, any[]>();
    for (const row of balances as any[]) {
      const key = String(row.lotId);
      const current = rowsByLot.get(key) ?? [];
      current.push(row);
      rowsByLot.set(key, current);
    }

    const problems: string[] = [];
    for (const [lotId, rows] of rowsByLot) {
      const lot: any = lotById.get(lotId);
      if (!lot) {
        problems.push(`saldo sem lote correspondente: ${lotId}`);
        continue;
      }
      if (rows.length !== 1) {
        problems.push(`lote ${lot.lotNumber}: ${rows.length} saldos lote × armário`);
        continue;
      }
      const row = rows[0];
      if (row.productId !== lot.productId ||
          !Number.isFinite(row.quantityAvailable) || row.quantityAvailable < 0 ||
          !Number.isFinite(lot.quantityAvailable) ||
          Math.abs(row.quantityAvailable - lot.quantityAvailable) > 1e-9 ||
          !locationById.get(String(row.locationId))?.active) {
        problems.push(`lote ${lot.lotNumber}: saldo, produto ou armário divergente`);
        continue;
      }
      if (lot.locationId && lot.locationId !== row.locationId) {
        problems.push(`lote ${lot.lotNumber}: localização já preenchida diverge do saldo conciliado`);
      }
    }
    for (const lot of lots as any[]) {
      if (Number(lot.quantityAvailable) > 0 && !rowsByLot.has(String(lot._id))) {
        problems.push(`lote ${lot.lotNumber}: saldo positivo sem vínculo lote × armário`);
      }
    }
    if (problems.length > 0) {
      throw new Error(
        `Atualização de localização dos lotes abortada sem gravações: ${problems.slice(0, 10).join("; ")}`
      );
    }

    let patched = 0;
    let skipped = 0;
    const now = Date.now();
    for (const [lotId, rows] of rowsByLot) {
      const lot: any = lotById.get(lotId);
      const row = rows[0];
      if (lot.locationId === row.locationId) {
        skipped++;
        continue;
      }
      await ctx.db.patch(lot._id, { locationId: row.locationId });
      patched++;
    }
    await ctx.db.insert("auditLogs", {
      action: "update",
      entity: "lots",
      details:
        `Backfill controlado de localização física dos lotes a partir de ${balances.length} vínculos conciliados: ${patched} lote(s) atualizado(s), ${skipped} já corretos. Nenhuma quantidade ou saldo físico foi alterado.`,
      timestamp: now,
    });
    return {
      metadataBackfillApplied: true,
      patched,
      skipped,
      mappedLots: balances.length,
      totalLots: lots.length,
      physicalQuantitiesChanged: false,
    };
  },
});

/**
 * Quick stock exit (saída simples).
 * Simplified exit without the full request/approval flow.
 * Uses FIFO lot consumption. Reduces both global and location stock.
 */
export const quickExit = mutation({
  args: {
    productId: v.id("products"),
    areaId: v.id("stockAreas"),
    locationId: v.id("storageLocations"),
    quantity: v.number(),
    destination: v.string(),
    receiverName: v.string(),
    reason: v.optional(v.string()),
    osNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    args = { ...args, quantity: Number(args.quantity) };
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
      throw new Error("Quantidade deve ser um número válido maior que zero");
    }
    if (args.destination.trim().length === 0 || args.receiverName.trim().length === 0) {
      throw new Error("Informe o destino e o nome de quem está recebendo o material.");
    }
    const product = await ctx.db.get(args.productId);
    if (!product || !product.active) throw new Error("Produto não encontrado ou inativo");
    if (product.hasSerial) {
      throw new Error("Este produto exige controle individual por número de série/patrimônio. Use a movimentação do equipamento, não a saída rápida por quantidade.");
    }
    if (isDiscreteStockUnit(product.unitOfMeasure, product.hasSerial) && !Number.isSafeInteger(args.quantity)) {
      throw new Error(`A quantidade de "${product.name}" deve ser inteira para a unidade ${product.unitOfMeasure}.`);
    }
    const area = await ctx.db.get(args.areaId);
    const location = await ctx.db.get(args.locationId);
    if (!area || !area.active || !location || !location.active) {
      throw new Error("A área/subestoque e o local físico precisam estar ativos.");
    }
    const stockRows = await ctx.db.query("stock")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    if (stockRows.length !== 1) {
      throw new Error(stockRows.length === 0
        ? "Produto não possui registro de estoque"
        : "Há registros globais de estoque duplicados. Regularize antes da saída rápida.");
    }
    const stock = stockRows[0];
    if (!Number.isFinite(stock.physicalQuantity) || !Number.isFinite(stock.reservedQuantity) ||
        stock.physicalQuantity < 0 || stock.reservedQuantity < 0 ||
        stock.reservedQuantity > stock.physicalQuantity) {
      throw new Error("O saldo global está inconsistente. Regularize antes da saída rápida.");
    }
    const globalAvailable = stock.physicalQuantity - stock.reservedQuantity;
    if (args.quantity > globalAvailable) {
      throw new Error(`Estoque global insuficiente. Disponível: ${globalAvailable} ${product.unitOfMeasure}`);
    }

    const existingReservations = await ctx.db.query("requestItemReservations")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const areaReservedGlobal = existingReservations.reduce(
      (sum: number, reservation: any) => sum + reservation.quantityRemaining, 0
    );
    if (existingReservations.some((reservation: any) =>
      !Number.isFinite(reservation.quantityRemaining) || reservation.quantityRemaining < 0
    )) {
      throw new Error("Há reserva de solicitação com quantidade inválida. Regularize antes da saída rápida.");
    }
    if (Math.abs(areaReservedGlobal - stock.reservedQuantity) > 1e-9) {
      const legacyReserved = stock.reservedQuantity - areaReservedGlobal;
      throw new Error(legacyReserved > 0
        ? `Há ${legacyReserved} unidade(s) reservada(s) por solicitação antiga sem área. Conclua ou cancele essa solicitação antes da saída rápida.`
        : "As reservas por lote excedem o saldo reservado global. Regularize a divergência antes da saída rápida.");
    }
    const legacyReserved = Math.max(0, stock.reservedQuantity - areaReservedGlobal);
    if (legacyReserved > 0) {
      throw new Error(
        `Há ${legacyReserved} unidade(s) reservada(s) por solicitação antiga sem área. Conclua ou cancele essa solicitação antes da saída rápida.`
      );
    }

    const locationRows = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const matchingLocationRows = locationRows.filter((row: any) =>
      row.locationId === args.locationId && row.areaId === args.areaId
    );
    if (matchingLocationRows.length > 1) {
      throw new Error("Há saldos físicos duplicados nessa área/local. Regularize antes da saída rápida.");
    }
    const locationStock = matchingLocationRows[0] ?? null;
    if (!locationStock || !Number.isFinite(locationStock.quantity) || locationStock.quantity < args.quantity) {
      throw new Error(`Estoque insuficiente em "${area.name}" / "${location.name}". Disponível: ${locationStock?.quantity ?? 0}.`);
    }

    const productLots = await ctx.db.query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    if (productLots.some((lot: any) => lot.materialType === "permanent")) {
      throw new Error("Material permanente deve ser movimentado pelo cadastro individual do patrimônio, não por saída agregada.");
    }
    const sourceLots = productLots.filter((lot: any) =>
      lot.areaId === args.areaId && lot.locationId === args.locationId
    );
    const sourceLotTotal = sourceLots.reduce((sum: number, lot: any) => {
      if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) {
        throw new Error(`O lote ${lot.lotNumber} possui saldo inválido. Regularize antes da saída rápida.`);
      }
      if (lot.active === false && lot.quantityAvailable > 0) {
        throw new Error(`O lote ${lot.lotNumber} está inativo com saldo positivo. Regularize antes da saída rápida.`);
      }
      return sum + lot.quantityAvailable;
    }, 0);
    if (Math.abs(sourceLotTotal - locationStock.quantity) > 1e-9) {
      throw new Error("O saldo do local diverge dos lotes registrados. Regularize antes da saída rápida.");
    }

    const reservedByLot = new Map<string, number>();
    for (const reservation of existingReservations as any[]) {
      const lot = productLots.find((candidate: any) => candidate._id === reservation.lotId);
      if (!lot || reservation.productId !== args.productId ||
          reservation.areaId !== lot.areaId || reservation.locationId !== lot.locationId) {
        throw new Error("Há reserva sem correspondência válida de produto, lote, área ou local.");
      }
      const remaining = Number(reservation.quantityRemaining);
      reservedByLot.set(String(lot._id), (reservedByLot.get(String(lot._id)) ?? 0) + remaining);
    }

    const candidates = [];
    for (const lot of sourceLots) {
      if (!lot.active) continue;
      const reserved = reservedByLot.get(String(lot._id)) ?? 0;
      const free = Number(lot.quantityAvailable) - reserved;
      if (free < -1e-9) {
        throw new Error(`O lote ${lot.lotNumber} possui reserva superior ao saldo físico.`);
      }
      candidates.push({ lot, free: Math.max(0, free) });
    }
    candidates.sort((a: any,b: any) =>
      a.lot.receivedAt - b.lot.receivedAt || a.lot.lotNumber.localeCompare(b.lot.lotNumber)
    );

    let remaining = args.quantity;
    const consumedLots: Array<{ lotId: string; quantity: number }> = [];
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const lot = await ctx.db.get(candidate.lot._id);
      if (!lot) throw new Error("Lote desapareceu durante a saída.");
      const reservations = await ctx.db.query("requestItemReservations")
        .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id)).collect();
      const reserved = reservations.reduce((sum: number, reservation: any) => sum + reservation.quantityRemaining, 0);
      const free = Math.max(0, lot.quantityAvailable - reserved);
      const consume = Math.min(free, remaining);
      if (consume <= 0) continue;
      const nextQuantity = lot.quantityAvailable - consume;
      await ctx.db.patch(lot._id, { quantityAvailable: nextQuantity, active: nextQuantity > 0 });
      await adjustLotLocationBalance(ctx, {
        lotId: lot._id, productId: lot.productId, locationId: lot.locationId,
        delta: -consume,
      });
      consumedLots.push({ lotId: lot._id as string, quantity: consume });
      remaining -= consume;
    }
    if (remaining > 0) {
      throw new Error(`Lotes insuficientes em "${area.name}" / "${location.name}". Faltam ${remaining} ${product.unitOfMeasure}.`);
    }

    const now = Date.now();
    const previousPhysical = stock.physicalQuantity;
    const previousReserved = stock.reservedQuantity;
    const newPhysical = previousPhysical - args.quantity;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    await ctx.db.patch(locationStock._id, { quantity: locationStock.quantity - args.quantity });

    const consumedLotId = resolveConsumedLotId(consumedLots as LotConsumption[]);
    const lotInfo = formatConsumedLots(consumedLots, (id) =>
      productLots.find((lot: any) => lot._id === id)?.lotNumber
    );
    const exitNumber = await generateExitNumber(ctx);
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId, type: "exit", quantity: args.quantity,
      previousPhysical, newPhysical, previousReserved, newReserved: previousReserved,
      userId, exitNumber, lotId: consumedLotId ?? undefined,
      areaId: args.areaId, locationId: args.locationId,
      observation: [
        `Saída rápida — ${args.receiverName}`,
        `Área: ${area.name}`,
        `Local: ${location.name}`,
        args.reason ? `Motivo: ${args.reason}` : "",
        args.osNumber ? `O.S.: ${args.osNumber}` : "",
        args.observation ?? "",
        `Destino: ${args.destination}`,
        `Lotes: ${lotInfo}`,
      ].filter(Boolean).join(" | "),
      timestamp: now,
    });
    for (const consumed of consumedLots) {
      await ctx.db.insert("stockMovementLots", {
        movementId,
        lotId: consumed.lotId as any,
        quantity: consumed.quantity,
        areaId: args.areaId,
        locationId: args.locationId,
      });
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "move_stock", entity: "stock", entityId: args.productId,
      details: `Saída rápida: ${args.quantity}x ${product.name} — ${area.name} / ${location.name} → ${args.destination} (${args.receiverName})`,
      timestamp: now,
    });
    return {
      message: "Saída registrada com sucesso",
      quantity: args.quantity,
      product: product.name,
      newAvailable: newPhysical - previousReserved,
      lotsConsumed: consumedLots.length,
    };
  },
});

/**
 * Cleanup: remove test/homologation data.
 * Preserves users, passwords, auth, schema, audit logs.
 */
export const cleanupTestData = internalMutation({
  args: {
    confirm: v.literal(true),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const deleted: Record<string, number> = {};

    // Delete draft entries
    const drafts = await ctx.db
      .query("entries")
      .withIndex("by_status", (q) => q.eq("status", "draft"))
      .collect();
    for (const d of drafts) {
      const items = await ctx.db
        .query("entryItems")
        .withIndex("by_entry", (q) => q.eq("entryId", d._id))
        .collect();
      for (const item of items) await ctx.db.delete(item._id);
      await ctx.db.delete(d._id);
    }
    deleted.entries_drafts = drafts.length;

    // Delete pending requests
    const pendingRequests = await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    for (const r of pendingRequests) {
      const items = await ctx.db
        .query("requestItems")
        .withIndex("by_request", (q) => q.eq("requestId", r._id))
        .collect();
      for (const item of items) await ctx.db.delete(item._id);
      await ctx.db.delete(r._id);
    }
    deleted.requests_pending = pendingRequests.length;

    // Reset stock to zero
    const stocks = await ctx.db.query("stock").collect();
    for (const s of stocks) {
      await ctx.db.patch(s._id, { physicalQuantity: 0, reservedQuantity: 0 });
    }
    deleted.stocks_reset = stocks.length;

    // Reset lot quantities
    const lots = await ctx.db.query("lots").collect();
    for (const l of lots) {
      await ctx.db.patch(l._id, { quantityAvailable: 0 });
    }
    deleted.lots_reset = lots.length;

    // Delete stockByLocation
    const sbl = await ctx.db.query("stockByLocation").collect();
    for (const s of sbl) {
      await ctx.db.delete(s._id);
    }
    deleted.stockByLocation_deleted = sbl.length;

    // Remove os saldos derivados junto com os lotes zerados no ambiente de testes.
    const lotLocationBalances = await ctx.db.query("lotLocationBalances").collect();
    for (const balance of lotLocationBalances) {
      await ctx.db.delete(balance._id);
    }
    deleted.lotLocationBalances_deleted = lotLocationBalances.length;

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "update",
      entity: "seed",
      details: `Limpeza de dados de homologação: ${JSON.stringify(deleted)}`,
      timestamp: Date.now(),
    });

    return { message: "Dados de homologação limpos", deleted };
  },
});

/**
 * Gestão de Estoque SGGD — ESTOQUE DE IMPLANTAÇÃO: validação de integridade (somente leitura).
 *
 * A carga inicial (originType "initial_inventory") representa o estoque físico
 * existente na data de implantação. Esta query NÃO altera nada: apenas confere
 *  - as entradas de implantação (itens, lotes, movimentações, unidades);
 *  - saldo global × saldo por localização, produto a produto;
 *  - ausência de duplicação (1 carga inicial por produto; sem nomes repetidos);
 *  - presença do carimbo de implantação na entrada.
 */
export const implementationStockStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const entries = await ctx.db.query("entries").collect();
    const initialEntries = entries.filter(
      (e) => e.originType === "initial_inventory"
    );
    const initialEntryIds = new Set<string>(initialEntries.map((e) => e._id as string));
    const allMovements = await ctx.db.query("stockMovements").collect();
    const allLots = await ctx.db.query("lots").collect();

    const productIds = new Set<string>();
    const entriesSummary: Array<{
      entryNumber: string;
      receivedAt: number;
      stamped: boolean;
      responsible: string | null;
      itemCount: number;
      lots: number;
      movements: number;
      units: number;
      observation: string | null;
    }> = [];
    let totalUnits = 0;
    let totalLots = 0;
    let totalMovements = 0;
    let totalItems = 0;

    for (const entry of initialEntries) {
      const items = await ctx.db
        .query("entryItems")
        .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
        .collect();
      const entryLots = allLots.filter((l) => l.entryId === entry._id);
      const entryMovements = allMovements.filter((m) => m.entryId === entry._id);
      const responsible = await ctx.db.get(entry.responsibleUserId);
      const units = items.reduce((sum, i) => sum + i.quantity, 0);

      for (const lot of entryLots) productIds.add(lot.productId as string);
      totalUnits += units;
      totalLots += entryLots.length;
      totalMovements += entryMovements.length;
      totalItems += items.length;

      entriesSummary.push({
        entryNumber: entry.entryNumber,
        receivedAt: entry.receivedAt,
        stamped: isImplementationStockStamped(entry.observation),
        responsible: responsible?.name ?? responsible?.email ?? null,
        itemCount: items.length,
        lots: entryLots.length,
        movements: entryMovements.length,
        units,
        observation: entry.observation ?? null,
      });
    }

    // ── Saldo global × localização (produto a produto) ──
    const mismatches: Array<{
      productId: string;
      name: string;
      global: number;
      byLocation: number;
    }> = [];
    const initialLoadsPerProduct: Array<{
      productId: string;
      name: string;
      initialLots: number;
    }> = [];
    const locationTotals = new Map<string, { name: string; quantity: number }>();
    let globalTotal = 0;
    let byLocationTotal = 0;

    for (const productId of productIds) {
      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q) => q.eq("productId", productId as any))
        .first();
      const sblRows = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", productId as any))
        .collect();
      const product = (await ctx.db.get(productId as any)) as {
        name?: string;
      } | null;
      const physical = stock?.physicalQuantity ?? 0;
      const byLocation = sblRows.reduce((sum, row) => sum + row.quantity, 0);

      globalTotal += physical;
      byLocationTotal += byLocation;

      if (physical !== byLocation) {
        mismatches.push({
          productId,
          name: product?.name ?? productId,
          global: physical,
          byLocation,
        });
      }

      const initialLots = allLots.filter(
        (l) =>
          l.productId === productId &&
          !!l.entryId &&
          initialEntryIds.has(l.entryId) &&
          l.active
      ).length;
      if (initialLots > 1) {
        initialLoadsPerProduct.push({
          productId,
          name: product?.name ?? productId,
          initialLots,
        });
      }

      for (const row of sblRows) {
        const location = await ctx.db.get(row.locationId);
        const key = row.locationId as string;
        const current = locationTotals.get(key) ?? {
          name: location?.name ?? key,
          quantity: 0,
        };
        current.quantity += row.quantity;
        locationTotals.set(key, current);
      }
    }

    // ── Duplicação de cadastro (nomes repetidos entre produtos ativos) ──
    const activeProducts = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const nameCounts = new Map<string, number>();
    for (const product of activeProducts) {
      const key = product.name.trim().toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const duplicateProductNames: string[] = [];
    nameCounts.forEach((count, name) => {
      if (count > 1) duplicateProductNames.push(name);
    });

    return {
      implementationDate: IMPLEMENTATION_STOCK_DATE,
      entries: entriesSummary,
      totals: {
        entries: initialEntries.length,
        items: totalItems,
        units: totalUnits,
        lots: totalLots,
        movements: totalMovements,
        products: productIds.size,
      },
      stock: {
        globalTotal,
        byLocationTotal,
        consistent: mismatches.length === 0,
        mismatches,
      },
      locations: Array.from(locationTotals.entries()).map(([locationId, v]) => ({
        locationId,
        name: v.name,
        quantity: v.quantity,
      })),
      duplicates: {
        initialLoadsPerProduct,
        duplicateProductNames,
      },
      integrityOk:
        mismatches.length === 0 &&
        initialLoadsPerProduct.length === 0 &&
        duplicateProductNames.length === 0,
    };
  },
});

/**
 * Check if initial stock has been loaded.
 */
export const hasInitialStock = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const stocks = await ctx.db.query("stock").collect();
    const hasAny = stocks.some((s) => s.physicalQuantity > 0);
    return { hasInitialStock: hasAny, totalProducts: stocks.length };
  },
});

/**
 * Status da carga inicial por produto (usado pela tela de Implantação Inicial).
 * Retorna, para cada produto ativo, se ele já possui carga inicial confirmada.
 */
export const getInitialLoadStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const lots = await ctx.db.query("lots").collect();
    const entryCache = new Map<string, any>();

    const result: Array<{ productId: string; loaded: boolean }> = [];
    for (const product of products) {
      const productLots = lots.filter((l) => l.productId === product._id);
      const loaded = await hasInitialInventoryLot(productLots, async (entryId) => {
        if (!entryCache.has(entryId)) {
          entryCache.set(entryId, await ctx.db.get(entryId as any));
        }
        return entryCache.get(entryId);
      });
      result.push({ productId: product._id, loaded });
    }
    return result;
  },
});
