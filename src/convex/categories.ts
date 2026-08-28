import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** List all categories. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("categories").collect();
  },
});

/** List active categories only. */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("categories")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

/** Create a category. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const id = await ctx.db.insert("categories", {
      ...args,
      active: true,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "categories",
      entityId: id,
      details: `Categoria "${args.name}" criada`,
      timestamp: Date.now(),
    });

    return id;
  },
});

/** Update a category. */
export const update = mutation({
  args: {
    id: v.id("categories"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);

    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId,
      action,
      entity: "categories",
      entityId: id,
      details: JSON.stringify(updates),
      timestamp: Date.now(),
    });

    return id;
  },
});
