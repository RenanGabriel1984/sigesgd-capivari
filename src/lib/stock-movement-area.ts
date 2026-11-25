/**
 * Resolve a única área efetiva para um movimento com rastreabilidade por lote.
 * Misturar lotes de áreas distintas (ou classificados e sem área) é bloqueado.
 */
export function resolveConsistentMovementArea(
  areaIds: Array<string | null | undefined>,
): string | undefined {
  const normalized = [...new Set(areaIds.map((areaId) => areaId ?? null))];
  if (normalized.length > 1) {
    throw new Error("A movimentação não pode misturar lotes de áreas diferentes ou combinar lotes classificados e sem área.");
  }
  return normalized[0] ?? undefined;
}
