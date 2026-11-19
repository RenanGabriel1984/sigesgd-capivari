/**
 * Valida a localização em movimentos da carga inicial.
 *
 * Versões antigas do fluxo podem ter gravado o movimento sem locationId.
 * O chamador só usa esta compatibilidade depois de conferir, de forma
 * independente, lote, item da entrada e saldo por localização. Um ID
 * preenchido e diferente nunca é aceito.
 */
export function isLegacyMovementLocationCompatible(
  movementLocationId: string | null | undefined,
  expectedLocationId: string,
): boolean {
  return movementLocationId == null || movementLocationId === expectedLocationId;
}
