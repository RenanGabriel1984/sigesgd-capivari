import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** List all products with category info and stock. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    return Promise.all(
      products.map(async (p) => {
        const category = await ctx.db.get(p.categoryId);
        const stock = await ctx.db
          .query("stock")
          .withIndex("by_product", (q) => q.eq("productId", p._id))
          .first();
        return {
          ...p,
          category,
          stock: stock ?? { physicalQuantity: 0, reservedQuantity: 0 },
        };
      })
    );
  },
});

/** List active products only. */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return Promise.all(
      products.map(async (p) => {
        const category = await ctx.db.get(p.categoryId);
        const stock = await ctx.db
          .query("stock")
          .withIndex("by_product", (q) => q.eq("productId", p._id))
          .first();
        return {
          ...p,
          category,
          stock: stock ?? { physicalQuantity: 0, reservedQuantity: 0 },
        };
      })
    );
  },
});

/** Get a single product with details. */
export const get = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.id);
    if (!product) return null;
    const category = await ctx.db.get(product.categoryId);
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.id))
      .first();
    return { ...product, category, stock };
  },
});

/** Get stock info for a product. */
export const getStock = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    return stock ?? { physicalQuantity: 0, reservedQuantity: 0 };
  },
});

/** Products below minimum stock. */
export const belowMinimum = query({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    const result = [];
    for (const p of products) {
      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q) => q.eq("productId", p._id))
        .first();
      const qty = stock?.physicalQuantity ?? 0;
      if (qty < p.minimumStock) {
        const category = await ctx.db.get(p.categoryId);
        result.push({ ...p, category, currentStock: qty });
      }
    }
    return result;
  },
});

/** Create a product. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.id("categories"),
    unitOfMeasure: v.string(),
    internalCode: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    minimumStock: v.number(),
    idealStock: v.number(),
    maximumStock: v.number(),
    observation: v.optional(v.string()),
    photo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const id = await ctx.db.insert("products", {
      ...args,
      active: true,
    });

    // Initialize stock
    await ctx.db.insert("stock", {
      productId: id,
      physicalQuantity: 0,
      reservedQuantity: 0,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "products",
      entityId: id,
      details: `Produto "${args.name}" criado`,
      timestamp: Date.now(),
    });

    return id;
  },
});

/** Update a product. */
export const update = mutation({
  args: {
    id: v.id("products"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    unitOfMeasure: v.optional(v.string()),
    internalCode: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    active: v.optional(v.boolean()),
    minimumStock: v.optional(v.number()),
    idealStock: v.optional(v.number()),
    maximumStock: v.optional(v.number()),
    observation: v.optional(v.string()),
    photo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);

    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId,
      action,
      entity: "products",
      entityId: id,
      details: JSON.stringify(updates),
      timestamp: Date.now(),
    });

    return id;
  },
});
