import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** List all organizations. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    // Build tree structure
    const byParent: Record<string, typeof orgs> = {};
    for (const org of orgs) {
      const key = org.parentId ?? "root";
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(org);
    }
    return { orgs, byParent };
  },
});

/** Get a single organization. */
export const get = query({
  args: { id: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Create an organization. */
export const create = mutation({
  args: {
    name: v.string(),
    type: v.union(
      v.literal("prefeitura"),
      v.literal("paco_municipal"),
      v.literal("gabinete"),
      v.literal("secretaria"),
      v.literal("departamento"),
      v.literal("unidade")
    ),
    parentId: v.optional(v.id("organizations")),
    observation: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const id = await ctx.db.insert("organizations", {
      ...args,
      active: true,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "organizations",
      entityId: id,
      details: `Organização "${args.name}" criada`,
      timestamp: Date.now(),
    });

    return id;
  },
});

/** Update an organization. */
export const update = mutation({
  args: {
    id: v.id("organizations"),
    name: v.optional(v.string()),
    type: v.optional(v.union(
      v.literal("prefeitura"),
      v.literal("paco_municipal"),
      v.literal("gabinete"),
      v.literal("secretaria"),
      v.literal("departamento"),
      v.literal("unidade")
    )),
    parentId: v.optional(v.id("organizations")),
    active: v.optional(v.boolean()),
    observation: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
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
      entity: "organizations",
      entityId: id,
      details: JSON.stringify(updates),
      timestamp: Date.now(),
    });

    return id;
  },
});
