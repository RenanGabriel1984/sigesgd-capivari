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

async function requireStockManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar fornecedores");
  }
  return { userId, user };
}

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
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (!args.legalName.trim()) throw new Error("Razão social é obrigatória");

    // Check CNPJ uniqueness if provided
    if (args.cnpj) {
      const existing = await ctx.db.query("suppliers").withIndex("by_cnpj", (q: any) => q.eq("cnpj", args.cnpj)).first();
      if (existing) throw new Error("Já existe um fornecedor com este CNPJ");
    }

    const id = await ctx.db.insert("suppliers", { ...args, legalName: args.legalName.trim(), active: true });
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
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const { id, ...updates } = args;

    const supplier = await ctx.db.get(id);
    if (!supplier) throw new Error("Fornecedor não encontrado");

    // Check CNPJ uniqueness if changing
    if (updates.cnpj) {
      const existing = await ctx.db.query("suppliers").withIndex("by_cnpj", (q: any) => q.eq("cnpj", updates.cnpj)).first();
      if (existing && existing._id !== id) throw new Error("Já existe outro fornecedor com este CNPJ");
    }

    if (updates.legalName) updates.legalName = updates.legalName.trim();

    await ctx.db.patch(id, updates);
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId, action, entity: "suppliers", entityId: id,
      details: `Fornecedor "${supplier.legalName}" — ${JSON.stringify(updates)}`, timestamp: Date.now(),
    });
    return id;
  },
});
