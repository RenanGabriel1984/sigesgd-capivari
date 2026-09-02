import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado");
  return { userId, user };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const transfers = await ctx.db.query("stockTransfers").order("desc").take(200);
    return Promise.all(transfers.map(async (t: any) => {
      const product = await ctx.db.get(t.productId);
      const lot = t.lotId ? await ctx.db.get(t.lotId) : null;
      const fromLocation = await ctx.db.get(t.fromLocationId);
      const toLocation = await ctx.db.get(t.toLocationId);
      const responsible = await ctx.db.get(t.responsibleUserId);
      return { ...t, product, lot, fromLocation, toLocation, responsible };
    }));
  },
});

export const listByProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const transfers = await ctx.db
      .query("stockTransfers")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .order("desc")
      .take(100);
    return Promise.all(transfers.map(async (t: any) => {
      const fromLocation = await ctx.db.get(t.fromLocationId);
      const toLocation = await ctx.db.get(t.toLocationId);
      return { ...t, fromLocation, toLocation };
    }));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    productId: v.id("products"),
    lotId: v.optional(v.id("lots")),
    fromLocationId: v.id("storageLocations"),
    toLocationId: v.id("storageLocations"),
    quantity: v.number(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (role === "technician") throw new Error("Técnicos não podem realizar transferências");

    if (args.quantity <= 0) throw new Error("Quantidade deve ser maior que zero");
    if (args.fromLocationId === args.toLocationId) throw new Error("Origem e destino não podem ser o mesmo local");

    // Validate locations
    const fromLocation = await ctx.db.get(args.fromLocationId);
    if (!fromLocation) throw new Error("Local de origem não encontrado");
    const toLocation = await ctx.db.get(args.toLocationId);
    if (!toLocation) throw new Error("Local de destino não encontrado");

    // Validate product
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");

    // Validate lot if provided
    if (args.lotId) {
      const lot = await ctx.db.get(args.lotId);
      if (!lot) throw new Error("Lote não encontrado");
      if (lot.productId !== args.productId) throw new Error("Lote não corresponde ao produto");
      if (lot.quantityAvailable < args.quantity) {
        throw new Error(`Lote só possui ${lot.quantityAvailable} unidades disponíveis`);
      }
    }

    // Check source location stock
    const fromStock = await ctx.db
      .query("stockByLocation")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const sourceStock = fromStock.find((s: any) => s.locationId === args.fromLocationId);
    if (!sourceStock || sourceStock.quantity < args.quantity) {
      const available = sourceStock?.quantity ?? 0;
      throw new Error(`Estoque insuficiente no local de origem. Disponível: ${available}. Transferência: ${args.quantity}.`);
    }

    const now = Date.now();

    // Decrease source location
    await ctx.db.patch(sourceStock._id, { quantity: sourceStock.quantity - args.quantity });

    // Increase destination location (or create)
    const toStock = await ctx.db
      .query("stockByLocation")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const destStock = toStock.find((s: any) => s.locationId === args.toLocationId);

    if (destStock) {
      await ctx.db.patch(destStock._id, { quantity: destStock.quantity + args.quantity });
    } else {
      await ctx.db.insert("stockByLocation", {
        productId: args.productId,
        locationId: args.toLocationId,
        quantity: args.quantity,
      });
    }

    // Decrease lot availability if lot is specified
    if (args.lotId) {
      const lot = await ctx.db.get(args.lotId);
      if (lot) {
        await ctx.db.patch(lot._id, {
          quantityAvailable: lot.quantityAvailable - args.quantity,
        });
      }
    }

    // Create transfer record
    const transferId = await ctx.db.insert("stockTransfers", {
      productId: args.productId,
      lotId: args.lotId,
      fromLocationId: args.fromLocationId,
      toLocationId: args.toLocationId,
      quantity: args.quantity,
      responsibleUserId: userId,
      observation: args.observation,
      createdAt: now,
    });

    // Create stock movement (transfer type — no global stock change)
    const globalStock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    if (globalStock) {
      await ctx.db.insert("stockMovements", {
        productId: args.productId,
        type: "transfer",
        quantity: args.quantity,
        previousPhysical: globalStock.physicalQuantity,
        newPhysical: globalStock.physicalQuantity,
        previousReserved: globalStock.reservedQuantity,
        newReserved: globalStock.reservedQuantity,
        userId,
        observation: `Transferência: ${fromLocation.name} → ${toLocation.name}`,
        timestamp: now,
      });
    }

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "transfer_stock",
      entity: "stockTransfers",
      entityId: transferId,
      details: `Transferência de ${args.quantity} ${product.name}: ${fromLocation.name} → ${toLocation.name}`,
      timestamp: now,
    });

    return transferId;
  },
});
