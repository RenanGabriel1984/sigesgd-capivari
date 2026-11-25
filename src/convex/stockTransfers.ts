import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { planTransfer } from "../lib/transfer-rules";
import { planLotLocationTransfer } from "../lib/lot-location-rules";
import { requireSingleValidGlobalStock, validateUniqueScopedStockRows } from "../lib/stock-read-integrity";
import { assertProductLedgerConsistent, assertProductReservationConsistent } from "./lotLocationLedger";
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
      const lot: any = t.lotId ? await ctx.db.get(t.lotId) : null;
      const fromLocation = await ctx.db.get(t.fromLocationId);
      const toLocation = await ctx.db.get(t.toLocationId);
      const responsible = await ctx.db.get(t.responsibleUserId);
      const area = lot?.areaId ? await ctx.db.get(lot.areaId) : null;
      const movement = t.movementId ? await ctx.db.get(t.movementId) : null;
      return { ...t, product, lot, area, movement, fromLocation, toLocation, responsible };
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
      const lot: any = t.lotId ? await ctx.db.get(t.lotId) : null;
      const area = lot?.areaId ? await ctx.db.get(lot.areaId) : null;
      const movement = t.movementId ? await ctx.db.get(t.movementId) : null;
      return { ...t, lot, area, movement, fromLocation, toLocation };
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

    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Quantidade deve ser um número finito maior que zero");
    if (args.fromLocationId === args.toLocationId) throw new Error("Origem e destino não podem ser o mesmo local");

    // Validate locations
    const fromLocation = await ctx.db.get(args.fromLocationId);
    if (!fromLocation) throw new Error("Local de origem não encontrado");
    const toLocation = await ctx.db.get(args.toLocationId);
    if (!toLocation) throw new Error("Local de destino não encontrado");
    if (fromLocation.active === false) {
      throw new Error("O armário de origem está inativo. Reative-o antes de transferir materiais.");
    }
    if (toLocation.active === false) {
      throw new Error("O armário de destino está inativo. Selecione um armário ativo.");
    }

    // Validate product
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");

    // Transferir altera a distribuição física, não a reserva. A reserva precisa
    // continuar conciliada com as solicitações aprovadas antes de mover saldo.
    const reservationStock = await assertProductLedgerConsistent(ctx, args.productId, product.name);
    if (!reservationStock) throw new Error("Registro global de estoque não encontrado para transferir.");
    await assertProductReservationConsistent(ctx, args.productId, product.name, reservationStock);

    // A transferência rastreada exige lote e saldo atual no armário de origem.
    // Nunca reduzir quantityAvailable do lote: transferir muda a localização,
    // não consome material.
    let sourceLotLocation: any = null;
    let destinationLotLocation: any = null;
    let lotLocationPlan: ReturnType<typeof planLotLocationTransfer> | null = null;
    let lotDoc: any = null;
    if (args.lotId) {
      lotDoc = await ctx.db.get(args.lotId);
      if (!lotDoc) throw new Error("Lote não encontrado");
      if (lotDoc.productId !== args.productId) throw new Error("Lote não corresponde ao produto");
      if (lotDoc.active === false) throw new Error("Lote inativo não pode ser transferido.");
      const [lotLocations, productLots, allBalances, locationRows, globalRows] = await Promise.all([
        ctx.db.query("lotLocationBalances")
          .withIndex("by_lot", (q: any) => q.eq("lotId", args.lotId))
          .collect(),
        ctx.db.query("lots")
          .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
          .collect(),
        ctx.db.query("lotLocationBalances")
          .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
          .collect(),
        ctx.db.query("stockByLocation")
          .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
          .collect(),
        ctx.db.query("stock")
          .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
          .collect(),
      ]);
      validateUniqueScopedStockRows(locationRows, product.name);
      const globalStock = requireSingleValidGlobalStock(globalRows, product.name);
      const balanceKeys = new Set<string>();
      const balancesByLot = new Map<string, number>();
      const balancesByLocation = new Map<string, number>();
      const knownLots = new Set(productLots.map((lot: any) => String(lot._id)));
      for (const balance of allBalances as any[]) {
        const lotKey = String(balance.lotId);
        const locationKey = String(balance.locationId);
        if (!knownLots.has(lotKey) || !Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
          throw new Error("Há saldo lote/armário inválido. Regularize antes de transferir.");
        }
        const key = `${lotKey}::${locationKey}`;
        if (balanceKeys.has(key)) throw new Error("Há saldos duplicados de lote por armário. Regularize antes de transferir.");
        balanceKeys.add(key);
        balancesByLot.set(lotKey, (balancesByLot.get(lotKey) ?? 0) + balance.quantityAvailable);
        balancesByLocation.set(locationKey, (balancesByLocation.get(locationKey) ?? 0) + balance.quantityAvailable);
      }
      for (const lot of productLots as any[]) {
        const distributed = balancesByLot.get(String(lot._id)) ?? 0;
        if (Math.abs(distributed - lot.quantityAvailable) > 1e-9) {
          throw new Error(`O lote ${lot.lotNumber} não está conciliado por armário. Regularize antes de transferir.`);
        }
      }
      const physicalByLocation = new Map(locationRows.map((row: any) => [String(row.locationId), row.quantity]));
      const locationIds = new Set([...physicalByLocation.keys(), ...balancesByLocation.keys()]);
      for (const locationId of locationIds) {
        if (Math.abs((physicalByLocation.get(locationId) ?? 0) - (balancesByLocation.get(locationId) ?? 0)) > 1e-9) {
          throw new Error(`O saldo lote/armário diverge do saldo físico no local ${locationId}. Regularize antes de transferir.`);
        }
      }
      const locationTotal = locationRows.reduce((sum: number, row: any) => sum + row.quantity, 0);
      if (Math.abs(globalStock.physicalQuantity - locationTotal) > 1e-9) {
        throw new Error("O saldo global diverge do saldo por armário. Transferência bloqueada.");
      }
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
      lotLocationPlan = planLotLocationTransfer({
        sourceQuantity: sourceLotLocation.quantityAvailable,
        destinationQuantity: destinationLotLocation?.quantityAvailable ?? 0,
        quantity: args.quantity,
      });
    } else {
      const [productLots, existingLotBalances] = await Promise.all([
        ctx.db.query("lots")
          .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
          .collect(),
        ctx.db.query("lotLocationBalances")
          .withIndex("by_product", (q: any) => q.eq("productId", args.productId))
          .collect(),
      ]);
      if (productLots.length > 0 || existingLotBalances.length > 0) {
        throw new Error(
          "Este produto possui histórico de lotes. Selecione o lote da transferência; se o saldo estiver sem classificação, regularize o inventário antes de transferir.",
        );
      }
      const [globalRows, locationRows] = await Promise.all([
        ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect(),
        ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect(),
      ]);
      const globalStock = requireSingleValidGlobalStock(globalRows, product.name);
      validateUniqueScopedStockRows(locationRows, product.name);
      const locationTotal = locationRows.reduce((sum: number, row: any) => sum + row.quantity, 0);
      if (Math.abs(globalStock.physicalQuantity - locationTotal) > 1e-9) {
        throw new Error("O saldo global diverge do saldo por armário. Transferência bloqueada.");
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
    // lotDoc já foi validado antes da leitura/escrita dos saldos.

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
        quantityAvailable: lotLocationPlan!.sourceQuantityAfter,
        updatedAt: now,
      });
      if (destinationLotLocation) {
        await ctx.db.patch(destinationLotLocation._id, {
          quantityAvailable: lotLocationPlan!.destinationQuantityAfter,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("lotLocationBalances", {
          lotId: args.lotId,
          productId: args.productId,
          locationId: args.toLocationId,
          quantityAvailable: lotLocationPlan!.destinationQuantityAfter,
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

    // O ledger global/reservas foi validado antes das alterações por armário.
    // O movimento é obrigatório e vincula origem, destino, lote, área e transferência.
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "transfer",
      quantity: args.quantity,
      previousPhysical: reservationStock.physicalQuantity,
      newPhysical: reservationStock.physicalQuantity,
      previousReserved: reservationStock.reservedQuantity,
      newReserved: reservationStock.reservedQuantity,
      userId,
      transferId,
      locationId: args.fromLocationId,
      toLocationId: args.toLocationId,
      areaId: lotDoc?.areaId,
      lotId: lotDoc?.lotNumber,
      observation: `Transferência: ${fromLocation.name} → ${toLocation.name}`,
      timestamp: now,
    });
    await ctx.db.patch(transferId, { movementId });

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
