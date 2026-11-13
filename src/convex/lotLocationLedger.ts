import { planFifoLotLocationConsumption } from "../lib/lot-location-rules";
import { validateUniqueScopedStockRows } from "../lib/stock-read-integrity";

const QUANTITY_EPSILON = 1e-9;

function sameQuantity(left: number, right: number): boolean {
  return Math.abs(left - right) <= QUANTITY_EPSILON;
}

/**
 * Resolve o armário sem adivinhar: a omissão só é aceita quando existe
 * exatamente um único armário com saldo físico positivo para o produto.
 */
export async function resolveWithdrawalLocation(
  ctx: any,
  productId: any,
  requestedLocationId?: any,
): Promise<any> {
  const rows = await ctx.db
    .query("stockByLocation")
    .withIndex("by_product", (q: any) => q.eq("productId", productId))
    .collect();
  validateUniqueScopedStockRows(rows, String(productId));

  if (requestedLocationId) {
    const match = rows.find((row: any) => row.locationId === requestedLocationId);
    if (!match || match.quantity <= QUANTITY_EPSILON) {
      throw new Error("O armário selecionado não possui saldo físico disponível para este produto.");
    }
    return requestedLocationId;
  }

  const positive = rows.filter((row: any) => row.quantity > QUANTITY_EPSILON);
  if (positive.length !== 1) {
    throw new Error(
      positive.length === 0
        ? "O produto não possui saldo físico por armário. Regularize o inventário antes da retirada."
        : "Selecione o armário de origem da retirada; o produto possui saldo em mais de um armário.",
    );
  }
  return positive[0].locationId;
}

/**
 * Consome lotes FIFO exclusivamente no armário indicado.
 *
 * A operação valida previamente:
 * - lote × armário sem duplicidade;
 * - soma dos armários igual ao saldo disponível de cada lote;
 * - soma dos lotes por armário igual ao saldo físico por armário;
 * - saldo suficiente no armário de origem.
 *
 * Nenhuma escrita ocorre até que todas as validações e a alocação FIFO
 * estejam concluídas. A mutation Convex mantém as atualizações atômicas.
 */
export async function consumeLotLocationStock(
  ctx: any,
  input: { productId: any; locationId: any; quantity: number },
): Promise<{
  locationId: any;
  availableAtLocation: number;
  allocations: Array<{
    lotId: any;
    lotNumber: string;
    quantity: number;
    lotQuantityAfter: number;
    locationQuantityAfter: number;
  }>;
}> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("A quantidade da retirada deve ser positiva e finita.");
  }

  const [lots, balances, locationRows] = await Promise.all([
    ctx.db.query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", input.productId))
      .collect(),
    ctx.db.query("lotLocationBalances")
      .withIndex("by_product", (q: any) => q.eq("productId", input.productId))
      .collect(),
    ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", input.productId))
      .collect(),
  ]);

  validateUniqueScopedStockRows(locationRows, String(input.productId));

  const lotsById = new Map<string, any>();
  for (const lot of lots) lotsById.set(String(lot._id), lot);

  const plan = planFifoLotLocationConsumption({
    lots: lots.map((lot: any) => ({
      lotId: String(lot._id),
      lotNumber: lot.lotNumber,
      receivedAt: lot.receivedAt,
      quantityAvailable: lot.quantityAvailable,
      active: lot.active,
    })),
    balances: balances.map((balance: any) => ({
      balanceId: String(balance._id),
      lotId: String(balance.lotId),
      locationId: String(balance.locationId),
      quantityAvailable: balance.quantityAvailable,
    })),
    locationId: String(input.locationId),
    quantity: input.quantity,
  });

  const balanceById = new Map<string, any>();
  for (const balance of balances) balanceById.set(String(balance._id), balance);

  const lotTotalsByLocation = new Map<string, number>();
  for (const balance of balances) {
    const key = String(balance.locationId);
    lotTotalsByLocation.set(key, (lotTotalsByLocation.get(key) ?? 0) + balance.quantityAvailable);
  }
  const physicalByLocation = new Map<string, any>();
  for (const row of locationRows) physicalByLocation.set(String(row.locationId), row);
  const allLocationIds = new Set([
    ...lotTotalsByLocation.keys(),
    ...physicalByLocation.keys(),
  ]);

  for (const locationId of allLocationIds) {
    const lotQuantity = lotTotalsByLocation.get(locationId) ?? 0;
    const physical = physicalByLocation.get(locationId)?.quantity ?? 0;
    if (!sameQuantity(lotQuantity, physical)) {
      throw new Error(
        `O saldo dos lotes (${lotQuantity}) diverge do saldo físico (${physical}) no armário ${locationId}. ` +
        "A baixa foi bloqueada; faça a conciliação do inventário antes de continuar.",
      );
    }
  }

  const sourceRow = physicalByLocation.get(String(input.locationId));
  if (!sourceRow || sourceRow.quantity + QUANTITY_EPSILON < input.quantity) {
    throw new Error("Saldo físico insuficiente no armário de origem.");
  }

  // Plano completo validado: agora aplica a mesma baixa em lote, armário e
  // saldo físico local. O saldo global é atualizado pela mutation chamadora.
  for (const allocation of plan.allocations) {
    const lot = lotsById.get(allocation.lotId);
    const balance = allocation.balanceId
      ? balanceById.get(allocation.balanceId)
      : balances.find((row: any) =>
          String(row.lotId) === allocation.lotId &&
          String(row.locationId) === String(input.locationId),
        );
    if (!lot || !balance) {
      throw new Error("O vínculo lote/armário mudou durante a baixa. Tente novamente.");
    }
    await ctx.db.patch(lot._id, { quantityAvailable: allocation.lotQuantityAfter });
    await ctx.db.patch(balance._id, {
      quantityAvailable: allocation.locationQuantityAfter,
      updatedAt: Date.now(),
    });
  }

  await ctx.db.patch(sourceRow._id, { quantity: sourceRow.quantity - input.quantity });

  return {
    locationId: input.locationId,
    availableAtLocation: plan.availableAtLocation,
    allocations: plan.allocations.map((allocation) => ({
      lotId: lotsById.get(allocation.lotId)._id,
      lotNumber: allocation.lotNumber,
      quantity: allocation.quantity,
      lotQuantityAfter: allocation.lotQuantityAfter,
      locationQuantityAfter: allocation.locationQuantityAfter,
    })),
  };
}


/**
 * Persiste a lista completa de lotes consumidos vinculada à movimentação.
 * O campo legado stockMovements.lotId continua recebendo o primeiro lote,
 * mas relatórios/devoluções podem consultar esta tabela sem parsear texto.
 */
export async function recordLotMovementAllocations(
  ctx: any,
  input: {
    movementId: any;
    productId: any;
    locationId: any;
    allocations: Array<{ lotId: any; quantity: number }>;
    allocationType?: "withdrawal" | "reclassification";
  },
): Promise<void> {
  const allocationType = input.allocationType ?? "withdrawal";
  if (input.allocations.some((allocation) =>
    !Number.isFinite(allocation.quantity) || allocation.quantity <= 0,
  )) {
    throw new Error("Alocação de lote inválida para a movimentação.");
  }
  for (const allocation of input.allocations) {
    await ctx.db.insert("stockMovementLotAllocations", {
      movementId: input.movementId,
      productId: input.productId,
      lotId: allocation.lotId,
      locationId: input.locationId,
      quantity: allocation.quantity,
      allocationType,
      createdAt: Date.now(),
    });
  }
}
