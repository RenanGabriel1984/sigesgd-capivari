import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado");
  return { userId, user };
}

async function requireManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar equipamentos");
  }
  return { userId, user };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const list = query({
  args: {
    status: v.optional(v.string()),
    assetType: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
    responsibleUserId: v.optional(v.id("users")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let assets = await ctx.db.query("assets").order("desc").take(500);

    if (args.status) assets = assets.filter((a: any) => a.status === args.status);
    if (args.assetType) assets = assets.filter((a: any) => a.assetType === args.assetType);
    if (args.organizationId) assets = assets.filter((a: any) => a.organizationId === args.organizationId);
    if (args.responsibleUserId) assets = assets.filter((a: any) => a.responsibleUserId === args.responsibleUserId);

    if (args.search) {
      const s = args.search.toLowerCase();
      assets = assets.filter((a: any) =>
        (a.patrimonyNumber ?? "").toLowerCase().includes(s) ||
        (a.serialNumber ?? "").toLowerCase().includes(s) ||
        (a.hostname ?? "").toLowerCase().includes(s) ||
        (a.manufacturer ?? "").toLowerCase().includes(s) ||
        (a.model ?? "").toLowerCase().includes(s)
      );
    }

    return Promise.all(assets.map(async (a: any) => {
      const org = a.organizationId ? await ctx.db.get(a.organizationId) : null;
      const responsible = a.responsibleUserId ? await ctx.db.get(a.responsibleUserId) : null;
      return { ...a, organization: org, responsible };
    }));
  },
});

export const get = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const org = asset.organizationId ? await ctx.db.get(asset.organizationId) : null;
    const responsible = asset.responsibleUserId ? await ctx.db.get(asset.responsibleUserId) : null;
    const location = asset.storageLocationId ? await ctx.db.get(asset.storageLocationId) : null;

    // Get installed parts
    const parts = await ctx.db
      .query("assetParts")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();
    const partsWithDetails = await Promise.all(parts.map(async (p: any) => {
      const product = await ctx.db.get(p.productId);
      return { ...p, product };
    }));

    // Get licenses assigned
    const assignments = await ctx.db
      .query("licenseAssignments")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();
    const licensesWithDetails = await Promise.all(assignments.map(async (a: any) => {
      const license = await ctx.db.get(a.licenseId);
      return { ...a, license };
    }));

    // Get maintenances
    const maintenances = await ctx.db
      .query("assetMaintenances")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .order("desc")
      .take(50);
    const maintWithDetails = await Promise.all(maintenances.map(async (m: any) => {
      const tech = await ctx.db.get(m.technicianUserId);
      return { ...m, technician: tech };
    }));

    // Get history
    const history = await ctx.db
      .query("assetHistory")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .order("desc")
      .take(100);
    const histWithDetails = await Promise.all(history.map(async (h: any) => {
      const user = await ctx.db.get(h.userId);
      return { ...h, user };
    }));

    return {
      ...asset,
      organization: org,
      responsible,
      location,
      parts: partsWithDetails,
      licenses: licensesWithDetails,
      maintenances: maintWithDetails,
      history: histWithDetails,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const create = mutation({
  args: {
    patrimonyNumber: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    assetType: v.string(),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    hostname: v.optional(v.string()),
    macAddress: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
    responsibleUserId: v.optional(v.id("users")),
    storageLocationId: v.optional(v.id("storageLocations")),
    acquisitionDate: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const now = Date.now();

    const assetId = await ctx.db.insert("assets", {
      patrimonyNumber: args.patrimonyNumber || undefined,
      serialNumber: args.serialNumber || undefined,
      assetType: args.assetType as any,
      manufacturer: args.manufacturer || undefined,
      model: args.model || undefined,
      hostname: args.hostname || undefined,
      macAddress: args.macAddress || undefined,
      organizationId: args.organizationId || undefined,
      responsibleUserId: args.responsibleUserId || undefined,
      storageLocationId: args.storageLocationId || undefined,
      status: "active",
      acquisitionDate: args.acquisitionDate || undefined,
      observation: args.observation || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create history entry
    await ctx.db.insert("assetHistory", {
      assetId,
      eventType: "created",
      userId,
      newOrganizationId: args.organizationId || undefined,
      newResponsibleUserId: args.responsibleUserId || undefined,
      newStatus: "active",
      observation: args.observation || undefined,
      timestamp: now,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_create",
      entity: "assets",
      entityId: assetId,
      details: `Equipamento criado: ${args.patrimonyNumber ?? "s/ patrimônio"} — ${args.manufacturer ?? ""} ${args.model ?? ""}`.trim(),
      timestamp: now,
    });

    return assetId;
  },
});

export const update = mutation({
  args: {
    assetId: v.id("assets"),
    patrimonyNumber: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    assetType: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    hostname: v.optional(v.string()),
    macAddress: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();
    const updates: Record<string, any> = { updatedAt: now };

    if (args.patrimonyNumber !== undefined) updates.patrimonyNumber = args.patrimonyNumber || undefined;
    if (args.serialNumber !== undefined) updates.serialNumber = args.serialNumber || undefined;
    if (args.assetType !== undefined) updates.assetType = args.assetType;
    if (args.manufacturer !== undefined) updates.manufacturer = args.manufacturer || undefined;
    if (args.model !== undefined) updates.model = args.model || undefined;
    if (args.hostname !== undefined) updates.hostname = args.hostname || undefined;
    if (args.macAddress !== undefined) updates.macAddress = args.macAddress || undefined;
    if (args.observation !== undefined) updates.observation = args.observation || undefined;

    await ctx.db.patch(args.assetId, updates);

    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_update",
      entity: "assets",
      entityId: args.assetId,
      details: `Equipamento atualizado`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const assign = mutation({
  args: {
    assetId: v.id("assets"),
    responsibleUserId: v.optional(v.id("users")),
    organizationId: v.optional(v.id("organizations")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();
    const previousResponsible = asset.responsibleUserId;
    const previousOrg = asset.organizationId;

    await ctx.db.patch(args.assetId, {
      responsibleUserId: args.responsibleUserId || undefined,
      organizationId: args.organizationId || undefined,
      updatedAt: now,
    });

    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "assigned",
      userId,
      previousOrganizationId: previousOrg || undefined,
      newOrganizationId: args.organizationId || asset.organizationId || undefined,
      previousResponsibleUserId: previousResponsible || undefined,
      newResponsibleUserId: args.responsibleUserId || asset.responsibleUserId || undefined,
      observation: args.observation || undefined,
      timestamp: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_assign",
      entity: "assets",
      entityId: args.assetId,
      details: `Equipamento atribuído`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const transfer = mutation({
  args: {
    assetId: v.id("assets"),
    organizationId: v.id("organizations"),
    storageLocationId: v.optional(v.id("storageLocations")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();

    await ctx.db.patch(args.assetId, {
      organizationId: args.organizationId,
      storageLocationId: args.storageLocationId || asset.storageLocationId,
      updatedAt: now,
    });

    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "relocated",
      userId,
      previousOrganizationId: asset.organizationId || undefined,
      newOrganizationId: args.organizationId,
      observation: args.observation || undefined,
      timestamp: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_transfer",
      entity: "assets",
      entityId: args.assetId,
      details: `Equipamento transferido`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const changeStatus = mutation({
  args: {
    assetId: v.id("assets"),
    newStatus: v.string(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();
    const previousStatus = asset.status;

    await ctx.db.patch(args.assetId, {
      status: args.newStatus as any,
      active: args.newStatus !== "disposed" && args.newStatus !== "lost",
      updatedAt: now,
    });

    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: args.newStatus === "disposed" ? "disposed" : "status_changed",
      userId,
      previousStatus,
      newStatus: args.newStatus,
      observation: args.observation || undefined,
      timestamp: now,
    });

    const actionType = args.newStatus === "disposed" ? "asset_disposal" : "asset_update";
    await ctx.db.insert("auditLogs", {
      userId,
      action: actionType as any,
      entity: "assets",
      entityId: args.assetId,
      details: `Status: ${previousStatus} → ${args.newStatus}`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const history = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const entries = await ctx.db
      .query("assetHistory")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .order("desc")
      .take(100);

    return Promise.all(entries.map(async (h: any) => {
      const user = await ctx.db.get(h.userId);
      return { ...h, user };
    }));
  },
});
