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
    return await ctx.db.query("storageLocations").collect();
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db
      .query("storageLocations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const { id, ...updates } = args;
    const location = await ctx.db.get(id);
    if (!location) throw new Error("Local não encontrado");

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
