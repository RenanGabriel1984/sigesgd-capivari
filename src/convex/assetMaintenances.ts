import { requirePermission } from "./rbac";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: consulta de manutenções (visão de equipamentos).
  return requirePermission(ctx, "equipment.view");
}

async function requireManagerOrAdmin(ctx: any) {
  // RBAC central: registrar/editar manutenções.
  return requirePermission(ctx, "equipment.manage", { entity: "assetMaintenances" });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const listByAsset = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const maintenances = await ctx.db
      .query("assetMaintenances")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .order("desc")
      .take(50);

    return Promise.all(maintenances.map(async (m: any) => {
      const tech = await ctx.db.get(m.technicianUserId);
      return { ...m, technician: tech };
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const create = mutation({
  args: {
    assetId: v.id("assets"),
    date: v.number(),
    technicianUserId: v.id("users"),
    reason: v.string(),
    serviceDescription: v.string(),
    osNumber: v.optional(v.string()),
    status: v.string(),
    observation: v.optional(v.string()),
    partsUsed: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();

    const maintenanceId = await ctx.db.insert("assetMaintenances", {
      assetId: args.assetId,
      date: args.date,
      technicianUserId: args.technicianUserId,
      reason: args.reason,
      serviceDescription: args.serviceDescription,
      osNumber: args.osNumber || undefined,
      status: args.status as any,
      observation: args.observation || undefined,
      partsUsed: args.partsUsed || undefined,
      createdAt: now,
    });

    // Asset history
    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "maintenance",
      userId,
      observation: `Manutenção: ${args.reason} — ${args.serviceDescription}`,
      timestamp: now,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_maintenance",
      entity: "assetMaintenances",
      entityId: maintenanceId,
      details: `Manutenção em ${asset.patrimonyNumber ?? "equipamento"}: ${args.reason}`,
      timestamp: now,
    });

    return maintenanceId;
  },
});

export const updateStatus = mutation({
  args: {
    maintenanceId: v.id("assetMaintenances"),
    status: v.string(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const maintenance = await ctx.db.get(args.maintenanceId);
    if (!maintenance) throw new Error("Manutenção não encontrada");

    await ctx.db.patch(args.maintenanceId, {
      status: args.status as any,
      observation: args.observation || maintenance.observation,
    });

    return args.maintenanceId;
  },
});
