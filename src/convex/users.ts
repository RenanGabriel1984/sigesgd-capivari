import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, internalMutation, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { hashPassword } from "./auth/passwords";
import { requirePermission } from "./rbac";
import { internal } from "./_generated/api";
import {
  describeDuplicateCredential,
  resolveUniqueRecord,
} from "../lib/credential-integrity";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician" | "patrimony_manager";

async function requireUser(ctx: any) {
  // Compatibilidade: wrapper fino sobre a camada central src/lib/rbac.ts
  const auth = await requirePermission(ctx, "users.view");
  return auth;
}

async function requireUserManager(ctx: any) {
  // Admin e secretary têm o mesmo conjunto de permissões na matriz central.
  // A autorização deve seguir users.manage, sem restringir indevidamente ao
  // rótulo literal "admin".
  return requirePermission(ctx, "users.manage", { entity: "users" });
}
function normalizeUserEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Informe um e-mail válido.");
  }
  return email;
}

function normalizeUserName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new Error("O nome deve ter entre 1 e 120 caracteres.");
  }
  return name;
}


// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Bootstrap do primeiro administrador.
 *
 * Hardening B-01/§15: era uma MUTATION PÚBLICA sem autenticação, protegida
 * apenas pela condição "não existem usuários". Isso é insuficiente — qualquer
 * visitante poderia criar um administrador se a tabela fosse esvaziada.
 *
 * Agora é INTERNALMutation: executável somente via CLI/dashboard do
 * deployment (`bunx convex run users:bootstrapAdmin '{...}'`), nunca pelo
 * cliente. A proteção de "zero usuários" continua valendo.
 *
 * O bootstrap canônico do SIGESGD é `passwords.bootstrapAdmin` (internal).
 */
export const bootstrapAdmin = internalMutation({
  args: { name: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const existingUsers = await ctx.db.query("users").first();
    if (existingUsers) {
      throw new Error("Já existem usuários no sistema. Use o painel administrativo para criar novos usuários.");
    }
    if (!args.name.trim()) throw new Error("Nome é obrigatório");
    if (!args.email.trim()) throw new Error("E-mail é obrigatório");
    if (args.password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres");

    const email = args.email.trim().toLowerCase();
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: args.name.trim(), email, role: "admin", active: true,
      createdAt: now, updatedAt: now,
    });
    const { hash, salt } = await hashPassword(args.password);
    await ctx.db.insert("passwords", { userId, passwordHash: hash, salt, requiresReset: false });
    await ctx.db.insert("auditLogs", {
      action: "create", entity: "users", entityId: userId,
      details: `Primeiro administrador "${args.name}" criado via bootstrap`, timestamp: Date.now(),
    });
    return { userId, message: "Administrador criado com sucesso. Faça login com as credenciais definidas." };
  },
});

// ─── Queries ─────────────────────────────────────────────────────────────────

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    return user;
  },
});

export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.db.get(args.userId);
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    // RBAC central: a listagem completa (com PII) exige users.manage
    // (admin/secretary). Consumidores operacionais que só precisam de
    // nome/ID para pickers usam `listUserOptions`.
    await requirePermission(ctx, "users.manage", { entity: "users" });
    const [users, passwordRecords] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("passwords").collect(),
    ]);
    const passwordCounts = new Map<string, number>();
    for (const record of passwordRecords) {
      const key = String(record.userId);
      passwordCounts.set(key, (passwordCounts.get(key) ?? 0) + 1);
    }
    return Promise.all(users.map(async (user) => {
      const organization = user.organizationId
        ? await ctx.db.get(user.organizationId)
        : null;
      const passwordRecordCount = passwordCounts.get(String(user._id)) ?? 0;
      return {
        ...user,
        organization,
        hasPassword: passwordRecordCount > 0,
        passwordRecordCount,
      };
    }));
  },
});

/**
 * Opções mínimas de usuário (id, nome, papel, ativo) para pickers operacionais
 * (ex.: "quem recebeu" na entrega de requisições). Sem e-mail ou dados adicionais.
 */
export const listUserOptions = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "requests.view");
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u: any) => u.active !== false && !!u.role)
      .map((u: any) => ({ _id: u._id as string, name: (u.name ?? null) as string | null, role: (u.role ?? null) as string | null, active: (u.active ?? true) as boolean }));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Cria usuário e credencial em uma única transação.
 * Evita deixar contas sem senha caso a segunda chamada falhe no cliente.
 */
export const createUserWithPassword = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("stock_manager"), v.literal("director"), v.literal("secretary"), v.literal("technician"), v.literal("patrimony_manager")),
    organizationId: v.optional(v.id("organizations")),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireUserManager(ctx);
    const name = normalizeUserName(args.name);
    const email = normalizeUserEmail(args.email);
    if (args.temporaryPassword.length < 8 || args.temporaryPassword.length > 200) {
      throw new Error("A senha temporária deve ter entre 8 e 200 caracteres.");
    }
    const existingRows = await ctx.db.query("users")
      .withIndex("email", (q: any) => q.eq("email", email))
      .collect();
    const existing = resolveUniqueRecord(existingRows);
    if (existing.status === "ambiguous") {
      throw new Error(describeDuplicateCredential(existing.count));
    }
    if (existing.status === "unique") {
      throw new Error("Já existe um usuário com este e-mail.");
    }

    if (args.organizationId) {
      const organization = await ctx.db.get(args.organizationId);
      if (!organization || organization.active === false) {
        throw new Error("Secretaria/departamento não encontrado ou inativo.");
      }
    }

    const now = Date.now();
    const newUserId = await ctx.db.insert("users", {
      name,
      email,
      role: args.role,
      organizationId: args.organizationId,
      active: true,
      requiresPasswordReset: true,
      createdAt: now,
      updatedAt: now,
    });
    const { hash, salt } = await hashPassword(args.temporaryPassword);
    const passwordId = await ctx.db.insert("passwords", {
      userId: newUserId,
      passwordHash: hash,
      salt,
      requiresReset: true,
    });

    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action: "create",
      entity: "users",
      entityId: newUserId,
      details: `Usuário "${name}" criado com perfil "${args.role}" e credencial temporária configurada.`,
      timestamp: now,
    });
    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action: "create",
      entity: "passwords",
      entityId: passwordId,
      details: `Senha temporária definida para o usuário "${name}"; troca obrigatória no primeiro acesso.`,
      timestamp: now,
    });
    return newUserId;
  },
});

export const createUser = mutation({
  args: {
    name: v.string(), email: v.string(),
    role: v.union(v.literal("admin"), v.literal("stock_manager"), v.literal("director"), v.literal("secretary"), v.literal("technician"), v.literal("patrimony_manager")),
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUserManager(ctx);
    const name = normalizeUserName(args.name);
    const email = normalizeUserEmail(args.email);
    const existingRows = await ctx.db.query("users")
      .withIndex("email", (q: any) => q.eq("email", email))
      .collect();
    const existing = resolveUniqueRecord(existingRows);
    if (existing.status === "ambiguous") {
      throw new Error(describeDuplicateCredential(existing.count));
    }
    if (existing.status === "unique") {
      throw new Error("Já existe um usuário com este e-mail");
    }
    if (args.organizationId) {
      const organization = await ctx.db.get(args.organizationId);
      if (!organization || organization.active === false) {
        throw new Error("Secretaria/departamento não encontrado ou inativo.");
      }
    }

    const now = Date.now();
    const newUserId = await ctx.db.insert("users", {
      name, email, role: args.role,
      organizationId: args.organizationId, active: true,
      createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "users", entityId: newUserId,
      details: `Usuário "${args.name}" criado com perfil "${args.role}"`, timestamp: Date.now(),
    });
    return newUserId;
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"), name: v.optional(v.string()), email: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("stock_manager"), v.literal("director"), v.literal("secretary"), v.literal("technician"), v.literal("patrimony_manager"))),
    organizationId: v.optional(v.id("organizations")), active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireUserManager(ctx);
    const { userId, ...updates } = args;

    if (userId === adminId && updates.active === false) {
      throw new Error("Você não pode desativar sua própria conta");
    }
    const targetUser = await ctx.db.get(userId);
    if (!targetUser) throw new Error("Usuário não encontrado");
    // admin e secretary possuem o mesmo acesso integral na matriz RBAC.
    // Ambos contam como gestores de usuários para evitar lockout administrativo.
    const targetIsUserManager = targetUser.role === "admin" || targetUser.role === "secretary";
    const remainsUserManager = updates.role === undefined ||
      updates.role === "admin" || updates.role === "secretary";
    const removesActiveAdmin = targetIsUserManager &&
      targetUser.active !== false &&
      (updates.active === false || (updates.role !== undefined && !remainsUserManager));
    if (removesActiveAdmin) {
      const [admins, secretaries] = await Promise.all([
        ctx.db.query("users").withIndex("by_role", (q: any) => q.eq("role", "admin")).collect(),
        ctx.db.query("users").withIndex("by_role", (q: any) => q.eq("role", "secretary")).collect(),
      ]);
      const activeUserManagers = [...admins, ...secretaries]
        .filter((manager: any) => manager.active !== false);
      if (activeUserManagers.length <= 1) {
        throw new Error("Não é possível desativar ou rebaixar o último administrador/secretário com acesso integral");
      }
    }
    if (updates.name !== undefined) {
      updates.name = normalizeUserName(updates.name);
    }
    if (updates.email !== undefined) {
      const email = normalizeUserEmail(updates.email);
      const existingRows = await ctx.db.query("users")
        .withIndex("email", (q: any) => q.eq("email", email))
        .collect();
      const otherAccounts = existingRows.filter((record: any) => record._id !== userId);
      if (otherAccounts.length > 0) {
        throw new Error(otherAccounts.length > 1
          ? describeDuplicateCredential(otherAccounts.length + 1)
          : "Já existe outro usuário com este e-mail");
      }
      updates.email = email;
    }
    if (updates.organizationId) {
      const organization = await ctx.db.get(updates.organizationId);
      if (!organization || organization.active === false) {
        throw new Error("Secretaria/departamento não encontrado ou inativo.");
      }
    }

    await ctx.db.patch(userId, { ...updates, updatedAt: Date.now() });
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    const user = await ctx.db.get(userId);
    await ctx.db.insert("auditLogs", {
      userId: adminId, action, entity: "users", entityId: userId,
      details: `Usuário "${user?.name}" — ${JSON.stringify(updates)}`, timestamp: Date.now(),
    });
    const securityProfileChanged =
      updates.active === false ||
      (updates.role !== undefined && updates.role !== targetUser.role) ||
      (updates.email !== undefined && updates.email !== targetUser.email);
    if (securityProfileChanged) {
      await ctx.scheduler.runAfter(0, internal.passwords.invalidateUserSessionsInternal, {
        userId,
      });
      await ctx.scheduler.runAfter(0, internal.passwords.invalidatePasswordResetsForUserInternal, {
        userId,
      });
    }
    return userId;
  },
});

export const activateUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireUserManager(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Usuário não encontrado");
    await ctx.db.patch(args.userId, { active: true, updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId: adminId, action: "activate", entity: "users", entityId: args.userId,
      details: `Usuário "${user.name}" ativado`, timestamp: Date.now(),
    });
    return true;
  },
});

export const deactivateUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireUserManager(ctx);
    if (args.userId === adminId) throw new Error("Você não pode desativar sua própria conta");
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Usuário não encontrado");
    if ((user.role === "admin" || user.role === "secretary") && user.active !== false) {
      const [admins, secretaries] = await Promise.all([
        ctx.db.query("users").withIndex("by_role", (q: any) => q.eq("role", "admin")).collect(),
        ctx.db.query("users").withIndex("by_role", (q: any) => q.eq("role", "secretary")).collect(),
      ]);
      const activeUserManagers = [...admins, ...secretaries]
        .filter((manager: any) => manager.active !== false);
      if (activeUserManagers.length <= 1) {
        throw new Error("Não é possível desativar o último administrador/secretário com acesso integral");
      }
    }
    await ctx.db.patch(args.userId, { active: false, updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId: adminId, action: "deactivate", entity: "users", entityId: args.userId,
      details: `Usuário "${user.name}" desativado`, timestamp: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.passwords.invalidateUserSessionsInternal, {
      userId: args.userId,
    });
    await ctx.scheduler.runAfter(0, internal.passwords.invalidatePasswordResetsForUserInternal, {
      userId: args.userId,
    });
    return true;
  },
});

export const recordLogin = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    await ctx.db.patch(userId, { lastLoginAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId, action: "login", entity: "users", entityId: userId, timestamp: Date.now(),
    });
  },
});

export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
};
