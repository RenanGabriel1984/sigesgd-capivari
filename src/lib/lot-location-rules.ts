export interface LotLocationTransferPlan {
  sourceQuantityAfter: number;
  destinationQuantityAfter: number;
}

export interface FifoLotForConsumption {
  lotId: string;
  lotNumber: string;
  receivedAt: number;
  quantityAvailable: number;
  active?: boolean;
}

export interface FifoLotLocationBalance {
  balanceId?: string;
  lotId: string;
  locationId: string;
  quantityAvailable: number;
}

export interface FifoLotConsumptionAllocation {
  lotId: string;
  lotNumber: string;
  locationId: string;
  balanceId?: string;
  quantity: number;
  lotQuantityAfter: number;
  locationQuantityAfter: number;
}

export interface FifoLotConsumptionPlan {
  availableAtLocation: number;
  allocations: FifoLotConsumptionAllocation[];
}

const QUANTITY_EPSILON = 1e-9;

function quantitiesMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= QUANTITY_EPSILON;
}

/**
 * Calcula uma baixa FIFO somente dentro do armário escolhido.
 *
 * Antes de montar qualquer alocação, exige que:
 * - cada lote tenha no máximo um saldo por armário;
 * - não existam quantidades negativas/não finitas;
 * - a soma dos saldos por armário seja exatamente o saldo disponível do lote.
 *
 * A função é pura: não grava dados e pode ser testada sem Convex.
 */
export function planFifoLotLocationConsumption(input: {
  lots: FifoLotForConsumption[];
  balances: FifoLotLocationBalance[];
  locationId: string;
  quantity: number;
}): FifoLotConsumptionPlan {
  const { lots, balances, locationId, quantity } = input;

  if (!locationId.trim()) throw new Error("Informe o armário de origem da retirada.");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("A quantidade da retirada deve ser positiva e finita.");
  }

  const lotsById = new Map<string, FifoLotForConsumption>();
  for (const lot of lots) {
    if (!lot.lotId || lotsById.has(lot.lotId)) {
      throw new Error("Há lotes duplicados ou sem identificador para este produto.");
    }
    if (!Number.isFinite(lot.receivedAt) || !Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) {
      throw new Error(`O saldo ou a data de recebimento do lote ${lot.lotNumber || lot.lotId} é inválido.`);
    }
    if (lot.active === false && lot.quantityAvailable > QUANTITY_EPSILON) {
      throw new Error(`O lote inativo ${lot.lotNumber} ainda possui saldo disponível.`);
    }
    lotsById.set(lot.lotId, lot);
  }

  const balanceByKey = new Map<string, FifoLotLocationBalance>();
  const sumByLot = new Map<string, number>();
  const sumByLotLocation = new Map<string, number>();
  for (const balance of balances) {
    const lot = lotsById.get(balance.lotId);
    if (!lot) throw new Error("Existe saldo por armário vinculado a um lote inexistente ou de outro produto.");
    if (!balance.locationId || !Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
      throw new Error(`O saldo do lote ${lot.lotNumber} em um armário é inválido.`);
    }
    const key = `${balance.lotId}::${balance.locationId}`;
    if (balanceByKey.has(key)) {
      throw new Error(`Há saldos duplicados do lote ${lot.lotNumber} no mesmo armário.`);
    }
    balanceByKey.set(key, balance);
    sumByLot.set(balance.lotId, (sumByLot.get(balance.lotId) ?? 0) + balance.quantityAvailable);
    sumByLotLocation.set(balance.locationId, (sumByLotLocation.get(balance.locationId) ?? 0) + balance.quantityAvailable);
  }

  for (const lot of lots) {
    const locatedQuantity = sumByLot.get(lot.lotId) ?? 0;
    if (!quantitiesMatch(locatedQuantity, lot.quantityAvailable)) {
      throw new Error(
        `O lote ${lot.lotNumber} não está totalmente conciliado por armário: ` +
        `saldo do lote ${lot.quantityAvailable}, distribuído ${locatedQuantity}. Regularize o legado antes da baixa.`,
      );
    }
  }

  const availableAtLocation = sumByLotLocation.get(locationId) ?? 0;
  if (availableAtLocation + QUANTITY_EPSILON < quantity) {
    throw new Error(
      `Saldo rastreável insuficiente no armário selecionado. Disponível: ${availableAtLocation}; solicitado: ${quantity}.`,
    );
  }

  const fifoLots = lots
    .filter((lot) => lot.active !== false && lot.quantityAvailable > QUANTITY_EPSILON)
    .map((lot) => ({
      lot,
      balance: balanceByKey.get(`${lot.lotId}::${locationId}`),
    }))
    .filter((item) => (item.balance?.quantityAvailable ?? 0) > QUANTITY_EPSILON)
    .sort((a, b) =>
      a.lot.receivedAt - b.lot.receivedAt ||
      a.lot.lotNumber.localeCompare(b.lot.lotNumber) ||
      a.lot.lotId.localeCompare(b.lot.lotId),
    );

  let remaining = quantity;
  const allocations: FifoLotConsumptionAllocation[] = [];
  for (const item of fifoLots) {
    if (remaining <= QUANTITY_EPSILON) break;
    const available = item.balance!.quantityAvailable;
    const take = Math.min(available, remaining);
    if (take <= QUANTITY_EPSILON) continue;
    allocations.push({
      lotId: item.lot.lotId,
      lotNumber: item.lot.lotNumber,
      locationId,
      balanceId: item.balance!.balanceId,
      quantity: take,
      lotQuantityAfter: Math.max(0, item.lot.quantityAvailable - take),
      locationQuantityAfter: Math.max(0, available - take),
    });
    remaining = Math.max(0, remaining - take);
  }

  if (remaining > QUANTITY_EPSILON) {
    throw new Error(`Lotes insuficientes no armário selecionado. Faltam ${remaining} unidade(s).`);
  }

  return { availableAtLocation, allocations };
}

/**
 * Calcula a redistribuição de um lote entre dois armários.
 * Transferência não altera o total do lote; apenas move saldo entre locais.
 */
export function planLotLocationTransfer(input: {
  sourceQuantity: number;
  destinationQuantity: number;
  quantity: number;
}): LotLocationTransferPlan {
  const { sourceQuantity, destinationQuantity, quantity } = input;
  if (![sourceQuantity, destinationQuantity, quantity].every(Number.isFinite)) {
    throw new Error("Quantidades da transferência do lote devem ser finitas.");
  }
  if (sourceQuantity < 0 || destinationQuantity < 0 || quantity <= 0) {
    throw new Error("Quantidades inválidas para transferência do lote.");
  }
  if (sourceQuantity < quantity) {
    throw new Error(`Saldo do lote no armário de origem insuficiente. Disponível: ${sourceQuantity}.`);
  }
  return {
    sourceQuantityAfter: sourceQuantity - quantity,
    destinationQuantityAfter: destinationQuantity + quantity,
  };
}
