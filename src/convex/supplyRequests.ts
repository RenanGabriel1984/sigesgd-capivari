/**
 * Gestão de Estoque SGGD — SOLICITAÇÃO MENSAL DE SUPRIMENTOS (backend).
 *
 * Uma solicitação mensal é um DOCUMENTO DE PLANEJAMENTO. Este módulo grava
 * apenas em `supplyRequests` e `supplyRequestItems`.
 *
 * PROIBIÇÕES ESTRUTURAIS (verificadas pelos testes GOMAQ-04/05):
 *   - nenhuma função toca `stock`, `lots`, `stockByLocation` ou `stockMovements`;
 *   - nenhuma função cria entrada, saída, reserva ou lote;
 *   - nenhuma função altera NF-e, XML, DANFE ou histórico existente;
 *   - o documento guarda a fotografia do momento (estoque atual/vazio) e não a
 *     recalcula depois.
 *
 * A quantidade solicitada é SEMPRE a digitada pelo operador; a sugestão do
 * sistema aparece como referência e nunca é imposta.
 *
 * RBAC:
 *   list/get          → supply_requests.view   (Diretor consulta)
 *   create/addItem/
 *   setQuantity/
 *   setStatus/generate → supply_requests.manage (Diretor e Técnico não geram)
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import {
  SUPPLY_REQUEST_STATUS_LABELS,
  normalizeSupplyRequestItem,
  buildSuggestedQuantity,
  computeSupplyRequestTotals,
  canGenerateSupplyRequest,
  type SupplyRequestStatus,
} from "../lib/supply-requests";
import { readReplenishmentParameters, isValidPeriodMonth } from "../lib/stock-parameters";

const STATUSES: SupplyRequestStatus[] = ["draft", "ready_for_review", "generated"];

function assertStatus(status: string): asserts status is SupplyRequestStatus {
  if (!STATUSES.includes(status as SupplyRequestStatus)) {
    throw new Error(`Status inválido: ${status}.`);
  }
}

/* ═══ Consultas ════════════════════════════════════════════════════════════ */

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "supply_requests.view", { entity: "supplyRequests" });
    const requests = await ctx.db.query("supplyRequests").order("desc").collect();
    return Promise.all(
      requests.map(async (r) => {
        const items = await ctx.db
          .query("supplyRequestItems")
          .withIndex("by_request", (q) => q.eq("supplyRequestId", r._id))
          .collect();
        const requester = r.requesterUserId ? await ctx.db.get(r.requesterUserId) : null;
        const supplier = r.supplierId ? await ctx.db.get(r.supplierId) : null;
        return {
          ...r,
          statusLabel: SUPPLY_REQUEST_STATUS_LABELS[r.status],
          requesterName: (requester as { name?: string } | null)?.name ?? null,
          supplierName: supplier?.legalName ?? null,
          totals: computeSupplyRequestTotals(
            items.map((i) => ({ productId: i.productId ?? null, requestedQuantity: i.requestedQuantity }))
          ),
        };
      })
    );
  },
});

export const get = query({
  args: { supplyRequestId: v.id("supplyRequests") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "supply_requests.view", { entity: "supplyRequests" });
    const request = await ctx.db.get(args.supplyRequestId);
    if (!request) throw new Error("Solicitação mensal não encontrada");

    const items = await ctx.db
      .query("supplyRequestItems")
      .withIndex("by_request", (q) => q.eq("supplyRequestId", args.supplyRequestId))
      .collect();

    const withProducts = await Promise.all(
      items.map(async (i) => {
        const product = i.productId ? await ctx.db.get(i.productId) : null;
        return { ...i, productName: product?.name ?? "—", unitOfMeasure: product?.unitOfMeasure ?? "un" };
      })
    );

    return {
      ...request,
      statusLabel: SUPPLY_REQUEST_STATUS_LABELS[request.status],
      items: withProducts,
      totals: computeSupplyRequestTotals(
        items.map((i) => ({ productId: i.productId ?? null, requestedQuantity: i.requestedQuantity }))
      ),
    };
  },
});

/**
 * Sugestões de quantidade para montar a solicitação do período.
 *
 * SOMENTE LEITURA: lê estoque e parâmetros e devolve NÚMEROS. Não cria item,
 * não reserva, não movimenta. A sugestão é `max(ideal − disponível, 0)`.
 */
export const suggestions = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "supply_requests.view", { entity: "products" });
    const [products, stockRows] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("stock").collect(),
    ]);
    const stockByProduct = new Map(
      stockRows.map((s) => [s.productId, { physicalQuantity: s.physicalQuantity, reservedQuantity: s.reservedQuantity }])
    );
    return products.map((p) => {
      const stock = stockByProduct.get(p._id);
      const available = Math.max((stock?.physicalQuantity ?? 0) - (stock?.reservedQuantity ?? 0), 0);
      const parameters = readReplenishmentParameters(p);
      return {
        productId: p._id,
        productName: p.name,
        unitOfMeasure: p.unitOfMeasure,
        availableQuantity: available,
        minimumStock: parameters.minimumStock,
        idealStock: parameters.idealStock,
        monthlyConsumptionTarget: parameters.monthlyConsumptionTarget,
        replenishmentEnabled: parameters.replenishmentEnabled,
        suggestedQuantity: buildSuggestedQuantity(available, parameters.idealStock),
      };
    });
  },
});

/* ═══ Mutações (documento; nunca estoque) ═══════════════════════════════════ */

export const create = mutation({
  args: {
    periodMonth: v.number(),
    periodYear: v.number(),
    supplierId: v.optional(v.id("suppliers")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "supply_requests.manage", {
      entity: "supplyRequests",
    });
    if (!isValidPeriodMonth(args.periodMonth)) {
      throw new Error("Mês do período inválido (use 1 a 12).");
    }
    const now = Date.now();
    const id = await ctx.db.insert("supplyRequests", {
      periodMonth: args.periodMonth,
      periodYear: args.periodYear,
      requesterUserId: userId,
      supplierId: args.supplierId,
      observation: args.observation,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_order",
      entity: "supplyRequests",
      entityId: id,
      details:
        `Solicitação mensal de suprimentos criada (${args.periodMonth}/${args.periodYear}). ` +
        `Documento de planejamento — nenhuma movimentação de estoque foi registrada.`,
      timestamp: now,
    } as never);
    return id;
  },
});

/**
 * Adiciona um item à solicitação.
 *
 * `requestedQuantity` é o que o OPERADOR digitou. `suggestedQuantity` é
 * apenas referência e nunca substitui o valor digitado.
 */
export const addItem = mutation({
  args: {
    supplyRequestId: v.id("supplyRequests"),
    productId: v.id("products"),
    requestedQuantity: v.number(),
    currentStock: v.number(),
    emptyStock: v.number(),
    equipmentAssetId: v.optional(v.id("assets")),
    equipmentModel: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "supply_requests.manage", {
      entity: "supplyRequests",
    });
    const request = await ctx.db.get(args.supplyRequestId);
    if (!request) throw new Error("Solicitação mensal não encontrada");
    if (request.status === "generated") {
      throw new Error("Solicitação já gerada — não é possível alterar os itens.");
    }

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");

    const available = Math.max(args.currentStock, 0);
    const suggested = buildSuggestedQuantity(available, product.idealStock ?? null);
    const normalized = normalizeSupplyRequestItem({
      currentStock: available,
      emptyStock: args.emptyStock,
      suggestedQuantity: suggested,
      // PRESERVADO como digitado pelo operador.
      requestedQuantity: args.requestedQuantity,
      observation: args.observation,
      equipmentModel: args.equipmentModel,
    });

    const now = Date.now();
    const id = await ctx.db.insert("supplyRequestItems", {
      supplyRequestId: args.supplyRequestId,
      productId: args.productId,
      equipmentAssetId: args.equipmentAssetId,
      equipmentModel: normalized.equipmentModel ?? undefined,
      currentStock: normalized.currentStock,
      emptyStock: normalized.emptyStock,
      suggestedQuantity: normalized.suggestedQuantity,
      requestedQuantity: normalized.requestedQuantity,
      observation: normalized.observation ?? undefined,
    });
    await ctx.db.patch(args.supplyRequestId, { updatedAt: now });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_order",
      entity: "supplyRequestItems",
      entityId: id,
      details:
        `Item "${product.name}" adicionado à solicitação ${request.periodMonth}/${request.periodYear}: ` +
        `solicitado ${normalized.requestedQuantity} (sugestão do sistema: ${normalized.suggestedQuantity}). ` +
        `Nenhuma movimentação de estoque foi registrada.`,
      timestamp: now,
    } as never);
    return id;
  },
});

/**
 * Ajusta a quantidade SOLICITADA de um item.
 *
 * Aceita qualquer valor não negativo — inclusive diferente da sugestão. É o
 * ponto explícito de que a quantidade solicitada é decisão do operador.
 */
export const setItemQuantity = mutation({
  args: {
    itemId: v.id("supplyRequestItems"),
    requestedQuantity: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "supply_requests.manage", {
      entity: "supplyRequestItems",
    });
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item da solicitação não encontrado");

    const request = await ctx.db.get(item.supplyRequestId);
    if (request?.status === "generated") {
      throw new Error("Solicitação já gerada — a quantidade não pode mais ser alterada.");
    }

    const next = normalizeSupplyRequestItem({
      currentStock: item.currentStock,
      emptyStock: item.emptyStock,
      suggestedQuantity: item.suggestedQuantity,
      requestedQuantity: args.requestedQuantity,
    });

    const now = Date.now();
    await ctx.db.patch(args.itemId, { requestedQuantity: next.requestedQuantity });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_order",
      entity: "supplyRequestItems",
      entityId: args.itemId,
      details:
        `Quantidade solicitada ajustada de ${item.requestedQuantity} para ${next.requestedQuantity} ` +
        `(sugestão do sistema mantida: ${item.suggestedQuantity}). Nenhuma movimentação de estoque.`,
      timestamp: now,
    } as never);
    return args.itemId;
  },
});

/** Move o documento entre os status do ciclo (rascunho → conferência → gerada). */
export const setStatus = mutation({
  args: {
    supplyRequestId: v.id("supplyRequests"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "supply_requests.manage", {
      entity: "supplyRequests",
    });
    assertStatus(args.status);
    const request = await ctx.db.get(args.supplyRequestId);
    if (!request) throw new Error("Solicitação mensal não encontrada");

    const now = Date.now();
    await ctx.db.patch(args.supplyRequestId, { status: args.status, updatedAt: now });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_order",
      entity: "supplyRequests",
      entityId: args.supplyRequestId,
      details: `Status da solicitação: ${request.status} → ${args.status}. Sem efeito no estoque.`,
      timestamp: now,
    } as never);
    return args.status;
  },
});

/**
 * Gera o documento (status "generated") e carimba a data de geração.
 *
 * NÃO envia e-mail, NÃO cria pedido no fornecedor, NÃO movimenta estoque.
 * "Gerada" significa apenas que o documento foi fechado para emissão.
 */
export const generate = mutation({
  args: { supplyRequestId: v.id("supplyRequests") },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "supply_requests.manage", {
      entity: "supplyRequests",
    });
    const request = await ctx.db.get(args.supplyRequestId);
    if (!request) throw new Error("Solicitação mensal não encontrada");

    const items = await ctx.db
      .query("supplyRequestItems")
      .withIndex("by_request", (q) => q.eq("supplyRequestId", args.supplyRequestId))
      .collect();

    const allowed = canGenerateSupplyRequest({
      status: request.status,
      itemCount: items.length,
      periodMonth: request.periodMonth,
      periodYear: request.periodYear,
      validMonth: isValidPeriodMonth(request.periodMonth),
    });
    if (!allowed) {
      throw new Error(
        request.status === "generated"
          ? "A solicitação já foi gerada."
          : "Não é possível gerar: a solicitação precisa ter itens e período válido.",
      );
    }

    const now = Date.now();
    await ctx.db.patch(args.supplyRequestId, {
      status: "generated",
      generatedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "gomaq_order",
      entity: "supplyRequests",
      entityId: args.supplyRequestId,
      details:
        `Solicitação mensal ${request.periodMonth}/${request.periodYear} gerada com ${items.length} item(ns). ` +
        `Documento de planejamento: nenhum pedido, entrada, saída ou reserva foi criado.`,
      timestamp: now,
    } as never);
    return { generatedAt: now, status: "generated" as const };
  },
});
