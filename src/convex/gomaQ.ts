import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { PRINT_AREA_ID } from "./printSupplies";
import { attachStorageFile } from "./storage";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician" | "patrimony_manager";

async function requireUser(ctx: any) {
  // RBAC central: consultas GomaQ (suprimentos de impressão).
  return requirePermission(ctx, "gomaq.view");
}

async function requireManagerOrAdmin(ctx: any) {
  // RBAC central: operações GomaQ (trocas, coletas, pedidos).
  return requirePermission(ctx, "gomaq.manage", { entity: "gomaQ" });
}

async function generateCollectionNumber(ctx: any): Promise<string> {
  const prefix = `COL-${new Date().getFullYear()}-`;
  const collections = await ctx.db.query("gomaQCollections").collect();
  const maxSequence = collections.reduce((max: number, item: any) => {
    if (!item.collectionNumber?.startsWith(prefix)) return max;
    const sequence = Number(item.collectionNumber.slice(prefix.length));
    return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(6, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const listExchanges = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    productId: v.optional(v.id("products")),
    printerId: v.optional(v.id("printers")),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let exchanges = await ctx.db.query("gomaQExchanges").order("desc").take(500);

    if (args.startDate) exchanges = exchanges.filter((e: any) => e.exchangedAt >= args.startDate!);
    if (args.endDate) exchanges = exchanges.filter((e: any) => e.exchangedAt <= args.endDate!);
    if (args.productId) exchanges = exchanges.filter((e: any) => e.productId === args.productId);
    if (args.printerId) exchanges = exchanges.filter((e: any) => e.printerId === args.printerId);

    return Promise.all(exchanges.map(async (e: any) => {
      const product = await ctx.db.get(e.productId);
      const printer = await ctx.db.get(e.printerId);
      const lot = e.lotId ? await ctx.db.get(e.lotId) : null;
      const deliveredBy = await ctx.db.get(e.deliveredByUserId);
      const receivedBy = await ctx.db.get(e.receivedByUserId);
      return { ...e, product, printer, lot, deliveredBy, receivedBy };
    }));
  },
});

export const listEmptyCartridges = query({
  args: {
    status: v.optional(v.union(v.literal("awaiting_collection"), v.literal("collected"))),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let cartridges;
    if (args.status) {
      cartridges = await ctx.db
        .query("gomaQEmptyCartridges")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(500);
    } else {
      cartridges = await ctx.db.query("gomaQEmptyCartridges").order("desc").take(500);
    }

    return Promise.all(cartridges.map(async (c: any) => {
      const product = await ctx.db.get(c.productId);
      const printer = c.printerId ? await ctx.db.get(c.printerId) : null;
      const location = c.storageLocationId ? await ctx.db.get(c.storageLocationId) : null;
      return { ...c, product, printer, location };
    }));
  },
});

export const awaitingCollectionCount = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const cartridges = await ctx.db
      .query("gomaQEmptyCartridges")
      .withIndex("by_status", (q) => q.eq("status", "awaiting_collection"))
      .collect();
    return cartridges.reduce((sum: number, c: any) => sum + c.quantity, 0);
  },
});

export const lastCollection = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const collections = await ctx.db
      .query("gomaQCollections")
      .order("desc")
      .take(1);
    return collections[0] ?? null;
  },
});

export const listCollections = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const collections = await ctx.db.query("gomaQCollections").order("desc").take(100);
    return Promise.all(collections.map(async (c: any) => {
      const responsible = await ctx.db.get(c.responsibleUserId);
      return { ...c, responsible };
    }));
  },
});

export const monthlyOrder = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    // Get all products that are GOMAQ supplies (have printer compatibility)
    const allCompat = await ctx.db.query("printerCompatibility").collect();
    const productIds = [...new Set(allCompat.map((c: any) => c.productId as string))];

    const items = await Promise.all(productIds.map(async (pid: string) => {
      const rawProduct = await ctx.db.get(pid as any);
      if (!rawProduct) return null;
      // Narrow to product document
      const product = rawProduct as any;
      if (!product.name || !product.categoryId) return null;

      const [stock, lots, reservations] = await Promise.all([
        ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", pid)).first(),
        ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", pid)).collect(),
        ctx.db.query("requestItemReservations").withIndex("by_product", (q: any) => q.eq("productId", pid)).collect(),
      ]);

      const compatEntries = allCompat.filter((c: any) => c.productId === pid);
      const compatibleModels = compatEntries.map((c: any) => c.printerModel);

      const physical = stock?.physicalQuantity ?? 0;
      const reserved = stock?.reservedQuantity ?? 0;
      const available = physical - reserved;
      const areaLots = lots.filter((lot: any) => lot.areaId === PRINT_AREA_ID);
      const areaLotIds = new Set(areaLots.map((lot: any) => String(lot._id)));
      const areaPhysical = areaLots.reduce((sum: number, lot: any) => sum + Number(lot.quantityAvailable), 0);
      const areaReserved = (reservations as any[])
        .filter((reservation: any) => areaLotIds.has(String(reservation.lotId)))
        .reduce((sum: number, reservation: any) => {
          const remaining = Number(reservation.quantityRemaining);
          return Number.isFinite(remaining) && remaining > 0 ? sum + remaining : sum;
        }, 0);
      const availableInArea = areaPhysical - areaReserved;

      const idealStock = product.idealStock ?? 0;
      const standardQty = product.standardOrderQuantity;

      let suggestedQty: number;
      if (standardQty && standardQty > 0) {
        suggestedQty = availableInArea < idealStock ? standardQty : 0;
      } else {
        suggestedQty = Math.max(idealStock - availableInArea, 0);
      }

      return {
        productId: pid,
        productName: product.name,
        brand: product.brand,
        model: product.model,
        specification: product.specification,
        compatibleModels,
        physicalQuantity: physical,
        reservedQuantity: reserved,
        availableQuantity: availableInArea,
        globalAvailableQuantity: available,
        areaPhysicalQuantity: areaPhysical,
        areaReservedQuantity: areaReserved,
        idealStock,
        minimumStock: product.minimumStock,
        standardOrderQuantity: standardQty,
        suggestedQuantity: suggestedQty,
        finalQuantity: suggestedQty,
      };
    }));

    return items.filter(Boolean);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fluxo legado desativado: a troca antiga debitava estoque global sem
 * respeitar área, reservas por lote, saldo por local e rastreabilidade multi-lote.
 * A retirada operacional deve ocorrer por printSupplies.withdraw/withdrawFamily.
 */
export const createExchange = internalMutation({
  args: {
    productId: v.id("products"),
    printerId: v.id("printers"),
    quantityDelivered: v.number(),
    quantityEmptyReceived: v.number(),
    receivedByUserId: v.optional(v.id("users")),
    receivedByName: v.optional(v.string()),
    requestId: v.optional(v.id("requests")),
    organizationId: v.optional(v.id("organizations")),
    observation: v.optional(v.string()),
  },
  handler: async (_ctx, _args) => {
    throw new Error("Fluxo legado de troca desativado. Registre a retirada pela Gestão de Suprimentos de Impressão.");
  },
});

export const createCollection = mutation({
  args: {
    cartridgeIds: v.array(v.id("gomaQEmptyCartridges")),
    observation: v.optional(v.string()),
    documentStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);

    if (args.cartridgeIds.length === 0) throw new Error("Selecione ao menos uma carcaça para coleta");

    const now = Date.now();
    let totalCartridges = 0;

    // Validate and update each cartridge
    for (const cartridgeId of args.cartridgeIds) {
      const cartridge = await ctx.db.get(cartridgeId);
      if (!cartridge) throw new Error(`Carcaça não encontrada: ${cartridgeId}`);
      if (cartridge.status === "collected") {
        throw new Error(`Carcaça ${cartridgeId} já foi coletada em ${new Date(cartridge.collectedAt ?? 0).toLocaleDateString("pt-BR")}`);
      }
      totalCartridges += cartridge.quantity;
    }

    // Create collection record
    const collectionId = await ctx.db.insert("gomaQCollections", {
      collectionNumber: await generateCollectionNumber(ctx),
      collectedAt: now,
      responsibleUserId: userId,
      observation: args.observation,
      documentStorageId: args.documentStorageId,
      totalCartridges,
    });

    if (args.documentStorageId) {
      await attachStorageFile(ctx, args.documentStorageId, "gomaqCollection", String(collectionId), String(userId));
    }

    // Update cartridges
    for (const cartridgeId of args.cartridgeIds) {
      await ctx.db.patch(cartridgeId, {
        status: "collected",
        collectedAt: now,
        collectionId: collectionId as any,
      });
    }

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_collection",
      entity: "gomaQCollections",
      entityId: collectionId,
      details: `Coleta Gomaq: ${totalCartridges} carcaça(s) em ${args.cartridgeIds.length} registro(s)`,
      timestamp: now,
    });

    return collectionId;
  },
});

export const exportMonthlyOrder = mutation({
  args: {
    items: v.array(v.object({
      productId: v.id("products"),
      finalQuantity: v.number(),
      observation: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const now = Date.now();

    const summary = args.items
      .filter((i) => i.finalQuantity > 0)
      .map((i) => `Produto ${i.productId}: ${i.finalQuantity}`)
      .join(", ");

    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_order",
      entity: "gomaQExchanges",
      details: `Pedido mensal Gomaq: ${args.items.filter((i) => i.finalQuantity > 0).length} itens`,
      timestamp: now,
    });

    return { success: true, itemCount: args.items.filter((i) => i.finalQuantity > 0).length };
  },
});
