import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { ConvexError } from "convex/values";
import { api } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

// IMPORTANT: `auth:signIn` is implemented as a Convex ACTION, and Convex
// redacts plain `Error`s thrown inside actions to the generic message
// "Server Error" before sending them to the client. To make real messages
// ("E-mail ou senha incorretos", "Usuário inativo…") reach the login
// screen we must throw `ConvexError`, which is never redacted.

/**
 * Email + password authentication provider.
 * Validates credentials against the custom `passwords` table.
 * Users must have a password record created by an admin before they can sign in.
 */
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

    // Use the existing verifyCredentials query to validate
    const result: { success: boolean; error?: string; userId?: any } = await ctx.runQuery(
      api.passwords.verifyCredentials,
      {
        email: email.trim().toLowerCase(),
        password,
      }
    );

    if (!result.success) {
      throw new ConvexError(result.error ?? "Credenciais inválidas");
    }

    return { userId: result.userId };
  },
});
