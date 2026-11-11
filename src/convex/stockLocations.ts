import { requirePermission } from "./rbac";
import { query } from "./_generated/server";
import { v } from "convex/values";

async function requireUser(ctx: any) {
  return requirePermission(ctx, "stock.view");
}

async function enrichLocationStock(ctx: any, row: any) {
  const location = await ctx.db.get(row.locationId);
  const area = row.areaId ? await ctx.db.get(row.areaId) : null;
  const reservations = await ctx.db.query("requestItemReservations")
    .withIndex("by_product", (q: any) => q.eq("productId", row.productId))
    .collect();
  const reservedQuantity = reservations
    .filter((reservation: any) =>
      reservation.locationId === row.locationId &&
      reservation.areaId === (row.areaId ?? undefined)
    )
    .reduce((sum: number, reservation: any) => sum + reservation.quantityRemaining, 0);

  return {
    ...row,
    location,
    area,
    classificationPending: !area,
    reservedQuantity,
    availableQuantity: Math.max(0, row.quantity - reservedQuantity),
  };
}

// Stock per location and area for a product.
export const listByProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const entries = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
      .collect();
    return Promise.all(entries.map((entry: any) => enrichLocationStock(ctx, entry)));
  },
});

// Physical, reserved and free balances by physical storage location.
export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const locations = await ctx.db.query("storageLocations")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .collect();

    return Promise.all(locations.map(async (location: any) => {
      const entries = await ctx.db.query("stockByLocation")
        .withIndex("by_location", (q: any) => q.eq("locationId", location._id))
        .collect();
      const detailed = await Promise.all(entries.map((entry: any) => enrichLocationStock(ctx, entry)));
      return {
        ...location,
        totalItems: detailed.length,
        totalQuantity: detailed.reduce((sum: number, entry: any) => sum + entry.quantity, 0),
        totalReserved: detailed.reduce((sum: number, entry: any) => sum + entry.reservedQuantity, 0),
        totalAvailable: detailed.reduce((sum: number, entry: any) => sum + entry.availableQuantity, 0),
        classificationPending: detailed.some((entry: any) => entry.classificationPending),
        balances: detailed,
      };
    }));
  },
});

// Stock at a specific physical location; each row still distinguishes its area.
export const listByLocation = query({
  args: { locationId: v.id("storageLocations") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const entries = await ctx.db.query("stockByLocation")
      .withIndex("by_location", (q: any) => q.eq("locationId", args.locationId))
      .collect();
    return Promise.all(entries.map(async (entry: any) => ({
      ...await enrichLocationStock(ctx, entry),
      product: await ctx.db.get(entry.productId),
    })));
  },
});
