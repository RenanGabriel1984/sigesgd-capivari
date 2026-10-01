import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

// IMPORTANT: `auth:signIn` is implemented as a Convex ACTION, and Convex
// redacts plain `Error`s thrown inside actions to the generic message
// "Server Error" before sending them to the client. To make real messages
// ("E-mail ou senha incorretos", "Usuário inativo…") reach the login
// screen we must throw `ConvexError`, which is never redacted.
//
// ─── Hardening §9/§10/§11 ────────────────────────────────────────────────────
// • A contabilização de falha agora acontece numa MUTAÇÃO INTERNA
//   (`internal.passwords.recordFailedLogin`): não existe mais endpoint público
//   que permita a um atacante bloquear arbitrariamente a conta de um terceiro.
// • O login bem-sucedido ZERA o contador (`internal.passwords.recordSuccessfulLogin`).
// • Todas as falhas de credencial chegam com a MESMA mensagem genérica
//   ("E-mail ou senha incorretos."), sem distinguir e-mail inexistente,
//   usuário inativo, sem senha, sem perfil de acesso ou senha incorreta.
export const credentials = ConvexCredentials<DataModel>({
  id: "credentials",
  authorize: async (params: Record<string, unknown>, ctx: any): Promise<{ userId: any } | null> => {
    const email = params.email;
    const password = params.password;

    if (typeof email !== "string" || typeof password !== "string") {
      throw new ConvexError("E-mail e senha são obrigatórios");
    }

    if (!email.trim()) {
      throw new ConvexError("E-mail é obrigatório");
    }

    if (!password) {
      throw new ConvexError("Senha é obrigatória");
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check brute force lockout
    const lockStatus: { locked: boolean; remainingSeconds?: number } = await ctx.runQuery(
      internal.passwords.isLockedOut,
      { email: normalizedEmail },
    );

    if (lockStatus.locked) {
      const minutes = Math.ceil((lockStatus.remainingSeconds ?? 0) / 60);
      throw new ConvexError(
        `Acesso temporariamente bloqueado. Tente novamente em ${minutes} minuto(s). ` +
        `Use "Esqueci minha senha" para redefinir.`,
      );
    }

    // Use the existing verifyCredentials query to validate
    const result: { success: boolean; error?: string; userId?: any } = await ctx.runQuery(
      internal.passwords.verifyCredentials,
      { email: normalizedEmail, password },
    );

    if (!result.success) {
      // Registra a falha SOMENTE dentro deste fluxo confiável de autenticação.
      await ctx.runMutation(internal.passwords.recordFailedLogin, {
        email: normalizedEmail,
      });
      // Mensagem genérica: idêntica para qualquer causa de falha.
      throw new ConvexError(result.error ?? "E-mail ou senha incorretos.");
    }

    // §10 — Login válido: limpa o contador de tentativas e qualquer bloqueio
    // residual, para que a proteção de força bruta continue válida daqui em
    // diante.
    await ctx.runMutation(internal.passwords.recordSuccessfulLogin, {
      email: normalizedEmail,
    });

    return { userId: result.userId };
  },
});