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
