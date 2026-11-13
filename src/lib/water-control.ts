/**
 * Regras puras do rateio de água mineral.
 * O rateio é igualitário e trabalha em centavos para não acumular erros
 * de ponto flutuante. O centavo residual é distribuído de forma estável.
 */
export function splitWaterCostCents(
  totalCents: number,
  participantIds: string[],
): Array<{ participantId: string; amountDueCents: number }> {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error("O valor total deve ser um número inteiro de centavos não negativo.");
  }

  const ids = [...new Set(participantIds)].sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) {
    if (totalCents === 0) return [];
    throw new Error("Inclua ao menos uma pessoa no rateio antes de fechar o período.");
  }

  const base = Math.floor(totalCents / ids.length);
  const remainder = totalCents % ids.length;
  return ids.map((participantId, index) => ({
    participantId,
    amountDueCents: base + (index < remainder ? 1 : 0),
  }));
}

export function parseWaterMoneyToCents(value: string): number | null {
  const normalized = value.trim().replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!normalized) return null;
  const canonical = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized;
  const amount = Number(canonical);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}


/** Períodos precisam ter timestamps inteiros, finitos e em ordem cronológica. */
export function validateWaterPeriodRange(startAt: number, endAt: number): string | null {
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt)) {
    return "As datas do período são inválidas.";
  }
  if (endAt < startAt) {
    return "A data final não pode ser anterior à inicial.";
  }
  return null;
}

/** Um recebimento só pode compor o rateio do período ao qual pertence. */
export function validateWaterReceiptDate(
  receivedAt: number,
  startAt: number,
  endAt: number,
): string | null {
  if (!Number.isSafeInteger(receivedAt)) {
    return "A data do recebimento é inválida.";
  }
  if (receivedAt < startAt || receivedAt > endAt) {
    return "A data do recebimento precisa estar dentro do período de rateio selecionado.";
  }
  return null;
}

/** Datas de movimentos e pagamentos também devem ser timestamps válidos. */
export function isValidWaterTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}


export interface WaterReceiptBalanceInput {
  gallonsReceived: number;
  emptyGallonsReturned: number;
}

export interface WaterMovementBalanceInput {
  fullDelta: number;
  emptyDelta: number;
}

/** Calcula o saldo de galões a partir dos recebimentos e movimentos físicos. */
export function calculateWaterContainerBalance(
  receipts: WaterReceiptBalanceInput[],
  movements: WaterMovementBalanceInput[],
): { fullGallons: number; emptyGallons: number } {
  return {
    fullGallons:
      receipts.reduce((sum, receipt) => sum + receipt.gallonsReceived, 0) +
      movements.reduce((sum, movement) => sum + movement.fullDelta, 0),
    emptyGallons:
      movements.reduce((sum, movement) => sum + movement.emptyDelta, 0) -
      receipts.reduce((sum, receipt) => sum + receipt.emptyGallonsReturned, 0),
  };
}


/**
 * Devolução ao fornecedor pode incluir galões cheios, vazios ou ambos.
 * O movimento é sempre uma redução dos saldos físicos correspondentes.
 */
export function buildWaterSupplierReturnDeltas(
  fullGallonsReturned: number,
  emptyGallonsReturned: number,
): { fullDelta: number; emptyDelta: number } {
  if (!Number.isSafeInteger(fullGallonsReturned) || fullGallonsReturned < 0) {
    throw new Error("A quantidade de galões cheios devolvidos deve ser um inteiro não negativo.");
  }
  if (!Number.isSafeInteger(emptyGallonsReturned) || emptyGallonsReturned < 0) {
    throw new Error("A quantidade de galões vazios devolvidos deve ser um inteiro não negativo.");
  }
  if (fullGallonsReturned === 0 && emptyGallonsReturned === 0) {
    throw new Error("Informe ao menos um galão cheio ou vazio para devolver.");
  }
  return {
    fullDelta: -fullGallonsReturned,
    emptyDelta: -emptyGallonsReturned,
  };
}
