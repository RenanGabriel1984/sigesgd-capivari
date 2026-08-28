import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** Helper: get authenticated user or throw. */
async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User profile not found. Please sign in again.");
  return { userId, user };
}

/** List all stock movements with product info. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_timestamp")
      .order("desc")
      .take(200);

    return Promise.all(
      movements.map(async (m) => {
        const product = await ctx.db.get(m.productId);
        const user = await ctx.db.get(m.userId);
        const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
        return { ...m, product, user, supplier };
      })
    );
  },
});

/** Get movements for a specific product. */
export const byProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .order("desc")
      .collect();

    return Promise.all(
      movements.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
        return { ...m, user, supplier };
      })
    );
  },
});

/** Create a stock entry (entrada). */
export const createEntry = mutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
    supplierId: v.optional(v.id("suppliers")),
    documentNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    if (args.quantity <= 0) throw new Error("Quantity must be positive");

    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();

    const prevPhysical = stock?.physicalQuantity ?? 0;
    const prevReserved = stock?.reservedQuantity ?? 0;
    const newPhysical = prevPhysical + args.quantity;

    if (stock) {
      await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    } else {
      await ctx.db.insert("stock", {
        productId: args.productId,
        physicalQuantity: args.quantity,
        reservedQuantity: 0,
      });
    }

    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "entry",
      quantity: args.quantity,
      previousPhysical: prevPhysical,
      newPhysical,
      previousReserved: prevReserved,
      newReserved: prevReserved,
      userId,
      supplierId: args.supplierId,
      documentNumber: args.documentNumber,
      observation: args.observation,
      timestamp: Date.now(),
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "move_stock",
      entity: "stockMovements",
      entityId: movementId,
      details: `Entry of ${args.quantity} unit(s)`,
      timestamp: Date.now(),
    });

    return movementId;
  },
});

/** Create a stock exit (saída). */
export const createExit = mutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
    requestId: v.optional(v.id("requests")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    if (args.quantity <= 0) throw new Error("Quantity must be positive");

    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();

    if (!stock) throw new Error("Product has no stock record");

    const available = stock.physicalQuantity - stock.reservedQuantity;
    if (available < args.quantity) {
      throw new Error(`Insufficient stock. Available: ${available}, requested: ${args.quantity}`);
    }

    const prevPhysical = stock.physicalQuantity;
    const prevReserved = stock.reservedQuantity;
    const newPhysical = prevPhysical - args.quantity;

    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });

    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      previousPhysical: prevPhysical,
      newPhysical,
      previousReserved: prevReserved,
      newReserved: prevReserved,
      userId,
      requestId: args.requestId,
      observation: args.observation,
      timestamp: Date.now(),
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "move_stock",
      entity: "stockMovements",
      entityId: movementId,
      details: `Exit of ${args.quantity} unit(s)`,
      timestamp: Date.now(),
    });

    return movementId;
  },
});

/** Reserve stock for an approved request. */
export const reserveStock = mutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);

    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();

    if (!stock) throw new Error("No stock record");

    const available = stock.physicalQuantity - stock.reservedQuantity;
    if (available < args.quantity) {
      throw new Error(`Insufficient stock. Available: ${available}, requested: ${args.quantity}`);
    }

    await ctx.db.patch(stock._id, {
      reservedQuantity: stock.reservedQuantity + args.quantity,
    });

    return stock._id;
  },
});

/** Create stock adjustment. */
export const createAdjustment = mutation({
  args: {
    productId: v.id("products"),
    newQuantity: v.number(),
    observation: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    if (args.newQuantity < 0) throw new Error("Quantity cannot be negative");

    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();

    if (!stock) throw new Error("No stock record");

    const prevPhysical = stock.physicalQuantity;
    const diff = args.newQuantity - prevPhysical;

    await ctx.db.patch(stock._id, { physicalQuantity: args.newQuantity });

    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "adjustment",
      quantity: Math.abs(diff),
      previousPhysical: prevPhysical,
      newPhysical: args.newQuantity,
      previousReserved: stock.reservedQuantity,
      newReserved: stock.reservedQuantity,
      userId,
      observation: args.observation,
      timestamp: Date.now(),
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "move_stock",
      entity: "stockMovements",
      entityId: movementId,
      details: `Adjustment: ${prevPhysical} → ${args.newQuantity}`,
      timestamp: Date.now(),
    });

    return movementId;
  },
});
