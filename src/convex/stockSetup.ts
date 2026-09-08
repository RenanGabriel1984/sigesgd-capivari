import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasInitialInventoryLot } from "./stockHelpers";

async function requireAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado");
  if (user.role !== "admin" && user.role !== "stock_manager")
    throw new Error(
      "Apenas administradores ou gerentes de estoque podem executar esta operação"
    );
  return { userId, user };
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
export const initialStockLoad = mutation({
  args: {
    items: v.array(
      v.object({
        productId: v.id("products"),
        locationId: v.id("storageLocations"),
        quantity: v.number(),
      })
    ),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);

    if (!args.items || args.items.length === 0) {
      throw new Error("Nenhum item informado para carga inicial");
    }

    const now = Date.now();
    const year = new Date().getFullYear();

    // ── Pre-check: block if any product already has initial_inventory lots ──
    // A carga inicial é caracterizada por um lote ativo vinculado a uma entrada
    // com originType "initial_inventory" (não confundir com lotes de compras).
    for (const item of args.items) {
      if (item.quantity <= 0) continue;

      const existingLots = await ctx.db
        .query("lots")
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
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
      observation: args.observation ?? "Carga inicial de estoque",
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
    });

    const summary: string[] = [];
    let totalProductsUpdated = 0;
    let totalQuantityLoaded = 0;

    for (const item of args.items) {
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
        unitOfMeasure: "un",
        lotId,
        locationId: item.locationId,
      });

      // ── 3. stockByLocation ──
      const existingSbl = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
        .collect();
      const sblForLocation = existingSbl.find(
        (s) => s.locationId === item.locationId
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
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
        .first();

      const previousGlobal = existingStock?.physicalQuantity ?? 0;
      const totalForProduct = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
        .collect();
      const newGlobal = totalForProduct.reduce(
        (sum, s) => sum + s.quantity,
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
    const lotInfo = consumedLots
      .map((c) => {
        const lot = lots.find((l) => l._id === c.lotId);
        return lot ? `${lot.lotNumber}(${c.quantity})` : `?(${c.quantity})`;
      })
      .join(", ");

    await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      previousPhysical,
      newPhysical,
      previousReserved,
      newReserved: previousReserved,
      userId,
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
 * Check if initial stock has been loaded.
 */
export const hasInitialStock = query({
  args: {},
  handler: async (ctx) => {
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
