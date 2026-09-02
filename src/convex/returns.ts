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

// ─── Queries ─────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const returns = await ctx.db.query("returns").order("desc").take(200);
    return Promise.all(returns.map(async (r: any) => {
      const product = await ctx.db.get(r.productId);
      const lot = r.lotId ? await ctx.db.get(r.lotId) : null;
      const returnedBy = await ctx.db.get(r.returnedByUserId);
      const receivedBy = await ctx.db.get(r.receivedByUserId);
      const request = await ctx.db.get(r.requestId);
      return { ...r, product, lot, returnedBy, receivedBy, request };
    }));
  },
});

export const listByRequest = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const returns = await ctx.db
      .query("returns")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();
    return Promise.all(returns.map(async (r: any) => {
      const product = await ctx.db.get(r.productId);
      const lot = r.lotId ? await ctx.db.get(r.lotId) : null;
      return { ...r, product, lot };
    }));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    requestId: v.id("requests"),
    requestItemId: v.id("requestItems"),
    productId: v.id("products"),
    lotId: v.optional(v.id("lots")),
    quantity: v.number(),
    reason: v.string(),
    receivedByUserId: v.id("users"),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (role === "technician") throw new Error("Técnicos não podem processar devoluções");

    if (args.quantity <= 0) throw new Error("Quantidade deve ser maior que zero");
    const reason = args.reason.trim();
    if (!reason) throw new Error("O motivo da devolução é obrigatório");

    // Validate request exists and was delivered
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    if (request.status !== "delivered") throw new Error("Só é possível devolver material de solicitação entregue");

    // Validate request item
    const requestItem = await ctx.db.get(args.requestItemId);
    if (!requestItem) throw new Error("Item da solicitação não encontrado");
    if (requestItem.requestId !== args.requestId) throw new Error("Item não pertence a esta solicitação");
    if (requestItem.productId !== args.productId) throw new Error("Produto não corresponde ao item");

    // Validate quantity does not exceed delivered
    const alreadyReturned = await ctx.db
      .query("returns")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();
    const totalReturned = alreadyReturned
      .filter((r: any) => r.requestItemId === args.requestItemId)
      .reduce((sum: number, r: any) => sum + r.quantity, 0);

    const maxReturnable = requestItem.quantityDelivered - totalReturned;
    if (args.quantity > maxReturnable) {
      throw new Error(
        `Quantidade para devolução (${args.quantity}) excede o máximo retornável (${maxReturnable}). ` +
        `Entregue: ${requestItem.quantityRequested}, já devolvido: ${totalReturned}.`
      );
    }

    // Validate receiver
    const receiver = await ctx.db.get(args.receivedByUserId);
    if (!receiver) throw new Error("Usuário recebedor não encontrado");

    // Validate lot if provided
    if (args.lotId) {
      const lot = await ctx.db.get(args.lotId);
      if (!lot) throw new Error("Lote não encontrado");
      if (lot.productId !== args.productId) throw new Error("Lote não corresponde ao produto");
    }

    const now = Date.now();

    // Create return record
    const returnId = await ctx.db.insert("returns", {
      requestId: args.requestId,
      requestItemId: args.requestItemId,
      productId: args.productId,
      lotId: args.lotId,
      quantity: args.quantity,
      reason,
      returnedByUserId: userId,
      receivedByUserId: args.receivedByUserId,
      observation: args.observation,
      createdAt: now,
    });

    // Increase global stock
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    if (!stock) throw new Error("Registro de estoque não encontrado");

    const newPhysical = stock.physicalQuantity + args.quantity;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });

    // Create stock movement
    await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "return",
      quantity: args.quantity,
      previousPhysical: stock.physicalQuantity,
      newPhysical,
      previousReserved: stock.reservedQuantity,
      newReserved: stock.reservedQuantity,
      userId,
      requestId: args.requestId,
      observation: `Devolução: ${reason}`,
      timestamp: now,
    });

    // Increase lot availability if lot is identified
    if (args.lotId) {
      const lot = await ctx.db.get(args.lotId);
      if (lot) {
        await ctx.db.patch(lot._id, {
          quantityAvailable: lot.quantityAvailable + args.quantity,
        });
      }
    }

    // Audit
    const product = await ctx.db.get(args.productId);
    await ctx.db.insert("auditLogs", {
      userId,
      action: "return_stock",
      entity: "returns",
      entityId: returnId,
      details: `Devolução de ${args.quantity} ${product?.name ?? "item"} (solicitação ${request._id})`,
      timestamp: now,
    });

    return returnId;
  },
});
