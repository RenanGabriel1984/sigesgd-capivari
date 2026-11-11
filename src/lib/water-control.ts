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
