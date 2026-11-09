import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: consulta de transferências.
  return requirePermission(ctx, "transfers.view");
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const transfers = await ctx.db.query("stockTransfers").order("desc").take(200);
    return Promise.all(transfers.map(async (t: any) => {
      const product = await ctx.db.get(t.productId);
      const lot = t.lotId ? await ctx.db.get(t.lotId) : null;
      const fromLocation = await ctx.db.get(t.fromLocationId);
      const toLocation = await ctx.db.get(t.toLocationId);
      const fromArea = t.fromAreaId ? await ctx.db.get(t.fromAreaId) : null;
      const toArea = t.toAreaId ? await ctx.db.get(t.toAreaId) : null;
      const responsible = await ctx.db.get(t.responsibleUserId);
      const lotLinks = await ctx.db.query("stockTransferLots")
        .withIndex("by_transfer", (q: any) => q.eq("transferId", t._id)).collect();
      return { ...t, product, lot, fromLocation, toLocation, fromArea, toArea, lotLinks, responsible };
    }));
  },
});

export const listByProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const transfers = await ctx.db
      .query("stockTransfers")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .order("desc")
      .take(100);
    return Promise.all(transfers.map(async (t: any) => {
      const fromLocation = await ctx.db.get(t.fromLocationId);
      const toLocation = await ctx.db.get(t.toLocationId);
      const fromArea = t.fromAreaId ? await ctx.db.get(t.fromAreaId) : null;
      const toArea = t.toAreaId ? await ctx.db.get(t.toAreaId) : null;
      const lotLinks = await ctx.db.query("stockTransferLots")
        .withIndex("by_transfer", (q: any) => q.eq("transferId", t._id)).collect();
      return { ...t, fromLocation, toLocation, fromArea, toArea, lotLinks };
    }));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    productId: v.id("products"), lotId: v.optional(v.id("lots")),
    fromLocationId: v.id("storageLocations"), toLocationId: v.id("storageLocations"),
    quantity: v.number(), observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "transfers.create", { entity: "stockTransfers" });
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Quantidade deve ser um número válido maior que zero");
    if (args.fromLocationId === args.toLocationId) throw new Error("Origem e destino não podem ser o mesmo local");

    const fromLocation = await ctx.db.get(args.fromLocationId);
    const toLocation = await ctx.db.get(args.toLocationId);
    if (!fromLocation || !fromLocation.active) throw new Error("Local de origem não encontrado ou inativo");
    if (!toLocation || !toLocation.active) throw new Error("Local de destino não encontrado ou inativo");
    if (!fromLocation.areaId || !toLocation.areaId) throw new Error("Classifique a área dos locais de origem e destino antes de transferir estoque");

    const fromArea = await ctx.db.get(fromLocation.areaId);
    const toArea = await ctx.db.get(toLocation.areaId);
    if (!fromArea?.active || !toArea?.active) throw new Error("A área de origem ou destino está inativa");
    const product = await ctx.db.get(args.productId);
    if (!product || !product.active) throw new Error("Produto não encontrado ou inativo");

    const globalStock = await ctx.db.query("stock")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).first();
    if (!globalStock) throw new Error("Registro global de estoque não encontrado.");
    const allReservations = await ctx.db.query("requestItemReservations")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const areaReserved = allReservations.reduce((sum: number, item: any) => sum + item.quantityRemaining, 0);
    const legacyReserved = Math.max(0, globalStock.reservedQuantity - areaReserved);
    if (legacyReserved > 0) {
      throw new Error("Há solicitações antigas aprovadas sem reserva por lote para este produto. Conclua ou cancele essas solicitações antes de transferir.");
    }
    const globalAvailable = globalStock.physicalQuantity - globalStock.reservedQuantity;
    if (args.quantity > globalAvailable) throw new Error("A quantidade excede o estoque global livre.");

    const locationRows = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const sourceStock = locationRows.find((row: any) => row.locationId === args.fromLocationId && row.areaId === fromLocation.areaId);
    if (!sourceStock || sourceStock.quantity < args.quantity) {
      throw new Error(`Estoque insuficiente em "${fromArea.name}" / "${fromLocation.name}". Disponível: ${sourceStock?.quantity ?? 0}.`);
    }

    const productLots = await ctx.db.query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const candidates: Array<{ lot: any; free: number }> = [];
    for (const lot of productLots) {
      if (!lot.active || lot.areaId !== fromLocation.areaId || lot.locationId !== args.fromLocationId) continue;
      if (args.lotId && lot._id !== args.lotId) continue;
      const reservations = await ctx.db.query("requestItemReservations")
        .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id)).collect();
      const reserved = reservations.reduce((sum: number, item: any) => sum + item.quantityRemaining, 0);
      const free = Math.max(0, lot.quantityAvailable - reserved);
      if (free > 0) candidates.push({ lot, free });
    }
    candidates.sort((a, b) => a.lot.receivedAt - b.lot.receivedAt || a.lot.lotNumber.localeCompare(b.lot.lotNumber));

    const planned: Array<{ lotId: string; quantity: number }> = [];
    let remaining = args.quantity;
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const quantity = Math.min(candidate.free, remaining);
      planned.push({ lotId: candidate.lot._id, quantity });
      remaining -= quantity;
    }
    if (remaining > 0) throw new Error(`Lotes livres insuficientes na origem. Faltam ${remaining} unidade(s); transferências não podem consumir quantidades reservadas.`);

    const destinationStock = locationRows.find((row: any) => row.locationId === args.toLocationId && row.areaId === toLocation.areaId);
    const now = Date.now();
    const transferId = await ctx.db.insert("stockTransfers", {
      productId: args.productId, lotId: planned.length === 1 ? planned[0].lotId as any : undefined,
      fromLocationId: args.fromLocationId, toLocationId: args.toLocationId,
      fromAreaId: fromLocation.areaId, toAreaId: toLocation.areaId,
      quantity: args.quantity, responsibleUserId: userId, observation: args.observation, createdAt: now,
    });

    // Divide cada lote de origem; o novo lote no destino mantém entrada, fornecedor e custo originais.
    for (const part of planned) {
      const sourceLot = await ctx.db.get(part.lotId as any);
      if (!sourceLot || sourceLot.quantityAvailable < part.quantity) throw new Error("Saldo do lote de origem mudou durante a transferência");
      const allNumbers = await ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
      const year = new Date(now).getFullYear();
      const prefix = `LOT-${year}-`;
      const maxSequence = allNumbers.reduce((max: number, item: any) => {
        if (!item.lotNumber?.startsWith(prefix)) return max;
        const n = Number(item.lotNumber.slice(prefix.length));
        return Number.isSafeInteger(n) && n > max ? n : max;
      }, 0);
      const destinationLotId = await ctx.db.insert("lots", {
        lotNumber: `${prefix}${String(maxSequence + 1).padStart(6, "0")}`,
        productId: sourceLot.productId, entryId: sourceLot.entryId,
        brand: sourceLot.brand, model: sourceLot.model, specification: sourceLot.specification,
        quantityReceived: part.quantity, quantityAvailable: part.quantity,
        unitCost: sourceLot.unitCost, receivedAt: now, supplierId: sourceLot.supplierId,
        invoiceNumber: sourceLot.invoiceNumber, purchaseAuthorizationNumber: sourceLot.purchaseAuthorizationNumber,
        photoStorageId: sourceLot.photoStorageId, supplierLotNumber: sourceLot.supplierLotNumber,
        active: true,
        observation: `Transferido de ${sourceLot.lotNumber} — ${fromArea.name}/${fromLocation.name} → ${toArea.name}/${toLocation.name}`,
        materialType: sourceLot.materialType, areaId: toLocation.areaId, locationId: toLocation._id,
      });
      await ctx.db.patch(sourceLot._id, { quantityAvailable: sourceLot.quantityAvailable - part.quantity });
      await ctx.db.insert("stockTransferLots", { transferId, sourceLotId: sourceLot._id, destinationLotId, quantity: part.quantity });
    }

    await ctx.db.patch(sourceStock._id, { quantity: sourceStock.quantity - args.quantity });
    if (destinationStock) {
      await ctx.db.patch(destinationStock._id, { quantity: destinationStock.quantity + args.quantity });
    } else {
      await ctx.db.insert("stockByLocation", { productId: args.productId, locationId: args.toLocationId, areaId: toLocation.areaId, quantity: args.quantity });
    }

    const globalStock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", args.productId)).first();
    if (globalStock) await ctx.db.insert("stockMovements", {
      productId: args.productId, type: "transfer", quantity: args.quantity,
      previousPhysical: globalStock.physicalQuantity, newPhysical: globalStock.physicalQuantity,
      previousReserved: globalStock.reservedQuantity, newReserved: globalStock.reservedQuantity,
      userId, areaId: fromLocation.areaId, locationId: args.fromLocationId, toLocationId: args.toLocationId,
      observation: `Transferência: ${fromArea.name}/${fromLocation.name} → ${toArea.name}/${toLocation.name}`,
      timestamp: now,
    });

    await ctx.db.insert("auditLogs", {
      userId, action: "transfer_stock", entity: "stockTransfers", entityId: transferId,
      details: `Transferência de ${args.quantity} ${product.name}: ${fromArea.name}/${fromLocation.name} → ${toArea.name}/${toLocation.name}; ${planned.length} lote(s) com origem rastreável.`,
      timestamp: now,
    });
    return transferId;
  },
});
