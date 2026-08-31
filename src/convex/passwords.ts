import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hashPassword, verifyPassword } from "./auth/passwords";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

async function requireAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  if (user.role !== "admin") throw new Error("Apenas administradores podem executar esta operação");
  return { userId, user };
}

/** Create password for a user (admin only). */
export const createPassword = mutation({
  args: {
    userId: v.id("users"),
    password: v.string(),
    requiresReset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Usuário não encontrado");

    // Check if password already exists
    const existing = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) throw new Error("Usuário já possui senha definida. Use alteração de senha.");

    if (args.password.length < 6) {
      throw new Error("A senha deve ter pelo menos 6 caracteres");
    }

    const { hash, salt } = await hashPassword(args.password);

    const id = await ctx.db.insert("passwords", {
      userId: args.userId,
      passwordHash: hash,
      salt,
      requiresReset: args.requiresReset ?? false,
    });

    // Set requiresPasswordReset flag on user
    if (args.requiresReset) {
      await ctx.db.patch(args.userId, { requiresPasswordReset: true });
    }

    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action: "create",
      entity: "passwords",
      entityId: id,
      details: `Senha criada para usuário ${user.name ?? user.email}`,
      timestamp: Date.now(),
    });

    return id;
  },
});

/** Change password (authenticated user). */
export const changePassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);

    if (args.newPassword.length < 6) {
      throw new Error("A nova senha deve ter pelo menos 6 caracteres");
    }

    if (args.currentPassword === args.newPassword) {
      throw new Error("A nova senha deve ser diferente da atual");
    }

    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!passwordRecord) throw new Error("Senha não configurada. Contate o administrador.");

    const valid = await verifyPassword(
      args.currentPassword,
      passwordRecord.passwordHash,
      passwordRecord.salt
    );

    if (!valid) throw new Error("Senha atual incorreta");

    const { hash, salt } = await hashPassword(args.newPassword);

    await ctx.db.patch(passwordRecord._id, {
      passwordHash: hash,
      salt,
      requiresReset: false,
    });

    // Clear requiresPasswordReset flag on user
    await ctx.db.patch(userId, { requiresPasswordReset: false });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "password_change",
      entity: "passwords",
      entityId: passwordRecord._id,
      details: "Senha alterada",
      timestamp: Date.now(),
    });

    return true;
  },
});

/** Admin reset password for a user. */
export const adminResetPassword = mutation({
  args: {
    userId: v.id("users"),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Usuário não encontrado");

    if (args.newPassword.length < 6) {
      throw new Error("A nova senha deve ter pelo menos 6 caracteres");
    }

    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const { hash, salt } = await hashPassword(args.newPassword);

    if (passwordRecord) {
      await ctx.db.patch(passwordRecord._id, {
        passwordHash: hash,
        salt,
        requiresReset: true,
      });
    } else {
      await ctx.db.insert("passwords", {
        userId: args.userId,
        passwordHash: hash,
        salt,
        requiresReset: true,
      });
    }

    // Set requiresPasswordReset flag on user
    await ctx.db.patch(args.userId, { requiresPasswordReset: true });

    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action: "password_reset",
      entity: "passwords",
      entityId: args.userId,
      details: `Senha redefinida pelo administrador para ${user.name ?? user.email}`,
      timestamp: Date.now(),
    });

    return true;
  },
});

/** Force change password (first login — requiresPasswordReset). */
export const forceChangePassword = mutation({
  args: {
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);

    if (args.newPassword.length < 6) {
      throw new Error("A nova senha deve ter pelo menos 6 caracteres");
    }

    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!passwordRecord) throw new Error("Senha não configurada. Contate o administrador.");

    const { hash, salt } = await hashPassword(args.newPassword);

    await ctx.db.patch(passwordRecord._id, {
      passwordHash: hash,
      salt,
      requiresReset: false,
    });

    // Clear requiresPasswordReset flag on user
    await ctx.db.patch(userId, { requiresPasswordReset: false });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "password_change",
      entity: "passwords",
      entityId: passwordRecord._id,
      details: "Senha alterada no primeiro acesso",
      timestamp: Date.now(),
    });

    return true;
  },
});

/** Verify email and password (used by auth provider). */
export const verifyCredentials = query({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    // Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    if (!user) return { success: false, error: "Usuário não encontrado" };

    // Check if user is active
    if (user.active === false) {
      return { success: false, error: "Usuário inativo. Contate o administrador." };
    }

    // Find password record
    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!passwordRecord) {
      return { success: false, error: "Senha não configurada. Contate o administrador." };
    }

    // Verify password
    const valid = await verifyPassword(
      args.password,
      passwordRecord.passwordHash,
      passwordRecord.salt
    );

    if (!valid) {
      return { success: false, error: "E-mail ou senha incorretos" };
    }

    return {
      success: true,
      userId: user._id,
      requiresReset: passwordRecord.requiresReset,
    };
  },
});

/** Check if a user has a password configured. */
export const hasPassword = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    return !!record;
  },
});
