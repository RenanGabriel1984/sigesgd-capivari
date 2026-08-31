import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

async function requireStockManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem movimentar estoque");
  }
  return { userId, user };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const movements = await ctx.db.query("stockMovements").withIndex("by_timestamp").order("desc").take(200);
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
    const movements = await ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", args.productId)).order("desc").collect();
    return Promise.all(movements.map(async (m) => {
      const user = await ctx.db.get(m.userId);
      const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
      return { ...m, user, supplier };
    }));
  },
});

export const createEntry = mutation({
  args: {
    productId: v.id("products"), quantity: v.number(),
    supplierId: v.optional(v.id("suppliers")),
    documentNumber: v.optional(v.string()), observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (args.quantity <= 0) throw new Error("A quantidade deve ser positiva");
    if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.productId)).first();
    const prevPhysical = stock?.physicalQuantity ?? 0;
    const prevReserved = stock?.reservedQuantity ?? 0;
    const newPhysical = prevPhysical + args.quantity;
    if (stock) { await ctx.db.patch(stock._id, { physicalQuantity: newPhysical }); }
    else { await ctx.db.insert("stock", { productId: args.productId, physicalQuantity: args.quantity, reservedQuantity: 0 }); }
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId, type: "entry", quantity: args.quantity,
      previousPhysical: prevPhysical, newPhysical, previousReserved: prevReserved, newReserved: prevReserved,
      userId, supplierId: args.supplierId, documentNumber: args.documentNumber, observation: args.observation, timestamp: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "move_stock", entity: "stockMovements", entityId: movementId,
      details: `Entrada de ${args.quantity} unidade(s)`, timestamp: Date.now(),
    });
    return movementId;
  },
});

export const createExit = mutation({
  args: {
    productId: v.id("products"), quantity: v.number(),
    requestId: v.optional(v.id("requests")), observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (args.quantity <= 0) throw new Error("A quantidade deve ser positiva");
    if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.productId)).first();
    if (!stock) throw new Error("Produto não possui registro de estoque");
    const available = stock.physicalQuantity - stock.reservedQuantity;
    if (available < args.quantity) {
      throw new Error(`Estoque insuficiente. Disponível: ${available}. Solicitado: ${args.quantity}.`);
    }
    const prevPhysical = stock.physicalQuantity;
    const prevReserved = stock.reservedQuantity;
    const newPhysical = prevPhysical - args.quantity;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId, type: "exit", quantity: args.quantity,
      previousPhysical: prevPhysical, newPhysical, previousReserved: prevReserved, newReserved: prevReserved,
      userId, requestId: args.requestId, observation: args.observation, timestamp: Date.now(),
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
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.productId)).first();
    if (!stock) throw new Error("Registro de estoque não encontrado");
    const available = stock.physicalQuantity - stock.reservedQuantity;
    if (available < args.quantity) {
      throw new Error(`Estoque insuficiente. Disponível: ${available}. Solicitado: ${args.quantity}.`);
    }
    await ctx.db.patch(stock._id, { reservedQuantity: stock.reservedQuantity + args.quantity });
    return stock._id;
  },
});

export const editEntry = mutation({
  args: {
    movementId: v.id("stockMovements"),
    quantity: v.number(),
    documentNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (args.quantity <= 0) throw new Error("A quantidade deve ser maior que zero");
    if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");
    const movement = await ctx.db.get(args.movementId);
    if (!movement) throw new Error("Movimentação não encontrada");
    if (movement.type !== "entry") throw new Error("Apenas entradas podem ser editadas");
    if (movement.canceled) throw new Error("Entrada cancelada não pode ser editada");
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", movement.productId)).first();
    if (!stock) throw new Error("Registro de estoque não encontrado");
    const diff = args.quantity - movement.quantity;
    if (diff < 0 && stock.physicalQuantity + diff < 0) {
      throw new Error(`A redução deixaria o saldo negativo. Saldo atual: ${stock.physicalQuantity}. Redução: ${Math.abs(diff)}.`);
    }
    const newPhysical = stock.physicalQuantity + diff;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    await ctx.db.patch(args.movementId, {
      quantity: args.quantity,
      newPhysical: newPhysical,
      documentNumber: args.documentNumber,
      observation: args.observation,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "stockMovements", entityId: args.movementId,
      details: `Edição de entrada: quantidade ${movement.quantity} → ${args.quantity}. ${args.observation ? `Motivo: ${args.observation}` : ""}`,
      timestamp: Date.now(),
    });
    return args.movementId;
  },
});

export const reverseEntry = mutation({
  args: {
    movementId: v.id("stockMovements"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (!args.reason.trim()) throw new Error("O motivo do estorno é obrigatório");
    const movement = await ctx.db.get(args.movementId);
    if (!movement) throw new Error("Movimentação não encontrada");
    if (movement.type !== "entry") throw new Error("Apenas entradas podem ser estornadas");
    if (movement.canceled) throw new Error("Esta entrada já foi estornada");
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", movement.productId)).first();
    if (!stock) throw new Error("Registro de estoque não encontrado");
    if (stock.physicalQuantity < movement.quantity) {
      throw new Error(`Estoque insuficiente para estorno. Saldo atual: ${stock.physicalQuantity}. Quantidade da entrada: ${movement.quantity}.`);
    }
    const newPhysical = stock.physicalQuantity - movement.quantity;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    await ctx.db.patch(args.movementId, { canceled: true, canceledAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId, action: "cancel", entity: "stockMovements", entityId: args.movementId,
      details: `Estorno de entrada: ${movement.quantity} unidade(s). Motivo: ${args.reason.trim()}`,
      timestamp: Date.now(),
    });
    return args.movementId;
  },
});

export const createAdjustment = mutation({
  args: { productId: v.id("products"), newQuantity: v.number(), observation: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (args.newQuantity < 0) throw new Error("A quantidade não pode ser negativa");
    if (!isFinite(args.newQuantity)) throw new Error("Quantidade inválida");
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.productId)).first();
    if (!stock) throw new Error("Registro de estoque não encontrado");
    const prevPhysical = stock.physicalQuantity;
    const diff = args.newQuantity - prevPhysical;
    await ctx.db.patch(stock._id, { physicalQuantity: args.newQuantity });
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId, type: "adjustment", quantity: Math.abs(diff),
      previousPhysical: prevPhysical, newPhysical: args.newQuantity,
      previousReserved: stock.reservedQuantity, newReserved: stock.reservedQuantity,
      userId, observation: args.observation, timestamp: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "move_stock", entity: "stockMovements", entityId: movementId,
      details: `Ajuste: ${prevPhysical} → ${args.newQuantity}`, timestamp: Date.now(),
    });
    return movementId;
  },
});
