import { query } from "./_generated/server";
import { v } from "convex/values";

// Stock per location for a product
export const listByProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("stockByLocation")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    return Promise.all(entries.map(async (e: any) => {
      const location = await ctx.db.get(e.locationId);
      return { ...e, location };
    }));
  },
});

// All stock locations summary
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const locations = await ctx.db
      .query("storageLocations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    return Promise.all(locations.map(async (loc: any) => {
      const entries = await ctx.db
        .query("stockByLocation")
        .withIndex("by_location", (q) => q.eq("locationId", loc._id))
        .collect();
      const totalItems = entries.length;
      const totalQuantity = entries.reduce((sum: number, e: any) => sum + e.quantity, 0);
      return { ...loc, totalItems, totalQuantity };
    }));
  },
});

// Stock at a specific location
export const listByLocation = query({
  args: { locationId: v.id("storageLocations") },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("stockByLocation")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .collect();
    return Promise.all(entries.map(async (e: any) => {
      const product = await ctx.db.get(e.productId);
      return { ...e, product };
    }));
  },
});
