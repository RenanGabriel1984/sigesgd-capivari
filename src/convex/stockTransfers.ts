import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import type { Id } from "./_generated/dataModel";
import { isDiscreteStockUnit } from "../lib/stock-quantity-rules";

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
    // Optional only for older clients; new clients always select both dimensions.
    fromAreaId: v.optional(v.id("stockAreas")),
    toAreaId: v.optional(v.id("stockAreas")),
    quantity: v.number(), observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "transfers.create", { entity: "stockTransfers" });
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Quantidade deve ser um número válido maior que zero");
    const fromLocation = await ctx.db.get(args.fromLocationId);
    const toLocation = await ctx.db.get(args.toLocationId);
    if (!fromLocation || !fromLocation.active) throw new Error("Local de origem não encontrado ou inativo");
    if (!toLocation || !toLocation.active) throw new Error("Local de destino não encontrado ou inativo");

    // Área de origem e destino deve ser explícita. Nunca inferir subestoque
    // pelo armário, mesmo que o campo legado storageLocations.areaId exista.
    const fromAreaId = args.fromAreaId;
    const toAreaId = args.toAreaId;
    if (!fromAreaId || !toAreaId) {
      throw new Error("Selecione a área/subestoque de origem e destino da transferência.");
    }
    if (args.fromLocationId === args.toLocationId && fromAreaId === toAreaId) {
      throw new Error("Origem e destino não podem ser a mesma combinação de área e local físico.");
    }

    const fromArea = await ctx.db.get(fromAreaId);
    const toArea = await ctx.db.get(toAreaId);
    if (!fromArea?.active || !toArea?.active) throw new Error("A área de origem ou destino está inativa");
    const product = await ctx.db.get(args.productId);
    if (!product || !product.active) throw new Error("Produto não encontrado ou inativo");

    const globalStockRows = await ctx.db.query("stock")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    if (globalStockRows.length !== 1) {
      throw new Error(globalStockRows.length === 0
        ? "Registro global de estoque não encontrado."
        : "Há registros globais de estoque duplicados. Regularize antes de transferir.");
    }
    const globalStock = globalStockRows[0];
    const allReservations = await ctx.db.query("requestItemReservations")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    if (!Number.isFinite(globalStock.physicalQuantity) ||
        !Number.isFinite(globalStock.reservedQuantity) ||
        globalStock.physicalQuantity < 0 || globalStock.reservedQuantity < 0 ||
        globalStock.reservedQuantity > globalStock.physicalQuantity) {
      throw new Error("O saldo global está inconsistente. Regularize antes de transferir.");
    }
    if (allReservations.some((item: any) =>
      !Number.isFinite(item.quantityRemaining) || item.quantityRemaining < 0
    )) {
      throw new Error("Há reserva por lote com quantidade inválida. Regularize antes de transferir.");
    }
    const areaReserved = allReservations.reduce((sum: number, item: any) => sum + item.quantityRemaining, 0);
    if (areaReserved - globalStock.reservedQuantity > 1e-9) {
      throw new Error("As reservas por lote excedem o saldo reservado global. Regularize antes de transferir.");
    }
    const legacyReserved = Math.max(0, globalStock.reservedQuantity - areaReserved);
    if (legacyReserved > 0) {
      throw new Error("Há solicitações antigas aprovadas sem reserva por lote para este produto. Conclua ou cancele essas solicitações antes de transferir.");
    }
    const globalAvailable = globalStock.physicalQuantity - globalStock.reservedQuantity;
    if (args.quantity > globalAvailable) throw new Error("A quantidade excede o estoque global livre.");
    if (isDiscreteStockUnit(product.unitOfMeasure, product.hasSerial) && !Number.isSafeInteger(args.quantity)) {
      throw new Error(`A quantidade transferida deve ser inteira para a unidade ${product.unitOfMeasure}.`);
    }

    const productLots = await ctx.db.query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    if (product.hasSerial || productLots.some((lot: any) => lot.materialType === "permanent")) {
      throw new Error("Material permanente ou com número de série deve ser transferido pelo cadastro individual de equipamentos, não por quantidade agregada.");
    }

    const locationRows = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const sourceRows = locationRows.filter((row: any) =>
      row.locationId === args.fromLocationId && row.areaId === fromAreaId
    );
    const destinationRows = locationRows.filter((row: any) =>
      row.locationId === args.toLocationId && row.areaId === toAreaId
    );
    if (sourceRows.length !== 1) {
      throw new Error(sourceRows.length === 0
        ? "Saldo da origem não encontrado."
        : "Há saldos duplicados na origem. Regularize a combinação área/local antes de transferir.");
    }
    if (destinationRows.length > 1) {
      throw new Error("Há saldos duplicados no destino. Regularize a combinação área/local antes de transferir.");
    }
    const sourceStock = sourceRows[0];
    const destinationStock = destinationRows[0] ?? null;
    if (sourceStock.quantity < args.quantity) {
      throw new Error(`Estoque insuficiente em "${fromArea.name}" / "${fromLocation.name}". Disponível: ${sourceStock.quantity}.`);
    }

    const sourceLots = productLots.filter((lot: any) =>
      lot.areaId === fromAreaId && lot.locationId === args.fromLocationId
    );
    const destinationLots = productLots.filter((lot: any) =>
      lot.areaId === toAreaId && lot.locationId === args.toLocationId
    );
    for (const lot of productLots) {
      if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) {
        throw new Error(`O lote ${lot.lotNumber} possui saldo inválido. Regularize antes da transferência.`);
      }
      if (lot.active === false && Number(lot.quantityAvailable) > 0) {
        throw new Error(`O lote ${lot.lotNumber} está inativo com saldo positivo. Regularize antes da transferência.`);
      }
    }
    const sourceLotTotal = sourceLots.reduce((sum: number, lot: any) => sum + Number(lot.quantityAvailable), 0);
    const destinationLotTotal = destinationLots.reduce((sum: number, lot: any) => sum + Number(lot.quantityAvailable), 0);
    if (Math.abs(sourceLotTotal - Number(sourceStock.quantity)) > 1e-9) {
      throw new Error("O saldo da origem diverge dos lotes registrados. Transferência bloqueada para preservar a rastreabilidade.");
    }
    if (Math.abs(destinationLotTotal - Number(destinationStock?.quantity ?? 0)) > 1e-9) {
      throw new Error("O saldo do destino diverge dos lotes registrados. Regularize antes de transferir.");
    }

    const reservedByLot = new Map<string, number>();
    for (const reservation of allReservations as any[]) {
      const lot = productLots.find((candidate: any) => candidate._id === reservation.lotId);
      const remaining = Number(reservation.quantityRemaining);
      if (!lot || !Number.isFinite(remaining) || remaining < 0) {
        throw new Error("Há reserva inválida ou sem lote correspondente. Transferência bloqueada.");
      }
      if (remaining > 0 && (
        reservation.productId !== args.productId ||
        reservation.areaId !== lot.areaId ||
        reservation.locationId !== lot.locationId ||
        remaining > Number(lot.quantityAvailable)
      )) {
        throw new Error(`A reserva do lote ${lot.lotNumber} não corresponde à área/local ou excede o saldo.`);
      }
      reservedByLot.set(String(lot._id), (reservedByLot.get(String(lot._id)) ?? 0) + remaining);
    }
    for (const lot of productLots) {
      const reserved = reservedByLot.get(String(lot._id)) ?? 0;
      if (reserved > Number(lot.quantityAvailable) + 1e-9) {
        throw new Error(`A soma das reservas do lote ${lot.lotNumber} excede o saldo físico.`);
      }
    }

    const candidates: Array<{ lot: any; free: number }> = [];
    for (const lot of sourceLots) {
      if (!lot.active || (args.lotId && lot._id !== args.lotId)) continue;
      const reserved = reservedByLot.get(String(lot._id)) ?? 0;
      const free = Number(lot.quantityAvailable) - reserved;
      if (free < -1e-9) throw new Error(`O lote ${lot.lotNumber} possui reserva superior ao saldo físico.`);
      if (free > 0) candidates.push({ lot, free });
    }
    candidates.sort((a, b) => a.lot.receivedAt - b.lot.receivedAt || a.lot.lotNumber.localeCompare(b.lot.lotNumber));

    const planned: Array<{ lotId: Id<"lots">; quantity: number }> = [];
    let remaining = args.quantity;
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const quantity = Math.min(candidate.free, remaining);
      planned.push({ lotId: candidate.lot._id as Id<"lots">, quantity });
      remaining -= quantity;
    }
    if (remaining > 0) throw new Error(`Lotes livres insuficientes na origem. Faltam ${remaining} unidade(s); transferências não podem consumir quantidades reservadas.`);

    const now = Date.now();
    const year = new Date(now).getFullYear();
    const prefix = `LOT-${year}-`;
    const allNumbers = await ctx.db.query("lots")
      .withIndex("by_number", (q: any) => q.gte("lotNumber", prefix)).collect();
    let maxSequence = allNumbers.reduce((max: number, item: any) => {
      if (!item.lotNumber?.startsWith(prefix)) return max;
      const n = Number(item.lotNumber.slice(prefix.length));
      return Number.isSafeInteger(n) && n > max ? n : max;
    }, 0);
    const transferId = await ctx.db.insert("stockTransfers", {
      productId: args.productId, lotId: planned.length === 1 ? planned[0].lotId as any : undefined,
      fromLocationId: args.fromLocationId, toLocationId: args.toLocationId,
      fromAreaId, toAreaId,
      quantity: args.quantity, responsibleUserId: userId, observation: args.observation, createdAt: now,
    });

    // Divide cada lote de origem; o novo lote no destino mantém entrada, fornecedor e custo originais.
    for (const part of planned) {
      const sourceLot = await ctx.db.get(part.lotId);
      if (!sourceLot || sourceLot.quantityAvailable < part.quantity) throw new Error("Saldo do lote de origem mudou durante a transferência");
      maxSequence += 1;
      const destinationLotId = await ctx.db.insert("lots", {
        lotNumber: `${prefix}${String(maxSequence).padStart(6, "0")}`,
        productId: sourceLot.productId, entryId: sourceLot.entryId,
        brand: sourceLot.brand, model: sourceLot.model, specification: sourceLot.specification,
        quantityReceived: part.quantity, quantityAvailable: part.quantity,
        unitCost: sourceLot.unitCost, receivedAt: now, supplierId: sourceLot.supplierId,
        invoiceNumber: sourceLot.invoiceNumber, purchaseAuthorizationNumber: sourceLot.purchaseAuthorizationNumber,
        photoStorageId: sourceLot.photoStorageId, supplierLotNumber: sourceLot.supplierLotNumber,
        active: true,
        observation: `Transferido de ${sourceLot.lotNumber} — ${fromArea.name}/${fromLocation.name} → ${toArea.name}/${toLocation.name}`,
        materialType: sourceLot.materialType, areaId: toAreaId as any, locationId: toLocation._id,
      });
      await ctx.db.patch(sourceLot._id, { quantityAvailable: sourceLot.quantityAvailable - part.quantity });
      await ctx.db.insert("stockTransferLots", { transferId, sourceLotId: sourceLot._id, destinationLotId, quantity: part.quantity });
    }

    await ctx.db.patch(sourceStock._id, { quantity: sourceStock.quantity - args.quantity });
    if (destinationStock) {
      await ctx.db.patch(destinationStock._id, { quantity: destinationStock.quantity + args.quantity });
    } else {
      await ctx.db.insert("stockByLocation", { productId: args.productId, locationId: args.toLocationId, areaId: toAreaId as any, quantity: args.quantity });
    }

    if (globalStock) {
      const movementId = await ctx.db.insert("stockMovements", {
        productId: args.productId, type: "transfer", quantity: args.quantity,
        previousPhysical: globalStock.physicalQuantity, newPhysical: globalStock.physicalQuantity,
        previousReserved: globalStock.reservedQuantity, newReserved: globalStock.reservedQuantity,
        userId, areaId: fromAreaId as any, locationId: args.fromLocationId,
        toLocationId: args.toLocationId, toAreaId: toAreaId as any,
        observation: `Transferência: ${fromArea.name}/${fromLocation.name} → ${toArea.name}/${toLocation.name}`,
        timestamp: now,
      });
      // Preserva a origem exata de cada lote consumido pela transferência.
      for (const part of planned) {
        await ctx.db.insert("stockMovementLots", {
          movementId,
          lotId: part.lotId,
          quantity: part.quantity,
          areaId: fromAreaId as any,
          locationId: args.fromLocationId,
        });
      }
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "transfer_stock", entity: "stockTransfers", entityId: transferId,
      details: `Transferência de ${args.quantity} ${product.name}: ${fromArea.name}/${fromLocation.name} → ${toArea.name}/${toLocation.name}; ${planned.length} lote(s) com origem rastreável.`,
      timestamp: now,
    });
    return transferId;
  },
});
