import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

/** Require authenticated user and verify they exist in the users table. */
async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

/** Require admin role. */
async function requireAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  if (user.role !== "admin") throw new Error("Apenas administradores podem executar esta operação");
  return { userId, user };
}

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
    return await ctx.db.get(args.userId);
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return Promise.all(
      users.map(async (u: any) => {
        const org = u.organizationId ? await ctx.db.get(u.organizationId) : null;
        return { ...u, organization: org };
      })
    );
  },
});

export const createUser = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("stock_manager"),
      v.literal("director"),
      v.literal("secretary"),
      v.literal("technician")
    ),
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);

    // Validate email uniqueness
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q: any) => q.eq("email", args.email.toLowerCase()))
      .first();
    if (existing) throw new Error("Já existe um usuário com este e-mail");

    // Create user directly in the users table
    const newUserId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email.toLowerCase(),
      role: args.role,
      organizationId: args.organizationId,
      active: true,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "users",
      entityId: newUserId,
      details: `Usuário "${args.name}" criado com perfil "${args.role}"`,
      timestamp: Date.now(),
    });

    return newUserId;
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(v.union(
      v.literal("admin"),
      v.literal("stock_manager"),
      v.literal("director"),
      v.literal("secretary"),
      v.literal("technician")
    )),
    organizationId: v.optional(v.id("organizations")),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId: adminId, user: admin } = await requireAdmin(ctx);

    const { userId, ...updates } = args;

    // Prevent admin from deactivating themselves
    if (userId === adminId && updates.active === false) {
      throw new Error("Você não pode desativar sua própria conta");
    }

    // Prevent removing last admin
    if (updates.role && updates.role !== "admin") {
      const user = await ctx.db.get(userId);
      if (user?.role === "admin") {
        const admins = await ctx.db.query("users").withIndex("by_role", (q: any) => q.eq("role", "admin")).collect();
        if (admins.length <= 1) {
          throw new Error("Não é possível alterar o perfil do único administrador");
        }
      }
    }

    // Validate email uniqueness if changing email
    if (updates.email) {
      const existing = await ctx.db
        .query("users")
        .withIndex("email", (q: any) => q.eq("email", updates.email!.toLowerCase()))
        .first();
      if (existing && existing._id !== userId) {
        throw new Error("Já existe outro usuário com este e-mail");
      }
      updates.email = updates.email.toLowerCase();
    }

    await ctx.db.patch(userId, updates);

    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    const user = await ctx.db.get(userId);
    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action,
      entity: "users",
      entityId: userId,
      details: `Usuário "${user?.name}" — ${JSON.stringify(updates)}`,
      timestamp: Date.now(),
    });

    return userId;
  },
});

export const activateUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Usuário não encontrado");

    await ctx.db.patch(args.userId, { active: true });
    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action: "activate",
      entity: "users",
      entityId: args.userId,
      details: `Usuário "${user.name}" ativado`,
      timestamp: Date.now(),
    });

    return true;
  },
});

export const deactivateUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireAdmin(ctx);

    if (args.userId === adminId) {
      throw new Error("Você não pode desativar sua própria conta");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Usuário não encontrado");

    // Prevent deactivating last admin
    if (user.role === "admin") {
      const admins = await ctx.db.query("users").withIndex("by_role", (q: any) => q.eq("role", "admin")).collect();
      if (admins.length <= 1) {
        throw new Error("Não é possível desativar o único administrador");
      }
    }

    await ctx.db.patch(args.userId, { active: false });
    await ctx.db.insert("auditLogs", {
      userId: adminId,
      action: "deactivate",
      entity: "users",
      entityId: args.userId,
      details: `Usuário "${user.name}" desativado`,
      timestamp: Date.now(),
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
