import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import {
  validateReturnQuantity,
  returnedQuantityForExit,
  returnableQuantity,
  applyReturnToStock,
  applyReturnToLocation,
  buildReturnAuditDetail,
  resolveReturnLotGuard,
  buildUnresolvableLotMessage,
  type ReturnCondition,
} from "../lib/returns-rules";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: consulta de devoluções.
  return requirePermission(ctx, "returns.view");
}

/** RBAC central: registrar devolução (opera estoque). */
async function requireReturnCreate(ctx: any) {
  return requirePermission(ctx, "returns.create", { entity: "returns" });
}

/**
 * Carrega todas as devoluções (para cálculo de saldo por saída).
 * Inclui devoluções legadas sem `exitMovementId` (vinculadas por solicitação).
 */
async function loadReturns(ctx: any) {
  return await ctx.db.query("returns").collect();
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
      const receivedBy = r.receivedByUserId ? await ctx.db.get(r.receivedByUserId) : null;
      const request = r.requestId ? await ctx.db.get(r.requestId) : null;
      const exit = r.exitMovementId ? await ctx.db.get(r.exitMovementId) : null;
      const location = r.locationId ? await ctx.db.get(r.locationId) : null;
      return { ...r, product, lot, returnedBy, receivedBy, request, exit, location };
    }));
  },
});

/**
 * SAÍDAS com saldo disponível para devolução.
 *
 * Mostra somente materiais que possuem quantidade efetivamente disponível:
 *   retirado − já devolvido = disponível para devolver
 */
export const returnable = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const exits = await ctx.db
      .query("stockMovements")
      .withIndex("by_type", (q: any) => q.eq("type", "exit"))
      .order("desc")
      .take(300);
    const allReturns = await loadReturns(ctx);

    const rows = await Promise.all(exits.map(async (m: any) => {
      const product: any = await ctx.db.get(m.productId);
      const user: any = await ctx.db.get(m.userId);
      const request: any = m.requestId ? await ctx.db.get(m.requestId) : null;
      const requester: any = request?.requesterId ? await ctx.db.get(request.requesterId) : null;
      const returned = returnedQuantityForExit(allReturns, m);
      const available = returnableQuantity(m.quantity, returned);
      return {
        ...m,
        product,
        user,
        requesterName: requester?.name ?? user?.name ?? null,
        osNumber: request?.osNumber ?? null,
        requestReason: request?.reason ?? null,
        returned,
        available,
      };
    }));

    return rows.filter((r) => r.available > 0);
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

/**
 * Registra uma DEVOLUÇÃO sempre vinculada a uma SAÍDA REAL já registrada.
 *
 * - Devolução PARCIAL permitida (nunca além do disponível na saída).
 * - Não altera a baixa original: a devolução é uma movimentação reversora.
 * - Ao confirmar: repõe estoque físico (e do local, quando informado),
 *   cria movimentação type "return" vinculada à saída, registra usuário,
 *   data/hora, motivo, condição e auditoria.
 */
export const create = mutation({
  args: {
    exitMovementId: v.id("stockMovements"),
    quantity: v.number(),
    reason: v.string(),
    condition: v.union(
      v.literal("unused"),
      v.literal("partially_used"),
      v.literal("defective"),
      v.literal("other"),
    ),
    locationId: v.optional(v.id("storageLocations")),
    lotId: v.optional(v.id("lots")),
    receivedByUserId: v.optional(v.id("users")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireReturnCreate(ctx);

    const reason = args.reason.trim();
    if (!reason) throw new Error("O motivo da devolução é obrigatório");

    // A saída original precisa existir e ser uma saída real
    const exit: any = await ctx.db.get(args.exitMovementId);
    if (!exit) throw new Error("Saída original não encontrada");
    if (exit.type !== "exit") throw new Error("A movimentação informada não é uma saída");
    if (exit.canceled) throw new Error("A saída original foi cancelada — devolução não permitida");

    const product: any = await ctx.db.get(exit.productId);
    if (!product) throw new Error("Produto da saída não encontrado");

    // Saldo disponível para devolver NESTA saída
    const allReturns = await loadReturns(ctx);
    const alreadyReturned = returnedQuantityForExit(allReturns, exit);
    const error = validateReturnQuantity({
      exitQuantity: exit.quantity,
      alreadyReturned,
      requested: args.quantity,
    });
    if (error) throw new Error(error);

    // ── Lote de origem da devolução (ATOMICIDADE) ─────────────────────────────
    // A devolução DEVE devolver ao mesmo lote que a saída consumiu. Sem isso o
    // saldo global era restaurado e o `quantityAvailable` do lote não — o estado
    // parcial que gerou a divergência 3337 x 3338.
    //
    // Precedência: lote informado na devolução → `stockMovements.lotId` da
    // saída. A validação acontece ANTES de qualquer escrita, para que uma
    // recusa não deixe estado parcial.
    const exitLotId = (exit as any).lotId ?? null;
    const productLots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q) => q.eq("productId", exit.productId))
      .collect();
    // Material rastreado por lote: existe lote ativo do produto. Sem lote ativo,
    // a devolução opera apenas sobre o saldo global (comportamento histórico
    // de itens sem rastreio, preservado deliberadamente).
    const requiresLot =
      args.lotId != null || exitLotId != null || productLots.some((l: any) => l.active);

    let resolvedLotId = args.lotId ?? (exitLotId as any);
    if (resolvedLotId && typeof resolvedLotId === "string" && !resolvedLotId.startsWith("LOT-")) {
      // `stockMovements.lotId` guarda o ID do lote; se por algum motivo
      // histórico guardou apenas o número, não é um ID utilizável.
      resolvedLotId = null as any;
    }

    const lotGuard = resolveReturnLotGuard({ exitLotId: resolvedLotId ?? null, requiresLot });
    if (lotGuard) {
      const exitLabelForError = exit.exitNumber ?? new Date(exit.timestamp).toLocaleString("pt-BR");
      throw new Error(
        buildUnresolvableLotMessage({ productName: product.name, exitLabel: exitLabelForError, reason: lotGuard }),
      );
    }

    // Lote, quando identificado, precisa existir e pertencer ao produto
    const resolvedLot: any = resolvedLotId ? await ctx.db.get(resolvedLotId) : null;
    if (resolvedLotId && !resolvedLot) throw new Error("Lote de origem da saída não encontrado");
    if (resolvedLot && resolvedLot.productId !== exit.productId) {
      throw new Error("Lote não corresponde ao produto da saída");
    }

    if (args.receivedByUserId) {
      const receiver = await ctx.db.get(args.receivedByUserId);
      if (!receiver) throw new Error("Usuário recebedor não encontrado");
    }

    const now = Date.now();
    const condition: ReturnCondition = args.condition;

    // 1) Registro da devolução (rastreável e reversor)
    const returnId = await ctx.db.insert("returns", {
      exitMovementId: exit._id,
      requestId: exit.requestId,
      productId: exit.productId,
      lotId: resolvedLotId ?? undefined,
      quantity: args.quantity,
      reason,
      condition,
      locationId: args.locationId,
      returnedByUserId: userId,
      receivedByUserId: args.receivedByUserId,
      observation: args.observation,
      createdAt: now,
    });

    // 2) Repor estoque físico global
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", exit.productId))
      .first();
    if (!stock) throw new Error("Registro de estoque não encontrado");

    const newPhysical = applyReturnToStock(stock.physicalQuantity, args.quantity);
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });

    // 3) Repor saldo no local físico (quando a devolução informa o destino)
    if (args.locationId) {
      const sblList = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", exit.productId))
        .collect();
      const sbl = sblList.find((s: any) => s.locationId === args.locationId);
      if (sbl) {
        await ctx.db.patch(sbl._id, {
          quantity: applyReturnToLocation(sbl.quantity, args.quantity),
        });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: exit.productId,
          locationId: args.locationId,
          quantity: args.quantity,
        });
      }
    }

    // 4) Repor disponibilidade do lote (OBRIGATÓRIO quando rastreado)
    //    A validação do passo anterior (guard) já garantiu que, quando o
    //    material exige lote, existe um lote resolvível. Aqui o lote e o
    //    saldo global SEMPRE sobem juntos — nunca um sem o outro.
    if (resolvedLot) {
      await ctx.db.patch(resolvedLot._id, {
        quantityAvailable: resolvedLot.quantityAvailable + args.quantity,
      });
    }

    // 5) Movimentação de DEVOLUÇÃO vinculada à saída original
    //    (a baixa original NÃO é alterada)
    const exitLabel = exit.exitNumber ?? new Date(exit.timestamp).toLocaleString("pt-BR");
    await ctx.db.insert("stockMovements", {
      productId: exit.productId,
      type: "return",
      quantity: args.quantity,
      previousPhysical: stock.physicalQuantity,
      newPhysical,
      previousReserved: stock.reservedQuantity,
      newReserved: stock.reservedQuantity,
      userId,
      requestId: exit.requestId,
      exitMovementId: exit._id,
      lotId: resolvedLot ? resolvedLot.lotNumber : undefined,
      observation:
        `Devolução da saída ${exitLabel} — ${reason}` +
        (args.observation ? ` | ${args.observation}` : ""),
      timestamp: now,
    });

    // 6) Auditoria
    await ctx.db.insert("auditLogs", {
      userId,
      action: "return_stock",
      entity: "returns",
      entityId: returnId,
      details: buildReturnAuditDetail({
        quantity: args.quantity,
        productName: product.name,
        exitLabel,
        condition,
        reason,
      }),
      timestamp: now,
    });

    return returnId;
  },
});
