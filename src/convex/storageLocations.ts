import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: visualização de locais físicos.
  return requirePermission(ctx, "locations.view");
}

async function requireManagerOrAdmin(ctx: any) {
  // RBAC central: gerenciamento de locais físicos.
  return requirePermission(ctx, "locations.manage", { entity: "storageLocations" });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const locations = await ctx.db.query("storageLocations").collect();
    return Promise.all(locations.map(async (location: any) => ({
      ...location, area: location.areaId ? await ctx.db.get(location.areaId) : null,
    })));
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const locations = await ctx.db.query("storageLocations")
      .withIndex("by_active", (q) => q.eq("active", true)).collect();
    return Promise.all(locations.map(async (location: any) => ({
      ...location, area: location.areaId ? await ctx.db.get(location.areaId) : null,
    })));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    // Mantido opcional para compatibilidade com clientes antigos; novos locais
    // não recebem área. A área pertence ao lote/saldo, não ao armário.
    areaId: v.optional(v.id("stockAreas")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    if (!args.name.trim()) throw new Error("Nome do local é obrigatório");

    // Check for duplicate name
    const existing = await ctx.db.query("storageLocations").collect();
    if (existing.some((l: any) => l.name.toLowerCase() === args.name.trim().toLowerCase())) {
      throw new Error("Já existe um local de armazenamento com este nome");
    }

    const id = await ctx.db.insert("storageLocations", {
      name: args.name.trim(),
      description: args.description || undefined,
      active: true,
    });

    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "storageLocations", entityId: id,
      details: `Local de armazenamento "${args.name}" criado`, timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("storageLocations"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
    areaId: v.optional(v.id("stockAreas")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const { id } = args;
    const location = await ctx.db.get(id);
    if (!location) throw new Error("Local não encontrado");

    // areaId é aceito apenas para compatibilidade com clientes antigos e
    // deliberadamente ignorado: uma localização física não pertence a uma área.
    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.active !== undefined) updates.active = args.active;

    if (updates.active === false) {
      const lotsAtLocation = await ctx.db.query("lots")
        .withIndex("by_location", (q: any) => q.eq("locationId", id)).collect();
      if (lotsAtLocation.some((lot: any) => lot.active && lot.quantityAvailable > 0)) {
        throw new Error("Não é possível desativar um local que ainda possui lotes com saldo. Transfira ou regularize o estoque primeiro.");
      }
      const balancesAtLocation = await ctx.db.query("stockByLocation")
        .withIndex("by_location", (q: any) => q.eq("locationId", id)).collect();
      if (balancesAtLocation.some((row: any) => row.quantity > 0)) {
        throw new Error("Não é possível desativar um local que ainda possui saldo por localização.");
      }
    }

    if (updates.name) {
      updates.name = updates.name.trim();
      const all = await ctx.db.query("storageLocations").collect();
      if (all.some((l: any) => l._id !== id && l.name.toLowerCase() === updates.name!.toLowerCase())) {
        throw new Error("Já existe outro local com este nome");
      }
    }

    await ctx.db.patch(id, updates);
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId, action, entity: "storageLocations", entityId: id,
      details: `Local "${location.name}" — ${JSON.stringify(updates)}`, timestamp: Date.now(),
    });
    return id;
  },
});
