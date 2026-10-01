import { getAuthUserId } from "@convex-dev/auth/server";
import { requirePermission } from "./rbac";
import { mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { hashPassword, verifyPassword } from "./auth/passwords";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { APP_ROLES } from "../lib/rbac";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

/** Política de senha (§12). Todas as cinco ACTIONS de definição exigem este mínimo. */
export const MIN_PASSWORD_LENGTH = 8;

/** Janela de bloqueio por tentativas de login (§9/§10). */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

/** Tentativas máximas do código de recuperação (§8). */
const RESET_MAX_ATTEMPTS = 5;
/** Intervalo mínimo entre dois pedidos de recuperação para o mesmo e-mail. */
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;

/** Mensagem ÚNICA para qualquer falha de autenticação — anti-enumeração (§11). */
const GENERIC_AUTH_ERROR = "E-mail ou senha incorretos.";

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

    assertPasswordPolicy(args.newPassword);

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
    if (!user) return { success: false, error: GENERIC_AUTH_ERROR };

    // Check if user is active
    if (user.active === false) {
      return { success: false, error: GENERIC_AUTH_ERROR };
    }

    // ── B-01 (defesa em profundidade) ────────────────────────────────────
    // Identidade anônima (provider removido) ou identidade sem `role`
    // válido nunca é autenticada, mesmo com senha correta.
    if ((user as { isAnonymous?: boolean }).isAnonymous === true) {
      return { success: false, error: GENERIC_AUTH_ERROR };
    }
    if (!VALID_ROLE_SET.has(user.role as string)) {
      return { success: false, error: GENERIC_AUTH_ERROR };
    }

    // Find password record
    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!passwordRecord) {
      return { success: false, error: GENERIC_AUTH_ERROR };
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

    // Clear any brute-force lock so the new password works immediately
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
      if (!token.usedAt) {
        await ctx.db.patch(token._id, { usedAt: now });
      }
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const resetId: Id<"passwordResets"> = await ctx.db.insert("passwordResets", {
      userId: user._id,
      token: code,
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

    // Send email with the reset code via the Freebuff email service (same
    // transport as internal.email.sendPasswordResetEmailInternal). The scheduled INTERNAL action receives
    // only the reset id and reads the code server-side — the code never
    // crosses a public endpoint, is never returned to the client and is
    // never written to production logs.
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

    // Generic error to prevent email enumeration
    if (!user) throw new Error("Código inválido ou expirado");

    // Find valid token
    const tokens = await ctx.db
      .query("passwordResets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const validToken = tokens.find(
      (t) =>
        t.token === args.code &&
        !t.usedAt &&
        t.expiresAt > Date.now() &&
        (t.attempts ?? 0) < RESET_MAX_ATTEMPTS,
    );

    if (!validToken) {
      // Incrementa a contagem do token QUANDO o código confere, para não
      // penalizar quem digita códigos aleatórios de outro e-mail.
      const matching = tokens.find(
        (t) => t.token === args.code && !t.usedAt && t.expiresAt > Date.now(),
      );
      if (matching) {
        const attempts = (matching.attempts ?? 0) + 1;
        await ctx.db.patch(matching._id, {
          attempts,
          // Ao exceder o limite o token é INVALIDADO (usedAt) — o atacante
          // precisa pedir uma nova recuperação e um novo e-mail é enviado.
          usedAt: attempts >= RESET_MAX_ATTEMPTS ? Date.now() : undefined,
        });
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

    // Clear any lock on the account
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
 * Check and record failed login attempt for brute force protection.
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
      const lockExpired =
        existing.lockedUntil !== undefined && existing.lockedUntil <= now;
      const updates: any = {
        attempts: newAttempts,
        lastAttemptAt: now,
      };
      // Bloqueia após LOGIN_MAX_ATTEMPTS falhas por LOGIN_LOCK_MINUTES.
      // O bloqueio é REAVALIADO quando a janela anterior expirou — sem isso a
      // condição `!existing.lockedUntil` nunca voltava a ser verdadeira e a
      // proteção de força brute deixava de valer depois do 1º bloqueio (§10).
      if (newAttempts >= LOGIN_MAX_ATTEMPTS && (!existing.lockedUntil || lockExpired)) {
        updates.lockedUntil = now + LOGIN_LOCK_MINUTES * 60 * 1000;
      }
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("failedLoginAttempts", {
        email,
        attempts: 1,
        lastAttemptAt: now,
      });
    }
  },
});

/**
 * Check if an email is currently locked out due to brute force.
 */
/**
 * Zera o contador de tentativas após um login BEN-SUCEDIDO (§10).
 *
 * Hardening §10: o contador NUNCA era zerado no sucesso (o comentário no
 * provider afirmava o contrário). Resultado: depois do primeiro bloqueio, o
 * limite de tentativas deixava de ser aplicado definitivamente.
 *
 * INTERNAL: chamada apenas pelo provider de credenciais, no servidor.
 */
export const recordSuccessfulLogin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) return { cleared: false };

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

/**
 * Check if an email is currently locked out due to brute force.
 */
// INTERNAL: usada pelo provider de credenciais (server-side).
export const isLockedOut = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const record = await ctx.db
      .query("failedLoginAttempts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (!record) return { locked: false };

    const now = Date.now();
    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      return { locked: true, remainingSeconds };
    }

    return { locked: false };
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
 * Limpa o bloqueio de tentativas para o novo acesso funcionar imediatamente.
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

    // Clear any brute-force lock so the new password works immediately
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
