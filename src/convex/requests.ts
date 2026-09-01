import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { verifyPassword } from "./auth/passwords";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

const ROLES_WITH_FULL_VISIBILITY: UserRole[] = [
  "admin", "stock_manager", "director", "secretary",
];

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
  const secretaria = await ctx.db.get(r.secretariaId);
  const departamento = r.departamentoId ? await ctx.db.get(r.departamentoId) : null;
  const unidade = r.unidadeId ? await ctx.db.get(r.unidadeId) : null;
  const items = await ctx.db
    .query("requestItems")
    .withIndex("by_request", (q: any) => q.eq("requestId", r._id))
    .collect();
  const itemsWithProduct = await Promise.all(
    items.map(async (item: any) => {
      const product = await ctx.db.get(item.productId);
      const printer = item.targetPrinterId ? await ctx.db.get(item.targetPrinterId) : null;
      return { ...item, product, printer };
    })
  );
  return { ...r, requester, approver, secretaria, departamento, unidade, items: itemsWithProduct };
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
    if (!hasFullVisibility(role) && args.userId !== user._id) throw new Error("Acesso negado");
    const requests = await ctx.db.query("requests").withIndex("by_requester", (q) => q.eq("requesterId", args.userId)).order("desc").take(100);
    return Promise.all(requests.map(async (r) => enrichRequest(ctx, r)));
  },
});

export const get = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    return enrichRequest(ctx, request);
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    secretariaId: v.optional(v.id("organizations")),
    departamentoId: v.optional(v.id("organizations")),
    unidadeId: v.optional(v.id("organizations")),
    reason: v.optional(v.string()),
    osNumber: v.optional(v.string()),
    patrimony: v.optional(v.string()),
    observation: v.optional(v.string()),
    items: v.array(v.object({
      productId: v.id("products"),
      quantityRequested: v.number(),
      targetPrinterId: v.optional(v.id("printers")),
    })),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);

    // Validate required fields
    const reason = args.reason?.trim() ?? "";
    if (!reason) throw new Error("O motivo da solicitação é obrigatório");
    if (args.items.length === 0) throw new Error("A solicitação deve ter pelo menos um item");

    // Validate secretaria exists
    const secretariaId = args.secretariaId;
    if (!secretariaId) throw new Error("A secretaria de destino é obrigatória");
    const secretaria = await ctx.db.get(secretariaId);
    if (!secretaria) throw new Error("Secretaria não encontrada");

    // Validate departamento belongs to secretaria (if provided)
    if (args.departamentoId) {
      const dept = await ctx.db.get(args.departamentoId);
      if (!dept) throw new Error("Departamento não encontrado");
      if (dept.parentId !== secretariaId) {
        throw new Error("Departamento não pertence à secretaria selecionada");
      }
    }

    // Validate unidade belongs to departamento or secretaria (if provided)
    if (args.unidadeId) {
      const unit = await ctx.db.get(args.unidadeId);
      if (!unit) throw new Error("Unidade não encontrada");
      if (args.departamentoId && unit.parentId !== args.departamentoId) {
        throw new Error("Unidade não pertence ao departamento selecionado");
      } else if (!args.departamentoId && unit.parentId !== secretariaId) {
        throw new Error("Unidade não pertence à secretaria selecionada");
      }
    }

    // Validate each item
    for (const item of args.items) {
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error("Produto não encontrado");
      if (!product.active) throw new Error(`O item "${product.name}" está inativo`);
      if (typeof item.quantityRequested !== "number" || !isFinite(item.quantityRequested)) {
        throw new Error("Quantidade inválida");
      }
      if (item.quantityRequested <= 0) throw new Error("A quantidade deve ser maior que zero");
      if (product.unitOfMeasure === "un" && !Number.isInteger(item.quantityRequested)) {
        throw new Error("A quantidade deve ser um número inteiro para esta unidade");
      }
      // Validate toner compatibility: if this product has compatibility entries, targetPrinterId is required
      const compatEntries = await ctx.db
        .query("printerCompatibility")
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
        .collect();
      if (compatEntries.length > 0) {
        // This is a toner product — targetPrinterId is required
        if (!item.targetPrinterId) throw new Error(`"${product.name}" é um toner/insumo. Selecione a impressora de destino.`);
        const printer = await ctx.db.get(item.targetPrinterId);
        if (!printer) throw new Error("Impressora de destino não encontrada");
        // Check compatibility
        const isCompatible = compatEntries.some((c) => c.printerModel === printer.model);
        if (!isCompatible) {
          const compatModels = compatEntries.map((c) => c.printerModel).join(", ");
          throw new Error(`O toner "${product.name}" não é compatível com a impressora "${printer.model}". Modelos compatíveis: ${compatModels}`);
        }
      }
    }

    const now = Date.now();
    const requestId = await ctx.db.insert("requests", {
      requesterId: userId,
      status: "pending",
      secretariaId: secretariaId,
      departamentoId: args.departamentoId,
      unidadeId: args.unidadeId,
      reason: reason,
      osNumber: args.osNumber || undefined,
      patrimony: args.patrimony || undefined,
      observation: args.observation || undefined,
      createdAt: now,
      updatedAt: now,
    });

    for (const item of args.items) {
      await ctx.db.insert("requestItems", {
        requestId,
        productId: item.productId,
        quantityRequested: item.quantityRequested,
        quantityApproved: 0,
        quantityDelivered: 0,
        targetPrinterId: item.targetPrinterId,
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
    if (request.requesterId === userId && role !== "admin") throw new Error("Não é possível aprovar sua própria solicitação");
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
      if (stock) await ctx.db.patch(stock._id, { reservedQuantity: stock.reservedQuantity + item.quantityApproved });
    }
    await ctx.db.patch(args.requestId, { status: "approved", approverId: userId, updatedAt: now, approvalObservation: args.observation ?? undefined });
    await ctx.db.insert("auditLogs", { userId, action: "approve", entity: "requests", entityId: args.requestId, details: "Solicitação aprovada", timestamp: now });
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
    if (request.requesterId === userId && role !== "admin") throw new Error("Não é possível rejeitar sua própria solicitação");
    if (request.status !== "pending") throw new Error("Solicitação não está pendente");
    const reason = (args.observation ?? "").trim();
    if (!reason) throw new Error("O motivo da rejeição é obrigatório");
    const now = Date.now();
    await ctx.db.patch(args.requestId, { status: "rejected", approverId: userId, updatedAt: now, approvalObservation: reason });
    await ctx.db.insert("auditLogs", { userId, action: "reject", entity: "requests", entityId: args.requestId, details: `Solicitação rejeitada. Motivo: ${reason}`, timestamp: now });
    return args.requestId;
  },
});

export const deliver = mutation({
  args: {
    requestId: v.id("requests"),
    items: v.optional(v.array(v.object({
      itemId: v.id("requestItems"),
      quantityDelivered: v.number(),
      serialNumbers: v.optional(v.array(v.string())),
    }))),
    confirmationPassword: v.string(),
    reverseLogisticsConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);

    // Verify password for electronic signature
    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();
    if (!passwordRecord) throw new Error("Senha não configurada. Contate o administrador.");
    const passwordValid = await verifyPassword(args.confirmationPassword, passwordRecord.passwordHash, passwordRecord.salt);
    if (!passwordValid) throw new Error("Senha de confirmação incorreta");

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    if (request.status !== "approved") throw new Error("Solicitação deve estar aprovada");
    const inputItems = args.items ?? [];
    if (inputItems.length === 0) throw new Error("Informe ao menos um item para entrega");

    // Validate each item
    for (const input of inputItems) {
      const requestItem = await ctx.db.get(input.itemId);
      if (!requestItem) throw new Error(`Item da solicitação não encontrado: ${input.itemId}`);
      if (requestItem.requestId !== args.requestId) throw new Error("Item não pertence a esta solicitação");
      if (input.quantityDelivered <= 0) throw new Error("Quantidade entregue deve ser maior que zero");
      if (input.quantityDelivered > requestItem.quantityApproved) {
        throw new Error(`Quantidade entregue (${input.quantityDelivered}) excede a aprovada (${requestItem.quantityApproved}) para "${(await ctx.db.get(requestItem.productId))?.name ?? "item"}"`);
      }
      // Validate serial numbers for serial-tracked products
      const product = await ctx.db.get(requestItem.productId);
      if (product?.hasSerial && input.quantityDelivered > 0) {
        const serials = input.serialNumbers ?? [];
        if (serials.length !== input.quantityDelivered) {
          throw new Error(`Para "${product.name}", é necessário informar ${input.quantityDelivered} número(s) de patrimônio/série`);
        }
        // Check for empty serials
        if (serials.some((s) => !s.trim())) {
          throw new Error(`Todos os números de patrimônio/série devem ser preenchidos para "${product.name}"`);
        }
      }
    }

    // Check stock availability for all items
    for (const input of inputItems) {
      if (input.quantityDelivered <= 0) continue;
      const requestItem = await ctx.db.get(input.itemId);
      if (!requestItem) continue;
      const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", requestItem.productId)).first();
      if (!stock) throw new Error(`Registro de estoque não encontrado para o produto`);
      if (stock.physicalQuantity < input.quantityDelivered) {
        throw new Error(`Estoque insuficiente. Disponível: ${stock.physicalQuantity}. Entrega: ${input.quantityDelivered}.`);
      }
      if (stock.reservedQuantity < input.quantityDelivered) {
        throw new Error(`Estoque reservado insuficiente. Reservado: ${stock.reservedQuantity}. Entrega: ${input.quantityDelivered}.`);
      }
    }

    const now = Date.now();
    // Process deliveries
    for (const input of inputItems) {
      if (input.quantityDelivered <= 0) continue;
      const requestItem = await ctx.db.get(input.itemId);
      if (!requestItem) continue;
      const freshStock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", requestItem.productId)).first();
      if (!freshStock) throw new Error("Registro de estoque desapareceu durante a entrega");
      if (freshStock.physicalQuantity < input.quantityDelivered) throw new Error(`Estoque insuficiente (concorrência). Disponível: ${freshStock.physicalQuantity}.`);
      if (freshStock.reservedQuantity < input.quantityDelivered) throw new Error(`Estoque reservado insuficiente (concorrência). Reservado: ${freshStock.reservedQuantity}.`);
      const newPhysical = freshStock.physicalQuantity - input.quantityDelivered;
      const newReserved = freshStock.reservedQuantity - input.quantityDelivered;
      await ctx.db.patch(freshStock._id, { physicalQuantity: newPhysical, reservedQuantity: newReserved });
      await ctx.db.insert("stockMovements", {
        productId: requestItem.productId, type: "exit", quantity: input.quantityDelivered,
        previousPhysical: freshStock.physicalQuantity, newPhysical,
        previousReserved: freshStock.reservedQuantity, newReserved,
        userId, requestId: args.requestId, observation: "Entrega da solicitação", timestamp: now,
      });
      await ctx.db.patch(input.itemId, {
        quantityDelivered: input.quantityDelivered,
        deliveredSerialNumbers: input.serialNumbers?.length ? input.serialNumbers : undefined,
      });
    }

    const sigName = user.name ?? user.email ?? "Servidor";
    const sigDate = new Date(now).toLocaleString("pt-BR");
    const deliveredBySignature = `Assinado eletronicamente por ${sigName} via autenticação por senha em ${sigDate}`;
    await ctx.db.patch(args.requestId, {
      status: "delivered",
      updatedAt: now,
      deliveredAt: now,
      deliveredBySignature,
      reverseLogisticsConfirmed: args.reverseLogisticsConfirmed ?? undefined,
    });
    await ctx.db.insert("auditLogs", { userId, action: "deliver", entity: "requests", entityId: args.requestId, details: `Solicitação entregue (${inputItems.length} item(ns))`, timestamp: now });
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
    await ctx.db.insert("auditLogs", { userId, action: "cancel", entity: "requests", entityId: args.requestId, details: "Solicitação cancelada pelo solicitante", timestamp: now });
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

// ─── Arquivo Histórico: delivered/cancelled requests with filters ─────────────
export const listDelivered = query({
  args: {
    secretariaId: v.optional(v.id("organizations")),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    serialSearch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let requests = await ctx.db
      .query("requests")
      .withIndex("by_status", (q: any) => q.eq("status", "delivered"))
      .order("desc")
      .take(500);

    if (args.secretariaId) {
      requests = requests.filter((r) => r.secretariaId === args.secretariaId);
    }
    if (args.startDate) {
      requests = requests.filter((r) => r.deliveredAt != null && r.deliveredAt >= args.startDate!);
    }
    if (args.endDate) {
      requests = requests.filter((r) => r.deliveredAt != null && r.deliveredAt <= args.endDate!);
    }

    let results = await Promise.all(requests.map(async (r) => enrichRequest(ctx, r)));

    // Filter by serial number in delivered items
    if (args.serialSearch?.trim()) {
      const term = args.serialSearch.trim().toLowerCase();
      results = results.filter((r) =>
        r.items?.some((item: any) =>
          item.deliveredSerialNumbers?.some((sn: string) => sn.toLowerCase().includes(term))
        )
      );
    }

    return results;
  },
});

// ─── Historico de Consumo por organizacao ───────────────────────────────────
export const listByOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    // Get all delivered requests that reference this org (as secretaria, departamento, or unidade)
    const allDelivered = await ctx.db
      .query("requests")
      .withIndex("by_status", (q: any) => q.eq("status", "delivered"))
      .order("desc")
      .take(500);

    const filtered = allDelivered.filter(
      (r) => r.secretariaId === args.organizationId || r.departamentoId === args.organizationId || r.unidadeId === args.organizationId
    );

    return Promise.all(filtered.map(async (r) => enrichRequest(ctx, r)));
  },
});
