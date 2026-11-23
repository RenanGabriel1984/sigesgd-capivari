import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { requirePermission } from "./rbac";
import { assertTextLimits, MAX_OBSERVATION } from "../lib/text-limits";
import { isDiscreteStockUnit, requireValidScopedStockQuantity } from "../lib/stock-quantity-rules";
import {
  validateReturnQuantity,
  returnedQuantityForExit,
  returnableQuantity,
  applyReturnToStock,
  applyReturnToLocation,
  buildReturnAuditDetail,
  resolveReturnLotGuard,
  buildUnresolvableLotMessage,
  shouldRestockReturnedMaterial,
  validateExitLotLinks,
  applyReturnToLot,
  type ReturnCondition,
} from "../lib/returns-rules";
import { adjustLotLocationBalance } from "../lib/lot-location-balance";

async function requireUser(ctx: QueryCtx) {
  // RBAC central: consulta de devoluções.
  return requirePermission(ctx, "returns.view");
}

/** RBAC central: registrar devolução (opera estoque). */
async function requireReturnCreate(ctx: MutationCtx) {
  return requirePermission(ctx, "returns.create", { entity: "returns" });
}

/**
 * Carrega somente devoluções relacionadas à saída consultada.
 * O índice por saída atende registros atuais; o índice por solicitação cobre
 * o legado sem exitMovementId, limitado à solicitação e ao produto.
 */
async function loadReturnsForExit(
  ctx: QueryCtx | MutationCtx,
  exit: Doc<"stockMovements">,
): Promise<Doc<"returns">[]> {
  const [directReturns, requestReturns] = await Promise.all([
    ctx.db.query("returns")
      .withIndex("by_exitMovement", (q) => q.eq("exitMovementId", exit._id))
      .collect(),
    exit.requestId
      ? ctx.db.query("returns")
          .withIndex("by_request", (q) => q.eq("requestId", exit.requestId))
          .collect()
      : Promise.resolve([]),
  ]);
  const legacyReturns = requestReturns.filter((record) =>
    !record.exitMovementId &&
    (!record.productId || record.productId === exit.productId)
  );
  return [...directReturns, ...legacyReturns];
}

async function buildReturnableExitRow(
  ctx: QueryCtx,
  movement: Doc<"stockMovements">,
) {
  if (movement.type !== "exit" || movement.canceled) return null;
  const [product, user, request, area, location, relatedReturns] = await Promise.all([
    ctx.db.get(movement.productId),
    ctx.db.get(movement.userId),
    movement.requestId ? ctx.db.get(movement.requestId) : Promise.resolve(null),
    movement.areaId ? ctx.db.get(movement.areaId) : Promise.resolve(null),
    movement.locationId ? ctx.db.get(movement.locationId) : Promise.resolve(null),
    loadReturnsForExit(ctx, movement),
  ]);
  const requester = request?.requesterId
    ? await ctx.db.get(request.requesterId)
    : null;
  const returned = returnedQuantityForExit(relatedReturns, movement);
  const available = returnableQuantity(movement.quantity, returned);
  if (available <= 0) return null;
  return {
    ...movement,
    product,
    user,
    area,
    location,
    requesterName: requester?.name ?? user?.name ?? null,
    osNumber: request?.osNumber ?? null,
    requestReason: request?.reason ?? null,
    returned,
    available,
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const page = await ctx.db.query("returns").order("desc").paginate(args.paginationOpts);
    const enriched = await Promise.all(page.page.map(async (r) => {
      const product = await ctx.db.get(r.productId);
      const lot = r.lotId ? await ctx.db.get(r.lotId) : null;
      const returnedBy = await ctx.db.get(r.returnedByUserId);
      const receivedBy = r.receivedByUserId ? await ctx.db.get(r.receivedByUserId) : null;
      const request = r.requestId ? await ctx.db.get(r.requestId) : null;
      const exit = r.exitMovementId ? await ctx.db.get(r.exitMovementId) : null;
      const location = r.locationId ? await ctx.db.get(r.locationId) : null;
      const area = r.areaId ? await ctx.db.get(r.areaId) : null;
      return { ...r, product, lot, returnedBy, receivedBy, request, exit, location, area };
    }));
    return { ...page, page: enriched };
  },
});

/**
 * SAÍDAS com saldo disponível para devolução.
 *
 * Mostra somente materiais que possuem quantidade efetivamente disponível:
 *   retirado − já devolvido = disponível para devolver
 */
export const returnablePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const page = await ctx.db.query("stockMovements")
      .withIndex("by_type", (q) => q.eq("type", "exit"))
      .order("desc")
      .paginate(args.paginationOpts);
    const rows = await Promise.all(
      page.page.map((movement) => buildReturnableExitRow(ctx, movement))
    );
    return { ...page, page: rows.filter((row): row is NonNullable<typeof row> => row !== null) };
  },
});

export const returnableByExit = query({
  args: { exitMovementId: v.id("stockMovements") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const movement = await ctx.db.get(args.exitMovementId);
    if (!movement) return null;
    return buildReturnableExitRow(ctx, movement);
  },
});

export const listByRequest = query({
  args: {
    requestId: v.id("requests"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const page = await ctx.db.query("returns")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .order("desc")
      .paginate(args.paginationOpts);
    const enriched = await Promise.all(page.page.map(async (record) => {
      const product = await ctx.db.get(record.productId);
      const lot = record.lotId ? await ctx.db.get(record.lotId) : null;
      return { ...record, product, lot };
    }));
    return { ...page, page: enriched };
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
    const { userId } = await requireReturnCreate(ctx);
    const reason = args.reason.trim();
    if (!reason) throw new Error("O motivo da devolução é obrigatório");
    assertTextLimits({ observation: reason, description: args.observation }, MAX_OBSERVATION);

    const exit = await ctx.db.get(args.exitMovementId);
    if (!exit) throw new Error("Saída original não encontrada");
    if (exit.type !== "exit") throw new Error("A movimentação informada não é uma saída");
    if (exit.canceled) throw new Error("A saída original foi cancelada — devolução não permitida");

    const product = await ctx.db.get(exit.productId);
    if (!product) throw new Error("Produto da saída não encontrado");
    if (isDiscreteStockUnit(product.unitOfMeasure, product.hasSerial) && !Number.isSafeInteger(args.quantity)) {
      throw new Error(`A quantidade devolvida deve ser inteira para a unidade ${product.unitOfMeasure}.`);
    }

    const relatedReturns = await loadReturnsForExit(ctx, exit);
    const alreadyReturned = returnedQuantityForExit(relatedReturns, exit);
    const quantityError = validateReturnQuantity({
      exitQuantity: exit.quantity,
      alreadyReturned,
      requested: args.quantity,
    });
    if (quantityError) throw new Error(quantityError);

    // Devoluções de saídas classificadas permanecem na mesma área e no mesmo
    // local físico de origem. Mudança de local deve ser uma transferência.
    let targetLocationId: Id<"storageLocations"> | undefined = undefined;
    if (exit.areaId) {
      if (!exit.locationId) {
        throw new Error("A saída não possui local físico registrado. Não é seguro devolver para um subestoque sem origem identificada.");
      }
      const sourceLocation = await ctx.db.get(exit.locationId);
      if (!sourceLocation || !sourceLocation.active) {
        throw new Error("O local físico da saída original não existe ou está inativo.");
      }
      if (args.locationId && args.locationId !== exit.locationId) {
        throw new Error("A devolução deve voltar ao local físico de origem. Para mudar o local, registre uma transferência após a devolução.");
      }
      targetLocationId = exit.locationId;
    } else if (args.locationId) {
      // Saídas legadas não guardam a área/local nem o saldo por origem. Atribuir
      // agora um destino físico produziria um bucket sem lote correspondente.
      throw new Error(
        "Esta saída antiga não possui área/local de origem. Não é seguro atribuir um local na devolução; regularize a classificação antes de devolver."
      );
    }

    // Preferir a trilha completa de lotes consumidos. Ela permite devolver
    // corretamente uma saída que utilizou dois ou mais lotes FIFO.
    const movementLots = await ctx.db.query("stockMovementLots")
      .withIndex("by_movement", (q) => q.eq("movementId", exit._id))
      .collect();
    const sourceLots: Array<{ lot: Doc<"lots">; quantity: number }> = [];

    if (movementLots.length > 0) {
      const linkError = validateExitLotLinks(
        Number(exit.quantity),
        movementLots.map((link) => ({
          lotId: link.lotId ? String(link.lotId) : "",
          quantity: Number(link.quantity),
        })),
      );
      if (linkError) throw new Error(linkError);
      for (const link of movementLots) {
        const lot = await ctx.db.get(link.lotId);
        if (!lot || lot.productId !== exit.productId ||
            !Number.isFinite(lot.quantityReceived) || link.quantity > lot.quantityReceived) {
          throw new Error("A trilha de lotes da saída está incompleta ou excede o lote recebido. Devolução bloqueada para preservar a rastreabilidade.");
        }
        if (exit.areaId) {
          if (lot.areaId !== exit.areaId || lot.locationId !== exit.locationId) {
            throw new Error("Um lote consumido não corresponde à área/local da saída. Devolução bloqueada.");
          }
        } else if (lot.areaId || lot.locationId) {
          throw new Error("A saída legada está vinculada a um lote já classificado em área/local. Devolução bloqueada.");
        }
        sourceLots.push({ lot, quantity: link.quantity });
      }
    } else {
      const productLots = await ctx.db.query("lots")
        .withIndex("by_product", (q) => q.eq("productId", exit.productId))
        .collect();
      const rawLotId = args.lotId ?? exit.lotId ?? null;
      let fallbackLot: Doc<"lots"> | null = args.lotId ? await ctx.db.get(args.lotId) : null;
      if (!fallbackLot && rawLotId) {
        if (String(rawLotId).startsWith("LOT-")) {
          const matchingLots = await ctx.db.query("lots")
            .withIndex("by_number", (q) => q.eq("lotNumber", rawLotId))
            .collect();
          if (matchingLots.length > 1) {
            throw new Error(`O número de lote "${rawLotId}" está duplicado. Regularize a identificação antes de registrar a devolução.`);
          }
          fallbackLot = matchingLots[0] ?? null;
        } else {
          fallbackLot = await ctx.db.get(rawLotId as Id<"lots">);
        }
      }
      const requiresLot = !!rawLotId || productLots.some((lot) => lot.active);
      const lotGuard = resolveReturnLotGuard({
        exitLotId: fallbackLot?._id ? String(fallbackLot._id) : null,
        requiresLot,
      });
      if (lotGuard) {
        const exitLabel = exit.exitNumber ?? new Date(exit.timestamp).toLocaleString("pt-BR");
        throw new Error(buildUnresolvableLotMessage({
          productName: product.name, exitLabel, reason: lotGuard,
        }));
      }
      if (fallbackLot) {
        if (fallbackLot.productId !== exit.productId) {
          throw new Error("Lote não corresponde ao produto da saída");
        }
        if (exit.areaId) {
          if (fallbackLot.areaId !== exit.areaId || fallbackLot.locationId !== exit.locationId) {
            throw new Error("O lote de origem não pertence à área/local da saída. Devolução bloqueada.");
          }
        } else if (fallbackLot.areaId || fallbackLot.locationId) {
          throw new Error("Não é possível devolver uma saída legada para um lote classificado em área/local.");
        }
        sourceLots.push({ lot: fallbackLot, quantity: exit.quantity });
      }
    }

    if (args.lotId && sourceLots.length > 0 && !sourceLots.some((part) => part.lot._id === args.lotId)) {
      throw new Error("O lote selecionado não pertence à saída original.");
    }
    if (exit.areaId && sourceLots.length === 0) {
      throw new Error("A saída classificada não possui vínculo verificável com os lotes consumidos. Devolução bloqueada.");
    }

    // Distribuir a quantidade a devolver entre os mesmos lotes consumidos,
    // abatendo devoluções anteriores lote a lote.
    const returnedByLot = new Map<string, number>();
    for (const record of relatedReturns) {
      if (record.lotId && (record.exitMovementId === exit._id ||
        (!record.exitMovementId && !!exit.requestId && record.requestId === exit.requestId &&
          record.productId === exit.productId))) {
        returnedByLot.set(record.lotId as string,
          (returnedByLot.get(record.lotId as string) ?? 0) + record.quantity);
      }
    }
    const orderedSources = [...sourceLots].sort((a, b) =>
      a.lot.receivedAt - b.lot.receivedAt ||
      a.lot.lotNumber.localeCompare(b.lot.lotNumber)
    );
    // Registros históricos de devolução podem não ter exitMovementId nem lotId.
    // Sua quantidade já reduz o total devolvível; abatemos conservadoramente
    // essa parte dos primeiros lotes FIFO para não restaurar saldo em duplicidade.
    let unassignedLegacyReturned = relatedReturns
      .filter((record) => !record.exitMovementId && !record.lotId &&
        !!exit.requestId && record.requestId === exit.requestId &&
        record.productId === exit.productId)
      .reduce((sum, record) => sum + record.quantity, 0);
    const legacyReturnedByLot = new Map<string, number>();
    for (const source of orderedSources) {
      const assignedLegacyReturn = Math.min(source.quantity, unassignedLegacyReturned);
      unassignedLegacyReturned -= assignedLegacyReturn;
      legacyReturnedByLot.set(String(source.lot._id), assignedLegacyReturn);
    }
    const parts: Array<{ lot: Doc<"lots"> | null; quantity: number }> = [];
    let remaining = args.quantity;
    if (orderedSources.length > 0) {
      const candidates = args.lotId
        ? orderedSources.filter((part) => part.lot._id === args.lotId)
        : orderedSources;
      if (args.lotId && candidates.length === 0) {
        throw new Error("O lote selecionado não pertence à saída original.");
      }
      for (const source of candidates) {
        if (remaining <= 0) break;
        const assignedLegacyReturn = legacyReturnedByLot.get(String(source.lot._id)) ?? 0;
        const alreadyForLot = (returnedByLot.get(String(source.lot._id)) ?? 0) + assignedLegacyReturn;
        const availableFromLot = Math.max(0, source.quantity - alreadyForLot);
        const quantity = Math.min(availableFromLot, remaining);
        if (quantity <= 0) continue;
        parts.push({ lot: source.lot, quantity });
        remaining -= quantity;
      }
      if (remaining > 0) {
        throw new Error("A quantidade solicitada excede o saldo ainda devolvível dos lotes consumidos nesta saída.");
      }
    } else {
      parts.push({ lot: null, quantity: args.quantity });
    }

    if (args.receivedByUserId) {
      const recipient = await ctx.db.get(args.receivedByUserId);
      if (!recipient || recipient.active === false) {
        throw new Error("Usuário recebedor não encontrado ou inativo");
      }
    }

    const [stockRows, productLots, locationRows] = await Promise.all([
      ctx.db.query("stock")
        .withIndex("by_product", (q) => q.eq("productId", exit.productId))
        .collect(),
      ctx.db.query("lots")
        .withIndex("by_product", (q) => q.eq("productId", exit.productId))
        .collect(),
      ctx.db.query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", exit.productId))
        .collect(),
    ]);
    if (stockRows.length !== 1) {
      throw new Error(stockRows.length === 0
        ? "Registro de estoque não encontrado."
        : "Há registros globais de estoque duplicados. Regularize antes de devolver.");
    }
    const stock = stockRows[0];
    if (!Number.isFinite(stock.physicalQuantity) || !Number.isFinite(stock.reservedQuantity) ||
        stock.physicalQuantity < 0 || stock.reservedQuantity < 0 ||
        stock.physicalQuantity < stock.reservedQuantity) {
      throw new Error("O saldo global está inconsistente. Regularize o estoque antes de registrar a devolução.");
    }
    if (productLots.some((lot) =>
      !Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0 ||
      (lot.active === false && lot.quantityAvailable > 0)
    )) {
      throw new Error("Há lote com saldo inválido ou inativo com quantidade positiva. Regularize antes de devolver.");
    }

    let locationStock: Doc<"stockByLocation"> | null = null;
    let locationStockQuantity = 0;
    if (targetLocationId) {
      const matchingRows = locationRows.filter((row) =>
        row.locationId === targetLocationId &&
        (row.areaId ?? undefined) === (exit.areaId ?? undefined)
      );
      if (matchingRows.length > 1) {
        throw new Error("Há saldos físicos duplicados para a área/local de origem. Regularize antes de devolver.");
      }
      locationStock = matchingRows[0] ?? null;
      locationStockQuantity = locationStock
        ? requireValidScopedStockQuantity(locationStock.quantity, "área/local de origem")
        : 0;
      const lotsAtLocation = productLots
        .filter((lot) => lot.locationId === targetLocationId &&
          (lot.areaId ?? undefined) === (exit.areaId ?? undefined))
        .reduce((sum: number, lot) => sum + Number(lot.quantityAvailable), 0);
      if (!Number.isFinite(lotsAtLocation) ||
          Math.abs(lotsAtLocation - locationStockQuantity) > 1e-9) {
        throw new Error("O saldo físico da área/local diverge dos lotes. Regularize antes de devolver.");
      }
    }

    const now = Date.now();
    const condition: ReturnCondition = args.condition;
    const restocked = shouldRestockReturnedMaterial(condition);
    // Só material explicitamente não utilizado volta ao saldo requisitável.
    // Itens usados parcialmente, defeituosos ou não classificados ficam
    // registrados para avaliação, sem alterar stock, lote ou bucket físico.
    const newPhysical = restocked
      ? applyReturnToStock(stock.physicalQuantity, args.quantity)
      : stock.physicalQuantity;
    if (restocked) {
      await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    }

    if (restocked && targetLocationId) {
      if (locationStock) {
        await ctx.db.patch(locationStock._id, {
          quantity: applyReturnToLocation(locationStockQuantity, args.quantity),
        });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: exit.productId,
          locationId: targetLocationId,
          areaId: exit.areaId,
          quantity: args.quantity,
        });
      }
    }

    const returnIds: Id<"returns">[] = [];
    let runningPhysical = stock.physicalQuantity;
    for (const part of parts) {
      if (restocked && part.lot) {
        await ctx.db.patch(part.lot._id, applyReturnToLot(
          Number(part.lot.quantityAvailable),
          part.quantity,
        ));
        await adjustLotLocationBalance(ctx, {
          lotId: part.lot._id, productId: part.lot.productId,
          locationId: targetLocationId, delta: part.quantity,
          expectedQuantityBefore: Number(part.lot.quantityAvailable),
        });
      }
      const returnId = await ctx.db.insert("returns", {
        exitMovementId: exit._id,
        requestId: exit.requestId,
        productId: exit.productId,
        lotId: part.lot?._id,
        quantity: part.quantity,
        reason,
        condition,
        restocked,
        areaId: exit.areaId,
        locationId: targetLocationId,
        returnedByUserId: userId,
        receivedByUserId: args.receivedByUserId,
        observation: args.observation,
        createdAt: now,
      });
      returnIds.push(returnId);

      const nextPhysical = runningPhysical + (restocked ? part.quantity : 0);
      await ctx.db.insert("stockMovements", {
        productId: exit.productId,
        type: "return",
        quantity: part.quantity,
        previousPhysical: runningPhysical,
        newPhysical: nextPhysical,
        previousReserved: stock.reservedQuantity,
        newReserved: stock.reservedQuantity,
        userId,
        requestId: exit.requestId,
        exitMovementId: exit._id,
        lotId: part.lot?._id,
        areaId: exit.areaId,
        locationId: targetLocationId,
        observation: `Devolução da saída ${exit.exitNumber ?? new Date(exit.timestamp).toLocaleString("pt-BR")} — ${reason}` +
          (restocked ? " | material não utilizado reintegrado ao estoque" : " | recebido para avaliação; fora do saldo utilizável") +
          (args.observation ? ` | ${args.observation}` : ""),
        timestamp: now,
      });
      runningPhysical = nextPhysical;
    }

    const exitLabel = exit.exitNumber ?? new Date(exit.timestamp).toLocaleString("pt-BR");
    const area = exit.areaId ? await ctx.db.get(exit.areaId) : null;
    const location = targetLocationId ? await ctx.db.get(targetLocationId) : null;
    const returnedLotDetails = parts.map((part) =>
      `${part.lot?.lotNumber ?? "lote não identificado"} x${part.quantity}`
    ).join(", ");
    await ctx.db.insert("auditLogs", {
      userId,
      action: "return_stock",
      entity: "returns",
      entityId: returnIds[0],
      details: buildReturnAuditDetail({
        quantity: args.quantity,
        productName: product.name,
        exitLabel,
        condition,
        reason,
      }) +
        ` | área: ${area?.name ?? (exit.areaId ? "não encontrada" : "legado")} | local físico: ${location?.name ?? (targetLocationId ? "não encontrado" : "não registrado")}` +
        ` | lotes: ${returnedLotDetails || "sem lote identificado"} | registros: ${returnIds.join(", ")}` +
        (restocked ? " | reintegrada ao estoque utilizável" : " | em avaliação, sem recompor o estoque disponível"),
      timestamp: now,
    });

    return returnIds.length === 1 ? returnIds[0] : returnIds;
  },
});

