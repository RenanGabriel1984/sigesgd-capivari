import { requirePermission } from "./rbac";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSingleValidGlobalStock } from "../lib/stock-read-integrity";
import { consumeLotLocationStock, recordLotMovementAllocations, resolveWithdrawalLocation } from "./lotLocationLedger";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: consulta de peças (visão de equipamentos).
  return requirePermission(ctx, "equipment.view");
}

async function requireManagerOrAdmin(ctx: any) {
  // RBAC central: instalar/remover peças.
  return requirePermission(ctx, "equipment.manage", { entity: "assetParts" });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const listByAsset = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const parts = await ctx.db
      .query("assetParts")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();

    return Promise.all(parts.map(async (p: any) => {
      const product = await ctx.db.get(p.productId);
      const installedBy = await ctx.db.get(p.installedByUserId);
      return { ...p, product, installedBy };
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const installPart = mutation({
  args: {
    assetId: v.id("assets"),
    productId: v.id("products"),
    quantity: v.number(),
    locationId: v.optional(v.id("storageLocations")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    if (args.quantity <= 0) throw new Error("Quantidade deve ser maior que zero");

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");

    // Validate stock (check available = physical - reserved)
    const stockRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const stock = requireSingleValidGlobalStock(stockRows, product.name);
    if (stock.physicalQuantity - stock.reservedQuantity < args.quantity) {
      throw new Error(`Estoque insuficiente. Disponível: ${stock.physicalQuantity - stock.reservedQuantity}. Necessário: ${args.quantity}`);
    }

    const now = Date.now();

    const sourceLocationId = await resolveWithdrawalLocation(ctx, args.productId, args.locationId);
    const lotConsumption = await consumeLotLocationStock(ctx, {
      productId: args.productId,
      locationId: sourceLocationId,
      quantity: args.quantity,
    });
    const sourceLocation = await ctx.db.get(sourceLocationId as Id<"storageLocations">);

    // Re-read stock for concurrency safety (double-check pattern)
    const freshStockRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const freshStock = requireSingleValidGlobalStock(freshStockRows, product.name);
    if (freshStock.physicalQuantity - freshStock.reservedQuantity < args.quantity) {
      throw new Error(`Estoque insuficiente (concorrência). Disponível: ${freshStock.physicalQuantity - freshStock.reservedQuantity}. Necessário: ${args.quantity}.`);
    }

    // Reduce global stock
    const newPhysical = freshStock.physicalQuantity - args.quantity;
    await ctx.db.patch(freshStock._id, { physicalQuantity: newPhysical });

    // Create stock movement
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      previousPhysical: freshStock.physicalQuantity,
      newPhysical,
      previousReserved: freshStock.reservedQuantity,
      newReserved: freshStock.reservedQuantity,
      userId,
      lotId: lotConsumption.allocations[0]?.lotId as any,
      locationId: sourceLocationId,
      observation: `Instalação em equipamento: ${asset.patrimonyNumber ?? asset.serialNumber ?? args.assetId} — armário ${sourceLocation?.name ?? sourceLocationId}; lotes: ${lotConsumption.allocations.map((a) => `${a.lotNumber}(${a.quantity})`).join(", ")}`,
      timestamp: now,
    });

    await recordLotMovementAllocations(ctx, {
      movementId, productId: args.productId, locationId: sourceLocationId,
      allocations: lotConsumption.allocations,
    });

    // Record part installation
    const partId = await ctx.db.insert("assetParts", {
      assetId: args.assetId,
      productId: args.productId,
      lotId: lotConsumption.allocations[0]?.lotId as any,
      locationId: sourceLocationId,
      quantity: args.quantity,
      installedAt: now,
      installedByUserId: userId,
      observation: args.observation || undefined,
    });

    // Asset history
    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "part_installed",
      userId,
      observation: `Peça instalada: ${product.name} (${args.quantity}x)`,
      timestamp: now,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_part_install",
      entity: "assetParts",
      entityId: partId,
      details: `Peça ${product.name} instalada em ${asset.patrimonyNumber ?? "equipamento"} — ${args.quantity} un`,
      timestamp: now,
    });

    return partId;
  },
});

export const removePart = mutation({
  args: {
    partId: v.id("assetParts"),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const part = await ctx.db.get(args.partId);
    if (!part) throw new Error("Peça não encontrada");
    if (part.removedAt) throw new Error("Esta peça já foi removida");

    const now = Date.now();
    await ctx.db.patch(args.partId, {
      removedAt: now,
      observation: args.observation || part.observation,
    });

    const asset = await ctx.db.get(part.assetId);
    const product = await ctx.db.get(part.productId);

    // Asset history
    await ctx.db.insert("assetHistory", {
      assetId: part.assetId,
      eventType: "part_removed",
      userId,
      observation: `Peça removida: ${product?.name ?? "desconhecida"} (${part.quantity}x)`,
      timestamp: now,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_part_remove",
      entity: "assetParts",
      entityId: args.partId,
      details: `Peça ${product?.name ?? ""} removida de ${asset?.patrimonyNumber ?? "equipamento"}`,
      timestamp: now,
    });

    return args.partId;
  },
});
