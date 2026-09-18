import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * SIGESGD — Auxiliares internos do teste E2E de recuperação de senha.
 *
 * Módulo separado de `diagnostics.ts` de propósito: funções internas do
 * MESMO módulo referenciadas via `internal.<módulo>.*` criam ciclo de
 * inferência de tipos no codegen do Convex. Aqui, isolados, não há ciclo.
 *
 * `pwE2EStateInternal` é SOMENTE LEITURA (ações internas não têm ctx.db).
 * `restorePasswordInternal` apenas repõe hash/salt originais no rollback.
 * Nenhuma das duas expõe código de reset.
 */

export const pwE2EStateInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) throw new Error(`Usuário não encontrado: ${email}`);

    const pw = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const resets = await ctx.db
      .query("passwordResets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return {
      userId: user._id,
      passwordRecordId: pw?._id ?? null,
      passwordHash: pw?.passwordHash ?? null,
      salt: pw?.salt ?? null,
      requiresReset: pw?.requiresReset ?? null,
      resets: resets.map((r) => ({
        id: r._id,
        usedAt: r.usedAt ?? null,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
    };
  },
});

export const restorePasswordInternal = internalMutation({
  args: {
    passwordRecordId: v.id("passwords"),
    passwordHash: v.string(),
    salt: v.string(),
    requiresReset: v.boolean(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.passwordRecordId, {
      passwordHash: args.passwordHash,
      salt: args.salt,
      requiresReset: args.requiresReset,
    });
    await ctx.db.patch(args.userId, { requiresPasswordReset: false });
    return true;
  },
});
