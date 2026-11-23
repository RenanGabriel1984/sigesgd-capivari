import { requirePermission } from "./rbac";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

async function requireUser(ctx: QueryCtx) {
  return requirePermission(ctx, "stock.view");
}

async function loadReservationsByProduct(ctx: QueryCtx, productIds: Id<"products">[]) {
  const uniqueProductIds = [...new Set(productIds)];
  const rows = await Promise.all(uniqueProductIds.map((productId) =>
    ctx.db.query("requestItemReservations")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect()
  ));
  return new Map<Id<"products">, Doc<"requestItemReservations">[]>(
    uniqueProductIds.map((productId, index) => [productId, rows[index]]),
  );
}

async function enrichLocationStock(ctx: QueryCtx, row: Doc<"stockByLocation">, reservations: Doc<"requestItemReservations">[] = []) {
  const location = await ctx.db.get(row.locationId);
  const area = row.areaId ? await ctx.db.get(row.areaId) : null;
  const reservedQuantity = reservations
    .filter((reservation) =>
      reservation.locationId === row.locationId &&
      reservation.areaId === (row.areaId ?? undefined)
    )
    .reduce((sum: number, reservation) => sum + reservation.quantityRemaining, 0);

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
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const reservationsByProduct = await loadReservationsByProduct(ctx, [args.productId]);
    const reservations = reservationsByProduct.get(args.productId) ?? [];
    return Promise.all(entries.map((entry) => enrichLocationStock(ctx, entry, reservations)));
  },
});

// Physical, reserved and free balances by physical storage location.
export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const locations = await ctx.db.query("storageLocations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    const locationEntries = await Promise.all(locations.map(async (location) => ({
      location,
      entries: await ctx.db.query("stockByLocation")
        .withIndex("by_location", (q) => q.eq("locationId", location._id))
        .collect(),
    })));
    const allEntries = locationEntries.flatMap(({ entries }) => entries);
    const reservationsByProduct = await loadReservationsByProduct(
      ctx,
      allEntries.map((entry) => entry.productId),
    );

    return Promise.all(locationEntries.map(async ({ location, entries }) => {
      const detailed = await Promise.all(entries.map((entry) =>
        enrichLocationStock(ctx, entry, reservationsByProduct.get(entry.productId) ?? [])
      ));
      return {
        ...location,
        area: location.areaId ? await ctx.db.get(location.areaId) : null,
        totalItems: detailed.length,
        totalQuantity: detailed.reduce((sum: number, entry) => sum + entry.quantity, 0),
        totalReserved: detailed.reduce((sum: number, entry) => sum + entry.reservedQuantity, 0),
        totalAvailable: detailed.reduce((sum: number, entry) => sum + entry.availableQuantity, 0),
        // Pendência é avaliada por saldo/área, nunca por um areaId legado do armário.
        classificationPending: detailed.some((entry) => entry.classificationPending),
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
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .collect();
    const reservationsByProduct = await loadReservationsByProduct(
      ctx,
      entries.map((entry) => entry.productId),
    );
    return Promise.all(entries.map(async (entry) => ({
      ...await enrichLocationStock(ctx, entry, reservationsByProduct.get(entry.productId) ?? []),
      product: await ctx.db.get(entry.productId),
    })));
  },
});
