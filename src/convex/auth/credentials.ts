import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { api } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

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
      throw new Error("E-mail e senha são obrigatórios");
    }

    if (!email.trim()) {
      throw new Error("E-mail é obrigatório");
    }

    if (!password) {
      throw new Error("Senha é obrigatória");
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
      throw new Error(result.error ?? "Credenciais inválidas");
    }

    return { userId: result.userId };
  },
});
