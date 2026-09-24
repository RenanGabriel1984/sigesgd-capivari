import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { normalizeText } from "../lib/nfe";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  return userId;
}

async function requireManagerOrAdmin(ctx: any) {
  const userId = await requireUser(ctx);
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  if (user.role !== "admin" && user.role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar correspondências de NF-e");
  }
  return userId;
}

/** Memória de correspondência aprendida por associação explícita. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.db.query("nfeProductAliases").collect();
  },
});

/**
 * Upsert idempotente. O código do fornecedor só é memorizado no escopo de
 * um fornecedor; descrição sem fornecedor pode ser reutilizada globalmente.
 * Esta mutation não toca em produtos, entradas ou estoque.
 */
export const upsert = mutation({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    supplierCode: v.optional(v.string()),
    description: v.string(),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const userId = await requireManagerOrAdmin(ctx);
    const normalizedDescription = normalizeText(args.description);
    const supplierCode = args.supplierCode?.trim() || undefined;
    if (!normalizedDescription) throw new Error("Descrição da NF-e é obrigatória para memorizar a associação");
    if (supplierCode && !args.supplierId) {
      throw new Error("Código de fornecedor só pode ser memorizado com o fornecedor identificado");
    }
    if (args.supplierId) {
      const supplier = await ctx.db.get(args.supplierId);
      if (!supplier || !supplier.active) throw new Error("Fornecedor não encontrado ou inativo");
    }
    const product = await ctx.db.get(args.productId);
    if (!product || !product.active) throw new Error("Produto não encontrado ou inativo");

    const all = await ctx.db.query("nfeProductAliases").collect();
    const existing = all.find((alias: any) => {
      const sameSupplier = (alias.supplierId ?? undefined) === (args.supplierId ?? undefined);
      if (!sameSupplier) return false;
      return supplierCode
        ? (alias.supplierCode ?? undefined) === supplierCode
        : alias.normalizedDescription === normalizedDescription;
    });
    const now = Date.now();
    const values = {
      supplierId: args.supplierId,
      supplierCode,
      normalizedDescription,
      productId: args.productId,
      updatedAt: now,
    };
    const aliasId = existing
      ? (await ctx.db.patch(existing._id, values), existing._id)
      : await ctx.db.insert("nfeProductAliases", { ...values, createdBy: userId, createdAt: now });

    await ctx.db.insert("auditLogs", {
      userId,
      action: existing ? "update" : "create",
      entity: "nfeProductAliases",
      entityId: aliasId,
      details: `Correspondência NF-e memorizada: ${supplierCode ?? normalizedDescription} → ${product.name}`,
      timestamp: now,
    });
    return aliasId;
  },
});
