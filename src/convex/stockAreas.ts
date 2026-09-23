import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado");
  return { userId, user };
}

async function requireStockManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar áreas/subestoques");
  }
  return { userId, user };
}

/**
 * ÁREAS / SUBESTOQUES — conceito INDEPENDENTE de fornecedor e categoria.
 * Ex.: "Impressoras / Gomaq" pode receber material de qualquer fornecedor,
 * e o mesmo produto pode existir em áreas diferentes.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("stockAreas").order("asc").collect();
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db
      .query("stockAreas")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .order("asc")
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Nome da área é obrigatório");

    const existing = await ctx.db
      .query("stockAreas")
      .withIndex("by_name", (q: any) => q.eq("name", name))
      .first();
    if (existing) throw new Error(`Já existe uma área/subestoque chamado "${name}"`);

    const id = await ctx.db.insert("stockAreas", {
      name,
      description: args.description?.trim() || undefined,
      active: true,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "stockAreas",
      entityId: id,
      details: `Área/Subestoque "${name}" criada`,
      timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("stockAreas"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const area = await ctx.db.get(args.id);
    if (!area) throw new Error("Área não encontrada");

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Nome da área é obrigatório");
      if (name !== area.name) {
        const dup = await ctx.db
          .query("stockAreas")
          .withIndex("by_name", (q: any) => q.eq("name", name))
          .first();
        if (dup) throw new Error(`Já existe uma área/subestoque chamado "${name}"`);
      }
      updates.name = name;
    }
    if (args.description !== undefined) updates.description = args.description.trim() || undefined;
    if (args.active !== undefined) updates.active = args.active;

    await ctx.db.patch(args.id, updates);
    const action = args.active === false ? "deactivate" : args.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId,
      action,
      entity: "stockAreas",
      entityId: args.id,
      details: `Área/Subestoque "${updates.name ?? area.name}" — ${JSON.stringify(updates)}`,
      timestamp: Date.now(),
    });
    return args.id;
  },
});
