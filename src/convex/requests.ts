import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Types ───────────────────────────────────────────────────────────────────
type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

const ROLES_WITH_FULL_VISIBILITY: UserRole[] = [
  "admin",
  "stock_manager",
  "director",
  "secretary",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

function hasFullVisibility(role: UserRole | undefined): boolean {
  if (!role) return false;
  return ROLES_WITH_FULL_VISIBILITY.includes(role);
}

async function enrichRequest(ctx: any, r: any) {
  const requester = await ctx.db.get(r.requesterId);
  const approver = r.approverId ? await ctx.db.get(r.approverId) : null;
  const items = await ctx.db
    .query("requestItems")
    .withIndex("by_request", (q: any) => q.eq("requestId", r._id))
    .collect();
  const itemsWithProduct = await Promise.all(
    items.map(async (item: any) => {
      const product = await ctx.db.get(item.productId);
      return { ...item, product };
    })
  );
  return { ...r, requester, approver, items: itemsWithProduct };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    let requests;
    if (hasFullVisibility(role)) {
      requests = await ctx.db.query("requests").withIndex("by_created").order("desc").take(200);
    } else {
      requests = await ctx.db.query("requests").withIndex("by_requester", (q) => q.eq("requesterId", user._id)).order("desc").take(200);
    }
    return Promise.all(requests.map(async (r) => enrichRequest(ctx, r)));
  },
});

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (!hasFullVisibility(role) && args.userId !== user._id) {
      throw new Error("Acesso negado");
    }
    const requests = await ctx.db.query("requests").withIndex("by_requester", (q) => q.eq("requesterId", args.userId)).order("desc").take(100);
    return Promise.all(requests.map(async (r) => enrichRequest(ctx, r)));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    observation: v.optional(v.string()),
    items: v.array(v.object({
      productId: v.id("products"),
      quantityRequested: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    if (args.items.length === 0) throw new Error("A solicitação deve ter pelo menos um item");
    for (const item of args.items) {
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error("Produto não encontrado");
      if (!product.active) throw new Error(`O produto "${product.name}" está inativo`);
      if (typeof item.quantityRequested !== "number" || !isFinite(item.quantityRequested)) {
        throw new Error("Quantidade inválida");
      }
      if (item.quantityRequested <= 0) throw new Error("A quantidade deve ser maior que zero");
      if (product.unitOfMeasure === "un" && !Number.isInteger(item.quantityRequested)) {
        throw new Error("A quantidade deve ser um número inteiro para esta unidade");
      }
    }
    const now = Date.now();
    const requestId = await ctx.db.insert("requests", {
      requesterId: userId, status: "pending", observation: args.observation, createdAt: now, updatedAt: now,
    });
    for (const item of args.items) {
      await ctx.db.insert("requestItems", {
        requestId, productId: item.productId, quantityRequested: item.quantityRequested, quantityApproved: 0, quantityDelivered: 0,
      });
    }
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "requests", entityId: requestId,
      details: `Solicitação criada com ${args.items.length} item(ns)`, timestamp: now,
    });
    return requestId;
  },
});

export const approve = mutation({
  args: {
    requestId: v.id("requests"),
    items: v.array(v.object({ itemId: v.id("requestItems"), quantityApproved: v.number() })),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (role === "technician") throw new Error("Técnicos não podem aprovar solicitações");
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    if (request.requesterId === userId) throw new Error("Não é possível aprovar sua própria solicitação");
    if (request.status !== "pending") throw new Error("Solicitação não está pendente");

    for (const item of args.items) {
      if (item.quantityApproved <= 0) continue;
      const requestItem = await ctx.db.get(item.itemId);
      if (!requestItem) throw new Error(`Item da solicitação não encontrado: ${item.itemId}`);
      if (requestItem.requestId !== args.requestId) throw new Error("O item não pertence a esta solicitação");
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", requestItem.productId)).first();
      if (stock) {
        const available = stock.physicalQuantity - stock.reservedQuantity;
        if (available < item.quantityApproved) {
          throw new Error(`Estoque insuficiente para aprovação. Disponível: ${available}. Aprovado: ${item.quantityApproved}.`);
        }
      } else {
        throw new Error("Registro de estoque não encontrado para este produto");
      }
    }

    const now = Date.now();
    for (const item of args.items) {
      if (item.quantityApproved <= 0) { await ctx.db.patch(item.itemId, { quantityApproved: 0 }); continue; }
      const requestItem = await ctx.db.get(item.itemId);
      if (!requestItem) continue;
      await ctx.db.patch(item.itemId, { quantityApproved: item.quantityApproved });
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", requestItem.productId)).first();
      if (stock) {
        await ctx.db.patch(stock._id, { reservedQuantity: stock.reservedQuantity + item.quantityApproved });
      }
    }
    await ctx.db.patch(args.requestId, {
      status: "approved", approverId: userId, updatedAt: now, observation: args.observation ?? request.observation,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "approve", entity: "requests", entityId: args.requestId,
      details: "Solicitação aprovada", timestamp: now,
    });
    return args.requestId;
  },
});

export const reject = mutation({
  args: { requestId: v.id("requests"), observation: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (role === "technician") throw new Error("Técnicos não podem rejeitar solicitações");
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    if (request.requesterId === userId) throw new Error("Não é possível rejeitar sua própria solicitação");
    if (request.status !== "pending") throw new Error("Solicitação não está pendente");
    const now = Date.now();
    await ctx.db.patch(args.requestId, { status: "rejected", approverId: userId, updatedAt: now, observation: args.observation });
    await ctx.db.insert("auditLogs", {
      userId, action: "reject", entity: "requests", entityId: args.requestId,
      details: "Solicitação rejeitada", timestamp: now,
    });
    return args.requestId;
  },
});

export const deliver = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    if (request.status !== "approved") throw new Error("Solicitação deve estar aprovada");
    const items = await ctx.db.query("requestItems").withIndex("by_request", (q) => q.eq("requestId", args.requestId)).collect();
    if (items.length === 0) throw new Error("Solicitação não possui itens");

    const stockUpdates: Array<{ stockId: string; productId: string; quantity: number }> = [];
    for (const item of items) {
      if (item.quantityApproved <= 0) continue;
      const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", item.productId)).first();
      if (!stock) throw new Error(`Registro de estoque não encontrado para o produto ${item.productId}`);
      if (stock.physicalQuantity < item.quantityApproved) {
        throw new Error(`Estoque insuficiente. Disponível: ${stock.physicalQuantity}. Solicitado: ${item.quantityApproved}.`);
      }
      if (stock.reservedQuantity < item.quantityApproved) {
        throw new Error(`Estoque reservado insuficiente. Reservado: ${stock.reservedQuantity}. Solicitado: ${item.quantityApproved}.`);
      }
      stockUpdates.push({ stockId: stock._id, productId: item.productId, quantity: item.quantityApproved });
    }

    const now = Date.now();
    for (const update of stockUpdates) {
      const freshStock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", update.productId as any)).first();
      if (!freshStock) throw new Error("Registro de estoque desapareceu durante a entrega");
      if (freshStock.physicalQuantity < update.quantity) {
        throw new Error(`Estoque insuficiente (concorrência). Disponível: ${freshStock.physicalQuantity}. Solicitado: ${update.quantity}.`);
      }
      if (freshStock.reservedQuantity < update.quantity) {
        throw new Error(`Estoque reservado insuficiente (concorrência). Reservado: ${freshStock.reservedQuantity}. Solicitado: ${update.quantity}.`);
      }
      const newPhysical = freshStock.physicalQuantity - update.quantity;
      const newReserved = freshStock.reservedQuantity - update.quantity;
      await ctx.db.patch(freshStock._id, { physicalQuantity: newPhysical, reservedQuantity: newReserved });
      await ctx.db.insert("stockMovements", {
        productId: update.productId as any, type: "exit", quantity: update.quantity,
        previousPhysical: freshStock.physicalQuantity, newPhysical,
        previousReserved: freshStock.reservedQuantity, newReserved,
        userId, requestId: args.requestId, observation: "Entrega da solicitação", timestamp: now,
      });
    }
    for (const item of items) {
      if (item.quantityApproved > 0) await ctx.db.patch(item._id, { quantityDelivered: item.quantityApproved });
    }
    await ctx.db.patch(args.requestId, { status: "delivered", updatedAt: now });
    await ctx.db.insert("auditLogs", {
      userId, action: "deliver", entity: "requests", entityId: args.requestId,
      details: `Solicitação entregue (${stockUpdates.length} item(ns))`, timestamp: now,
    });
    return args.requestId;
  },
});

export const cancel = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    if (request.requesterId !== userId) throw new Error("Só é possível cancelar suas próprias solicitações");
    if (request.status !== "pending") throw new Error("Só é possível cancelar solicitações pendentes");
    const now = Date.now();
    await ctx.db.patch(args.requestId, { status: "cancelled", updatedAt: now });
    await ctx.db.insert("auditLogs", {
      userId, action: "reject", entity: "requests", entityId: args.requestId,
      details: "Solicitação cancelada pelo solicitante", timestamp: now,
    });
    return args.requestId;
  },
});

export const pendingCount = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (hasFullVisibility(role)) {
      const pending = await ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", "pending")).collect();
      return pending.length;
    }
    const pending = await ctx.db.query("requests").withIndex("by_requester", (q) => q.eq("requesterId", user._id)).collect();
    return pending.filter((r) => r.status === "pending").length;
  },
});
