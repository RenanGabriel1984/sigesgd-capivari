import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { requireSingleValidGlobalStock, validateUniqueScopedStockRows } from "../lib/stock-read-integrity";
import {
  validateReturnQuantity,
  returnedQuantityForExit,
  returnableQuantity,
  applyReturnToStock,
  applyReturnToLocation,
  buildReturnAuditDetail,
  type ReturnCondition,
} from "../lib/returns-rules";
import { planLotReturnAllocations } from "../lib/return-lot-allocation";

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

      const [sourceRows, persistedReturns] = await Promise.all([
        ctx.db.query("stockMovementLotAllocations")
          .withIndex("by_movement", (q: any) => q.eq("movementId", m._id))
          .collect(),
        ctx.db.query("returnLotAllocations")
          .withIndex("by_exitMovement", (q: any) => q.eq("exitMovementId", m._id))
          .collect(),
      ]);
      let sourceAllocations: Array<{ lotId: string; sourceLocationId?: string; quantity: number }> = sourceRows
        .filter((row: any) => row.allocationType === "withdrawal")
        .map((row: any) => ({
          lotId: String(row.lotId),
          sourceLocationId: String(row.locationId),
          quantity: row.quantity,
        }));

      // Compatibilidade com saídas legadas que guardavam apenas um lote.
      if (sourceAllocations.length === 0 && m.lotId) {
        const productLots = await ctx.db.query("lots")
          .withIndex("by_product", (q: any) => q.eq("productId", m.productId))
          .collect();
        const legacyLot = productLots.find((lot: any) =>
          String(lot._id) === String(m.lotId) || lot.lotNumber === String(m.lotId),
        );
        if (legacyLot) {
          sourceAllocations = [{
            lotId: String(legacyLot._id),
            sourceLocationId: m.locationId ? String(m.locationId) : undefined,
            quantity: m.quantity,
          }];
        }
      }

      const returnedByKey = new Map<string, number>();
      for (const row of persistedReturns) {
        const key = `${String(row.lotId)}::${row.sourceLocationId ? String(row.sourceLocationId) : ""}`;
        returnedByKey.set(key, (returnedByKey.get(key) ?? 0) + row.quantity);
      }

      // Devoluções antigas só tinham um lotId no registro-pai. Se esse lote
      // saiu de mais de um armário, a localização histórica é ambígua e não
      // se oferece saldo até regularização manual.
      const childReturnIds = new Set(persistedReturns.map((row: any) => String(row.returnId)));
      const legacyReturns = allReturns.filter((row: any) =>
        row.exitMovementId === m._id && row.lotId && !childReturnIds.has(String(row._id)),
      );
      const legacyAmbiguousLots = new Set<string>();
      for (const legacyReturn of legacyReturns) {
        const matches = sourceAllocations.filter((source: any) => source.lotId === String(legacyReturn.lotId));
        if (matches.length === 1) {
          const key = `${matches[0].lotId}::${matches[0].sourceLocationId ?? ""}`;
          returnedByKey.set(key, (returnedByKey.get(key) ?? 0) + legacyReturn.quantity);
        } else if (matches.length > 1) {
          legacyAmbiguousLots.add(String(legacyReturn.lotId));
        }
      }

      const allocations = await Promise.all(sourceAllocations.map(async (source: any) => {
        const lot: any = await ctx.db.get(source.lotId);
        const sourceLocation: any = source.sourceLocationId
          ? await ctx.db.get(source.sourceLocationId)
          : null;
        const key = `${source.lotId}::${source.sourceLocationId ?? ""}`;
        const alreadyReturned = legacyAmbiguousLots.has(source.lotId)
          ? source.quantity
          : returnedByKey.get(key) ?? 0;
        return {
          lotId: source.lotId,
          lotNumber: lot?.lotNumber ?? "Lote legado",
          sourceLocationId: source.sourceLocationId,
          sourceLocationName: sourceLocation?.name ?? "Origem não identificada",
          allocatedQuantity: source.quantity,
          alreadyReturned,
          remaining: Math.max(0, source.quantity - alreadyReturned),
        };
      }));

      const availableByExit = returnableQuantity(m.quantity, returned);
      const availableByLot = allocations.length > 0
        ? allocations.reduce((sum: number, allocation: any) => sum + allocation.remaining, 0)
        : (await ctx.db.query("lots")
            .withIndex("by_product", (q: any) => q.eq("productId", m.productId))
            .collect()).some((lot: any) => lot.active)
          ? 0
          : availableByExit;
      const available = Math.min(availableByExit, availableByLot);

      return {
        ...m,
        product,
        user,
        requesterName: requester?.name ?? user?.name ?? null,
        osNumber: request?.osNumber ?? null,
        requestReason: request?.reason ?? null,
        returned,
        available,
        lotAllocations: allocations,
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
    lotAllocations: v.optional(v.array(v.object({
      lotId: v.id("lots"),
      sourceLocationId: v.optional(v.id("storageLocations")),
      quantity: v.number(),
    }))),
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

    // A saída recente possui alocações exatas por lote × armário. A devolução
    // exige que o operador identifique quanto voltou de cada parcela original;
    // não distribui quantidade por FIFO nem escolhe lote arbitrariamente.
    const productLots = await ctx.db.query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", exit.productId))
      .collect();
    const sourceRows = await ctx.db.query("stockMovementLotAllocations")
      .withIndex("by_movement", (q: any) => q.eq("movementId", exit._id))
      .collect();
    let sourceAllocations = sourceRows
      .filter((row: any) => row.allocationType === "withdrawal")
      .map((row: any) => ({
        lotId: row.lotId,
        sourceLocationId: row.locationId,
        quantity: row.quantity,
      }));

    // Saída antiga: resolve o lote pela ID OU pelo número legado, sem testar
    // prefixos artificiais em IDs do Convex.
    if (sourceAllocations.length === 0 && (args.lotId || exit.lotId)) {
      const legacyLot = productLots.find((lot: any) =>
        String(lot._id) === String(args.lotId ?? exit.lotId) ||
        lot.lotNumber === String(args.lotId ?? exit.lotId),
      );
      if (legacyLot) {
        sourceAllocations = [{
          lotId: legacyLot._id,
          sourceLocationId: exit.locationId,
          quantity: exit.quantity,
        }];
      }
    }

    const requiresLot = sourceAllocations.length > 0 || productLots.some((lot: any) => lot.active);
    let plannedLotAllocations: Array<{ lotId: any; sourceLocationId?: any; quantity: number }> = [];
    const destinationBalances = new Map<string, any>();

    if (requiresLot) {
      if (!args.locationId) {
        throw new Error("Informe o armário de destino para devolver material rastreado por lote.");
      }
      if (sourceAllocations.length === 0) {
        throw new Error("A saída original não possui rastreabilidade de lote suficiente. Regularize a saída antes da devolução.");
      }

      const persistedReturns = await ctx.db.query("returnLotAllocations")
        .withIndex("by_exitMovement", (q: any) => q.eq("exitMovementId", exit._id))
        .collect();
      const previouslyReturned = persistedReturns.map((row: any) => ({
        lotId: String(row.lotId),
        sourceLocationId: row.sourceLocationId ? String(row.sourceLocationId) : undefined,
        quantity: row.quantity,
      }));

      const childReturnIds = new Set(persistedReturns.map((row: any) => String(row.returnId)));
      const legacyReturns = allReturns.filter((row: any) =>
        row.exitMovementId === exit._id && row.lotId && !childReturnIds.has(String(row._id)),
      );
      for (const legacyReturn of legacyReturns) {
        const matches = sourceAllocations.filter((source: any) => String(source.lotId) === String(legacyReturn.lotId));
        if (matches.length !== 1) {
          throw new Error("Há uma devolução legada sem alocação por armário/lote. Regularize esse histórico antes de nova devolução.");
        }
        previouslyReturned.push({
          lotId: String(matches[0].lotId),
          sourceLocationId: matches[0].sourceLocationId ? String(matches[0].sourceLocationId) : undefined,
          quantity: legacyReturn.quantity,
        });
      }

      const requestedAllocations = args.lotAllocations ?? (
        args.lotId && sourceAllocations.length === 1
          ? [{
              lotId: args.lotId,
              sourceLocationId: sourceAllocations[0].sourceLocationId,
              quantity: args.quantity,
            }]
          : []
      );
      plannedLotAllocations = planLotReturnAllocations({
        requestedQuantity: args.quantity,
        sourceAllocations: sourceAllocations.map((row: any) => ({
          lotId: String(row.lotId),
          sourceLocationId: row.sourceLocationId ? String(row.sourceLocationId) : undefined,
          quantity: row.quantity,
        })),
        previouslyReturned,
        requestedAllocations: requestedAllocations.map((row: any) => ({
          lotId: String(row.lotId),
          sourceLocationId: row.sourceLocationId ? String(row.sourceLocationId) : undefined,
          quantity: row.quantity,
        })),
      });

      for (const allocation of plannedLotAllocations) {
        const lot: any = await ctx.db.get(allocation.lotId);
        if (!lot || lot.productId !== exit.productId) {
          throw new Error("Um dos lotes selecionados não corresponde ao produto da saída.");
        }
        const rows = await ctx.db.query("lotLocationBalances")
          .withIndex("by_lot", (q: any) => q.eq("lotId", allocation.lotId))
          .collect();
        const matching = rows.filter((row: any) => row.locationId === args.locationId);
        if (matching.length > 1) {
          throw new Error("Há saldos duplicados deste lote no armário de devolução. Regularize antes de continuar.");
        }
        destinationBalances.set(String(allocation.lotId), matching[0] ?? null);
      }
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
      lotId: plannedLotAllocations.length === 1 ? plannedLotAllocations[0].lotId : undefined,
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
    const stockRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", exit.productId))
      .collect();
    const stock = requireSingleValidGlobalStock(stockRows, String(exit.productId));

    const newPhysical = applyReturnToStock(stock.physicalQuantity, args.quantity);
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });

    // 3) Repor saldo no local físico (quando a devolução informa o destino)
    if (args.locationId) {
      const sblList = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", exit.productId))
        .collect();
      validateUniqueScopedStockRows(sblList, String(exit.productId));
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

    // 4) Repor exatamente os lotes da saída original no armário de destino.
    for (const allocation of plannedLotAllocations) {
      const lot: any = await ctx.db.get(allocation.lotId);
      const destinationBalance = destinationBalances.get(String(allocation.lotId));
      await ctx.db.patch(lot._id, {
        quantityAvailable: lot.quantityAvailable + allocation.quantity,
      });
      if (destinationBalance) {
        await ctx.db.patch(destinationBalance._id, {
          quantityAvailable: destinationBalance.quantityAvailable + allocation.quantity,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("lotLocationBalances", {
          lotId: lot._id,
          productId: exit.productId,
          locationId: args.locationId!,
          quantityAvailable: allocation.quantity,
          updatedAt: now,
        });
      }
      await ctx.db.insert("returnLotAllocations", {
        returnId,
        exitMovementId: exit._id,
        productId: exit.productId,
        lotId: lot._id,
        sourceLocationId: allocation.sourceLocationId,
        destinationLocationId: args.locationId!,
        quantity: allocation.quantity,
        createdAt: now,
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
      locationId: args.locationId,
      lotId: plannedLotAllocations.length === 1
        ? (await ctx.db.get(plannedLotAllocations[0].lotId) as any)?.lotNumber
        : undefined,
      observation:
        `Devolução da saída ${exitLabel} — ${reason}` +
        (plannedLotAllocations.length > 0
          ? ` | lotes: ${plannedLotAllocations.map((a) => `${String(a.lotId)}(${a.quantity})`).join(", ")}`
          : "") +
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
