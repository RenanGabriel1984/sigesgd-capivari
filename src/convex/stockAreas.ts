import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { BASELINE_STOCK_AREAS, NO_AREA_LABEL } from "../lib/stock-areas";

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
 *
 * A área "Impressoras", por exemplo, pode receber material de QUALQUER
 * fornecedor: o nome da área nunca contém fornecedor, o mesmo produto pode
 * existir em áreas diferentes e o fornecedor de cada entrada permanece no
 * histórico (nova licitação ≠ nova estrutura).
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

/**
 * Resumo (SOMENTE LEITURA) do estoque disponível por área/subestoque.
 *
 * Deriva dos lotes existentes (lots.areaId) — não cria saldo paralelo nem
 * duplica a fonte da verdade: o saldo continua sendo o dos lotes/estoque.
 * Lotes sem área aparecem como estoque geral ("Sem área").
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const areas = await ctx.db.query("stockAreas").collect();
    const lots = await ctx.db.query("lots").collect();

    const buckets = new Map<
      string,
      { areaId: string | null; name: string; active: boolean; description: string | null; lots: number; quantityAvailable: number; quantityReceived: number }
    >();

    for (const area of areas) {
      buckets.set(area._id as string, {
        areaId: area._id as string,
        name: area.name,
        active: area.active,
        description: area.description ?? null,
        lots: 0,
        quantityAvailable: 0,
        quantityReceived: 0,
      });
    }

    for (const lot of lots) {
      const key = (lot.areaId as string | undefined) ?? "none";
      const current =
        buckets.get(key) ??
        {
          areaId: null,
          name: NO_AREA_LABEL,
          active: true,
          description: null,
          lots: 0,
          quantityAvailable: 0,
          quantityReceived: 0,
        };
      current.lots += 1;
      current.quantityAvailable += lot.quantityAvailable;
      current.quantityReceived += lot.quantityReceived;
      buckets.set(key, current);
    }

    return Array.from(buckets.values()).sort((a, b) => {
      if (a.areaId === null) return 1;
      if (b.areaId === null) return -1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  },
});

/**
 * Garante as áreas de referência da estrutura oficial (TI Geral, Impressoras).
 *
 * IDEMPOTENTE: só cria o que ainda não existe pelo nome; nunca renomeia,
 * nunca apaga e nunca toca em estoque, lotes ou movimentações. Cada criação
 * gera registro de auditoria.
 */
export const ensureBaselineAreas = internalMutation({
  args: {},
  handler: async (ctx) => {
    const created: string[] = [];
    const skipped: string[] = [];

    for (const area of BASELINE_STOCK_AREAS) {
      const existing = await ctx.db
        .query("stockAreas")
        .withIndex("by_name", (q: any) => q.eq("name", area.name))
        .first();
      if (existing) {
        skipped.push(area.name);
        continue;
      }
      const id = await ctx.db.insert("stockAreas", {
        name: area.name,
        description: area.description,
        active: true,
      });
      await ctx.db.insert("auditLogs", {
        action: "create",
        entity: "stockAreas",
        entityId: id as string,
        details: `Área/Subestoque "${area.name}" garantida pela estrutura oficial (sem fornecedor no nome)`,
        timestamp: Date.now(),
      });
      created.push(area.name);
    }

    return { created, skipped };
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
