import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { requirePermission } from "./rbac";

async function requireUser(ctx: any) {
  // RBAC central: histórico/movimentações visíveis a quem consulta estoque.
  return requirePermission(ctx, "movements.view");
}

async function requireStockManagerOrAdmin(ctx: any) {
  // RBAC central: movimentação direta de estoque.
  return requirePermission(ctx, "stock.mutate", { entity: "stockMovements" });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const movements = await ctx.db.query("stockMovements").withIndex("by_timestamp").order("desc").take(200);
    return Promise.all(movements.map(async (m) => {
      const product = await ctx.db.get(m.productId);
      const user = await ctx.db.get(m.userId);
      const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
      const area = m.areaId ? await ctx.db.get(m.areaId) : null;
      const location = m.locationId ? await ctx.db.get(m.locationId) : null;
      const toLocation = m.toLocationId ? await ctx.db.get(m.toLocationId) : null;
      const toArea = m.toAreaId ? await ctx.db.get(m.toAreaId) : null;
      return { ...m, product, user, supplier, area, location, toLocation, toArea };
    }));
  },
});

export const listPaginated = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const result = await ctx.db.query("stockMovements").withIndex("by_timestamp").order("desc").paginate(args.paginationOpts);
    const enriched = await Promise.all(result.page.map(async (movement) => {
      const product = await ctx.db.get(movement.productId);
      const user = await ctx.db.get(movement.userId);
      const supplier = movement.supplierId ? await ctx.db.get(movement.supplierId) : null;
      const area = movement.areaId ? await ctx.db.get(movement.areaId) : null;
      const location = movement.locationId ? await ctx.db.get(movement.locationId) : null;
      const toLocation = movement.toLocationId ? await ctx.db.get(movement.toLocationId) : null;
      const toArea = movement.toAreaId ? await ctx.db.get(movement.toAreaId) : null;
      return { ...movement, product, user, supplier, area, location, toLocation, toArea };
    }));
    return { ...result, page: enriched };
  },
});

export const byProduct = query({
  args: {
    productId: v.id("products"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const page = await ctx.db.query("stockMovements")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .order("desc")
      .paginate(args.paginationOpts);
    const enriched = await Promise.all(page.page.map(async (movement) => {
      const user = await ctx.db.get(movement.userId);
      const supplier = movement.supplierId ? await ctx.db.get(movement.supplierId) : null;
      const area = movement.areaId ? await ctx.db.get(movement.areaId) : null;
      const location = movement.locationId ? await ctx.db.get(movement.locationId) : null;
      const toLocation = movement.toLocationId ? await ctx.db.get(movement.toLocationId) : null;
      const toArea = movement.toAreaId ? await ctx.db.get(movement.toAreaId) : null;
      return { ...movement, user, supplier, area, location, toLocation, toArea };
    }));
    return { ...page, page: enriched };
  },
});

export const createEntry = mutation({
  args: {
    productId: v.id("products"), quantity: v.number(),
    supplierId: v.optional(v.id("suppliers")),
    documentNumber: v.optional(v.string()), observation: v.optional(v.string()),
  },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Entrada direta legada desativada. Use o módulo Entradas para registrar documento, lote, área e local físico.");
  },
});

export const createExit = mutation({
  args: {
    productId: v.id("products"), quantity: v.number(),
    requestId: v.optional(v.id("requests")), observation: v.optional(v.string()),
  },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Saída direta global desativada. Use Solicitações ou Saída rápida e informe a área/local de origem.");
  },
});

export const reserveStock = mutation({
  args: { productId: v.id("products"), quantity: v.number(), requestId: v.id("requests") },
  handler: async (ctx) => {
    await requireUser(ctx);
    throw new Error("Reserva manual isolada desativada. As reservas devem ser criadas durante a aprovação da solicitação.");
  },
});

export const editEntry = mutation({
  args: {
    movementId: v.id("stockMovements"),
    quantity: v.number(),
    documentNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Edição direta de entrada legada desativada. Use o módulo Entradas para preservar lote, área e localização.");
  },
});

export const reverseEntry = mutation({
  args: {
    movementId: v.id("stockMovements"),
    reason: v.string(),
  },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Estorno direto de entrada legada desativado. Use o estorno do módulo Entradas para preservar lote, área e localização.");
  },
});

export const createAdjustment = mutation({
  args: { productId: v.id("products"), newQuantity: v.number(), observation: v.string() },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Ajuste global legado desativado. A correção deve ocorrer por inventário/lote/área/local para preservar a rastreabilidade.");
  },
});

