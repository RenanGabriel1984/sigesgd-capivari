import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { requireSingleValidGlobalStock, validateUniqueScopedStockRows } from "../lib/stock-read-integrity";
import { assertProductLedgerConsistent, assertProductReservationConsistent } from "./lotLocationLedger";
import { planLotReturnAllocations } from "../lib/return-lot-allocation";
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
  returnConditionReturnsToAvailableStock,
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
    const returns = await ctx.db.query("returns").order("desc").collect();
    return Promise.all(returns.map(async (r: any) => {
      const product = await ctx.db.get(r.productId);
      const lot = r.lotId ? await ctx.db.get(r.lotId) : null;
      const returnedBy = await ctx.db.get(r.returnedByUserId);
      const receivedBy = r.receivedByUserId ? await ctx.db.get(r.receivedByUserId) : null;
      const area = r.areaId ? await ctx.db.get(r.areaId) : null;
      const stockMovement = r.stockMovementId ? await ctx.db.get(r.stockMovementId) : null;
      const request = r.requestId ? await ctx.db.get(r.requestId) : null;
      const exit = r.exitMovementId ? await ctx.db.get(r.exitMovementId) : null;
      const location = r.locationId ? await ctx.db.get(r.locationId) : null;
      const allocations = await ctx.db.query("returnLotAllocations")
        .withIndex("by_return", (q: any) => q.eq("returnId", r._id))
        .collect();
      const lotAllocations = await Promise.all(allocations.map(async (allocation: any) => {
        const [allocationLot, sourceLocation, destinationLocation] = await Promise.all([
          ctx.db.get(allocation.lotId as any) as Promise<any>,
          allocation.sourceLocationId
            ? ctx.db.get(allocation.sourceLocationId as any) as Promise<any>
            : Promise.resolve(null),
          ctx.db.get(allocation.destinationLocationId as any) as Promise<any>,
        ]);
        return {
          lotNumber: allocationLot?.lotNumber ?? "Lote não encontrado",
          sourceLocationName: sourceLocation?.name ?? "Origem não identificada",
          destinationLocationName: destinationLocation?.name ?? "Destino não encontrado",
          quantity: allocation.quantity,
        };
      }));
      return { ...r, product, lot, area, stockMovement, returnedBy, receivedBy, request, exit, location, lotAllocations };
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
      .collect();
    const allReturns = await loadReturns(ctx);

    const rows = await Promise.all(exits.map(async (m: any) => {
      const product: any = await ctx.db.get(m.productId);
      const user: any = await ctx.db.get(m.userId);
      const area: any = m.areaId ? await ctx.db.get(m.areaId) : null;
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
        area,
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
    const destinationLocation: any = args.locationId ? await ctx.db.get(args.locationId) : null;
    if (!destinationLocation || destinationLocation.active === false) {
      throw new Error("Informe um armário de destino existente e ativo para registrar a devolução.");
    }

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

    const requiresLot = sourceAllocations.length > 0 || productLots.length > 0;
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
        if (!lot || lot.active === false || lot.productId !== exit.productId) {
          throw new Error("Um dos lotes selecionados é inexistente, inativo ou não corresponde ao produto da saída.");
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
      areaId: exit.areaId,
      quantity: args.quantity,
      reason,
      condition,
      stockDisposition: returnConditionReturnsToAvailableStock(condition) ? "available" : "quarantine",
      locationId: args.locationId,
      returnedByUserId: userId,
      receivedByUserId: args.receivedByUserId,
      observation: args.observation,
      createdAt: now,
    });

    // Material usado parcialmente, defeituoso ou com condição não confirmada
    // fica registrado em quarentena: não pode aumentar o saldo disponível.
    // As alocações preservam o lote/local de origem para futura inspeção.
    if (!returnConditionReturnsToAvailableStock(condition)) {
      for (const allocation of plannedLotAllocations) {
        await ctx.db.insert("returnLotAllocations", {
          returnId,
          exitMovementId: exit._id,
          productId: exit.productId,
          lotId: allocation.lotId,
          sourceLocationId: allocation.sourceLocationId,
          destinationLocationId: args.locationId!,
          quantity: allocation.quantity,
          createdAt: now,
        });
      }
      const exitLabel = exit.exitNumber ?? new Date(exit.timestamp).toLocaleString("pt-BR");
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
        }) + " | destino: quarentena; não incorporado ao saldo disponível",
        timestamp: now,
      });
      return returnId;
    }

    // 2) Repor estoque físico global
    const stockRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", exit.productId))
      .collect();
    const stock = requireSingleValidGlobalStock(stockRows, String(exit.productId));
    const ledgerStock = await assertProductLedgerConsistent(ctx, exit.productId, product.name);
    if (!ledgerStock || ledgerStock._id !== stock._id) {
      throw new Error("A devolução foi bloqueada: o livro-razão do produto não está conciliado.");
    }
    await assertProductReservationConsistent(ctx, exit.productId, product.name, stock);
    const sblList = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", exit.productId))
      .collect();
    validateUniqueScopedStockRows(sblList, String(exit.productId));
    const localTotal = sblList.reduce((sum: number, row: any) => sum + row.quantity, 0);
    if (Math.abs(localTotal - stock.physicalQuantity) > 1e-9) {
      throw new Error("A devolução foi bloqueada: o saldo global diverge da soma dos armários. Regularize o estoque antes de devolver.");
    }

    if (requiresLot) {
      const [lotBalances, allProductLots] = await Promise.all([
        ctx.db.query("lotLocationBalances")
          .withIndex("by_product", (q: any) => q.eq("productId", exit.productId))
          .collect(),
        ctx.db.query("lots")
          .withIndex("by_product", (q: any) => q.eq("productId", exit.productId))
          .collect(),
      ]);
      const lotTotal = allProductLots.reduce((sum: number, lot: any) => {
        if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0 || (lot.active === false && lot.quantityAvailable > 1e-9)) {
          throw new Error("A devolução foi bloqueada: existe lote com saldo inválido ou lote inativo positivo.");
        }
        return sum + lot.quantityAvailable;
      }, 0);
      const lotLocationTotal = lotBalances.reduce((sum: number, balance: any) => {
        if (!Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
          throw new Error("A devolução foi bloqueada: existe saldo inválido por lote e armário.");
        }
        return sum + balance.quantityAvailable;
      }, 0);
      if (Math.abs(lotTotal - stock.physicalQuantity) > 1e-9 || Math.abs(lotLocationTotal - lotTotal) > 1e-9) {
        throw new Error("A devolução foi bloqueada: os saldos global, dos lotes e dos armários não estão conciliados.");
      }
      const lotByLocation = new Map<string, number>();
      for (const balance of lotBalances) {
        const key = String(balance.locationId);
        lotByLocation.set(key, (lotByLocation.get(key) ?? 0) + balance.quantityAvailable);
      }
      for (const row of sblList) {
        if (Math.abs((lotByLocation.get(String(row.locationId)) ?? 0) - row.quantity) > 1e-9) {
          throw new Error("A devolução foi bloqueada: a soma dos lotes diverge do saldo do armário.");
        }
      }
    }

    const newPhysical = applyReturnToStock(stock.physicalQuantity, args.quantity);
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });

    // 3) Repor saldo no armário de destino validado acima.
    const sbl = sblList.find((row: any) => row.locationId === args.locationId);
    if (sbl) {
      await ctx.db.patch(sbl._id, {
        quantity: applyReturnToLocation(sbl.quantity, args.quantity),
      });
    } else {
      await ctx.db.insert("stockByLocation", {
        productId: exit.productId,
        locationId: args.locationId!,
        quantity: args.quantity,
      });
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
    const stockMovementId = await ctx.db.insert("stockMovements", {
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
      returnId,
      areaId: exit.areaId,
      locationId: args.locationId,
      toLocationId: args.locationId,
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
    await ctx.db.patch(returnId, { stockMovementId });

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


/**
 * Conclui a inspeção de uma devolução em quarentena. A liberação recompõe
 * estoque global, armário e lotes de forma atômica; o descarte não recompõe.
 */
export const resolveQuarantine = mutation({
  args: {
    returnId: v.id("returns"),
    disposition: v.union(v.literal("available"), v.literal("disposed")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "stock.mutate", { entity: "returns" });
    const reason = args.reason.trim();
    if (!reason) throw new Error("A justificativa da inspeção é obrigatória.");
    const returned: any = await ctx.db.get(args.returnId);
    if (!returned) throw new Error("Devolução não encontrada.");
    if (returned.stockDisposition !== "quarantine") {
      throw new Error("Somente devoluções pendentes em quarentena podem ser inspecionadas.");
    }
    const product: any = await ctx.db.get(returned.productId);
    if (!product) throw new Error("Produto da devolução não encontrado.");
    const location: any = returned.locationId ? await ctx.db.get(returned.locationId) : null;
    if (!location || !location.active) throw new Error("O armário de destino não existe ou está inativo.");

    const now = Date.now();
    if (args.disposition === "available") {
      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q) => q.eq("productId", returned.productId)).collect();
      const stock = requireSingleValidGlobalStock(stockRows, String(returned.productId));
      const ledgerStock = await assertProductLedgerConsistent(ctx, returned.productId, product.name);
      if (!ledgerStock || ledgerStock._id !== stock._id) {
        throw new Error("A inspeção foi bloqueada: o livro-razão do produto não está conciliado.");
      }
      await assertProductReservationConsistent(ctx, returned.productId, product.name, stock);
      const locationRows = await ctx.db.query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", returned.productId)).collect();
      validateUniqueScopedStockRows(locationRows, String(returned.productId));
      const locationBalance = locationRows.find((row: any) => row.locationId === returned.locationId);
      const allocations = await ctx.db.query("returnLotAllocations")
        .withIndex("by_return", (q: any) => q.eq("returnId", args.returnId)).collect();
      const activeLots = await ctx.db.query("lots")
        .withIndex("by_product", (q: any) => q.eq("productId", returned.productId)).collect();
      const allLotBalances = await ctx.db.query("lotLocationBalances")
        .withIndex("by_product", (q: any) => q.eq("productId", returned.productId)).collect();
      const localTotal = locationRows.reduce((sum: number, row: any) => sum + row.quantity, 0);
      if (Math.abs(localTotal - stock.physicalQuantity) > 1e-9) {
        throw new Error("A inspeção foi bloqueada: o saldo global diverge da soma dos armários.");
      }
      if (activeLots.length > 0) {
        const lotTotal = activeLots.reduce((sum: number, lot: any) => {
          if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0 || (lot.active === false && lot.quantityAvailable > 1e-9)) {
            throw new Error("A inspeção foi bloqueada: existe lote com saldo inválido ou inativo positivo.");
          }
          return sum + lot.quantityAvailable;
        }, 0);
        const lotLocationTotal = allLotBalances.reduce((sum: number, balance: any) => {
          if (!Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
            throw new Error("A inspeção foi bloqueada: existe saldo inválido por lote e armário.");
          }
          return sum + balance.quantityAvailable;
        }, 0);
        if (Math.abs(lotTotal - stock.physicalQuantity) > 1e-9 || Math.abs(lotLocationTotal - lotTotal) > 1e-9) {
          throw new Error("A inspeção foi bloqueada: os saldos global, dos lotes e dos armários não estão conciliados.");
        }
        const lotByLocation = new Map<string, number>();
        for (const balance of allLotBalances) {
          const key = String(balance.locationId);
          lotByLocation.set(key, (lotByLocation.get(key) ?? 0) + balance.quantityAvailable);
        }
        for (const row of locationRows) {
          if (Math.abs((lotByLocation.get(String(row.locationId)) ?? 0) - row.quantity) > 1e-9) {
            throw new Error("A inspeção foi bloqueada: a soma dos lotes diverge do saldo do armário.");
          }
        }
      }

      if (allocations.length > 0) {
        const allocatedTotal = allocations.reduce((sum: number, row: any) => sum + row.quantity, 0);
        if (Math.abs(allocatedTotal - returned.quantity) > 1e-8) {
          throw new Error("As alocações de quarentena não correspondem à quantidade devolvida. Regularize antes de liberar.");
        }
        for (const allocation of allocations) {
          const lot: any = await ctx.db.get(allocation.lotId);
          if (!lot || lot.active === false || lot.productId !== returned.productId) {
            throw new Error("Lote da quarentena inexistente, inativo ou incompatível com o produto.");
          }
          const balances = await ctx.db.query("lotLocationBalances")
            .withIndex("by_lot", (q: any) => q.eq("lotId", allocation.lotId)).collect();
          const matching = balances.filter((row: any) => row.locationId === returned.locationId);
          if (matching.length > 1) throw new Error("Há saldos duplicados do lote no armário de destino.");
          await ctx.db.patch(lot._id, { quantityAvailable: lot.quantityAvailable + allocation.quantity });
          if (matching[0]) {
            await ctx.db.patch(matching[0]._id, {
              quantityAvailable: matching[0].quantityAvailable + allocation.quantity,
              updatedAt: now,
            });
          } else {
            await ctx.db.insert("lotLocationBalances", {
              lotId: lot._id,
              productId: returned.productId,
              locationId: returned.locationId,
              quantityAvailable: allocation.quantity,
              updatedAt: now,
            });
          }
        }
      } else if (activeLots.length > 0) {
        throw new Error("O produto possui rastreio por lote, mas a devolução em quarentena não tem alocação. Regularize antes de liberar.");
      }

      const newPhysical = stock.physicalQuantity + returned.quantity;
      await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
      if (locationBalance) {
        await ctx.db.patch(locationBalance._id, { quantity: locationBalance.quantity + returned.quantity });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: returned.productId,
          locationId: returned.locationId,
          quantity: returned.quantity,
        });
      }
      const stockMovementId = await ctx.db.insert("stockMovements", {
        productId: returned.productId,
        type: "return",
        quantity: returned.quantity,
        previousPhysical: stock.physicalQuantity,
        newPhysical,
        previousReserved: stock.reservedQuantity,
        newReserved: stock.reservedQuantity,
        userId,
        requestId: returned.requestId,
        exitMovementId: returned.exitMovementId,
        returnId: args.returnId,
        areaId: returned.areaId,
        locationId: returned.locationId,
        toLocationId: returned.locationId,
        lotId: allocations.length === 1 ? (await ctx.db.get(allocations[0].lotId) as any)?.lotNumber : undefined,
        observation: "Liberação de quarentena após inspeção — " + reason,
        timestamp: now,
      });
      await ctx.db.patch(args.returnId, { stockMovementId });
    }

    await ctx.db.patch(args.returnId, {
      stockDisposition: args.disposition,
      inspectedAt: now,
      inspectedByUserId: userId,
      inspectionReason: reason,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "return_stock",
      entity: "returns",
      entityId: args.returnId,
      details: args.disposition === "available"
        ? "Inspeção aprovou " + returned.quantity + " unidade(s) de " + product.name + "; material liberado da quarentena e reincorporado ao estoque. Motivo: " + reason
        : "Inspeção determinou descarte de " + returned.quantity + " unidade(s) de " + product.name + "; material não reincorporado ao estoque. Motivo: " + reason,
      timestamp: now,
    });
    return args.returnId;
  },
});
