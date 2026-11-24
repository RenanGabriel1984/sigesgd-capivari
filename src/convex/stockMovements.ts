import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import type { Id } from "./_generated/dataModel";
import { getOptionalSingleValidGlobalStock, requireSingleValidGlobalStock } from "../lib/stock-read-integrity";
import { assertProductReservationConsistent, consumeLotLocationStock, recordLotMovementAllocations, resolveWithdrawalLocation } from "./lotLocationLedger";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function assertLegacyMovementIsUntracked(ctx: any, productId: any, productName: string) {
  const [lots, balances, locations] = await Promise.all([
    ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", productId)).collect(),
    ctx.db.query("lotLocationBalances").withIndex("by_product", (q: any) => q.eq("productId", productId)).collect(),
    ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", productId)).collect(),
  ]);
  if (lots.some((lot: any) => lot.active && lot.quantityAvailable > 0) || balances.length > 0 || locations.some((row: any) => row.quantity > 0)) {
    throw new Error(`A operação direta sem lote/armário não é permitida para "${productName}". Use Entrada, Saída ou Inventário com rastreabilidade por área e armário.`);
  }
}


async function requireUser(ctx: any) {
  // RBAC central: histórico/movimentações visíveis a quem consulta estoque.
  return requirePermission(ctx, "movements.view");
}

async function requireStockManagerOrAdmin(ctx: any) {
  // RBAC central: movimentação direta de estoque.
  return requirePermission(ctx, "stock.mutate", { entity: "stockMovements" });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const movements = await ctx.db.query("stockMovements").withIndex("by_timestamp").order("desc").collect();
    return Promise.all(movements.map(async (m) => {
      const product = await ctx.db.get(m.productId);
      const user = await ctx.db.get(m.userId);
      const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
      return { ...m, product, user, supplier };
    }));
  },
});

export const byProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const movements = await ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", args.productId)).order("desc").collect();
    return Promise.all(movements.map(async (m) => {
      const user = await ctx.db.get(m.userId);
      const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
      return { ...m, user, supplier };
    }));
  },
});

/**
 * Endpoint legado mantido apenas para compatibilidade de nome.
 * Entradas operacionais devem passar por entries.create/confirm, que registram
 * área, local físico, lote, item documental e saldo global atomicamente.
 * Este endpoint não recebe essas dimensões e, portanto, não pode gravar estoque.
 */
export const createEntry = mutation({
  args: {
    productId: v.id("products"), quantity: v.number(),
    supplierId: v.optional(v.id("suppliers")),
    documentNumber: v.optional(v.string()), observation: v.optional(v.string()),
  },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error(
      "Entrada direta legada desativada: utilize o fluxo de Entradas para registrar documento, área, armário e lote.",
    );
  },
});

export const createExit = mutation({
  args: {
    productId: v.id("products"), quantity: v.number(),
    locationId: v.optional(v.id("storageLocations")),
    areaId: v.optional(v.id("stockAreas")),
    requestId: v.optional(v.id("requests")), observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (args.requestId) {
      throw new Error("Entregas vinculadas a solicitações devem usar requests.deliver para baixar físico e liberar a reserva juntos.");
    }
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("A quantidade deve ser positiva e finita");
    if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");
    const stockRows = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.productId)).collect();
    const stock = requireSingleValidGlobalStock(stockRows, String(args.productId));
    await assertProductReservationConsistent(ctx, args.productId, String(args.productId), stock);
    const available = stock.physicalQuantity - stock.reservedQuantity;
    if (available < args.quantity) {
      throw new Error(`Estoque insuficiente. Disponível: ${available}. Solicitado: ${args.quantity}.`);
    }
    const sourceLocationId = await resolveWithdrawalLocation(ctx, args.productId, args.locationId);
    const lotConsumption = await consumeLotLocationStock(ctx, {
      productId: args.productId,
      locationId: sourceLocationId,
      areaId: args.areaId,
      quantity: args.quantity,
    });
    const sourceLocation = await ctx.db.get(sourceLocationId as Id<"storageLocations">);
    const prevPhysical = stock.physicalQuantity;
    const prevReserved = stock.reservedQuantity;
    const newPhysical = prevPhysical - args.quantity;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId, type: "exit", quantity: args.quantity,
      previousPhysical: prevPhysical, newPhysical, previousReserved: prevReserved, newReserved: prevReserved,
      userId, requestId: args.requestId,
      lotId: lotConsumption.allocations[0]?.lotId as any,
      locationId: sourceLocationId,
      observation: `${args.observation ?? "Saída direta"} — armário ${sourceLocation?.name ?? sourceLocationId}; lotes: ${lotConsumption.allocations.map((a) => `${a.lotNumber}(${a.quantity})`).join(", ")}`,
      timestamp: Date.now(),
    });
    await recordLotMovementAllocations(ctx, {
      movementId, productId: args.productId, locationId: sourceLocationId,
      allocations: lotConsumption.allocations,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "move_stock", entity: "stockMovements", entityId: movementId,
      details: `Saída de ${args.quantity} unidade(s)`, timestamp: Date.now(),
    });
    return movementId;
  },
});

export const reserveStock = mutation({
  args: { productId: v.id("products"), quantity: v.number(), requestId: v.id("requests") },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Reserva direta legada desativada. As reservas são criadas exclusivamente pela aprovação em requests.approve.");
  },
});


export const editEntry = mutation({
  args: {
    movementId: v.id("stockMovements"),
    quantity: v.number(),
    documentNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Edição direta de entrada legada desativada. Edite o rascunho antes da confirmação; entradas confirmadas devem ser estornadas pelo fluxo de Entradas.");
  },
});


export const reverseEntry = mutation({
  args: {
    movementId: v.id("stockMovements"),
    reason: v.string(),
  },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Estorno direto de movimentação legado desativado. Utilize entries.reverse para estornar a entrada completa com rastreabilidade por lote e armário.");
  },
});


export const createAdjustment = mutation({
  args: { productId: v.id("products"), newQuantity: v.number(), observation: v.string() },
  handler: async (ctx) => {
    await requireStockManagerOrAdmin(ctx);
    throw new Error("Ajuste direto legado desativado. Utilize inventário por armário/lote para corrigir o saldo físico.");
  },
});
