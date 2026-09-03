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
    throw new Error("Apenas administradores e responsáveis pelo estoque podem realizar esta operação");
  }
  return { userId, user };
}

function generateExchangeNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 999999).toString().padStart(6, "0");
  return `TRO-${year}-${seq}`;
}

function generateCollectionNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 999999).toString().padStart(6, "0");
  return `COL-${year}-${seq}`;
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

      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", pid))
        .first();

      const compatEntries = allCompat.filter((c: any) => c.productId === pid);
      const compatibleModels = compatEntries.map((c: any) => c.printerModel);

      const physical = stock?.physicalQuantity ?? 0;
      const reserved = stock?.reservedQuantity ?? 0;
      const available = physical - reserved;

      const idealStock = product.idealStock ?? 0;
      const standardQty = product.standardOrderQuantity;

      let suggestedQty: number;
      if (standardQty && standardQty > 0) {
        suggestedQty = physical < idealStock ? standardQty : 0;
      } else {
        suggestedQty = Math.max(idealStock - physical, 0);
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
        availableQuantity: available,
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

export const createExchange = mutation({
  args: {
    productId: v.id("products"),
    printerId: v.id("printers"),
    quantityDelivered: v.number(),
    quantityEmptyReceived: v.number(),
    receivedByUserId: v.id("users"),
    requestId: v.optional(v.id("requests")),
    organizationId: v.optional(v.id("organizations")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireManagerOrAdmin(ctx);

    if (args.quantityDelivered <= 0) throw new Error("Quantidade entregue deve ser maior que zero");
    if (args.quantityEmptyReceived < 0) throw new Error("Quantidade de carcaças não pode ser negativa");

    // Validate product
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");

    // Validate printer
    const printer = await ctx.db.get(args.printerId);
    if (!printer) throw new Error("Impressora não encontrada");

    // Validate stock (check available = physical - reserved)
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    if (!stock) throw new Error("Registro de estoque não encontrado");
    const availableStock = stock.physicalQuantity - stock.reservedQuantity;
    if (availableStock < args.quantityDelivered) {
      throw new Error(`Estoque insuficiente. Disponível: ${availableStock} (físico: ${stock.physicalQuantity}, reservado: ${stock.reservedQuantity}). Necessário: ${args.quantityDelivered}`);
    }

    // Validate receiver
    const receiver = await ctx.db.get(args.receivedByUserId);
    if (!receiver) throw new Error("Usuário recebedor não encontrado");

    const now = Date.now();
    const exchangeNumber = generateExchangeNumber();

    // FIFO Lot Consumption (before stock reduction — mirrors requests.deliver pattern)
    let remainingToConsume = args.quantityDelivered;
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

    // Re-read stock for concurrency safety (double-check pattern)
    const freshStock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    if (!freshStock) throw new Error("Registro de estoque desapareceu durante a troca");
    if (freshStock.physicalQuantity < args.quantityDelivered) {
      throw new Error(`Estoque insuficiente (concorrência). Físico: ${freshStock.physicalQuantity}. Necessário: ${args.quantityDelivered}.`);
    }
    if (freshStock.reservedQuantity > freshStock.physicalQuantity - args.quantityDelivered) {
      throw new Error(`Estoque reservado insuficiente (concorrência). Reservado: ${freshStock.reservedQuantity}. Disponível: ${freshStock.physicalQuantity}.`);
    }

    // Reduce global stock
    const newPhysical = freshStock.physicalQuantity - args.quantityDelivered;
    const newReserved = freshStock.reservedQuantity;
    await ctx.db.patch(freshStock._id, { physicalQuantity: newPhysical });

    // Create stock movement
    await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantityDelivered,
      previousPhysical: freshStock.physicalQuantity,
      newPhysical,
      previousReserved: freshStock.reservedQuantity,
      newReserved,
      userId,
      observation: `Troca Gomaq — ${printer.name} (${printer.model})`,
      timestamp: now,
    });

    // Create exchange record
    const exchangeId = await ctx.db.insert("gomaQExchanges", {
      exchangeNumber,
      productId: args.productId,
      lotId: consumedLotId as any,
      printerId: args.printerId,
      quantityDelivered: args.quantityDelivered,
      quantityEmptyReceived: args.quantityEmptyReceived,
      deliveredByUserId: userId,
      receivedByUserId: args.receivedByUserId,
      requestId: args.requestId,
      organizationId: args.organizationId,
      exchangedAt: now,
      observation: args.observation,
    });

    // Create empty cartridge records
    if (args.quantityEmptyReceived > 0) {
      await ctx.db.insert("gomaQEmptyCartridges", {
        productId: args.productId,
        printerId: args.printerId,
        quantity: args.quantityEmptyReceived,
        generatedAt: now,
        sourceExchangeId: exchangeId as any,
        status: "awaiting_collection",
        createdByUserId: userId,
      });
    }

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_exchange",
      entity: "gomaQExchanges",
      entityId: exchangeId,
      details: `Troca: ${args.quantityDelivered} ${product.name} → ${printer.name}. Carcaças: ${args.quantityEmptyReceived}`,
      timestamp: now,
    });

    return exchangeId;
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
      collectionNumber: generateCollectionNumber(),
      collectedAt: now,
      responsibleUserId: userId,
      observation: args.observation,
      documentStorageId: args.documentStorageId,
      totalCartridges,
    });

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
