import { query } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

async function requireUser(ctx: any) {
  // RBAC central: auditoria é restrita a administração.
  return requirePermission(ctx, "audit.view");
}

const DEFAULT_AUDIT_LIMIT = 100;
const MAX_AUDIT_LIMIT = 500;
const MAX_AUDIT_SCAN = 5_000;

function validateLimit(limit: number | undefined, fallback: number): number {
  const value = limit ?? fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AUDIT_LIMIT) {
    throw new Error(`O limite de consulta deve estar entre 1 e ${MAX_AUDIT_LIMIT}.`);
  }
  return value;
}

function validateDateRange(startDate?: number, endDate?: number): void {
  if (startDate !== undefined && (!Number.isSafeInteger(startDate) || startDate < 0)) {
    throw new Error("A data inicial da auditoria é inválida.");
  }
  if (endDate !== undefined && (!Number.isSafeInteger(endDate) || endDate < 0)) {
    throw new Error("A data final da auditoria é inválida.");
  }
  if (startDate !== undefined && endDate !== undefined && startDate > endDate) {
    throw new Error("A data inicial não pode ser posterior à data final.");
  }
}

async function attachMinimalUser(ctx: any, logs: any[]) {
  return Promise.all(
    logs.map(async (log) => {
      const user = log.userId ? await ctx.db.get(log.userId) : null;
      return {
        ...log,
        user: user
          ? { _id: user._id, name: user.name, email: user.email, role: user.role }
          : null,
      };
    }),
  );
}

/** List audit logs with user info. */
export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const limit = validateLimit(args.limit, DEFAULT_AUDIT_LIMIT);
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
    return attachMinimalUser(ctx, logs);
  },
});

/** List audit logs by entity, optionally narrowed to one exact entity record. */
export const byEntity = query({
  args: {
    entity: v.string(),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const base = ctx.db.query("auditLogs");
    const logs = args.entityId
      ? await base
          .withIndex("by_entity_entityId", (q: any) =>
            q.eq("entity", args.entity).eq("entityId", args.entityId),
          )
          .order("desc")
          .take(100)
      : await base
          .withIndex("by_entity", (q: any) => q.eq("entity", args.entity))
          .order("desc")
          .take(100);
    return attachMinimalUser(ctx, logs);
  },
});

/** List audit logs with filters. All supplied filters are applied together. */
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
    await requireUser(ctx);
    const limit = validateLimit(args.limit, 300);
    validateDateRange(args.startDate, args.endDate);

    const scanLimit = Math.min(limit * 10, MAX_AUDIT_SCAN);
    let logs;

    // When a date range is present, constrain the timestamp index before
    // applying other filters. This prevents old date queries from being
    // accidentally limited to only the newest global audit records.
    if (args.startDate !== undefined || args.endDate !== undefined) {
      logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_timestamp", (index: any) => {
          let range = index;
          if (args.startDate !== undefined) range = range.gte("timestamp", args.startDate);
          if (args.endDate !== undefined) range = range.lte("timestamp", args.endDate);
          return range;
        })
        .order("desc")
        .take(scanLimit);
    } else if (args.action) {
      logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_action", (q: any) => q.eq("action", args.action))
        .order("desc")
        .take(scanLimit);
    } else if (args.entity) {
      logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_entity", (q: any) => q.eq("entity", args.entity))
        .order("desc")
        .take(scanLimit);
    } else {
      logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_timestamp")
        .order("desc")
        .take(scanLimit);
    }

    // Do not condition these filters on whether a previous filter ran:
    // combining action + entity + user previously skipped some conditions.
    let filtered = logs;
    if (args.userId) filtered = filtered.filter((log) => log.userId === args.userId);
    if (args.action) filtered = filtered.filter((log) => log.action === args.action);
    if (args.entity) filtered = filtered.filter((log) => log.entity === args.entity);
    if (args.startDate !== undefined) {
      filtered = filtered.filter((log) => log.timestamp >= args.startDate!);
    }
    if (args.endDate !== undefined) {
      filtered = filtered.filter((log) => log.timestamp <= args.endDate!);
    }

    return attachMinimalUser(ctx, filtered.slice(0, limit));
  },
});
