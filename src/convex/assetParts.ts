import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
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
    throw new Error("Apenas administradores e responsáveis pelo estoque podem instalar/remover peças");
  }
  return { userId, user };
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
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    if (args.quantity <= 0) throw new Error("Quantidade deve ser maior que zero");

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");

    // Validate stock
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    if (!stock) throw new Error("Registro de estoque não encontrado");
    if (stock.physicalQuantity - stock.reservedQuantity < args.quantity) {
      throw new Error(`Estoque insuficiente. Disponível: ${stock.physicalQuantity - stock.reservedQuantity}. Necessário: ${args.quantity}`);
    }

    const now = Date.now();

    // Reduce global stock
    const newPhysical = stock.physicalQuantity - args.quantity;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });

    // FIFO Lot Consumption
    let remainingToConsume = args.quantity;
    let consumedLotId: string | undefined;
    const lots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
      .collect();
    const sortedLots = lots
      .filter((l: any) => l.quantityAvailable > 0)
      .sort((a: any, b: any) => a.receivedAt - b.receivedAt || a.lotNumber.localeCompare(b.lotNumber));

    for (const lot of sortedLots) {
      if (remainingToConsume <= 0) break;
      const consumeFromLot = Math.min(lot.quantityAvailable, remainingToConsume);
      if (consumeFromLot <= 0) continue;
      await ctx.db.patch(lot._id, { quantityAvailable: lot.quantityAvailable - consumeFromLot });
      if (!consumedLotId) consumedLotId = lot._id;
      remainingToConsume -= consumeFromLot;
    }

    if (remainingToConsume > 0) {
      throw new Error(`Lotes insuficientes. Faltam ${remainingToConsume} unidades sem lote disponível.`);
    }

    // Create stock movement
    await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      previousPhysical: stock.physicalQuantity,
      newPhysical,
      previousReserved: stock.reservedQuantity,
      newReserved: stock.reservedQuantity,
      userId,
      observation: `Instalação em equipamento: ${asset.patrimonyNumber ?? asset.serialNumber ?? args.assetId}`,
      timestamp: now,
    });

    // Record part installation
    const partId = await ctx.db.insert("assetParts", {
      assetId: args.assetId,
      productId: args.productId,
      lotId: consumedLotId,
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
