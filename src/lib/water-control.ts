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
    fullDelta: fullGallonsReturned === 0 ? 0 : -fullGallonsReturned,
    emptyDelta: emptyGallonsReturned === 0 ? 0 : -emptyGallonsReturned,
  };
}


export interface WaterFinanceReceiptInput {
  totalValueCents: number;
}

export interface WaterFinanceShareInput {
  shareId: string;
  participantId: string;
  participantName: string;
  amountDueCents: number;
}

export interface WaterFinancePaymentInput {
  shareId: string;
  amountCents: number;
}

/**
 * Consolida compras, rateios e pagamentos de todos os períodos.
 * A dívida é apurada por parcela antes de somar por pessoa, para que um
 * pagamento excedente numa competência não esconda dívida de outra.
 */
export function summarizeWaterFinances(
  receipts: readonly WaterFinanceReceiptInput[],
  shares: readonly WaterFinanceShareInput[],
  payments: readonly WaterFinancePaymentInput[],
) {
  const sharesById = new Map(shares.map((share) => [share.shareId, share]));
  const paidByShare = new Map<string, number>();
  let unmatchedPaymentCount = 0;

  for (const payment of payments) {
    if (!sharesById.has(payment.shareId)) {
      unmatchedPaymentCount += 1;
      continue;
    }
    paidByShare.set(
      payment.shareId,
      (paidByShare.get(payment.shareId) ?? 0) + payment.amountCents,
    );
  }

  const byParticipant = new Map<string, {
    participantId: string;
    participantName: string;
    totalDueCents: number;
    totalPaidCents: number;
    outstandingCents: number;
    overpaidCents: number;
  }>();

  let totalAllocatedCents = 0;
  let totalPaidCents = 0;
  let totalOutstandingCents = 0;
  let totalOverpaidCents = 0;

  for (const share of shares) {
    const paid = paidByShare.get(share.shareId) ?? 0;
    const outstanding = Math.max(0, share.amountDueCents - paid);
    const overpaid = Math.max(0, paid - share.amountDueCents);
    const current = byParticipant.get(share.participantId) ?? {
      participantId: share.participantId,
      participantName: share.participantName,
      totalDueCents: 0,
      totalPaidCents: 0,
      outstandingCents: 0,
      overpaidCents: 0,
    };

    current.totalDueCents += share.amountDueCents;
    current.totalPaidCents += paid;
    current.outstandingCents += outstanding;
    current.overpaidCents += overpaid;
    byParticipant.set(share.participantId, current);

    totalAllocatedCents += share.amountDueCents;
    totalPaidCents += paid;
    totalOutstandingCents += outstanding;
    totalOverpaidCents += overpaid;
  }

  const totalPurchasedCents = receipts.reduce(
    (sum, receipt) => sum + receipt.totalValueCents,
    0,
  );

  return {
    totalPurchasedCents,
    totalAllocatedCents,
    totalPaidCents,
    totalOutstandingCents,
    pendingAllocationCents: Math.max(0, totalPurchasedCents - totalAllocatedCents),
    unallocatedOverageCents: Math.max(0, totalAllocatedCents - totalPurchasedCents),
    totalOverpaidCents,
    unmatchedPaymentCount,
    participants: [...byParticipant.values()].sort((a, b) =>
      a.participantName.localeCompare(b.participantName, "pt-BR")
    ),
  };
}
