import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  if (user.role !== "admin") throw new Error("Apenas administradores podem gerenciar a estrutura organizacional");
  return { userId, user };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const byParent: Record<string, typeof orgs> = {};
    for (const org of orgs) {
      const key = org.parentId ?? "root";
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(org);
    }
    return { orgs, byParent };
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("organizations").withIndex("by_active", (q) => q.eq("active", true)).collect();
  },
});

export const get = query({
  args: { id: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    type: v.union(
      v.literal("prefeitura"), v.literal("paco_municipal"), v.literal("gabinete"),
      v.literal("secretaria"), v.literal("departamento"), v.literal("unidade")
    ),
    parentId: v.optional(v.id("organizations")),
    observation: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    if (!args.name.trim()) throw new Error("Nome da organização é obrigatório");

    // Validate parent exists if provided
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent) throw new Error("Organização superior não encontrada");
      if (!parent.active) throw new Error("A organização superior está inativa");
    }

    // Validate hierarchy: departamento should have secretaria as parent, unidade should have secretaria or departamento as parent
    if (args.type === "departamento" && args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (parent && parent.type !== "secretaria") {
        throw new Error("Um departamento deve estar vinculado a uma secretaria");
      }
    }
    if (args.type === "unidade" && args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (parent && parent.type !== "secretaria" && parent.type !== "departamento") {
        throw new Error("Uma unidade deve estar vinculada a uma secretaria ou departamento");
      }
    }

    const id = await ctx.db.insert("organizations", { ...args, name: args.name.trim(), active: true });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "organizations", entityId: id,
      details: `Organização "${args.name}" (${args.type}) criada`, timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("organizations"),
    name: v.optional(v.string()),
    type: v.optional(v.union(
      v.literal("prefeitura"), v.literal("paco_municipal"), v.literal("gabinete"),
      v.literal("secretaria"), v.literal("departamento"), v.literal("unidade")
    )),
    parentId: v.optional(v.id("organizations")),
    active: v.optional(v.boolean()),
    observation: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const { id, ...updates } = args;

    const org = await ctx.db.get(id);
    if (!org) throw new Error("Organização não encontrada");

    // Prevent deactivation if has children
    if (updates.active === false) {
      const children = await ctx.db.query("organizations").withIndex("by_parent", (q: any) => q.eq("parentId", id)).collect();
      if (children.length > 0) {
        throw new Error(`Não é possível desativar: existem ${children.length} sub-unidade(s) vinculada(s). Desative-as primeiro.`);
      }
    }

    // Prevent circular parent
    if (updates.parentId && updates.parentId === id) {
      throw new Error("Uma organização não pode ser superior de si mesma");
    }

    if (updates.name) updates.name = updates.name.trim();

    await ctx.db.patch(id, updates);
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId, action, entity: "organizations", entityId: id,
      details: `Organização "${org.name}" — ${JSON.stringify(updates)}`, timestamp: Date.now(),
    });
    return id;
  },
});
