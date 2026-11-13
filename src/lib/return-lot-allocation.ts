export type SourceLotAllocation = {
  lotId: string;
  sourceLocationId?: string;
  quantity: number;
};

export type RequestedLotReturn = {
  lotId: string;
  sourceLocationId?: string;
  quantity: number;
};

export type PlannedLotReturn = RequestedLotReturn;

const EPSILON = 1e-9;
const keyOf = (value: { lotId: string; sourceLocationId?: string }) =>
  `${value.lotId}::${value.sourceLocationId ?? ""}`;

/**
 * Valida a devolução contra a alocação original da saída.
 * O operador informa explicitamente de quais lotes/localizações vieram as
 * unidades devolvidas; não há rateio automático entre lotes.
 */
export function planLotReturnAllocations(input: {
  requestedQuantity: number;
  sourceAllocations: SourceLotAllocation[];
  previouslyReturned: RequestedLotReturn[];
  requestedAllocations: RequestedLotReturn[];
}): PlannedLotReturn[] {
  if (!Number.isFinite(input.requestedQuantity) || input.requestedQuantity <= 0) {
    throw new Error("A quantidade da devolução deve ser positiva e finita.");
  }
  if (input.sourceAllocations.length === 0) {
    throw new Error("A saída não possui alocação de lote/localização rastreável.");
  }

  const sourceByKey = new Map<string, SourceLotAllocation>();
  for (const source of input.sourceAllocations) {
    if (!source.lotId || !Number.isFinite(source.quantity) || source.quantity <= 0) {
      throw new Error("A alocação original de lote está inválida.");
    }
    const key = keyOf(source);
    if (sourceByKey.has(key)) {
      throw new Error("A saída possui alocações duplicadas para o mesmo lote e armário.");
    }
    sourceByKey.set(key, source);
  }

  const returnedByKey = new Map<string, number>();
  for (const returned of input.previouslyReturned) {
    if (!Number.isFinite(returned.quantity) || returned.quantity <= 0) {
      throw new Error("Existe uma devolução anterior com alocação inválida.");
    }
    const key = keyOf(returned);
    returnedByKey.set(key, (returnedByKey.get(key) ?? 0) + returned.quantity);
  }

  if (input.requestedAllocations.length === 0) {
    throw new Error("Informe a quantidade devolvida de cada lote de origem.");
  }

  const seen = new Set<string>();
  let total = 0;
  const planned: PlannedLotReturn[] = [];
  for (const requested of input.requestedAllocations) {
    if (!requested.lotId || !Number.isFinite(requested.quantity) || requested.quantity <= 0) {
      throw new Error("A quantidade informada para um lote é inválida.");
    }
    const key = keyOf(requested);
    if (seen.has(key)) {
      throw new Error("O mesmo lote/armário foi informado mais de uma vez.");
    }
    seen.add(key);

    const source = sourceByKey.get(key);
    if (!source) {
      throw new Error("O lote selecionado não participou da saída original.");
    }
    const alreadyReturned = returnedByKey.get(key) ?? 0;
    const remaining = source.quantity - alreadyReturned;
    if (remaining < -EPSILON) {
      throw new Error("As devoluções anteriores excedem a quantidade originalmente retirada do lote.");
    }
    if (requested.quantity - remaining > EPSILON) {
      throw new Error(`A devolução excede o saldo disponível do lote ${requested.lotId}.`);
    }

    total += requested.quantity;
    planned.push({
      lotId: requested.lotId,
      sourceLocationId: requested.sourceLocationId,
      quantity: requested.quantity,
    });
  }

  if (Math.abs(total - input.requestedQuantity) > EPSILON) {
    throw new Error("A soma das quantidades por lote deve ser igual à quantidade total da devolução.");
  }
  return planned;
}
