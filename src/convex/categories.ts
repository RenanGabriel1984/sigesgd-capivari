import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

async function requireManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar categorias");
  }
  return { userId, user };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Proteção: exige sessão autenticada
    await requireUser(ctx);
    return await ctx.db.query("categories").collect();
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    // Proteção: exige sessão autenticada
    await requireUser(ctx);
    return await ctx.db.query("categories").withIndex("by_active", (q) => q.eq("active", true)).collect();
  },
});

export const create = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    if (!args.name.trim()) throw new Error("Nome da categoria é obrigatório");

    // Check for duplicate name
    const existing = await ctx.db.query("categories").collect();
    if (existing.some((c: any) => c.name.toLowerCase() === args.name.trim().toLowerCase())) {
      throw new Error("Já existe uma categoria com este nome");
    }

    const id = await ctx.db.insert("categories", { name: args.name.trim(), description: args.description || undefined, active: true });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "categories", entityId: id,
      details: `Categoria "${args.name}" criada`, timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: { id: v.id("categories"), name: v.optional(v.string()), description: v.optional(v.string()), active: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const { id, ...updates } = args;

    const category = await ctx.db.get(id);
    if (!category) throw new Error("Categoria não encontrada");

    // Prevent deactivation if category has active products
    if (updates.active === false) {
      const products = await ctx.db.query("products")
        .withIndex("by_category", (q: any) => q.eq("categoryId", id))
        .collect();
      const activeProducts = products.filter((p: any) => p.active);
      if (activeProducts.length > 0) {
        throw new Error(`Não é possível desativar: existem ${activeProducts.length} item(ns) ativo(s) nesta categoria. Desative os itens primeiro.`);
      }
    }

    // Check duplicate name if changing
    if (updates.name) {
      updates.name = updates.name.trim();
      const all = await ctx.db.query("categories").collect();
      if (all.some((c: any) => c._id !== id && c.name.toLowerCase() === updates.name!.toLowerCase())) {
        throw new Error("Já existe outra categoria com este nome");
      }
    }

    await ctx.db.patch(id, updates);
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId, action, entity: "categories", entityId: id,
      details: JSON.stringify(updates), timestamp: Date.now(),
    });
    return id;
  },
});
