import { query } from "./_generated/server";
import { v } from "convex/values";

/** List audit logs with user info. */
export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);

    return Promise.all(
      logs.map(async (log) => {
        const user = log.userId ? await ctx.db.get(log.userId) : null;
        return { ...log, user };
      })
    );
  },
});

/** List audit logs by entity. */
export const byEntity = query({
  args: {
    entity: v.string(),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("auditLogs")
      .withIndex("by_entity", (q) => q.eq("entity", args.entity));

    const logs = await q.order("desc").take(100);

    const filtered = args.entityId
      ? logs.filter((l) => l.entityId === args.entityId)
      : logs;

    return Promise.all(
      filtered.map(async (log) => {
        const user = log.userId ? await ctx.db.get(log.userId) : null;
        return { ...log, user };
      })
    );
  },
});

/** List audit logs with filters */
export const listFiltered = query({
  args: {
    userId: v.optional(v.id("users")),
    action: v.optional(v.string()),
    entity: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 300;

    // Try to use index if possible, otherwise scan
    let logs;
    if (args.action) {
      logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_action", (q) => q.eq("action", args.action as any))
        .order("desc")
        .take(limit * 3); // over-fetch for filters
    } else if (args.entity) {
      logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_entity", (q) => q.eq("entity", args.entity!))
        .order("desc")
        .take(limit * 3);
    } else {
      logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_timestamp")
        .order("desc")
        .take(limit * 3);
    }

    // Apply remaining filters
    let filtered = logs;
    if (args.userId) {
      filtered = filtered.filter((l) => l.userId === args.userId);
    }
    if (args.action && logs !== filtered) {
      filtered = filtered.filter((l) => l.action === args.action);
    }
    if (args.entity && logs !== filtered) {
      filtered = filtered.filter((l) => l.entity === args.entity);
    }
    if (args.startDate) {
      filtered = filtered.filter((l) => l.timestamp >= args.startDate!);
    }
    if (args.endDate) {
      filtered = filtered.filter((l) => l.timestamp <= args.endDate!);
    }

    return Promise.all(
      filtered.slice(0, limit).map(async (log) => {
        const user = log.userId ? await ctx.db.get(log.userId) : null;
        return { ...log, user };
      })
    );
  },
});
