export type WaterDelta = { fullDelta: number; emptyDelta: number };

export function calculateWaterBalances(movements: WaterDelta[]) {
  const balance = movements.reduce(
    (total, movement) => {
      if (!Number.isFinite(movement.fullDelta) || !Number.isFinite(movement.emptyDelta)) {
        throw new Error("Movimentação de garrafões inválida.");
      }
      return {
        full: total.full + movement.fullDelta,
        empty: total.empty + movement.emptyDelta,
      };
    },
    { full: 0, empty: 0 },
  );
  if (balance.full < 0 || balance.empty < 0) {
    throw new Error("O histórico de água mineral produz saldo negativo de garrafões.");
  }
  return balance;
}

export function splitWaterCost(totalCost: number, participantIds: string[]) {
  if (!Number.isFinite(totalCost) || totalCost <= 0) {
    throw new Error("O custo total deve ser maior que zero.");
  }
  const unique = [...new Set(participantIds)];
  if (unique.length === 0 || unique.length !== participantIds.length) {
    throw new Error("Selecione participantes sem duplicidade.");
  }
  const totalCents = Math.round((totalCost + Number.EPSILON) * 100);
  const baseCents = Math.floor(totalCents / unique.length);
  let remainingCents = totalCents;
  return unique.map((participantId, index) => {
    const shareCents = index === unique.length - 1 ? remainingCents : baseCents;
    remainingCents -= shareCents;
    return { participantId, shareAmount: shareCents / 100 };
  });
}

export function remainingWaterShare(shareAmount: number, payments: number[]) {
  if (!Number.isFinite(shareAmount) || shareAmount < 0 || payments.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    throw new Error("Valores de rateio ou pagamento inválidos.");
  }
  const paid = payments.reduce((sum, amount) => sum + amount, 0);
  return Math.max(0, Math.round((shareAmount - paid) * 100) / 100);
}
