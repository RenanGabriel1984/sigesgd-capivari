import { query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const lots = await ctx.db.query("lots").collect();
    return Promise.all(lots.map(async (l) => {
      const product = await ctx.db.get(l.productId);
      const entry = await ctx.db.get(l.entryId);
      const supplier = l.supplierId ? await ctx.db.get(l.supplierId) : null;
      return { ...l, product, entry, supplier };
    }));
  },
});

export const listByProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const lots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .order("desc")
      .collect();
    return Promise.all(lots.map(async (l) => {
      const supplier = l.supplierId ? await ctx.db.get(l.supplierId) : null;
      return { ...l, supplier };
    }));
  },
});

export const listActiveByProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const lots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const activeLots = lots.filter((l) => l.active && l.quantityAvailable > 0);
    return Promise.all(activeLots.map(async (l) => {
      const supplier = l.supplierId ? await ctx.db.get(l.supplierId) : null;
      return { ...l, supplier };
    }));
  },
});

export const get = query({
  args: { lotId: v.id("lots") },
  handler: async (ctx, args) => {
    const lot = await ctx.db.get(args.lotId);
    if (!lot) return null;
    const product = await ctx.db.get(lot.productId);
    const entry = await ctx.db.get(lot.entryId);
    const supplier = lot.supplierId ? await ctx.db.get(lot.supplierId) : null;
    return { ...lot, product, entry, supplier };
  },
});
