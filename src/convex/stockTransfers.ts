import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { planTransfer } from "../lib/transfer-rules";
import { requirePermission } from "./rbac";
import { getOptionalSingleValidGlobalStock, validateUniqueScopedStockRows } from "../lib/stock-read-integrity";

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
      const responsible = await ctx.db.get(t.responsibleUserId);
      return { ...t, product, lot, fromLocation, toLocation, responsible };
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
      return { ...t, fromLocation, toLocation };
    }));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    productId: v.id("products"),
    lotId: v.optional(v.id("lots")),
    fromLocationId: v.id("storageLocations"),
    toLocationId: v.id("storageLocations"),
    quantity: v.number(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // RBAC central: criar transferência (opera estoque).
    const { userId, user } = await requirePermission(ctx, "transfers.create", { entity: "stockTransfers" });

    if (args.quantity <= 0) throw new Error("Quantidade deve ser maior que zero");
    if (args.fromLocationId === args.toLocationId) throw new Error("Origem e destino não podem ser o mesmo local");

    // Validate locations
    const fromLocation = await ctx.db.get(args.fromLocationId);
    if (!fromLocation) throw new Error("Local de origem não encontrado");
    const toLocation = await ctx.db.get(args.toLocationId);
    if (!toLocation) throw new Error("Local de destino não encontrado");

    // Validate product
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");

    // A transferência rastreada exige lote e saldo atual no armário de origem.
    // Nunca reduzir quantityAvailable do lote: transferir muda a localização,
    // não consome material.
    let sourceLotLocation: any = null;
    let destinationLotLocation: any = null;
    let lotDoc: any = null;
    if (args.lotId) {
      lotDoc = await ctx.db.get(args.lotId);
      if (!lotDoc) throw new Error("Lote não encontrado");
      if (lotDoc.productId !== args.productId) throw new Error("Lote não corresponde ao produto");
      const lotLocations = await ctx.db.query("lotLocationBalances")
        .withIndex("by_lot", (q: any) => q.eq("lotId", args.lotId))
        .collect();
      const fromRows = lotLocations.filter((row: any) => row.locationId === args.fromLocationId);
      const toRows = lotLocations.filter((row: any) => row.locationId === args.toLocationId);
      if (fromRows.length > 1 || toRows.length > 1) {
        throw new Error("Há saldos duplicados do lote por armário. Regularize antes de transferir.");
      }
      sourceLotLocation = fromRows[0] ?? null;
      destinationLotLocation = toRows[0] ?? null;
      if (!sourceLotLocation) {
        throw new Error("Não há saldo rastreável deste lote no armário de origem. É necessária regularização do legado antes da transferência.");
      }
      if (!Number.isFinite(sourceLotLocation.quantityAvailable) || sourceLotLocation.quantityAvailable < args.quantity) {
        throw new Error(`Saldo do lote no armário de origem insuficiente. Disponível: ${sourceLotLocation.quantityAvailable}.`);
      }
    } else {
      const activeLots = await ctx.db.query("lots")
        .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
        .collect();
      if (activeLots.some((lot: any) => lot.active && lot.quantityAvailable > 0)) {
        throw new Error("Selecione o lote para transferir: o produto possui saldo rastreado por lote.");
      }
    }

    // Check source location stock
    const fromStock = await ctx.db
      .query("stockByLocation")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    validateUniqueScopedStockRows(fromStock, product.name);
    const sourceStock = fromStock.find((s: any) => s.locationId === args.fromLocationId);
    if (!sourceStock || sourceStock.quantity < args.quantity) {
      const available = sourceStock?.quantity ?? 0;
      throw new Error(`Estoque insuficiente no local de origem. Disponível: ${available}. Transferência: ${args.quantity}.`);
    }

    const now = Date.now();

    // Destino + lote (referências para o plano puro)
    const toStock = await ctx.db
      .query("stockByLocation")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    validateUniqueScopedStockRows(toStock, product.name);
    const destStock = toStock.find((s: any) => s.locationId === args.toLocationId);
    const destStockQuantity = destStock?.quantity ?? 0;
    const lotDoc = args.lotId ? await ctx.db.get(args.lotId) : null;

    // Plano puro: valida quantidades e monta registro + auditoria.
    // A origem reduz, o destino aumenta e o lote/origem é PRESERVADO.
    const plan = planTransfer({
      productName: product.name,
      quantity: args.quantity,
      fromQuantity: sourceStock.quantity,
      toQuantity: destStockQuantity,
      fromLocationName: fromLocation.name,
      toLocationName: toLocation.name,
      lotId: args.lotId,
      lotNumber: lotDoc?.lotNumber ?? null,
      reason: args.observation ?? null,
    });

    // Decrease source location
    await ctx.db.patch(sourceStock._id, { quantity: plan.fromQuantityAfter });

    // Increase destination location (or create)
    if (destStock) {
      await ctx.db.patch(destStock._id, { quantity: plan.toQuantityAfter });
    } else {
      await ctx.db.insert("stockByLocation", {
        productId: args.productId,
        locationId: args.toLocationId,
        quantity: args.quantity,
      });
    }

    // Atualiza somente a distribuição física do lote. O total do lote
    // permanece inalterado, pois transferência não é saída/consumo.
    if (args.lotId && sourceLotLocation) {
      await ctx.db.patch(sourceLotLocation._id, {
        quantityAvailable: sourceLotLocation.quantityAvailable - args.quantity,
        updatedAt: now,
      });
      if (destinationLotLocation) {
        await ctx.db.patch(destinationLotLocation._id, {
          quantityAvailable: destinationLotLocation.quantityAvailable + args.quantity,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("lotLocationBalances", {
          lotId: args.lotId,
          productId: args.productId,
          locationId: args.toLocationId,
          quantityAvailable: args.quantity,
          updatedAt: now,
        });
      }
    }

    // Create transfer record
    const transferId = await ctx.db.insert("stockTransfers", {
      productId: args.productId,
      lotId: args.lotId,
      fromLocationId: args.fromLocationId,
      toLocationId: args.toLocationId,
      quantity: args.quantity,
      responsibleUserId: userId,
      observation: args.observation,
      createdAt: now,
    });

    // Create stock movement (transfer type — no global stock change)
    const globalStockRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const globalStock = getOptionalSingleValidGlobalStock(globalStockRows, product.name);
    if (globalStock) {
      await ctx.db.insert("stockMovements", {
        productId: args.productId,
        type: "transfer",
        quantity: args.quantity,
        previousPhysical: globalStock.physicalQuantity,
        newPhysical: globalStock.physicalQuantity,
        previousReserved: globalStock.reservedQuantity,
        newReserved: globalStock.reservedQuantity,
        userId,
        observation: `Transferência: ${fromLocation.name} → ${toLocation.name}`,
        timestamp: now,
      });
    }

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "transfer_stock",
      entity: "stockTransfers",
      entityId: transferId,
      details: plan.auditDetail,
      timestamp: now,
    });

    return transferId;
  },
});
