import { requirePermission } from "./rbac";
import {
  resolveConsumedLotId,
  formatConsumedLots,
  type LotConsumption,
} from "../lib/stock-consumption";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
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

    if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
      throw new Error("Quantidade deve ser um número finito maior que zero");
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
 * Limpeza destrutiva de dados de teste, restrita à API interna.
 * Nunca pode ser chamada diretamente pelo cliente autenticado.
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
 * Diagnóstico de reconciliação produto × área × localização × lote.
 *
 * SOMENTE LEITURA: não cria alocações, não corrige saldos e não altera registros.
 * Classifica como evidência completa apenas o caso conservador em que há um
 * único lote ativo, a entrada informa seu local e não há operações posteriores
 * capazes de deslocar/consumir material sem dimensão de lote/local.
 */
export const stockDimensionDiagnostics = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const [products, stocks, locations, areas, lots, entryItems, transfers, movements, returns, inventories, inventoryCounts] =
      await Promise.all([
        ctx.db.query("products").collect(),
        ctx.db.query("stock").collect(),
        ctx.db.query("storageLocations").collect(),
        ctx.db.query("stockAreas").collect(),
        ctx.db.query("lots").collect(),
        ctx.db.query("entryItems").collect(),
        ctx.db.query("stockTransfers").collect(),
        ctx.db.query("stockMovements").collect(),
        ctx.db.query("returns").collect(),
        ctx.db.query("inventories").collect(),
        ctx.db.query("inventoryCounts").collect(),
      ]);

    const productById = new Map(products.map((p: any) => [String(p._id), p]));
    const locationById = new Map(locations.map((l: any) => [String(l._id), l]));
    const areaById = new Map(areas.map((a: any) => [String(a._id), a]));
    const lotById = new Map(lots.map((l: any) => [String(l._id), l]));
    const lotByNumber = new Map(lots.map((l: any) => [String(l.lotNumber), l]));
    const stockByProduct = new Map(stocks.map((s: any) => [String(s.productId), s]));
    const itemsByLot = new Map<string, any[]>();

    for (const item of entryItems as any[]) {
      if (!item.lotId) continue;
      const lot = lotById.get(String(item.lotId)) ?? lotByNumber.get(String(item.lotId));
      if (!lot) continue;
      const key = String(lot._id);
      const rows = itemsByLot.get(key) ?? [];
      rows.push(item);
      itemsByLot.set(key, rows);
    }

    const rows = products.map((product: any) => {
      const productId = String(product._id);
      const productLots = (lots as any[]).filter((lot) => String(lot.productId) === productId);
      const activeLots = productLots.filter((lot) => lot.active);
      const productStock = stockByProduct.get(productId) as any;
      const locationRows = (stocks.length >= 0 ? (ctx as any) : null); // keeps this query independent of write helpers
      void locationRows;
      const productTransfers = (transfers as any[]).filter((t) => String(t.productId) === productId);
      const productMovements = (movements as any[]).filter((m) => String(m.productId) === productId);
      const productReturns = (returns as any[]).filter((r) => String(r.productId) === productId);
      const productInventoryIds = new Set(
        (inventoryCounts as any[])
          .filter((c) => String(c.productId) === productId)
          .map((c) => String(c.inventoryId)),
      );
      const productInventoryCount = productInventoryIds.size;
      const lotRows = activeLots.map((lot: any) => {
        const itemRows = itemsByLot.get(String(lot._id)) ?? [];
        const itemLocationIds = [...new Set(itemRows.map((item) => item.locationId ? String(item.locationId) : null))];
        const movementsForLot = productMovements.filter((movement: any) => {
          const ref = movement.lotId == null ? null : String(movement.lotId);
          return ref === String(lot._id) || ref === String(lot.lotNumber);
        });
        return {
          lotId: String(lot._id),
          lotNumber: lot.lotNumber,
          areaId: lot.areaId ? String(lot.areaId) : null,
          areaName: lot.areaId ? ((areaById.get(String(lot.areaId)) as any)?.name ?? "Área não encontrada") : null,
          quantityReceived: lot.quantityReceived,
          quantityAvailable: lot.quantityAvailable,
          entryItemCount: itemRows.length,
          entryLocationIds: itemLocationIds,
          entryLocationNames: itemLocationIds.filter(Boolean).map((id) => (locationById.get(id as string) as any)?.name ?? "Local não encontrado"),
          movementReferences: movementsForLot.length,
          migrationEvidence: itemRows.length === 1 && itemRows[0].locationId && itemLocationIds.length === 1
            ? "entry_location_only"
            : "incomplete",
        };
      });
      const knownLocationLots = lotRows.filter((lot: any) => lot.migrationEvidence === "entry_location_only").length;
      const postEntryMovements = productMovements.filter((movement: any) => movement.type !== "entry");
      const hasUnscopedOperations = productTransfers.length > 0 || productReturns.length > 0 ||
        postEntryMovements.length > 0 || productInventoryCount > 0;
      const locationTotals = (ctx as any);
      void locationTotals;
      const physicalByLocation = (globalThis as any).__unused;
      void physicalByLocation;
      return {
        productId,
        productName: product.name,
        globalPhysical: productStock?.physicalQuantity ?? 0,
        globalReserved: productStock?.reservedQuantity ?? 0,
        activeLotCount: activeLots.length,
        activeLotsAvailable: activeLots.reduce((sum: number, lot: any) => sum + lot.quantityAvailable, 0),
        activeLotsWithoutArea: activeLots.filter((lot: any) => !lot.areaId || !areaById.has(String(lot.areaId))).length,
        activeLotsWithoutEntryLocation: lotRows.filter((lot: any) => lot.entryLocationIds.length === 0 || lot.entryLocationIds[0] == null).length,
        entryItemsWithLocation: entryItems.filter((item: any) => String(item.productId) === productId && !!item.locationId).length,
        transferCount: productTransfers.length,
        transfersWithoutLot: productTransfers.filter((t: any) => !t.lotId).length,
        returnCount: productReturns.length,
        nonEntryMovementCount: postEntryMovements.length,
        inventoryCountCount: productInventoryCount,
        knownEntryLocationLotCount: knownLocationLots,
        migrationClassification: activeLots.length === 1 && knownLocationLots === 1 && !hasUnscopedOperations
          ? "evidence_complete_candidate"
          : activeLots.length === 0 ? "no_active_lot" : "ambiguous_requires_review",
        lots: lotRows,
      };
    }).filter((row: any) =>
      row.globalPhysical !== 0 || row.globalReserved !== 0 || row.activeLotCount > 0 ||
      row.transferCount > 0 || row.returnCount > 0 || row.nonEntryMovementCount > 0
    ).sort((a: any, b: any) => a.productName.localeCompare(b.productName, "pt-BR"));

    const locationBalances = await ctx.db.query("stockByLocation").collect();
    const byLocation = new Map<string, { locationId: string; locationName: string; quantity: number; productCount: number }>();
    for (const balance of locationBalances as any[]) {
      const key = String(balance.locationId);
      const current = byLocation.get(key) ?? {
        locationId: key,
        locationName: (locationById.get(key) as any)?.name ?? "Local não encontrado",
        quantity: 0,
        productCount: 0,
      };
      current.quantity += balance.quantity;
      current.productCount += 1;
      byLocation.set(key, current);
    }

    const globalTotal = (stocks as any[]).reduce((sum, row) => sum + row.physicalQuantity, 0);
    const locationTotal = (locationBalances as any[]).reduce((sum, row) => sum + row.quantity, 0);
    const activeLotTotal = (lots as any[]).filter((lot) => lot.active).reduce((sum, lot) => sum + lot.quantityAvailable, 0);
    const lotReferenceCounts = { byId: 0, byNumber: 0, unresolved: 0, empty: 0 };
    for (const movement of movements as any[]) {
      if (!movement.lotId) {
        lotReferenceCounts.empty++;
      } else if (lotById.has(String(movement.lotId))) {
        lotReferenceCounts.byId++;
      } else if (lotByNumber.has(String(movement.lotId))) {
        lotReferenceCounts.byNumber++;
      } else {
        lotReferenceCounts.unresolved++;
      }
    }

    const classificationCounts = rows.reduce((acc: Record<string, number>, row: any) => {
      acc[row.migrationClassification] = (acc[row.migrationClassification] ?? 0) + 1;
      return acc;
    }, {});

    return {
      generatedAt: Date.now(),
      readOnly: true,
      totals: {
        productsAnalyzed: rows.length,
        globalPhysical: globalTotal,
        byLocationPhysical: locationTotal,
        activeLotsAvailable: activeLotTotal,
        globalVsLocationDifference: globalTotal - locationTotal,
        globalVsLotsDifference: globalTotal - activeLotTotal,
        transfers: transfers.length,
        returns: returns.length,
        movements: movements.length,
        inventories: inventories.length,
      },
      locationBalances: Array.from(byLocation.values()).sort((a, b) => a.locationName.localeCompare(b.locationName, "pt-BR")),
      lotMovementReferenceCounts: lotReferenceCounts,
      migrationClassificationCounts: classificationCounts,
      products: rows,
      warnings: [
        "Diagnóstico somente leitura; nenhuma alocação foi criada ou corrigida.",
        "A classificação evidence_complete_candidate é conservadora e ainda exige conferência antes de qualquer migração.",
        "O histórico de movimentos não contém localização de origem/destino de forma estruturada em todas as operações.",
      ],
    };
  },
});
