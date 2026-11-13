import { requirePermission } from "./rbac";
import {
  resolveConsumedLotId,
  formatConsumedLots,
  type LotConsumption,
} from "../lib/stock-consumption";
import { internalQuery, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildLotLocationMigrationPlan } from "../lib/lot-location-migration";
import { v } from "convex/values";
import {
  isClosedUnusedReturnAtSource,
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
async function generateLotNumber(ctx: any, productId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existingLots = await ctx.db
    .query("lots")
    .withIndex("by_product", (q: any) => q.eq("productId", productId))
    .collect();
  const seq = existingLots.length + 1;
  return `LOT-${year}-${String(seq).padStart(6, "0")}`;
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
  items: Array<{ productId: string; locationId: string; quantity: number; unitOfMeasure?: string }>,
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
  const entrySeq = (await ctx.db.query("entries").collect()).length + 1;
  const entryNumber = `ENT-${year}-${String(entrySeq).padStart(6, "0")}`;
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
    if (item.quantity < 0) {
      throw new Error(
        `Quantidade negativa não permitida para produto ${item.productId}`
      );
    }
    if (item.quantity === 0) continue;

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
        observation: `Carga inicial — ${item.quantity} unidades`,
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
      });

      // ── 3. stockByLocation ──
      const existingSbl = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
        .collect();
      const sblForLocation = existingSbl.find(
        (s: any) => s.locationId === item.locationId
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
        });
      }

      // ── 4. stock (global) ──
      const existingStock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
        .first();

      const previousGlobal = existingStock?.physicalQuantity ?? 0;
      const totalForProduct = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
        .collect();
      const newGlobal = totalForProduct.reduce(
        (sum: number, s: any) => sum + s.quantity,
        0
      );

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
        observation: `Carga inicial — lote ${lotNumber} — ${item.quantity} unidades`,
        timestamp: now,
      });

      const product = await ctx.db.get(item.productId);
      const location = await ctx.db.get(item.locationId);
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
        // UOM original da planilha: a quantidade fica semanticamente na
        // unidade registrada (cx permanece cx, pct permanece pct).
        unitOfMeasure: row.unitOfMeasure || (existing?.unitOfMeasure ?? "un"),
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
    const sbl = await ctx.db.query("stockByLocation").collect();
    const locIds = [...new Set(sbl.map((s) => s.locationId))];
    const locs = await Promise.all(locIds.map((id) => ctx.db.get(id)));
    const locName = new Map(
      locs
        .filter((l): l is NonNullable<typeof l> => !!l)
        .map((l) => [l._id, l.name])
    );
    const byProduct = new Map<
      string,
      Array<{ locationId: string; locationName: string; quantity: number }>
    >();
    for (const s of sbl) {
      const arr = byProduct.get(s.productId) ?? [];
      arr.push({
        locationId: s.locationId,
        locationName: locName.get(s.locationId) ?? "—",
        quantity: s.quantity,
      });
      byProduct.set(s.productId, arr);
    }
    return Array.from(byProduct.entries()).map(([productId, locations]) => ({
      productId,
      locations,
    }));
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
    quantity: v.number(),
    locationId: v.optional(v.id("storageLocations")),
    destination: v.string(),
    receiverName: v.string(),
    reason: v.optional(v.string()),
    osNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);

    // Defesa numérica: normaliza Int64 → number (v.number() aceita Int64 via CLI)
    args = { ...args, quantity: Number(args.quantity) };

    if (args.quantity <= 0) {
      throw new Error("Quantidade deve ser maior que zero");
    }

    // ── Validate product ──
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (!product.active) throw new Error("Produto está inativo");

    // ── Check stock ──
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();

    const available =
      (stock?.physicalQuantity ?? 0) - (stock?.reservedQuantity ?? 0);

    if (args.quantity > available) {
      throw new Error(
        `Estoque insuficiente. Disponível: ${available} ${product.unitOfMeasure}`
      );
    }

    const now = Date.now();
    const previousPhysical = stock?.physicalQuantity ?? 0;
    const previousReserved = stock?.reservedQuantity ?? 0;

    // ── 1. Consume lots (FIFO: oldest first, then by lotNumber) ──
    const lots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();

    const activeLots = lots
      .filter((l) => l.active && l.quantityAvailable > 0)
      .sort(
        (a, b) =>
          a.receivedAt - b.receivedAt ||
          a.lotNumber.localeCompare(b.lotNumber)
      );

    let remaining = args.quantity;
    const consumedLots: Array<{ lotId: string; quantity: number }> = [];

    for (const lot of activeLots) {
      if (remaining <= 0) break;
      const consume = Math.min(remaining, lot.quantityAvailable);
      await ctx.db.patch(lot._id, {
        quantityAvailable: lot.quantityAvailable - consume,
      });
      consumedLots.push({ lotId: lot._id, quantity: consume });
      remaining -= consume;
    }

    if (remaining > 0) {
      throw new Error(
        `Lotes insuficientes. Faltam ${remaining} ${product.unitOfMeasure} para consumo`
      );
    }

    // ── 2. Reduce global stock ──
    const newPhysical = previousPhysical - args.quantity;
    await ctx.db.patch(stock!._id, { physicalQuantity: newPhysical });

    // ── 3. Reduce location stock if specified ──
    if (args.locationId) {
      const sbl = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", args.productId))
        .collect();
      const sblForLocation = sbl.find(
        (s) => s.locationId === args.locationId
      );

      if (sblForLocation) {
        const newLocQty = sblForLocation.quantity - args.quantity;
        if (newLocQty < 0) {
          throw new Error(
            `Estoque insuficiente no local. Disponível: ${sblForLocation.quantity}`
          );
        }
        await ctx.db.patch(sblForLocation._id, { quantity: newLocQty });
      }
    }

    // ── 4. Create stock movement ──
    // CORREÇÃO: o lote consumido passa a ser gravado no campo ESTRUTURADO
    // `lotId`. Antes ele existia apenas dentro do texto da observation, o que
    // impedia a devolução de restaurar o `quantityAvailable` do lote e gerava
    // a divergência 3337 x 3338. A observation é mantida para compatibilidade.
    const consumedLotId = resolveConsumedLotId(consumedLots as LotConsumption[]);
    const lotInfo = formatConsumedLots(consumedLots, (id) =>
      lots.find((l) => l._id === id)?.lotNumber,
    );

    // Número sequencial da saída (SAI-ANO-SEQ) — usado no vínculo de devoluções
    const exitNumber = await generateExitNumber(ctx);

    await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      previousPhysical,
      newPhysical,
      previousReserved,
      newReserved: previousReserved,
      userId,
      exitNumber,
      lotId: consumedLotId ?? undefined,
      observation: [
        `Saída rápida — ${args.receiverName}`,
        args.reason ? `Motivo: ${args.reason}` : "",
        args.osNumber ? `O.S.: ${args.osNumber}` : "",
        args.observation ?? "",
        `Destino: ${args.destination}`,
        `Lotes: ${lotInfo}`,
      ]
        .filter(Boolean)
        .join(" | "),
      timestamp: now,
    });

    // ── 5. Audit ──
    await ctx.db.insert("auditLogs", {
      userId,
      action: "move_stock",
      entity: "stock",
      entityId: args.productId,
      details: `Saída rápida: ${args.quantity}x ${product.name} → ${args.destination} (${args.receiverName})`,
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
export const cleanupTestData = mutation({
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

/**
 * Diagnóstico READ-ONLY da rastreabilidade lote × armário.
 *
 * Não cria saldos nem migra dados. Para lotes históricos sem saldo por armário,
 * apresenta o local informado na entrada apenas como CANDIDATO, nunca como
 * localização atual confirmada. Movimentos posteriores de saída, ajuste,
 * transferência ou devolução tornam a associação ambígua para revisão humana.
 */
export const lotLocationReadiness = internalQuery({
  args: {},
  handler: async (ctx, args) => {
    const [
      allProducts, allLots, allBalances, allLocations, allGlobalStock,
      allLocalStock, allEntryItems, allEntries, allMovements, allTransfers,
      allReturns, allSuppliers, allGomaQExchanges, allGomaQEmptyCartridges,
      allGomaQCollections,
    ] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("lots").collect(),
      ctx.db.query("lotLocationBalances").collect(),
      ctx.db.query("storageLocations").collect(),
      ctx.db.query("stock").collect(),
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("entryItems").collect(),
      ctx.db.query("entries").collect(),
      ctx.db.query("stockMovements").collect(),
      ctx.db.query("stockTransfers").collect(),
      ctx.db.query("returns").collect(),
      ctx.db.query("suppliers").collect(),
      ctx.db.query("gomaQExchanges").collect(),
      ctx.db.query("gomaQEmptyCartridges").collect(),
      ctx.db.query("gomaQCollections").collect(),
    ]);

    // Escopo intencionalmente global: não aceita productId para evitar
    // que uma leitura parcial seja confundida com auditoria da produção.
    const products = allProducts;
    const locationNames = new Map(allLocations.map((location) => [String(location._id), location.name]));
    const entryNumbers = new Map(allEntries.map((entry) => [String(entry._id), entry.entryNumber]));
    const productsResult: Array<Record<string, any>> = [];

    for (const product of products) {
      const lots = allLots.filter((lot) => lot.productId === product._id);
      const balances = allBalances.filter((balance) => balance.productId === product._id);
      const balanceScopeKeys = balances.map((balance) => `${String(balance.lotId)}::${String(balance.locationId)}`);
      const duplicateBalanceScopeCount = balanceScopeKeys.length - new Set(balanceScopeKeys).size;
      const invalidBalanceCount = balances.filter((balance) =>
        !Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0,
      ).length;
      const localRows = allLocalStock.filter((row) => row.productId === product._id);
      const globalRows = allGlobalStock.filter((row) => row.productId === product._id);
      const orphanBalanceCount = balances.filter((balance) =>
        !lots.some((lot) => lot._id === balance.lotId),
      ).length;
      const invalidLotCount = lots.filter((lot) =>
        !Number.isFinite(lot.quantityAvailable) ||
        lot.quantityAvailable < 0 ||
        !Number.isFinite(lot.receivedAt),
      ).length;

      let global: (typeof globalRows)[number] | null = null;
      let globalError: string | null = null;
      if (globalRows.length > 1) {
        globalError = `Existem ${globalRows.length} registros globais de estoque para o produto.`;
      } else if (globalRows.length === 0 && (localRows.some((row) => row.quantity > 0) || lots.some((lot) => lot.quantityAvailable > 0))) {
        globalError = "Há saldo físico ou lote disponível sem registro global de estoque.";
      } else if (globalRows.length === 1) {
        global = globalRows[0];
        if (
          !Number.isFinite(global.physicalQuantity) ||
          !Number.isFinite(global.reservedQuantity) ||
          global.physicalQuantity < 0 ||
          global.reservedQuantity < 0 ||
          global.reservedQuantity > global.physicalQuantity
        ) {
          globalError = "O registro global possui quantidades inválidas.";
        }
      }

      const balancesByLot = new Map<string, typeof balances>();
      for (const balance of balances) {
        const key = String(balance.lotId);
        const rows = balancesByLot.get(key) ?? [];
        rows.push(balance);
        balancesByLot.set(key, rows);
      }

      const lotDetails = lots.filter((lot) => lot.quantityAvailable > 0).map((lot) => {
        const lotBalances = balancesByLot.get(String(lot._id)) ?? [];
        const mappedQuantity = lotBalances.reduce((sum, balance) => sum + balance.quantityAvailable, 0);
        const entryItems = allEntryItems.filter((item) => item.lotId === String(lot._id));
        const candidateLocationIds = [...new Set(entryItems.map((item) => item.locationId ? String(item.locationId) : "").filter(Boolean))];
        const laterExitsOrAdjustments = allMovements.filter((movement) =>
          movement.productId === product._id &&
          movement.timestamp > lot.receivedAt &&
          movement.type !== "entry",
        );
        const laterTransfers = allTransfers.filter((transfer) =>
          transfer.productId === product._id && transfer.createdAt > lot.receivedAt,
        );
        const laterReturns = allReturns.filter((returned) =>
          returned.productId === product._id && returned.createdAt > lot.receivedAt,
        );
        const duplicateLocationRows = lotBalances.length !== new Set(lotBalances.map((balance) => String(balance.locationId))).size;
        const invalidBalance = lotBalances.some((balance) =>
          !Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0,
        );

        let status: "mapped" | "divergent" | "candidate" | "ambiguous" | "unmapped";
        let reason: string;
        let candidateLocationId: string | null = null;

        if (lotBalances.length > 0) {
          if (duplicateLocationRows || invalidBalance || Math.abs(mappedQuantity - lot.quantityAvailable) > 1e-9) {
            status = "divergent";
            reason = duplicateLocationRows
              ? "Há mais de um saldo do mesmo lote no mesmo armário."
              : invalidBalance
                ? "Há quantidade negativa ou não finita em um saldo lote × armário."
                : `Soma por armário (${mappedQuantity}) difere do saldo atual do lote (${lot.quantityAvailable}).`;
          } else {
            status = "mapped";
            reason = "Saldo por armário confere com o saldo atual do lote.";
          }
        } else if (
          candidateLocationIds.length === 1 &&
          laterTransfers.length === 0 &&
          (
            (laterExitsOrAdjustments.length === 0 && laterReturns.length === 0) ||
            isClosedUnusedReturnAtSource({
              lotId: String(lot._id),
              sourceLocationId: candidateLocationIds[0],
              movements: laterExitsOrAdjustments.map((movement) => ({
                id: String(movement._id),
                type: movement.type,
                lotId: movement.lotId ? String(movement.lotId) : null,
                quantity: movement.quantity,
                exitMovementId: movement.exitMovementId ? String(movement.exitMovementId) : null,
                canceled: movement.canceled === true,
              })),
              returns: laterReturns.map((returned) => ({
                exitMovementId: returned.exitMovementId ? String(returned.exitMovementId) : null,
                quantity: returned.quantity,
                locationId: returned.locationId ? String(returned.locationId) : null,
                condition: returned.condition ?? null,
              })),
            })
          )
        ) {
          status = "candidate";
          candidateLocationId = candidateLocationIds[0];
          reason = laterExitsOrAdjustments.length > 0
            ? "A saída foi integralmente devolvida sem uso ao mesmo armário, vinculada ao lote e à saída original; a localização de origem permanece sustentada pelo histórico."
            : "A entrada aponta um único armário e não há saída, ajuste, transferência ou devolução posterior identificada; exige conferência humana antes de qualquer migração.";
        } else if (candidateLocationIds.length > 0 || laterExitsOrAdjustments.length > 0 || laterTransfers.length > 0 || laterReturns.length > 0) {
          status = "ambiguous";
          reason = "Há histórico posterior ou mais de um local de entrada; não é seguro inferir a localização atual.";
        } else {
          status = "unmapped";
          reason = "Não há saldo por armário nem local de entrada suficiente para propor uma associação.";
        }

        return {
          lotId: String(lot._id),
          lotNumber: lot.lotNumber,
          quantityAvailable: lot.quantityAvailable,
          receivedAt: lot.receivedAt,
          entryNumber: entryNumbers.get(String(lot.entryId)) ?? null,
          sourceEntryLocations: candidateLocationIds.map((locationId) => ({
            locationId,
            locationName: locationNames.get(locationId) ?? "Local inexistente",
          })),
          mappedQuantity,
          mappedLocations: lotBalances.map((balance) => ({
            locationId: String(balance.locationId),
            locationName: locationNames.get(String(balance.locationId)) ?? "Local inexistente",
            quantity: balance.quantityAvailable,
          })),
          candidateLocationId,
          candidateLocationName: candidateLocationId ? locationNames.get(candidateLocationId) ?? "Local inexistente" : null,
          laterMovementCount: laterExitsOrAdjustments.length,
          laterTransferCount: laterTransfers.length,
          laterReturnCount: laterReturns.length,
          status,
          reason,
        };
      });

      const physicalByLocation = new Map<string, number>();
      const localDuplicateCounts = new Map<string, number>();
      for (const row of localRows) {
        const key = String(row.locationId);
        physicalByLocation.set(key, (physicalByLocation.get(key) ?? 0) + row.quantity);
        localDuplicateCounts.set(key, (localDuplicateCounts.get(key) ?? 0) + 1);
      }
      const mappedByLocation = new Map<string, number>();
      for (const balance of balances) {
        const key = String(balance.locationId);
        mappedByLocation.set(key, (mappedByLocation.get(key) ?? 0) + balance.quantityAvailable);
      }
      const candidateByLocation = new Map<string, number>();
      for (const lot of lotDetails) {
        if (lot.status === "candidate" && lot.candidateLocationId) {
          candidateByLocation.set(
            lot.candidateLocationId,
            (candidateByLocation.get(lot.candidateLocationId) ?? 0) + lot.quantityAvailable,
          );
        }
      }
      const locationIds = [...new Set([...physicalByLocation.keys(), ...mappedByLocation.keys(), ...candidateByLocation.keys()])];
      const localComparison = locationIds.map((locationId) => ({
        locationId,
        locationName: locationNames.get(locationId) ?? "Local inexistente",
        physicalQuantity: physicalByLocation.get(locationId) ?? 0,
        mappedLotQuantity: mappedByLocation.get(locationId) ?? 0,
        candidateLotQuantity: candidateByLocation.get(locationId) ?? 0,
        difference: (physicalByLocation.get(locationId) ?? 0) - (mappedByLocation.get(locationId) ?? 0),
        duplicatePhysicalRows: Math.max(0, (localDuplicateCounts.get(locationId) ?? 0) - 1),
      }));

      const statusCounts = {
        mapped: lotDetails.filter((lot) => lot.status === "mapped").length,
        divergent: lotDetails.filter((lot) => lot.status === "divergent").length,
        candidate: lotDetails.filter((lot) => lot.status === "candidate").length,
        ambiguous: lotDetails.filter((lot) => lot.status === "ambiguous").length,
        unmapped: lotDetails.filter((lot) => lot.status === "unmapped").length,
      };
      const globalPhysical = global?.physicalQuantity ?? 0;
      const localPhysicalTotal = localRows.reduce((sum, row) => sum + row.quantity, 0);
      const lotsAvailableTotal = lots.reduce((sum, lot) => sum + lot.quantityAvailable, 0);
      const mappedLotTotal = balances.reduce((sum, balance) => sum + balance.quantityAvailable, 0);
      const candidateLotTotal = lotDetails.filter((lot) => lot.status === "candidate").reduce((sum, lot) => sum + lot.quantityAvailable, 0);

      productsResult.push({
        productId: String(product._id),
        productName: product.name,
        globalPhysical,
        globalReserved: global?.reservedQuantity ?? 0,
        globalError,
        localPhysicalTotal,
        lotsAvailableTotal,
        mappedLotTotal,
        candidateLotTotal,
        localComparison,
        statusCounts,
        lots: lotDetails,
        candidateTotalsAlign:
          localComparison.every((row) => Math.abs(row.physicalQuantity - (row.mappedLotQuantity + row.candidateLotQuantity)) <= 1e-9) &&
          Math.abs(globalPhysical - (mappedLotTotal + candidateLotTotal)) <= 1e-9,
        invalidLotCount,
        invalidBalanceCount,
        duplicateBalanceScopeCount,
        orphanBalanceCount,
        readyForTrackedWithdrawal:
          !globalError &&
          invalidLotCount === 0 &&
          invalidBalanceCount === 0 &&
          duplicateBalanceScopeCount === 0 &&
          orphanBalanceCount === 0 &&
          statusCounts.divergent === 0 &&
          statusCounts.candidate === 0 &&
          statusCounts.ambiguous === 0 &&
          statusCounts.unmapped === 0 &&
          localRows.every((row) => Number.isFinite(row.quantity) && row.quantity >= 0) &&
          localComparison.every((row) => row.duplicatePhysicalRows === 0 && Math.abs(row.difference) <= 1e-9) &&
          Math.abs(globalPhysical - localPhysicalTotal) <= 1e-9 &&
          Math.abs(globalPhysical - lotsAvailableTotal) <= 1e-9,
      });
    }

    const countBy = (rows: any[], field: string): Record<string, number> =>
      rows.reduce((counts: Record<string, number>, row: any) => {
        const key = String(row[field] ?? "unknown");
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});
    const sumField = (rows: any[], field: string): number =>
      rows.reduce((sum: number, row: any) => sum + (Number.isFinite(row[field]) ? row[field] : 0), 0);
    const supplierNames = new Map(
      allSuppliers.map((supplier) => [
        String(supplier._id),
        supplier.tradeName ?? supplier.legalName ?? "Fornecedor sem nome",
      ]),
    );
    const productById = new Map(allProducts.map((product) => [String(product._id), product]));
    const lotById = new Map(allLots.map((lot) => [String(lot._id), lot]));
    const entryHighlights = allEntries
      .filter((entry) => {
        const invoiceDigits = String(entry.invoiceNumber ?? "").replace(/\D/g, "");
        const supplierName = entry.supplierId ? supplierNames.get(String(entry.supplierId)) ?? "" : "";
        return (
          entry.entryNumber === "ENT-2026-000001" ||
          invoiceDigits === "372043" ||
          invoiceDigits === "2967" ||
          entry.originType === "gomaq" ||
          supplierName.toLowerCase().includes("gomaq")
        );
      })
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .map((entry) => {
        const items = allEntryItems
          .filter((item) => item.entryId === entry._id)
          .map((item) => {
            const product = productById.get(String(item.productId));
            const lot = item.lotId ? lotById.get(String(item.lotId)) : null;
            const locationId = item.locationId ? String(item.locationId) : null;
            return {
              productId: String(item.productId),
              productName: product?.name ?? "Produto inexistente",
              quantity: item.quantity,
              unitOfMeasure: item.unitOfMeasure,
              lotNumber: lot?.lotNumber ?? null,
              locationId,
              locationName: locationId ? locationNames.get(locationId) ?? "Local inexistente" : null,
            };
          });
        return {
          entryId: String(entry._id),
          entryNumber: entry.entryNumber,
          originType: entry.originType,
          status: entry.status,
          receivedAt: entry.receivedAt,
          invoiceNumber: entry.invoiceNumber ?? null,
          invoiceDate: entry.invoiceDate ?? null,
          supplierName: entry.supplierId ? supplierNames.get(String(entry.supplierId)) ?? "Fornecedor inexistente" : null,
          itemCount: items.length,
          totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
          items,
        };
      });

    // Eventos posteriores dos produtos cuja localização do lote ficou ambígua.
    // A consulta permanece somente leitura; os detalhes permitem conferir
    // saída/devolução antes de propor qualquer associação lote × armário.
    const reviewDetails = productsResult
      .filter((product) => product.statusCounts.ambiguous > 0)
      .map((product) => {
        const productLots = allLots.filter((lot) => String(lot.productId) === product.productId);
        const earliestLotReceivedAt = Math.min(...productLots.map((lot) => lot.receivedAt));
        const relevantMovements = allMovements
          .filter((movement) =>
            String(movement.productId) === product.productId &&
            movement.timestamp > earliestLotReceivedAt &&
            movement.type !== "entry",
          )
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((movement) => {
            const lot = movement.lotId ? lotById.get(String(movement.lotId)) : null;
            return {
              movementId: String(movement._id),
              type: movement.type,
              quantity: movement.quantity,
              previousPhysical: movement.previousPhysical,
              newPhysical: movement.newPhysical,
              timestamp: movement.timestamp,
              lotId: movement.lotId ?? null,
              lotNumber: lot?.lotNumber ?? null,
              entryNumber: movement.entryId ? entryNumbers.get(String(movement.entryId)) ?? null : null,
              exitNumber: movement.exitNumber ?? null,
              exitMovementId: movement.exitMovementId ? String(movement.exitMovementId) : null,
              canceled: movement.canceled ?? false,
              observation: movement.observation ?? null,
            };
          });
        const relevantReturns = allReturns
          .filter((returned) => String(returned.productId) === product.productId)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((returned) => {
            const lot = returned.lotId ? lotById.get(String(returned.lotId)) : null;
            return {
              returnId: String(returned._id),
              quantity: returned.quantity,
              createdAt: returned.createdAt,
              lotId: returned.lotId ? String(returned.lotId) : null,
              lotNumber: lot?.lotNumber ?? null,
              locationId: returned.locationId ? String(returned.locationId) : null,
              locationName: returned.locationId ? locationNames.get(String(returned.locationId)) ?? "Local inexistente" : null,
              exitMovementId: returned.exitMovementId ? String(returned.exitMovementId) : null,
              reason: returned.reason,
              condition: returned.condition ?? null,
              observation: returned.observation ?? null,
            };
          });
        return {
          productId: product.productId,
          productName: product.productName,
          globalPhysical: product.globalPhysical,
          localPhysicalTotal: product.localPhysicalTotal,
          movements: relevantMovements,
          returns: relevantReturns,
        };
      });

    const invalidGlobalStockCount = allGlobalStock.filter((row) =>
      !Number.isFinite(row.physicalQuantity) ||
      !Number.isFinite(row.reservedQuantity) ||
      row.physicalQuantity < 0 ||
      row.reservedQuantity < 0 ||
      row.reservedQuantity > row.physicalQuantity,
    ).length;
    const invalidLocalStockCount = allLocalStock.filter((row) =>
      !Number.isFinite(row.quantity) || row.quantity < 0,
    ).length;
    const invalidLotBalanceCount = allBalances.filter((row) =>
      !Number.isFinite(row.quantityAvailable) || row.quantityAvailable < 0,
    ).length;
    const productsWithoutGlobalStock = allProducts.filter((product) =>
      !allGlobalStock.some((row) => row.productId === product._id),
    ).length;
    const productsWithLotOrLocationStock = allProducts.filter((product) =>
      allLots.some((lot) => lot.productId === product._id && lot.quantityAvailable > 0) ||
      allLocalStock.some((row) => row.productId === product._id && row.quantity > 0),
    ).length;

    return {
      generatedAt: Date.now(),
      readOnly: true,
      migrationApplied: false,
      scope: "all_products_and_stock_records",
      summary: {
        products: {
          total: allProducts.length,
          active: allProducts.filter((product) => product.active).length,
          inactive: allProducts.filter((product) => !product.active).length,
          withoutGlobalStockRecord: productsWithoutGlobalStock,
          withLotOrLocationStock: productsWithLotOrLocationStock,
        },
        entries: {
          total: allEntries.length,
          byOriginType: countBy(allEntries, "originType"),
          byStatus: countBy(allEntries, "status"),
        },
        entryItems: { total: allEntryItems.length, totalQuantity: sumField(allEntryItems, "quantity") },
        lots: {
          total: allLots.length,
          active: allLots.filter((lot) => lot.active).length,
          withAvailableQuantity: allLots.filter((lot) => lot.quantityAvailable > 0).length,
          quantityReceivedTotal: sumField(allLots, "quantityReceived"),
          quantityAvailableTotal: sumField(allLots, "quantityAvailable"),
        },
        globalStock: {
          records: allGlobalStock.length,
          physicalQuantityTotal: sumField(allGlobalStock, "physicalQuantity"),
          reservedQuantityTotal: sumField(allGlobalStock, "reservedQuantity"),
          invalidRecords: invalidGlobalStockCount,
        },
        stockByLocation: {
          records: allLocalStock.length,
          physicalQuantityTotal: sumField(allLocalStock, "quantity"),
          invalidRecords: invalidLocalStockCount,
        },
        lotLocationBalances: {
          records: allBalances.length,
          quantityAvailableTotal: sumField(allBalances, "quantityAvailable"),
          invalidRecords: invalidLotBalanceCount,
        },
        movements: {
          total: allMovements.length,
          byType: countBy(allMovements, "type"),
          canceled: allMovements.filter((movement) => movement.canceled === true).length,
        },
        transfers: { total: allTransfers.length },
        returns: { total: allReturns.length },
        storageLocations: {
          total: allLocations.length,
          active: allLocations.filter((location) => location.active).length,
          locations: allLocations.map((location) => ({
            locationId: String(location._id), name: location.name, active: location.active,
          })),
        },
        gomaq: {
          exchanges: allGomaQExchanges.length,
          emptyCartridgeRecords: allGomaQEmptyCartridges.length,
          emptyCartridgeQuantity: sumField(allGomaQEmptyCartridges, "quantity"),
          pendingEmptyCartridges: allGomaQEmptyCartridges.filter((item) => item.status === "awaiting_collection").length,
          collections: allGomaQCollections.length,
          collectedCartridgeTotal: sumField(allGomaQCollections, "totalCartridges"),
        },
      },
      entryHighlights,
      reviewDetails,
      gomaqExchanges: allGomaQExchanges
        .slice()
        .sort((a, b) => b.exchangedAt - a.exchangedAt)
        .slice(0, 100)
        .map((exchange) => ({
          exchangeNumber: exchange.exchangeNumber,
          productName: productById.get(String(exchange.productId))?.name ?? "Produto inexistente",
          quantityDelivered: exchange.quantityDelivered,
          quantityEmptyReceived: exchange.quantityEmptyReceived,
          exchangedAt: exchange.exchangedAt,
        })),
      totalProducts: allProducts.length,
      productsRequiringReview: productsResult.filter((product) => !product.readyForTrackedWithdrawal).length,
      products: productsResult,
    };
  },
});


/**
 * Aplica a migração lote × armário após validação integral do diagnóstico.
 *
 * Esta mutation é INTERNAL (não integra a API pública do aplicativo). Só deve
 * ser chamada manualmente no deployment first-herring-264, após autorização
 * explícita do responsável. A transação é atômica: qualquer conflito aborta
 * todas as inserções. Não altera estoque global, saldos físicos por armário,
 * lotes, entradas, movimentações ou devoluções.
 */
export const applyLotLocationBalancesMigration = internalMutation({
  args: {
    confirmation: v.literal("CONFIRMAR_MIGRACAO_LOTES_FIRST_HERRING"),
  },
  handler: async (ctx) => {
    const report = await ctx.runQuery(internal.stockSetup.lotLocationReadiness, {});
    const plan = buildLotLocationMigrationPlan(report as unknown as Parameters<typeof buildLotLocationMigrationPlan>[0]);
    const now = Date.now();
    let inserted = 0;
    let skipped = 0;

    const insertableLotIds = new Set(plan.insertions.map((row) => row.lotId));

    for (const row of plan.rows) {
      const existing = await ctx.db
        .query("lotLocationBalances")
        .withIndex("by_lot", (q) => q.eq("lotId", row.lotId as any))
        .collect();

      if (existing.length > 0) {
        if (
          existing.length !== 1 ||
          existing[0].productId !== row.productId ||
          existing[0].locationId !== row.locationId ||
          Math.abs(existing[0].quantityAvailable - row.quantityAvailable) > 1e-9
        ) {
          throw new Error(
            `Migração lote × armário abortada: conflito no lote ${row.lotNumber}. Nenhuma gravação será confirmada.`,
          );
        }
        skipped++;
        continue;
      }

      if (!insertableLotIds.has(row.lotId)) {
        throw new Error(
          `Migração lote × armário abortada: diagnóstico considera ${row.lotNumber} mapeado, mas o registro não existe.`,
        );
      }

      await ctx.db.insert("lotLocationBalances", {
        lotId: row.lotId as any,
        productId: row.productId as any,
        locationId: row.locationId as any,
        quantityAvailable: row.quantityAvailable,
        updatedAt: now,
      });
      inserted++;
    }

    if (inserted + skipped !== plan.totalLots) {
      throw new Error("Migração lote × armário abortada: contagem final de registros inesperada.");
    }

    await ctx.db.insert("auditLogs", {
      action: "update",
      entity: "lotLocationBalances",
      details:
        `Migração controlada lote × armário: ${inserted} registro(s) inserido(s), ${skipped} já existente(s) idêntico(s), ${plan.totalLots} lotes, ${plan.totalQuantity} unidades. Nenhuma quantidade física/global, lote, entrada, movimentação ou devolução foi alterada.`,
      timestamp: now,
    });

    return {
      migrationApplied: true,
      inserted,
      skipped,
      totalLots: plan.totalLots,
      totalQuantity: plan.totalQuantity,
      updatedAt: now,
    };
  },
});
