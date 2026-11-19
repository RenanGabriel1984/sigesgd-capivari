import { requirePermission } from "./rbac";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { isValidStockQuantity } from "../lib/stock-quantity-rules";
import { groupAssetPartConsumptionByLocation, planAssetPartFifoConsumption } from "../lib/asset-part-consumption";
import { adjustLotLocationBalance } from "../lib/lot-location-balance";
import { assertTextLimits, MAX_OBSERVATION } from "../lib/text-limits";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician" | "patrimony_manager";

async function requireUser(ctx: any) {
  // RBAC central: consulta de peças (visão de equipamentos).
  return requirePermission(ctx, "equipment.view");
}

async function requireManagerOrAdmin(ctx: any) {
  // RBAC central: instalar/remover peças.
  return requirePermission(ctx, "equipment.manage", { entity: "assetParts" });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const listByAsset = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const parts = await ctx.db
      .query("assetParts")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();

    return Promise.all(parts.map(async (p: any) => {
      const product = await ctx.db.get(p.productId);
      const installedBy = await ctx.db.get(p.installedByUserId);
      return { ...p, product, installedBy };
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const installPart = mutation({
  args: {
    assetId: v.id("assets"),
    productId: v.id("products"),
    quantity: v.number(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (!isValidStockQuantity(args.quantity, product.unitOfMeasure, product.hasSerial === true)) {
      throw new Error(
        product.hasSerial || ["un", "pc", "cx", "rl", "pct", "po", "kt"].includes((product.unitOfMeasure ?? "").trim().toLowerCase())
          ? "A quantidade da peça deve ser um número inteiro positivo para a unidade de estoque deste produto."
          : "Quantidade deve ser um número positivo.",
      );
    }

    const lots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();

    const invalidLot = lots.find(
      (lot) =>
        !Number.isFinite(lot.quantityAvailable) ||
        lot.quantityAvailable < 0 ||
        (lot.active === false && lot.quantityAvailable > 0),
    );
    if (invalidLot) {
      throw new Error("O lote " + invalidLot.lotNumber + " possui saldo inválido ou está inativo com saldo positivo. Regularize antes de instalar a peça.");
    }

    // Reservas por lote precisam ser preservadas: o FIFO só pode consumir a
    // parcela livre de cada lote, mesmo quando há saldo global livre em outros.
    const reservations = await ctx.db
      .query("requestItemReservations")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const lotById = new Map(lots.map((lot) => [String(lot._id), lot]));
    const reservedByLot = new Map<string, number>();
    for (const reservation of reservations as any[]) {
      const lot = lotById.get(String(reservation.lotId));
      const remaining = Number(reservation.quantityRemaining);
      if (
        !lot ||
        reservation.productId !== args.productId ||
        !Number.isFinite(remaining) ||
        remaining < 0 ||
        (remaining > 0 && (
          reservation.areaId !== lot.areaId ||
          reservation.locationId !== lot.locationId ||
          lot.active === false
        ))
      ) {
        throw new Error("Há reserva inválida ou sem correspondência com lote/área/local. Regularize antes de instalar a peça.");
      }
      reservedByLot.set(String(lot._id), (reservedByLot.get(String(lot._id)) ?? 0) + remaining);
    }
    for (const lot of lots) {
      if ((reservedByLot.get(String(lot._id)) ?? 0) > lot.quantityAvailable + 1e-9) {
        throw new Error(`As reservas do lote ${lot.lotNumber} excedem o saldo físico. Regularize antes de instalar a peça.`);
      }
    }

    // Monta o plano FIFO antes de gravar qualquer alteração. Cada lote deve
    // informar local físico; a origem nunca é presumida pela tela ou pelo usuário.
    const allocations = planAssetPartFifoConsumption(
      lots.map((lot) => ({
        id: String(lot._id),
        lotNumber: lot.lotNumber,
        receivedAt: lot.receivedAt,
        quantityAvailable: lot.quantityAvailable,
        quantityReserved: reservedByLot.get(String(lot._id)) ?? 0,
        active: lot.active,
        locationId: lot.locationId ? String(lot.locationId) : undefined,
        areaId: lot.areaId ? String(lot.areaId) : undefined,
      })),
      args.quantity,
    );
    const locationConsumption = groupAssetPartConsumptionByLocation(allocations);

    // Cada parcela FIFO precisa corresponder exatamente a um saldo por
    // produto/local/área. Duplicidades ou ausência de saldo bloqueiam a operação
    // para evitar divergência entre o saldo global e os subestoques.
    const locationBalances = await ctx.db
      .query("stockByLocation")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();

    const locationUpdates: Array<{ id: any; newQuantity: number }> = [];
    for (const group of locationConsumption) {
      const matches = locationBalances.filter(
        (row) =>
          String(row.locationId) === group.locationId &&
          (row.areaId ? String(row.areaId) : undefined) === group.areaId,
      );
      if (matches.length !== 1) {
        throw new Error(
          matches.length === 0
            ? `Não existe saldo por local para o produto no local/área de origem do lote. Regularize antes de instalar.`
            : `Existe saldo duplicado para o produto no mesmo local/área. Regularize o subestoque antes de instalar.`,
        );
      }
      const row = matches[0];
      if (!Number.isFinite(row.quantity) || row.quantity < group.quantity) {
        throw new Error(
          `Saldo insuficiente no local de origem do lote. Disponível: ${row.quantity}; necessário: ${group.quantity}.`,
        );
      }
      locationUpdates.push({ id: row._id, newQuantity: row.quantity - group.quantity });
    }

    // Conferência final do saldo global disponível (físico - reservado).
    const globalRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    if (globalRows.length !== 1) {
      throw new Error(
        globalRows.length === 0
          ? "Registro global de estoque não encontrado."
          : "Existem registros globais duplicados para este produto. Regularize o estoque antes de instalar a peça.",
      );
    }
    const freshStock = globalRows[0];
    if (
      !Number.isFinite(freshStock.physicalQuantity) ||
      !Number.isFinite(freshStock.reservedQuantity) ||
      freshStock.physicalQuantity < 0 ||
      freshStock.reservedQuantity < 0 ||
      freshStock.reservedQuantity > freshStock.physicalQuantity
    ) {
      throw new Error("O saldo global do produto está inconsistente. Regularize antes de instalar a peça.");
    }
    const reservedInLots = [...reservedByLot.values()].reduce((sum, quantity) => sum + quantity, 0);
    if (reservedInLots > freshStock.reservedQuantity + 1e-9) {
      throw new Error("As reservas por lote excedem o saldo reservado global. Regularize antes de instalar a peça.");
    }
    const available = freshStock.physicalQuantity - freshStock.reservedQuantity;
    if (available < args.quantity) {
      throw new Error(
        `Estoque insuficiente. Disponível: ${available}. Necessário: ${args.quantity}.`,
      );
    }


    for (const allocation of allocations) {
      const lot = lotById.get(allocation.lotId);
      if (!lot || lot.quantityAvailable < allocation.quantity) {
        throw new Error("O saldo do lote mudou durante a instalação. Atualize a tela e tente novamente.");
      }
    }

    const now = Date.now();

    // Debita todos os lotes consumidos e todos os subestoques correspondentes.
    for (const allocation of allocations) {
      const lot = lotById.get(allocation.lotId)!;
      await ctx.db.patch(lot._id, {
        quantityAvailable: lot.quantityAvailable - allocation.quantity,
      });
      await adjustLotLocationBalance(ctx, {
        lotId: lot._id, productId: lot.productId, locationId: lot.locationId,
        delta: -allocation.quantity,
      });
    }
    for (const update of locationUpdates) {
      await ctx.db.patch(update.id, { quantity: update.newQuantity });
    }

    const newPhysical = freshStock.physicalQuantity - args.quantity;
    await ctx.db.patch(freshStock._id, { physicalQuantity: newPhysical });

    const singleSource = locationConsumption.length === 1 ? locationConsumption[0] : null;
    const firstLotId = allocations[0]?.lotId;
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      previousPhysical: freshStock.physicalQuantity,
      newPhysical,
      previousReserved: freshStock.reservedQuantity,
      newReserved: freshStock.reservedQuantity,
      userId,
      lotId: firstLotId,
      areaId: singleSource?.areaId as any,
      locationId: singleSource?.locationId as any,
      observation: `Instalação em equipamento: ${asset.patrimonyNumber ?? asset.serialNumber ?? args.assetId}. A rastreabilidade de todos os lotes está vinculada à movimentação.`,
      timestamp: now,
    });

    // Uma linha por lote usado: não perde os lotes adicionais da mesma instalação.
    for (const allocation of allocations) {
      await ctx.db.insert("stockMovementLots", {
        movementId,
        lotId: allocation.lotId as any,
        quantity: allocation.quantity,
        areaId: allocation.areaId as any,
        locationId: allocation.locationId as any,
      });
    }

    const partId = await ctx.db.insert("assetParts", {
      assetId: args.assetId,
      productId: args.productId,
      lotId: firstLotId,
      stockMovementId: movementId,
      quantity: args.quantity,
      installedAt: now,
      installedByUserId: userId,
      observation: args.observation || undefined,
    });

    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "part_installed",
      userId,
      observation: `Peça instalada: ${product.name} (${args.quantity}x). Movimentação: ${movementId}`,
      timestamp: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_part_install",
      entity: "assetParts",
      entityId: partId,
      details: `Peça ${product.name} instalada em ${asset.patrimonyNumber ?? "equipamento"} — ${args.quantity} un; ${allocations.length} lote(s) consumido(s)`,
      timestamp: now,
    });

    return partId;
  },
});

export const removePart = mutation({
  args: {
    partId: v.id("assetParts"),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    const part = await ctx.db.get(args.partId);
    if (!part) throw new Error("Peça não encontrada");
    if (part.removedAt) throw new Error("Esta peça já foi removida");

    const now = Date.now();
    await ctx.db.patch(args.partId, {
      removedAt: now,
      observation: args.observation || part.observation,
    });

    const asset = await ctx.db.get(part.assetId);
    const product = await ctx.db.get(part.productId);

    // Asset history
    await ctx.db.insert("assetHistory", {
      assetId: part.assetId,
      eventType: "part_removed",
      userId,
      observation: `Peça removida: ${product?.name ?? "desconhecida"} (${part.quantity}x)`,
      timestamp: now,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_part_remove",
      entity: "assetParts",
      entityId: args.partId,
      details: `Peça ${product?.name ?? ""} removida de ${asset?.patrimonyNumber ?? "equipamento"}`,
      timestamp: now,
    });

    return args.partId;
  },
});
