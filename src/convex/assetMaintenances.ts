import { requirePermission } from "./rbac";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician" | "patrimony_manager";

const ASSET_MAINTENANCE_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
const assetMaintenanceStatusValidator = v.union(...ASSET_MAINTENANCE_STATUSES.map((status) => v.literal(status)));

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
    status: assetMaintenanceStatusValidator,
    observation: v.optional(v.string()),
    partsUsed: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");
    if (asset.status === "disposed" || asset.status === "lost") {
      throw new Error("Não é possível registrar manutenção para equipamento baixado ou extraviado.");
    }
    if (!Number.isSafeInteger(args.date) || args.date <= 0) {
      throw new Error("Data da manutenção inválida.");
    }
    if (!args.reason.trim() || !args.serviceDescription.trim()) {
      throw new Error("Informe o motivo e a descrição do serviço.");
    }
    const technician = await ctx.db.get(args.technicianUserId);
    if (!technician || technician.active === false) {
      throw new Error("Técnico responsável não encontrado ou inativo.");
    }

    const now = Date.now();

    const maintenanceId = await ctx.db.insert("assetMaintenances", {
      assetId: args.assetId,
      date: args.date,
      technicianUserId: args.technicianUserId,
      reason: args.reason,
      serviceDescription: args.serviceDescription,
      osNumber: args.osNumber || undefined,
      status: args.status,
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
    status: assetMaintenanceStatusValidator,
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const maintenance = await ctx.db.get(args.maintenanceId);
    if (!maintenance) throw new Error("Manutenção não encontrada");

    const now = Date.now();
    if (maintenance.status === args.status && args.observation === undefined) {
      return args.maintenanceId;
    }
    const observation = args.observation === undefined
      ? maintenance.observation
      : args.observation.trim() || undefined;

    await ctx.db.patch(args.maintenanceId, {
      status: args.status,
      observation,
    });

    const asset = await ctx.db.get(maintenance.assetId);
    await ctx.db.insert("assetHistory", {
      assetId: maintenance.assetId,
      eventType: "maintenance",
      userId,
      observation: "Status da manutenção #" + String(args.maintenanceId) + ": " + maintenance.status + " → " + args.status,
      timestamp: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_maintenance",
      entity: "assetMaintenances",
      entityId: args.maintenanceId,
      details: "Manutenção em " + (asset?.patrimonyNumber ?? "equipamento") + ": status alterado de " + maintenance.status + " para " + args.status,
      timestamp: now,
    });

    return args.maintenanceId;
  },
});
