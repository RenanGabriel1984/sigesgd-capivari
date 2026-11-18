import { getAuthUserId, getAuthSessionId, invalidateSessions } from "@convex-dev/auth/server";
import { requirePermission } from "./rbac";
import { mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { hashPassword, verifyPassword, nextResetAttempt, verifyResetCode } from "./auth/passwords";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { APP_ROLES } from "../lib/rbac";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician" | "patrimony_manager";

/** Política de senha (§12). Todas as cinco ACTIONS de definição exigem este mínimo. */
export const MIN_PASSWORD_LENGTH = 8;

/** Tentativas máximas do código de recuperação (§8). */
const RESET_MAX_ATTEMPTS = 5;
/** Intervalo mínimo entre dois pedidos de recuperação para o mesmo e-mail. */
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;

/** Mensagem ÚNICA para qualquer falha de autenticação — anti-enumeração (§11). */
const GENERIC_AUTH_ERROR = "E-mail ou senha incorretos.";

// Equalize PBKDF2 work for unknown, inactive and incomplete accounts.
const DUMMY_PASSWORD_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const DUMMY_PASSWORD_SALT = "00000000000000000000000000000000";

async function rejectCredentials(password: string) {
  await verifyPassword(password, DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT);
  return { success: false, error: GENERIC_AUTH_ERROR };
}

/** Papéis reconhecidos — fail closed na autenticação. */
const VALID_ROLE_SET = new Set<string>(APP_ROLES);

/** Valida a política de senha e devolve mensagem amigável. */
function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  if (password.length > 200) {
    throw new Error("A senha deve ter no máximo 200 caracteres.");
  }
}

async function requireUser(ctx: any) {
  // Hardening B-01: a gestão da PRÓPRIA senha também exige um cadastro SIGESGD
  // válido (não anônimo, ativo, com `role` reconhecido). `settings.view` está
  // presente em todos os cinco perfis — a checagem aqui é de IDENTIDADE, não de
  // privilégio. Operações administrativas usam requireAdmin (`users.manage`).
  return requirePermission(ctx, "settings.view", { entity: "passwords" });
}

async function requireAdmin(ctx: any) {
  // RBAC central: operações administrativas de senha = gestão de usuários.
  return requirePermission(ctx, "users.manage", { entity: "passwords" });
}
/** Invalida OTPs pendentes quando a credencial ou o acesso muda. */
async function invalidatePendingPasswordResets(ctx: any, userId: Id<"users">): Promise<void> {
  const resets = await ctx.db
    .query("passwordResets")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();
  const now = Date.now();
  for (const reset of resets) {
    const patch: Record<string, unknown> = {};
    if (!reset.usedAt) patch.usedAt = now;
    if (reset.token !== undefined) patch.token = undefined;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(reset._id, patch);
    }
  }
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

    assertPasswordPolicy(args.password);

    const { hash, salt } = await hashPassword(args.password);

    const id = await ctx.db.insert("passwords", {
      userId: args.userId,
      passwordHash: hash,
      salt,
      requiresReset: args.requiresReset ?? false,
    });
    await invalidatePendingPasswordResets(ctx, args.userId);

    // Keep the user and credential reset flags synchronized.
    await ctx.db.patch(args.userId, {
      requiresPasswordReset: args.requiresReset ?? false,
    });

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
    const currentSessionId = await getAuthSessionId(ctx);

    assertPasswordPolicy(args.newPassword);

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
    await invalidatePendingPasswordResets(ctx, userId);

    await ctx.db.insert("auditLogs", {
      userId,
      action: "password_change",
      entity: "passwords",
      entityId: passwordRecord._id,
      details: "Senha alterada",
      timestamp: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.passwords.invalidateUserSessionsInternal, {
      userId,
      exceptSessionId: currentSessionId ?? undefined,
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

    assertPasswordPolicy(args.newPassword);

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
    await invalidatePendingPasswordResets(ctx, args.userId);

    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action: "password_reset",
      entity: "passwords",
      entityId: args.userId,
      details: `Senha redefinida pelo administrador para ${user.name ?? user.email}`,
      timestamp: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.passwords.invalidateUserSessionsInternal, {
      userId: args.userId,
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
    const { userId, user } = await requireUser(ctx);
    const currentSessionId = await getAuthSessionId(ctx);

    assertPasswordPolicy(args.newPassword);

    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!passwordRecord) throw new Error("Senha não configurada. Contate o administrador.");
    if (user.requiresPasswordReset !== true && passwordRecord.requiresReset !== true) {
      throw new Error("A troca obrigatória de senha não está pendente. Use a opção Alterar Senha.");
    }

    const { hash, salt } = await hashPassword(args.newPassword);

    await ctx.db.patch(passwordRecord._id, {
      passwordHash: hash,
      salt,
      requiresReset: false,
    });

    // Clear requiresPasswordReset flag on user
    await ctx.db.patch(userId, { requiresPasswordReset: false });
    await invalidatePendingPasswordResets(ctx, userId);

    await ctx.db.insert("auditLogs", {
      userId,
      action: "password_change",
      entity: "passwords",
      entityId: passwordRecord._id,
      details: "Senha alterada no primeiro acesso",
      timestamp: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.passwords.invalidateUserSessionsInternal, {
      userId,
      exceptSessionId: currentSessionId ?? undefined,
    });

    return true;
  },
});

/** Verify email and password (used by auth provider). */
// INTERNAL: usada pelo provider de credenciais (server-side). Cliente NÃO pode
// chamá-la diretamente — evita oráculo público de validação de senha.
export const verifyCredentials = internalQuery({
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

    // ── ANTI-ENUMERAÇÃO (§11) ────────────────────────────────────────────
    // TODOS os caminhos de falha devolvem EXATAMENTE a mesma mensagem, com a
    // mesma forma. O chamador não consegue distinguir "e-mail não existe",
    // "usuário inativo", "sem senha", "sem perfil de acesso" ou "senha errada".
    if (!user) return await rejectCredentials(args.password);

    // Check if user is active
    if (user.active === false) {
      return await rejectCredentials(args.password);
    }

    // ── B-01 (defesa em profundidade) ────────────────────────────────────
    // Identidade anônima (provider removido) ou identidade sem `role`
    // válido nunca é autenticada, mesmo com senha correta.
    if ((user as { isAnonymous?: boolean }).isAnonymous === true) {
      return await rejectCredentials(args.password);
    }
    if (!VALID_ROLE_SET.has(user.role as string)) {
      return await rejectCredentials(args.password);
    }

    // Find password record
    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!passwordRecord) {
      return await rejectCredentials(args.password);
    }

    // Verify password
    const valid = await verifyPassword(
      args.password,
      passwordRecord.passwordHash,
      passwordRecord.salt
    );

    if (!valid) {
      return { success: false, error: GENERIC_AUTH_ERROR };
    }

    return {
      success: true,
      userId: user._id,
      requiresReset: passwordRecord.requiresReset,
    };
  },
});

/** Check if a user has a password configured. */
// INTERNAL: não é usado pelo frontend e, como query pública, allowia a
// enumeração de contas (para qualquer `userId`, inclusive de terceiros).
export const hasPassword = internalQuery({
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
/**
 * INTERNAL: cria o primeiro administrador (bootstrap).
 *
 * Somente permitido quando NÃO existe nenhum admin. Como qualquer mutation
 * pública seria um vetor de criação de contas, esta função é INTERNAL —
 * executável apenas via CLI do deployment (convex run) ou dashboard, nunca
 * pelo cliente.
 */
export const bootstrapAdmin = internalMutation({
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
    assertPasswordPolicy(args.password);

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
export const hasAdmin = internalQuery({
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
/**
 * INTERNAL: define senha para usuário existente SEM senha.
 *
 * Executável apenas via CLI/dashboard do deployment (convex run).
 * NÃO é acessível pelo cliente — não há endpoint público de senha.
 */
export const bootstrapSetPassword = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("E-mail é obrigatório");
    assertPasswordPolicy(args.password);

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
    await ctx.db.patch(user._id, { requiresPasswordReset: false });
    await invalidatePendingPasswordResets(ctx, user._id);

    // Clear residual failed-login counters so the new credential starts clean.
    const failedAttempts = await ctx.db
      .query("failedLoginAttempts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (failedAttempts) {
      await ctx.db.patch(failedAttempts._id, { attempts: 0, lockedUntil: undefined });
    }

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
// INTERNAL: diagnóstico de usuários deve ficar inacessível ao cliente.
export const diagnosticListUsers = internalQuery({
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

/**
 * Request password reset — generates a 6-digit code valid for 15 minutes.
 * Does NOT reveal whether the email exists (security).
 *
 * Hardening §8: cooldown de RESET_REQUEST_COOLDOWN_MS por e-mail. Sem ele, o
 * endpoint público permitia INUNDAR a caixa de e-mail de um endereço legítimo
 * (envio ilimitado de códigos). O cooldown também é aplicado ANTES de qualquer
 * resposta differentiation — o retorno é byte-a-byte idêntico ao caso de e-mail
 * inexistente.
 */
const RESET_GENERIC_MESSAGE =
  "Se os dados estiverem cadastrados, enviaremos as instruções para recuperação.";

export const invalidatePasswordResetsForUserInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await invalidatePendingPasswordResets(ctx, args.userId);
    return true;
  },
});

/** Revoga sessões antigas após alteração de senha ou de perfil. */
export const invalidateUserSessionsInternal = internalAction({
  args: {
    userId: v.id("users"),
    exceptSessionId: v.optional(v.id("authSessions")),
  },
  handler: async (ctx, args) => {
    await invalidateSessions(ctx, {
      userId: args.userId,
      except: args.exceptSessionId ? [args.exceptSessionId] : [],
    });
    return true;
  },
});

/**
 * Store the salted hash generated by the internal email action. The raw OTP
 * is never written to passwordResets.
 */
export const storePasswordResetHashInternal = internalMutation({
  args: {
    resetId: v.id("passwordResets"),
    tokenHash: v.string(),
    tokenSalt: v.string(),
  },
  handler: async (ctx, args) => {
    const reset = await ctx.db.get(args.resetId);
    if (!reset || reset.usedAt || reset.expiresAt <= Date.now()) return false;
    if ((reset.attempts ?? 0) >= RESET_MAX_ATTEMPTS) return false;

    await ctx.db.patch(args.resetId, {
      token: undefined,
      tokenHash: args.tokenHash,
      tokenSalt: args.tokenSalt,
    });
    return true;
  },
});

/** Invalidate a reset whose delivery failed, avoiding a dead cooldown token. */
export const invalidatePasswordResetInternal = internalMutation({
  args: { resetId: v.id("passwordResets") },
  handler: async (ctx, args) => {
    const reset = await ctx.db.get(args.resetId);
    if (!reset || reset.usedAt) return false;
    await ctx.db.patch(args.resetId, { usedAt: Date.now() });
    return true;
  },
});

export const requestPasswordReset = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("E-mail é obrigatório");
    if (!Number.isFinite(args.email.length)) throw new Error("E-mail inválido");

    // Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    // Always return the same message to prevent email enumeration
    if (!user) return { message: RESET_GENERIC_MESSAGE };
    if (user.active === false) return { message: RESET_GENERIC_MESSAGE };
    if ((user as { isAnonymous?: boolean }).isAnonymous === true) {
      return { message: RESET_GENERIC_MESSAGE };
    }
    if (!VALID_ROLE_SET.has(user.role as string)) {
      return { message: RESET_GENERIC_MESSAGE };
    }

    const now = Date.now();

    // Invalidate any existing tokens for this user
    const existingTokens = await ctx.db
      .query("passwordResets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Cooldown: se um pedido foi feito há menos de RESET_REQUEST_COOLDOWN_MS,
    // nada é gerado nem enviado — e a resposta continua idêntica.
    const recent = existingTokens.some(
      (t) => !t.usedAt && now - t.createdAt < RESET_REQUEST_COOLDOWN_MS,
    );
    if (recent) return { message: RESET_GENERIC_MESSAGE };

    for (const token of existingTokens) {
      if (!token.usedAt || token.token !== undefined) {
        // Invalidate previous codes and redact any legacy plaintext value.
        await ctx.db.patch(token._id, {
          usedAt: token.usedAt ?? now,
          token: undefined,
        });
      }
    }

    const resetId: Id<"passwordResets"> = await ctx.db.insert("passwordResets", {
      userId: user._id,
      // The internal email action generates the OTP and persists only its hash.
      expiresAt: now + 15 * 60 * 1000, // 15 minutes
      createdAt: now,
      attempts: 0,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      action: "password_reset",
      entity: "passwordResets",
      entityId: user._id,
      details: `Solicitação de recuperação de senha para ${email}`,
      timestamp: now,
    });

    // The scheduled internal action generates the OTP, persists only a salted
    // hash, and sends the raw code directly to the mail provider. The public
    // mutation and scheduler payload never receive the raw code.
    await ctx.scheduler.runAfter(0, internal.email.sendPasswordResetEmailInternal, {
      resetId,
    });

    return {
      message: RESET_GENERIC_MESSAGE,
    };
  },
});

/**
 * Confirm password reset with the 6-digit code.
 * One-time use, expires after 15 minutes, máximo de RESET_MAX_ATTEMPTS
 * tentativas por token (hardening §8 — brute force).
 *
 * Mensagens de erro são IDÊNTICAS para: e-mail inexistente, token inexistente,
 * token expirado, token já usado, token esgotado e código errado. Não há
 * como enumerar contas nem distinguir a causa da falha.
 */
export const confirmPasswordReset = mutation({
  args: {
    email: v.string(),
    code: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("E-mail é obrigatório");
    assertPasswordPolicy(args.newPassword);

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    // Generic error to prevent enumeration and prevent disabled/invalid profiles
    // from using a previously issued recovery code after access was revoked.
    if (
      !user ||
      user.active === false ||
      (user as { isAnonymous?: boolean }).isAnonymous === true ||
      !VALID_ROLE_SET.has(user.role as string)
    ) {
      throw new Error("Código inválido ou expirado");
    }

    // Find valid token
    const tokens = await ctx.db
      .query("passwordResets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const now = Date.now();
    const activeToken = tokens
      .filter(
        (token) =>
          !token.usedAt &&
          token.expiresAt > now &&
          (token.attempts ?? 0) < RESET_MAX_ATTEMPTS,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    // Legacy plaintext tokens remain verifiable only until their original
    // expiry. New records use salted PBKDF2 and never persist the raw code.
    const validToken = activeToken
      ? activeToken.tokenHash && activeToken.tokenSalt
        ? (await verifyResetCode(args.code, activeToken.tokenHash, activeToken.tokenSalt))
          ? activeToken
          : null
        : activeToken.token === args.code
          ? activeToken
          : null
      : null;

    if (!validToken) {
      // Toda confirmação inválida consome uma tentativa do código ativo do
      // usuário. Antes, somente uma tentativa que coincidisse com um token
      // era contabilizada, deixando palpites aleatórios ilimitados.
      if (activeToken) {
        const attemptUpdate = nextResetAttempt(
          activeToken.attempts ?? 0,
          RESET_MAX_ATTEMPTS,
          now,
        );
        await ctx.db.patch(activeToken._id, attemptUpdate);
      }

      throw new Error("Código inválido ou expirado");
    }

    // Mark token as used
    await ctx.db.patch(validToken._id, { usedAt: Date.now() });

    // Hash new password
    const { hash, salt } = await hashPassword(args.newPassword);

    // Update or create password record
    const existingPw = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existingPw) {
      await ctx.db.patch(existingPw._id, {
        passwordHash: hash,
        salt,
        requiresReset: false,
      });
    } else {
      await ctx.db.insert("passwords", {
        userId: user._id,
        passwordHash: hash,
        salt,
        requiresReset: false,
      });
    }

    // Clear residual failed-login counters after successful recovery.
    const failedAttempts = await ctx.db
      .query("failedLoginAttempts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (failedAttempts) {
      await ctx.db.patch(failedAttempts._id, {
        attempts: 0,
        lockedUntil: undefined,
      });
    }

    // Clear requiresPasswordReset flag
    await ctx.db.patch(user._id, { requiresPasswordReset: false });
    await invalidatePendingPasswordResets(ctx, user._id);
    await ctx.scheduler.runAfter(0, internal.passwords.invalidateUserSessionsInternal, {
      userId: user._id,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      action: "password_reset",
      entity: "passwords",
      entityId: user._id,
      details: `Senha redefinida via recuperação para ${email}`,
      timestamp: Date.now(),
    });

    return { message: "Senha redefinida com sucesso. Faça login." };
  },
});

/**
 * Record failed login attempts for audit without locking accounts by email.
 *
 * Hardening §9: era uma MUTATION PÚBLICA sem autenticação — qualquer pessoa
 * podia chamá-la 5 vezes com o e-mail de um terceiro e BLOQUEAR a conta
 * (negação de serviço). Passou a ser INTERNALMutation, executada apenas pelo
 * provider de credenciais (`auth/credentials.ts`) no servidor, dentro do fluxo
 * real de autenticação. Não existe mais endpoint público que incremente
 * tentativas de terceiros.
 */
export const recordFailedLogin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) return;

    const now = Date.now();
    const existing = await ctx.db
      .query("failedLoginAttempts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existing) {
      const newAttempts = (existing.attempts ?? 0) + 1;
      // Não bloquear por e-mail: qualquer visitante poderia provocar negação
      // de serviço contra uma conta conhecida enviando senhas incorretas.
      await ctx.db.patch(existing._id, {
        attempts: newAttempts,
        lastAttemptAt: now,
        lockedUntil: undefined,
      });
    } else {
      await ctx.db.insert("failedLoginAttempts", {
        email,
        attempts: 1,
        lastAttemptAt: now,
      });
    }

    // A auditoria registra também tentativas inválidas. Quando o e-mail
    // pertence a um usuário cadastrado, associa o evento à conta; caso
    // contrário preserva o login tentado no detalhe, sem inventar identidade.
    const account = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    await ctx.db.insert("auditLogs", {
      userId: account?._id,
      action: "login_failed",
      entity: "auth",
      entityId: account?._id ? String(account._id) : email,
      details: `Falha de autenticação para o login ${email}`,
      timestamp: now,
    });
  },
});
/**
 * Zera o contador de falhas após um login bem-sucedido.
 *
 * A contagem é apenas um indicador de auditoria; ela não bloqueia a
 * autenticação nem impede o titular de tentar novamente.
 *
 * INTERNAL: chamada apenas pelo provider de credenciais, no servidor.
 */
export const recordSuccessfulLogin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) return { cleared: false };

    const now = Date.now();
    const account = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (account) {
      await ctx.db.insert("auditLogs", {
        userId: account._id,
        action: "login",
        entity: "auth",
        entityId: String(account._id),
        details: `Login realizado com sucesso: ${email}`,
        timestamp: now,
      });
    }

    const existing = await ctx.db
      .query("failedLoginAttempts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (!existing) return { cleared: false };
    if ((existing.attempts ?? 0) === 0 && existing.lockedUntil === undefined) {
      return { cleared: false };
    }

    await ctx.db.patch(existing._id, { attempts: 0, lockedUntil: undefined });
    return { cleared: true };
  },
});

export const recordLogout = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await requireUser(ctx);
    await ctx.db.insert("auditLogs", {
      userId,
      action: "logout",
      entity: "auth",
      entityId: String(userId),
      details: `Sessão encerrada por ${user.email ?? user.name ?? String(userId)}`,
      timestamp: Date.now(),
    });
    return true;
  },
});
/**
 * Bootstrap: reset password for an existing user (no login required).
 *
 * Safety:
 *  - Only targets users with role admin or stock_manager
 *  - Records the reset in auditLogs
 */
/**
 * INTERNAL: redefine senha de administrador/gerente sem exigir login.
 *
 * Plano de recuperação de acesso administrativo. Executável APENAS via CLI
 * do deployment (bunx convex run passwords:bootstrapResetPassword ...) ou
 * pelo dashboard — o cliente web NÃO consegue chamá-la.
 * Limpa a contagem residual de falhas para manter a auditoria consistente.
 */
export const bootstrapResetPassword = internalMutation({
  args: {
    email: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("E-mail é obrigatório");
    assertPasswordPolicy(args.newPassword);

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (!user) throw new Error(`Usuário não encontrado: ${email}`);

    // Safety: only allow reset for admin/stock_manager
    if (user.role !== "admin" && user.role !== "stock_manager") {
      throw new Error("Bootstrap só é permitido para administradores e gerentes de estoque");
    }

    const { hash, salt } = await hashPassword(args.newPassword);

    // Check if password record exists
    const existingPw = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existingPw) {
      await ctx.db.patch(existingPw._id, {
        passwordHash: hash,
        salt,
        requiresReset: false,
      });
    } else {
      await ctx.db.insert("passwords", {
        userId: user._id,
        passwordHash: hash,
        salt,
        requiresReset: false,
      });
    }
    await ctx.db.patch(user._id, { requiresPasswordReset: false });

    // Invalidate recovery codes issued before this administrative reset.
    await invalidatePendingPasswordResets(ctx, user._id);
    await ctx.scheduler.runAfter(0, internal.passwords.invalidateUserSessionsInternal, {
      userId: user._id,
    });

    // Clear residual failed-login counters after the credential reset.
    const failedAttempts = await ctx.db
      .query("failedLoginAttempts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (failedAttempts) {
      await ctx.db.patch(failedAttempts._id, { attempts: 0, lockedUntil: undefined });
    }

    await ctx.db.insert("auditLogs", {
      action: "password_reset",
      entity: "passwords",
      entityId: user._id,
      details: `Bootstrap: senha redefinida para ${user.name ?? email}`,
      timestamp: Date.now(),
    });

    return { message: `Senha redefinida para ${user.name ?? email}. Faça login.` };
  },
});
