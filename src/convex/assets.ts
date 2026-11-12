import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { findEquipmentCategory, buildRelatedStockProducts } from "../lib/equipment-categories";
import type { RelatedStockProduct } from "../lib/equipment-categories";
import { maskLicenseKey } from "../lib/license-keys";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

const ASSET_TYPES = [
  "desktop", "notebook", "monitor", "server", "printer", "switch",
  "router", "access_point", "ups", "storage", "phone", "other",
] as const;
const ASSET_STATUSES = [
  "active", "maintenance", "inactive", "disposal_pending", "disposed", "lost",
] as const;

function normalizeAssetIdentifier(value?: string): string | undefined {
  const normalized = value?.trim().toLocaleUpperCase("pt-BR");
  return normalized || undefined;
}

async function assertAssetIdentifiersAvailable(
  ctx: any,
  input: { patrimonyNumber?: string; serialNumber?: string; macAddress?: string },
  excludeAssetId?: string,
): Promise<void> {
  const patrimony = normalizeAssetIdentifier(input.patrimonyNumber);
  const serial = normalizeAssetIdentifier(input.serialNumber);
  const mac = normalizeAssetIdentifier(input.macAddress);
  if (!patrimony && !serial && !mac) return;

  const assets = await ctx.db.query("assets").collect();
  const duplicate = assets.find((asset: any) => {
    if (excludeAssetId && String(asset._id) === excludeAssetId) return false;
    return (
      (!!patrimony && normalizeAssetIdentifier(asset.patrimonyNumber) === patrimony) ||
      (!!serial && normalizeAssetIdentifier(asset.serialNumber) === serial) ||
      (!!mac && normalizeAssetIdentifier(asset.macAddress) === mac)
    );
  });
  if (!duplicate) return;
  if (patrimony && normalizeAssetIdentifier(duplicate.patrimonyNumber) === patrimony) {
    throw new Error(`Já existe equipamento cadastrado com o patrimônio "${patrimony}".`);
  }
  if (serial && normalizeAssetIdentifier(duplicate.serialNumber) === serial) {
    throw new Error(`Já existe equipamento cadastrado com o número de série "${serial}".`);
  }
  throw new Error(`Já existe equipamento cadastrado com o endereço MAC "${mac}".`);
}

async function assertAssetReferences(
  ctx: any,
  input: { organizationId?: any; responsibleUserId?: any; storageLocationId?: any },
): Promise<void> {
  if (input.organizationId) {
    const organization = await ctx.db.get(input.organizationId);
    if (!organization || organization.active === false) {
      throw new Error("Secretaria/departamento de destino não encontrado ou inativo.");
    }
  }
  if (input.responsibleUserId) {
    const responsible = await ctx.db.get(input.responsibleUserId);
    if (!responsible || responsible.active === false) {
      throw new Error("Servidor responsável não encontrado ou inativo.");
    }
  }
  if (input.storageLocationId) {
    const location = await ctx.db.get(input.storageLocationId);
    if (!location || location.active === false) {
      throw new Error("Local físico não encontrado ou inativo.");
    }
  }
}

async function requireUser(ctx: any) {
  // RBAC central: equipamentos visíveis a quem consulta (incl. gestor/diretor).
  return requirePermission(ctx, "equipment.view");
}

async function requireManagerOrAdmin(ctx: any) {
  // RBAC central: gerenciamento de equipamentos.
  return requirePermission(ctx, "equipment.manage", { entity: "assets" });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const list = query({
  args: {
    status: v.optional(v.string()),
    assetType: v.optional(v.union(...ASSET_TYPES.map((value) => v.literal(value)))),
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

/**
 * PRODUTOS DE ESTOQUE RELACIONADOS a uma categoria de equipamento.
 *
 * SOMENTE LEITURA: devolve os registros ORIGINAIS de `products`/`stock`.
 * Nenhum asset é criado, nenhum saldo é alterado, nenhuma movimentação é
 * registrada e o estoque NÃO é duplicado — a tela de /assets apenas aponta
 * ONDE estão os produtos parecidos com a categoria.
 *
 * RBAC: exige `stock.view` porque os dados devolvidos são SALDO de estoque
 * (products.view ficaria permissivo demais para expor quantidades).
 */
export const relatedStockByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, args): Promise<RelatedStockProduct[]> => {
    await requirePermission(ctx, "stock.view");
    const category = findEquipmentCategory(args.category);
    if (!category) return [];

    const products = await ctx.db.query("products").collect();
    const stockRows = await ctx.db.query("stock").collect();
    const stockByProduct = new Map<string, { physicalQuantity: number; reservedQuantity: number }>();
    for (const s of stockRows) {
      stockByProduct.set(s.productId, {
        physicalQuantity: s.physicalQuantity ?? 0,
        reservedQuantity: s.reservedQuantity ?? 0,
      });
    }

    // Categorias do catálogo resolvidas uma única vez (evita N+1 por produto).
    const categoryNameById = new Map<string, string>();
    for (const c of await ctx.db.query("categories").collect()) {
      categoryNameById.set(c._id, c.name);
    }

    return buildRelatedStockProducts(
      products.map((p) => ({
        _id: p._id,
        name: p.name,
        brand: p.brand ?? null,
        manufacturer: p.manufacturer ?? null,
        model: p.model ?? null,
        unitOfMeasure: p.unitOfMeasure,
        categoryName: p.categoryId ? categoryNameById.get(p.categoryId) ?? null : null,
        stock: stockByProduct.get(p._id) ?? null,
      })),
      category
    );
  },
});

export const get = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const { userId, role } = await requireUser(ctx);
    const isAdmin = role === "admin";
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
      const license = await ctx.db.get(a.licenseId) as any;
      if (!license) return { ...a, license: null };
      return {
        ...a,
        license: {
          ...license,
          // A chave completa é restrita ao mesmo perfil autorizado em /licenses.
          key: license.key ? (isAdmin ? license.key : maskLicenseKey(license.key)) : undefined,
        },
      };
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
    assetType: v.union(...ASSET_TYPES.map((value) => v.literal(value))),
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
    const patrimonyNumber = args.patrimonyNumber?.trim() || undefined;
    const serialNumber = args.serialNumber?.trim() || undefined;
    const macAddress = args.macAddress?.trim().toUpperCase() || undefined;
    await assertAssetIdentifiersAvailable(ctx, { patrimonyNumber, serialNumber, macAddress });
    await assertAssetReferences(ctx, args);
    if (args.acquisitionDate) {
      const date = new Date(`${args.acquisitionDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.acquisitionDate) || Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== args.acquisitionDate) {
        throw new Error("Data de aquisição inválida. Use o formato AAAA-MM-DD.");
      }
    }
    const now = Date.now();

    const assetId = await ctx.db.insert("assets", {
      patrimonyNumber,
      serialNumber,
      assetType: args.assetType as any,
      manufacturer: args.manufacturer || undefined,
      model: args.model || undefined,
      hostname: args.hostname || undefined,
      macAddress,
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
    if (args.assetType !== undefined &&
        !ASSET_TYPES.includes(args.assetType as (typeof ASSET_TYPES)[number])) {
      throw new Error("Tipo de equipamento inválido.");
    }

    const patrimonyNumber = args.patrimonyNumber === undefined
      ? asset.patrimonyNumber : args.patrimonyNumber.trim() || undefined;
    const serialNumber = args.serialNumber === undefined
      ? asset.serialNumber : args.serialNumber.trim() || undefined;
    const macAddress = args.macAddress === undefined
      ? asset.macAddress : args.macAddress.trim().toUpperCase() || undefined;
    await assertAssetIdentifiersAvailable(ctx, { patrimonyNumber, serialNumber, macAddress }, String(args.assetId));

    const now = Date.now();
    const updates: Record<string, any> = { updatedAt: now };

    if (args.patrimonyNumber !== undefined) updates.patrimonyNumber = patrimonyNumber;
    if (args.serialNumber !== undefined) updates.serialNumber = serialNumber;
    if (args.assetType !== undefined) updates.assetType = args.assetType;
    if (args.manufacturer !== undefined) updates.manufacturer = args.manufacturer || undefined;
    if (args.model !== undefined) updates.model = args.model || undefined;
    if (args.hostname !== undefined) updates.hostname = args.hostname || undefined;
    if (args.macAddress !== undefined) updates.macAddress = macAddress;
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

    await assertAssetReferences(ctx, {
      organizationId: args.organizationId,
      responsibleUserId: args.responsibleUserId,
    });
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

    await assertAssetReferences(ctx, {
      organizationId: args.organizationId,
      storageLocationId: args.storageLocationId,
    });
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
    newStatus: v.union(...ASSET_STATUSES.map((value) => v.literal(value))),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    if (!ASSET_STATUSES.includes(args.newStatus as (typeof ASSET_STATUSES)[number])) {
      throw new Error("Status de equipamento inválido.");
    }
    if (args.newStatus === "disposed" && !args.observation?.trim()) {
      throw new Error("Informe a justificativa da baixa patrimonial.");
    }
    const now = Date.now();
    const previousStatus = asset.status;
    if (previousStatus === args.newStatus) {
      throw new Error("O equipamento já está neste status.");
    }

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
