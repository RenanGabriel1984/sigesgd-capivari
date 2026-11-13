import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { verifyPassword } from "./auth/passwords";
import { generateExitNumber } from "./stockHelpers";
import { requirePermission, requireRequestAction } from "./rbac";
import type { Id } from "./_generated/dataModel";
import { roleHasPermission, type AppRole } from "../lib/rbac";
import { assertTextLimits, assertShortTextLimits, MAX_OBSERVATION } from "../lib/text-limits";
import { planFifoAreaLotAllocation, validateAreaLocationLotBalance } from "../lib/area-stock";
import { isDiscreteStockUnit, requireSingleValidGlobalStock } from "../lib/stock-quantity-rules";
import { validateRequestItemReservationLedger } from "../lib/request-reservation-ledger";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician" | "patrimony_manager";

async function requireUser(ctx: any) {
  // RBAC central: requisições são visíveis a quem pode consultá-las; a query
  // de lista abaixo já restringe o escopo para o solicitante (técnico).
  return requirePermission(ctx, "requests.view");
}

function hasFullVisibility(role: UserRole | undefined): boolean {
  // RBAC central: visão completa = possui requests.approve OU requests.deliver
  // (admin, secretary, stock_manager, director); técnico vê apenas as próprias.
  return roleHasPermission(role as AppRole, "requests.approve");
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
      const product = await ctx.db.get(item.productId as Id<"products">);
      const printer = item.targetPrinterId ? await ctx.db.get(item.targetPrinterId) : null;
      const area = item.areaId ? await ctx.db.get(item.areaId) : null;
      const sourceLocation = item.sourceLocationId ? await ctx.db.get(item.sourceLocationId) : null;
      return { ...item, product, printer, area, sourceLocation };
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
    // Hardening B-03: o escopo é calculado a partir do usuário AUTENTICADO.
    // O `requestId` vindo do cliente NUNCA é prova de autorização.
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    if (!hasFullVisibility(role) && request.requesterId !== user._id) {
      throw new Error(
        "ACESSO NEGADO: você só pode consultar as suas próprias solicitações.",
      );
    }
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
      areaId: v.id("stockAreas"),
      sourceLocationId: v.id("storageLocations"),
    })),
  },
  handler: async (ctx, args) => {
    // RBAC central: criar requisição exige requests.create (technician incluído).
    const { userId } = await requirePermission(ctx, "requests.create", { entity: "requests" });

    // Validate required fields
    const reason = args.reason?.trim() ?? "";
    if (!reason) throw new Error("O motivo da solicitação é obrigatório");
    if (args.items.length === 0) throw new Error("A solicitação deve ter pelo menos um item");

    // Hardening §17: limite de tamanho nos campos livres (rejeita, nunca trunca).
    assertTextLimits({ reason }, MAX_OBSERVATION);
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    assertShortTextLimits({ osNumber: args.osNumber, patrimony: args.patrimony });

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

    // Origem escolhida explicitamente: fornecedor e categoria não determinam a área.
    for (const item of args.items) {
      const area = await ctx.db.get(item.areaId);
      if (!area || !area.active) throw new Error("Selecione uma área/subestoque ativa para cada item.");
      const sourceLocation = await ctx.db.get(item.sourceLocationId);
      if (!sourceLocation || !sourceLocation.active) throw new Error("Selecione um local físico ativo para cada item.");
      const product = await ctx.db.get(item.productId as Id<"products">);
      if (!product) throw new Error("Produto não encontrado");
      if (!product.active) throw new Error(`O item "${product.name}" está inativo`);
      if (typeof item.quantityRequested !== "number" || !isFinite(item.quantityRequested)) {
        throw new Error("Quantidade inválida");
      }
      if (item.quantityRequested <= 0) throw new Error("A quantidade deve ser maior que zero");
      if (isDiscreteStockUnit(product.unitOfMeasure, product.hasSerial) &&
        !Number.isSafeInteger(item.quantityRequested)) {
        throw new Error(`A quantidade deve ser um número inteiro para a unidade ${product.unitOfMeasure}.`);
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
        areaId: item.areaId,
        sourceLocationId: item.sourceLocationId,
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
    const { userId, role } = await requireUser(ctx);
    if (!roleHasPermission(role, "requests.approve")) {
      throw new Error("ACESSO NEGADO: seu perfil não possui a permissão de aprovação de requisições.");
    }

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    await requireRequestAction(ctx, "requests.approve", request.requesterId, {
      entity: "requests", entityId: args.requestId,
    });
    if (request.status !== "pending") throw new Error("Solicitação não está pendente.");

    const stockNeeded = new Map<string, {
      quantity: number; productName: string; hasArea: boolean; hasLegacy: boolean;
    }>();
    const allocationPlans: Array<{
      requestItemId: string; productId: string; lotId: string;
      areaId: string; locationId: string; quantity: number;
    }> = [];
    const stagedByLot = new Map<string, number>();
    const seenItems = new Set<string>();
    let totalItemsToApprove = 0;

    // Fase 1: validar tudo e planejar FIFO sem gravar nada.
    for (const input of args.items) {
      const requestItem = await ctx.db.get(input.itemId);
      if (!requestItem) throw new Error(`Item da solicitação não encontrado: ${input.itemId}`);
      if (requestItem.requestId !== args.requestId) throw new Error("O item não pertence a esta solicitação.");
      if (seenItems.has(input.itemId)) throw new Error("A lista de aprovação contém item duplicado.");
      seenItems.add(input.itemId);

      if (!Number.isFinite(input.quantityApproved) || input.quantityApproved < 0) {
        throw new Error(`Quantidade aprovada inválida no item ${input.itemId}.`);
      }
      if (input.quantityApproved > requestItem.quantityRequested) {
        throw new Error("A quantidade aprovada não pode exceder a quantidade solicitada.");
      }
      if (input.quantityApproved === 0) continue;

      const product = await ctx.db.get(requestItem.productId);
      if (!product || !product.active) throw new Error("Produto não encontrado ou inativo; atualize a solicitação antes de aprovar.");
      if (isDiscreteStockUnit(product.unitOfMeasure, product.hasSerial) &&
        !Number.isSafeInteger(input.quantityApproved)) {
        throw new Error(`A quantidade aprovada para "${product.name}" deve ser inteira.`);
      }
      const productName = product.name;
      const productKey = requestItem.productId as string;
      const isAreaScoped = !!requestItem.areaId;
      const current = stockNeeded.get(productKey) ?? {
        quantity: 0, productName, hasArea: false, hasLegacy: false,
      };
      current.quantity += input.quantityApproved;
      current.hasArea ||= isAreaScoped;
      current.hasLegacy ||= !isAreaScoped;
      stockNeeded.set(productKey, current);
      totalItemsToApprove++;

      // Solicitações históricas permanecem sem área e sem alocação retroativa.
      if (!isAreaScoped) continue;
      if (!requestItem.sourceLocationId) {
        throw new Error(`A solicitação antiga de "${productName}" não possui local físico. Cancele e recrie com a origem correta.`);
      }

      const area = await ctx.db.get(requestItem.areaId!);
      const location = await ctx.db.get(requestItem.sourceLocationId);
      if (!area || !area.active || !location || !location.active) {
        throw new Error(`A área ou o local físico de "${productName}" não está válido.`);
      }

      const productLots = await ctx.db.query("lots")
        .withIndex("by_product", (q: any) => q.eq("productId", requestItem.productId))
        .collect();
      const scopedLots = productLots.filter((lot: any) =>
        lot.areaId === requestItem.areaId && lot.locationId === requestItem.sourceLocationId
      );
      const locationRows = await ctx.db.query("stockByLocation")
        .withIndex("by_product", (q: any) => q.eq("productId", requestItem.productId))
        .collect();
      const matchingLocationRows = locationRows.filter((row: any) =>
        row.locationId === requestItem.sourceLocationId && row.areaId === requestItem.areaId
      );
      const candidates = [];
      const scopedLotBalances = [];
      for (const lot of scopedLots) {
        const reservations = await ctx.db.query("requestItemReservations")
          .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id))
          .collect();
        if (reservations.some((reservation: any) =>
          !Number.isFinite(reservation.quantityRemaining) || reservation.quantityRemaining < 0
        )) {
          throw new Error(`O lote ${lot.lotNumber} possui reserva inválida. Regularize antes de aprovar.`);
        }
        const alreadyReserved = reservations.reduce((sum: number, reservation: any) =>
          sum + reservation.quantityRemaining, 0);
        scopedLotBalances.push({
          lotNumber: lot.lotNumber,
          quantityAvailable: lot.quantityAvailable,
          quantityReserved: alreadyReserved,
          active: lot.active,
        });
        if (!lot.active) continue;
        candidates.push({
          lotId: lot._id as string,
          lotNumber: lot.lotNumber,
          receivedAt: lot.receivedAt,
          quantityAvailable: lot.quantityAvailable,
          quantityReserved: alreadyReserved + (stagedByLot.get(lot._id as string) ?? 0),
          areaId: lot.areaId as string | undefined,
          locationId: lot.locationId as string | undefined,
          active: lot.active,
        });
      }

      const sourceBalance = validateAreaLocationLotBalance(
        matchingLocationRows,
        scopedLotBalances,
      );
      if (!sourceBalance.valid) {
        throw new Error(
          `Não é seguro reservar "${productName}" em "${area.name}" / "${location.name}": ${sourceBalance.error}`
        );
      }

      const allocation = planFifoAreaLotAllocation(
        candidates, input.quantityApproved,
        requestItem.areaId as string, requestItem.sourceLocationId as string,
      );
      if (allocation.remaining > 0) {
        throw new Error(
          `Estoque insuficiente em "${area.name}" / "${location.name}" para "${productName}". ` +
          `Disponível: ${input.quantityApproved - allocation.remaining}; necessário: ${input.quantityApproved}.`
        );
      }
      for (const part of allocation.allocations) {
        allocationPlans.push({
          requestItemId: input.itemId,
          productId: requestItem.productId as string,
          lotId: part.lotId,
          areaId: requestItem.areaId as string,
          locationId: requestItem.sourceLocationId as string,
          quantity: part.quantity,
        });
        stagedByLot.set(part.lotId, (stagedByLot.get(part.lotId) ?? 0) + part.quantity);
      }
    }

    if (totalItemsToApprove === 0) throw new Error("Nenhum item com quantidade aprovada maior que zero.");

    // Fase 2: estoque global e legado precisam fechar antes de gravar qualquer reserva.
    for (const [productId, needed] of stockNeeded) {
      if (needed.hasArea && needed.hasLegacy) {
        throw new Error(
          `A solicitação mistura estoque classificado e legado para "${needed.productName}". Separe em solicitações distintas.`
        );
      }
      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", productId as any))
        .collect();
      const stock = requireSingleValidGlobalStock(stockRows, needed.productName);

      if (needed.hasArea) {
        const existingReservations = await ctx.db.query("requestItemReservations")
          .withIndex("by_product", (q: any) => q.eq("productId", productId as any))
          .collect();
        const allocatedToAreas = existingReservations.reduce((sum: number, reservation: any) =>
          sum + reservation.quantityRemaining, 0);
        if (existingReservations.some((reservation: any) =>
          !Number.isFinite(reservation.quantityRemaining) || reservation.quantityRemaining < 0
        )) {
          throw new Error(`"${needed.productName}" possui reserva por lote inválida. Regularize antes de aprovar novas solicitações.`);
        }
        if (allocatedToAreas - stock.reservedQuantity > 1e-9) {
          throw new Error(`As reservas por lote de "${needed.productName}" excedem o saldo reservado global. Regularize antes de aprovar.`);
        }
        const legacyReserved = Math.max(0, stock.reservedQuantity - allocatedToAreas);
        if (legacyReserved > 0) {
          throw new Error(
            `"${needed.productName}" possui ${legacyReserved} unidade(s) reservada(s) por solicitação antiga sem área. Conclua ou cancele essa solicitação antes de reservar por subestoque.`
          );
        }
      }
      const available = stock.physicalQuantity - stock.reservedQuantity;
      if (available < needed.quantity) {
        throw new Error(
          `Estoque global insuficiente para "${needed.productName}". Disponível: ${available}, necessário: ${needed.quantity}. Nenhuma reserva foi aplicada.`
        );
      }
    }

    // Fase 3: persistir reserva global e alocações dos lotes na mesma mutation transacional.
    const now = Date.now();
    for (const input of args.items) {
      const requestItem = await ctx.db.get(input.itemId);
      if (!requestItem) continue;
      await ctx.db.patch(input.itemId, { quantityApproved: input.quantityApproved });
      if (input.quantityApproved <= 0) continue;
      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", requestItem.productId))
        .collect();
      const stock = requireSingleValidGlobalStock(stockRows, String(requestItem.productId));
      await ctx.db.patch(stock._id, {
        reservedQuantity: stock.reservedQuantity + input.quantityApproved,
      });
    }

    for (const allocation of allocationPlans) {
      await ctx.db.insert("requestItemReservations", {
        requestItemId: allocation.requestItemId as any,
        productId: allocation.productId as any,
        lotId: allocation.lotId as any,
        areaId: allocation.areaId as any,
        locationId: allocation.locationId as any,
        quantity: allocation.quantity,
        quantityRemaining: allocation.quantity,
        quantityDelivered: 0,
        quantityReleased: 0,
        createdAt: now,
      });
    }

    await ctx.db.patch(args.requestId, {
      status: "approved", approverId: userId, updatedAt: now,
      approvalObservation: args.observation ?? undefined,
    });
    const approvedSummary = Array.from(stockNeeded.values())
      .map((item) => `${item.productName}: ${item.quantity}`).join(", ");
    await ctx.db.insert("auditLogs", {
      userId, action: "approve", entity: "requests", entityId: args.requestId,
      details: `Solicitação aprovada. Itens: ${approvedSummary}. Reservas FIFO por área/local registradas quando classificadas.`,
      timestamp: now,
    });
    return args.requestId;
  },
});

export const reject = mutation({
  args: { requestId: v.id("requests"), observation: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId, user, role } = await requireUser(ctx);
    if (!roleHasPermission(role, "requests.reject")) {
      throw new Error("ACESSO NEGADO: seu perfil não possui a permissão " +
        "de rejeição de requisições.");
    }
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    // REGRA OBRIGATÓRIA: o solicitante NUNCA rejeita a própria requisição (nem admin).
    await requireRequestAction(ctx, "requests.reject", request.requesterId, {
      entity: "requests", entityId: args.requestId,
    });
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
    receivedByUserId: v.optional(v.id("users")),
    confirmationPassword: v.string(),
    reverseLogisticsConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // A entrega também deve respeitar a regra de autoatendimento: quem
    // solicitou não pode retirar/confirmar a própria requisição.
    await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação não encontrada");
    const { userId, user } = await requireRequestAction(
      ctx, "requests.deliver", request.requesterId,
      { entity: "requests", entityId: args.requestId },
    );

    const passwordRecord = await ctx.db.query("passwords")
      .withIndex("by_user", (q: any) => q.eq("userId", userId)).first();
    if (!passwordRecord) throw new Error("Senha não configurada. Contate o administrador.");
    const passwordValid = await verifyPassword(
      args.confirmationPassword, passwordRecord.passwordHash, passwordRecord.salt
    );
    if (!passwordValid) throw new Error("Senha de confirmação incorreta");

    if (request.status !== "approved") throw new Error("Solicitação deve estar aprovada");
    const inputItems = args.items ?? [];
    if (inputItems.length === 0) throw new Error("Informe ao menos um item para entrega");
    if (args.receivedByUserId) {
      const recipient = await ctx.db.get(args.receivedByUserId);
      if (!recipient || recipient.active === false) {
        throw new Error("Usuário recebedor não encontrado ou inativo");
      }
    }

    const requestItems = await ctx.db.query("requestItems")
      .withIndex("by_request", (q: any) => q.eq("requestId", args.requestId)).collect();
    const byId = new Map(requestItems.map((item: any) => [item._id as string, item]));
    const deliveredByItem = new Map<string, number>();
    const seen = new Set<string>();

    // Validação completa antes das primeiras escritas.
    for (const input of inputItems) {
      if (seen.has(input.itemId)) throw new Error("A lista de entrega contém item duplicado.");
      seen.add(input.itemId);
      const item: any = byId.get(input.itemId);
      if (!item) throw new Error("Item não pertence a esta solicitação.");
      if (!Number.isFinite(input.quantityDelivered) || input.quantityDelivered <= 0) {
        throw new Error("Quantidade entregue deve ser um número válido maior que zero.");
      }
      if (input.quantityDelivered > item.quantityApproved) {
        throw new Error(`Quantidade entregue excede a aprovada para "${(await ctx.db.get(item.productId as Id<"products">))?.name ?? "item"}".`);
      }
      const product = await ctx.db.get(item.productId as Id<"products">);
      if (!product || !product.active) throw new Error("Produto não encontrado ou inativo; entrega bloqueada.");
      if (isDiscreteStockUnit(product.unitOfMeasure, product.hasSerial) &&
        !Number.isSafeInteger(input.quantityDelivered)) {
        throw new Error(`A quantidade entregue para "${product.name}" deve ser inteira.`);
      }
      if (product.hasSerial) {
        const serials = input.serialNumbers ?? [];
        if (serials.length !== input.quantityDelivered || serials.some((value: string) => !value.trim())) {
          throw new Error(`Informe exatamente ${input.quantityDelivered} número(s) de patrimônio/série para "${product.name}".`);
        }
      }

      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
      const stock = requireSingleValidGlobalStock(stockRows, product.name);
      if (stock.physicalQuantity < input.quantityDelivered || stock.reservedQuantity < input.quantityDelivered) {
        throw new Error("Estoque físico ou reservado insuficiente para concluir a entrega.");
      }

      if (item.areaId) {
        if (!item.sourceLocationId) {
          throw new Error("A solicitação classificada precisa manter o local físico de origem.");
        }
        const reservations = await ctx.db.query("requestItemReservations")
          .withIndex("by_requestItem", (q: any) => q.eq("requestItemId", input.itemId)).collect();
        const reservationLedger = validateRequestItemReservationLedger({
          requestItemId: String(item._id),
          productId: String(item.productId),
          areaId: String(item.areaId),
          locationId: String(item.sourceLocationId),
          quantityApproved: Number(item.quantityApproved),
          reservations,
        });
        if (reservationLedger.error) throw new Error(reservationLedger.error);
        const remaining = reservationLedger.remaining;
        if (remaining < input.quantityDelivered) {
          throw new Error("A reserva por lote está incompleta. Entrega bloqueada para proteger a área/local.");
        }
        for (const reservation of reservations) {
          if (reservation.quantityRemaining <= 0) continue;
          if (reservation.productId !== item.productId ||
              reservation.areaId !== item.areaId ||
              reservation.locationId !== item.sourceLocationId) {
            throw new Error("A reserva não corresponde ao produto/área/local da solicitação. Entrega bloqueada.");
          }
          const lot = await ctx.db.get(reservation.lotId);
          if (!lot || !lot.active || lot.productId !== item.productId ||
              lot.areaId !== item.areaId || lot.locationId !== item.sourceLocationId ||
              lot.quantityAvailable < reservation.quantityRemaining) {
            throw new Error("Um lote reservado não pertence mais à área/local ou não possui saldo suficiente. Entrega bloqueada.");
          }
          const lotReservations = await ctx.db.query("requestItemReservations")
            .withIndex("by_lot", (q: any) => q.eq("lotId", reservation.lotId)).collect();
          if (lotReservations.some((row: any) =>
            !Number.isFinite(row.quantityRemaining) || row.quantityRemaining < 0
          )) {
            throw new Error("O lote possui reserva com quantidade inválida. Entrega bloqueada.");
          }
          const reservedOnLot = lotReservations.reduce((sum: number, row: any) =>
            sum + Number(row.quantityRemaining), 0);
          if (!Number.isFinite(reservedOnLot) || reservedOnLot > lot.quantityAvailable + 1e-9) {
            throw new Error("O total reservado no lote excede o saldo físico. Entrega bloqueada.");
          }
        }
        const locationRows = await ctx.db.query("stockByLocation")
          .withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
        const matchingSourceRows = locationRows.filter((row: any) =>
          row.locationId === item.sourceLocationId && row.areaId === item.areaId
        );
        if (matchingSourceRows.length !== 1) {
          throw new Error(matchingSourceRows.length === 0
            ? "Saldo físico insuficiente no local de origem para concluir a entrega."
            : "Há saldos duplicados no local de origem. Regularize antes de concluir a entrega.");
        }
        const source = matchingSourceRows[0];
        if (!Number.isFinite(source.quantity) || source.quantity < input.quantityDelivered) {
          throw new Error("Saldo físico insuficiente no local de origem para concluir a entrega.");
        }
      } else {
        // Solicitação antiga sem origem: nunca consumir lote já atribuído a uma área/local.
        const lots = await ctx.db.query("lots")
          .withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
        const legacyFree = lots.filter((lot: any) => lot.active && !lot.areaId && !lot.locationId)
          .reduce((sum: number, lot: any) => sum + lot.quantityAvailable, 0);
        if (legacyFree < input.quantityDelivered) {
          throw new Error(
            `Solicitação antiga sem área/local: há apenas ${legacyFree} unidade(s) sem classificação segura. Materiais de áreas definidas não serão consumidos.`
          );
        }
      }
      deliveredByItem.set(input.itemId, input.quantityDelivered);
    }

    const now = Date.now();
    for (const input of inputItems) {
      const item: any = byId.get(input.itemId);
      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
      const stock = requireSingleValidGlobalStock(stockRows, String(item.productId));
      const newPhysical = stock.physicalQuantity - input.quantityDelivered;
      const newReserved = stock.reservedQuantity - input.quantityDelivered;
      if (newPhysical < 0 || newReserved < 0) throw new Error("Saldo global inconsistente; entrega abortada.");
      await ctx.db.patch(stock._id, { physicalQuantity: newPhysical, reservedQuantity: newReserved });

      const exitNumber = await generateExitNumber(ctx);
      const movementId = await ctx.db.insert("stockMovements", {
        productId: item.productId, type: "exit", quantity: input.quantityDelivered,
        previousPhysical: stock.physicalQuantity, newPhysical,
        previousReserved: stock.reservedQuantity, newReserved,
        userId, requestId: args.requestId, exitNumber,
        areaId: item.areaId, locationId: item.sourceLocationId,
        observation: "Entrega da solicitação", timestamp: now,
      });
      await ctx.db.patch(input.itemId, {
        quantityDelivered: input.quantityDelivered,
        deliveredSerialNumbers: input.serialNumbers?.length ? input.serialNumbers : undefined,
      });

      let remaining = input.quantityDelivered;
      if (item.areaId) {
        const reservations = await ctx.db.query("requestItemReservations")
          .withIndex("by_requestItem", (q: any) => q.eq("requestItemId", input.itemId)).collect();
        const rows = await Promise.all(reservations.map(async (reservation: any) => ({
          reservation, lot: await ctx.db.get(reservation.lotId as Id<"lots">),
        })));
        rows.sort((a: any,b: any)=>(a.lot?.receivedAt??0)-(b.lot?.receivedAt??0) ||
          (a.lot?.lotNumber??"").localeCompare(b.lot?.lotNumber??""));
        for (const row of rows) {
          if (remaining <= 0) break;
          const reservation = await ctx.db.get(row.reservation._id as Id<"requestItemReservations">);
          const lot = await ctx.db.get(row.reservation.lotId as Id<"lots">);
          if (!reservation || !lot) throw new Error("Lote/reserva desapareceu durante a entrega.");
          const consume = Math.min(reservation.quantityRemaining, remaining);
          if (consume <= 0) continue;
          if (lot.areaId !== item.areaId || lot.locationId !== item.sourceLocationId || lot.quantityAvailable < consume) {
            throw new Error("O lote reservado não possui saldo físico na área/local de origem.");
          }
          const nextLotQuantity = lot.quantityAvailable - consume;
          await ctx.db.patch(lot._id, {
            quantityAvailable: nextLotQuantity,
            active: nextLotQuantity > 0,
          });
          await ctx.db.patch(reservation._id, {
            quantityRemaining: reservation.quantityRemaining - consume,
            quantityDelivered: reservation.quantityDelivered + consume,
          });
          await ctx.db.insert("requestItemLots", { requestItemId: input.itemId, lotId: lot._id, quantity: consume });
          await ctx.db.insert("stockMovementLots", {
            movementId, lotId: lot._id, quantity: consume,
            areaId: item.areaId, locationId: item.sourceLocationId,
          });
          remaining -= consume;
        }
        if (remaining > 0) throw new Error("Reservas por lote insuficientes para concluir a entrega.");
        const locationRows = await ctx.db.query("stockByLocation")
          .withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
        const matchingSourceRows = locationRows.filter((row: any) =>
          row.locationId === item.sourceLocationId && row.areaId === item.areaId
        );
        if (matchingSourceRows.length !== 1) {
          throw new Error("O saldo do local mudou ou está duplicado durante a entrega.");
        }
        const source = matchingSourceRows[0];
        if (!source || source.quantity < input.quantityDelivered) throw new Error("Saldo por local insuficiente durante a entrega.");
        await ctx.db.patch(source._id, { quantity: source.quantity - input.quantityDelivered });
      } else {
        const lots = await ctx.db.query("lots")
          .withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
        const sorted = lots.filter((lot: any)=>lot.active&&!lot.areaId&&!lot.locationId&&lot.quantityAvailable>0)
          .sort((a: any,b: any)=>a.receivedAt-b.receivedAt||a.lotNumber.localeCompare(b.lotNumber));
        for(const lot of sorted){
          if(remaining<=0)break;
          const consume=Math.min(lot.quantityAvailable,remaining);
          await ctx.db.patch(lot._id,{quantityAvailable:lot.quantityAvailable-consume});
          await ctx.db.insert("requestItemLots",{requestItemId:input.itemId,lotId:lot._id,quantity:consume});
          await ctx.db.insert("stockMovementLots", {
            movementId, lotId: lot._id, quantity: consume,
            areaId: undefined, locationId: undefined,
          });
          remaining-=consume;
        }
        if(remaining>0)throw new Error("Lotes legados sem classificação insuficientes.");
      }
    }

    // The request is closed after this delivery. Release undelivered quantities so
    // partial lines or lines omitted from this delivery do not leave orphan reservations.
    const releaseByProduct = new Map<string, number>();
    for (const item of requestItems as any[]) {
      if (item.quantityApproved <= 0) continue;
      let release = 0;
      if (item.areaId) {
        const reservations = await ctx.db.query("requestItemReservations")
          .withIndex("by_requestItem", (q: any) => q.eq("requestItemId", item._id)).collect();
        for (const reservation of reservations) {
          if (reservation.quantityRemaining <= 0) continue;
          release += reservation.quantityRemaining;
          await ctx.db.patch(reservation._id, {
            quantityReleased: reservation.quantityReleased + reservation.quantityRemaining,
            quantityRemaining: 0,
          });
        }
      } else {
        const delivered = deliveredByItem.get(item._id as string) ?? item.quantityDelivered ?? 0;
        release = Math.max(0, item.quantityApproved - delivered);
      }
      if (release > 0) {
        const key = item.productId as string;
        releaseByProduct.set(key, (releaseByProduct.get(key) ?? 0) + release);
      }
    }
    for (const [productId, release] of releaseByProduct) {
      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", productId as any)).collect();
      const stock = requireSingleValidGlobalStock(stockRows, String(productId));
      if (stock.reservedQuantity < release) {
        throw new Error("Inconsistência de reserva global ao liberar quantidade não entregue.");
      }
      await ctx.db.patch(stock._id, { reservedQuantity: stock.reservedQuantity - release });
    }

    const sigName = user.name ?? user.email ?? "Servidor";
    const sigDate = new Date(now).toLocaleString("pt-BR");
    const deliveredBySignature = `Assinado eletronicamente por ${sigName} via autenticação por senha em ${sigDate}`;
    await ctx.db.patch(args.requestId, {
      status: "delivered", updatedAt: now, deliveredAt: now, deliveredBySignature,
      receivedByUserId: args.receivedByUserId ?? request.requesterId,
      reverseLogisticsConfirmed: args.reverseLogisticsConfirmed ?? undefined,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "deliver", entity: "requests", entityId: args.requestId,
      details: `Solicitação entregue (${inputItems.length} item(ns)); saldo não entregue liberado.`,
      timestamp: now,
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
    if (request.status === "delivered") {
      throw new Error("Não é possível cancelar uma solicitação já entregue. Utilize a operação de devolução quando disponível.");
    }
    if (request.status === "rejected" || request.status === "cancelled") {
      throw new Error("Solicitação já foi rejeitada ou cancelada.");
    }
    if (request.status !== "pending" && request.status !== "approved") {
      throw new Error("Status inválido para cancelamento.");
    }

    const now = Date.now();
    const releaseByProduct = new Map<string, number>();
    const details: string[] = [];
    if (request.status === "approved") {
      const items = await ctx.db.query("requestItems")
        .withIndex("by_request", (q: any) => q.eq("requestId", args.requestId)).collect();
      for (const item of items as any[]) {
        if (item.quantityApproved <= 0) continue;
        let release = 0;
        if (item.areaId) {
          if (!item.sourceLocationId) {
            throw new Error("A solicitação aprovada não possui local físico de origem. Regularize antes de cancelar.");
          }
          const reservations = await ctx.db.query("requestItemReservations")
            .withIndex("by_requestItem", (q: any) => q.eq("requestItemId", item._id)).collect();
          const reservationLedger = validateRequestItemReservationLedger({
            requestItemId: String(item._id),
            productId: String(item.productId),
            areaId: String(item.areaId),
            locationId: String(item.sourceLocationId),
            quantityApproved: Number(item.quantityApproved),
            reservations,
          });
          if (reservationLedger.error) throw new Error(reservationLedger.error);
          for (const reservation of reservations) {
            const lot = await ctx.db.get(reservation.lotId);
            if (!lot || lot.productId !== item.productId ||
                lot.areaId !== item.areaId || lot.locationId !== item.sourceLocationId ||
                (reservation.quantityRemaining > 0 &&
                  (!lot.active || lot.quantityAvailable < reservation.quantityRemaining))) {
              throw new Error("A reserva não corresponde mais ao lote/área/local original. Cancelamento bloqueado para preservar o estoque.");
            }
            if (reservation.quantityRemaining <= 0) continue;
            release += reservation.quantityRemaining;
            await ctx.db.patch(reservation._id, {
              quantityReleased: reservation.quantityReleased + reservation.quantityRemaining,
              quantityRemaining: 0,
            });
          }
        } else {
          release = Math.max(0, item.quantityApproved - (item.quantityDelivered ?? 0));
        }
        if (release > 0) {
          const key = item.productId as string;
          releaseByProduct.set(key, (releaseByProduct.get(key) ?? 0) + release);
          const product = await ctx.db.get(item.productId as Id<"products">);
          details.push(`${product?.name ?? "item"}: -${release}`);
        }
      }
      for (const [productId, release] of releaseByProduct) {
        const stockRows = await ctx.db.query("stock")
          .withIndex("by_product", (q: any) => q.eq("productId", productId as any)).collect();
        const stock = requireSingleValidGlobalStock(stockRows, String(productId));
        if (stock.reservedQuantity < release) {
          throw new Error("Inconsistência de estoque: reserva insuficiente para cancelamento. Nenhuma alteração foi confirmada.");
        }
        await ctx.db.patch(stock._id, { reservedQuantity: stock.reservedQuantity - release });
      }
    }

    await ctx.db.patch(args.requestId, { status: "cancelled", updatedAt: now });
    await ctx.db.insert("auditLogs", {
      userId, action: "cancel", entity: "requests", entityId: args.requestId,
      details: request.status === "approved"
        ? `Solicitação aprovada cancelada. Reservas liberadas: ${details.join(", ")}`
        : "Solicitação pendente cancelada pelo solicitante.",
      timestamp: now,
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

// ─── Arquivo Histórico: delivered/cancelled requests with filters ─────────────
export const listDelivered = query({
  args: {
    secretariaId: v.optional(v.id("organizations")),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    serialSearch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Hardening B-03: sem visão completa, o resultado é restrito às PRÓPRIAS
    // solicitações — o filtro é aplicado ANTES de qualquer enriquecimento
    // (nomes de servidores e números de patrimônio de terceiros).
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    const fullVisibility = hasFullVisibility(role);

    let requests = await ctx.db
      .query("requests")
      .withIndex("by_status", (q: any) => q.eq("status", "delivered"))
      .order("desc")
      .take(500);

    if (!fullVisibility) {
      requests = requests.filter((r) => r.requesterId === user._id);
    }

    if (args.serialSearch?.trim()) {
      assertShortTextLimits({ serialSearch: args.serialSearch });
    }
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
    // Hardening B-03: `organizationId` NÃO é prova de autorização. O escopo é
    // derivado do solicitante autenticado; perfis sem visão completa recebem
    // apenas as próprias solicitações desta organização.
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    const fullVisibility = hasFullVisibility(role);

    // Get all delivered requests that reference this org (as secretaria, departamento, or unidade)
    const allDelivered = await ctx.db
      .query("requests")
      .withIndex("by_status", (q: any) => q.eq("status", "delivered"))
      .order("desc")
      .take(500);

    const filtered = allDelivered.filter(
      (r) => r.secretariaId === args.organizationId || r.departamentoId === args.organizationId || r.unidadeId === args.organizationId
    );

    const scoped = fullVisibility
      ? filtered
      : filtered.filter((r) => r.requesterId === user._id);

    return Promise.all(scoped.map(async (r) => enrichRequest(ctx, r)));
  },
});
