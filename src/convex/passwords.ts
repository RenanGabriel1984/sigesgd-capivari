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

/**
 * Bootstrap: create the first admin user + password.
 *
 * This mutation is ONLY allowed when NO admin user exists yet.
 * Once an admin exists, every subsequent call is rejected.
 *
 * Usage (from Convex dashboard or a one-time script):
 *  1. Open the Convex dashboard → Functions → Run
 *  2. Call: passwords.bootstrapAdmin
 *     { name: "Administrador", email: "admin@capivari.sp.gov.br", password: "MinhaS3nh@" }
 *  3. The function creates the user, hashes the password, and returns the userId.
 */
export const bootstrapAdmin = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    // ── Safety: only allowed when zero admins exist ──
    const existingAdmins = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();

    if (existingAdmins.length > 0) {
      throw new Error(
        "Já existe um administrador no sistema. " +
        "Esta operação só é permitida no primeiro acesso. " +
        "Use o painel de administração para criar novos usuários."
      );
    }

    // ── Validate ──
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("E-mail é obrigatório");
    if (args.password.length < 6) {
      throw new Error("A senha deve ter pelo menos 6 caracteres");
    }

    // ── Check for duplicate email ──
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (existingUser) {
      throw new Error("Já existe um usuário com este e-mail");
    }

    // ── Create user ──
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: args.name.trim(),
      email,
      role: "admin",
      active: true,
      requiresPasswordReset: false,
      createdAt: now,
      updatedAt: now,
    });

    // ── Create password ──
    const { hash, salt } = await hashPassword(args.password);
    await ctx.db.insert("passwords", {
      userId,
      passwordHash: hash,
      salt,
      requiresReset: false,
    });

    // ── Audit ──
    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "bootstrap",
      entityId: userId,
      details: `Bootstrap: primeiro administrador criado (${args.name} <${email}>)`,
      timestamp: now,
    });

    return { userId, message: "Administrador criado com sucesso. Faça login." };
  },
});

/**
 * Check if the system has been bootstrapped (at least one admin exists).
 * Used by the frontend to show/hide the bootstrap screen.
 */
export const hasAdmin = query({
  args: {},
  handler: async (ctx) => {
    const admin = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .first();
    return !!admin;
  },
});

/**
 * Bootstrap: set password for an existing user who has no password yet.
 *
 * Safe because:
 *  - Only works when the target user has NO password record
 *  - Does NOT create new users
 *  - Does NOT change existing passwords
 *
 * Usage (Convex dashboard → Functions → Run):
 *  passwords:bootstrapSetPassword
 *  { email: "admin@capivari.sp.gov.br", password: "MinhaS3nh@2026" }
 */
export const bootstrapSetPassword = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("E-mail é obrigatório");
    if (args.password.length < 6) {
      throw new Error("A senha deve ter pelo menos 6 caracteres");
    }

    // Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (!user) {
      throw new Error(`Usuário não encontrado com e-mail: ${email}`);
    }

    // Check if password already exists
    const existingPassword = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existingPassword) {
      throw new Error(
        `Usuário ${email} já possui senha definida. ` +
        "Use a opção de alteração de senha no painel."
      );
    }

    // Create password
    const { hash, salt } = await hashPassword(args.password);
    await ctx.db.insert("passwords", {
      userId: user._id,
      passwordHash: hash,
      salt,
      requiresReset: false,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      action: "create",
      entity: "passwords",
      entityId: user._id,
      details: `Bootstrap: senha definida para ${user.name ?? email}`,
      timestamp: Date.now(),
    });

    return { message: `Senha definida para ${user.name ?? email}. Faça login.` };
  },
});

/**
 * Diagnostic: list all users and whether they have a password.
 * Useful for figuring out login issues.
 */
export const diagnosticListUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const results: Array<{
      userId: string;
      name: string | undefined;
      email: string | undefined;
      role: string | undefined;
      active: boolean | undefined;
      hasPassword: boolean;
    }> = [];

    for (const u of users) {
      const pw = await ctx.db
        .query("passwords")
        .withIndex("by_user", (q) => q.eq("userId", u._id))
        .first();
      results.push({
        userId: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        hasPassword: !!pw,
      });
    }

    return results;
  },
});
