import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("suppliers").collect();
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("suppliers").withIndex("by_active", (q) => q.eq("active", true)).collect();
  },
});

export const get = query({
  args: { id: v.id("suppliers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    legalName: v.string(), tradeName: v.optional(v.string()), cnpj: v.optional(v.string()),
    contact: v.optional(v.string()), phone: v.optional(v.string()), email: v.optional(v.string()),
    address: v.optional(v.string()), observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Não autenticado");
    const id = await ctx.db.insert("suppliers", { ...args, active: true });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "suppliers", entityId: id,
      details: `Fornecedor "${args.legalName}" criado`, timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("suppliers"), legalName: v.optional(v.string()), tradeName: v.optional(v.string()),
    cnpj: v.optional(v.string()), contact: v.optional(v.string()), phone: v.optional(v.string()),
    email: v.optional(v.string()), address: v.optional(v.string()),
    active: v.optional(v.boolean()), observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Não autenticado");
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId, action, entity: "suppliers", entityId: id,
      details: JSON.stringify(updates), timestamp: Date.now(),
    });
    return id;
  },
});
