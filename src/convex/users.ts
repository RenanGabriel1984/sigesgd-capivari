import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

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
      users.map(async (u) => {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Não autenticado");
    const existing = await ctx.db.get(userId);
    if (existing) {
      await ctx.db.patch(userId, {
        name: args.name, email: args.email, role: args.role,
        organizationId: args.organizationId, active: true,
      });
      return userId;
    }
    await ctx.db.patch(userId, {
      name: args.name, email: args.email, role: args.role,
      organizationId: args.organizationId, active: true,
    });
    return userId;
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
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Não autenticado");
    const { userId, ...updates } = args;
    await ctx.db.patch(userId, updates);
    await ctx.db.insert("auditLogs", {
      userId: authUserId,
      action: updates.active === false ? "deactivate" : "update",
      entity: "users",
      entityId: userId,
      details: JSON.stringify(updates),
      timestamp: Date.now(),
    });
    return userId;
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
