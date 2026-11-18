/**
 * Resolve the effective business area for one entry item.
 *
 * An explicit item area overrides the entry default; older/manual drafts that
 * omit the item area inherit the header area. Physical location is deliberately
 * independent and must never be used as a classification fallback.
 */
export function resolveEntryItemAreaId(
  itemAreaId: string | null | undefined,
  defaultAreaId: string | null | undefined,
): string | undefined {
  return itemAreaId ?? defaultAreaId ?? undefined;
}

/**
 * Resolve a localização física original de um lote durante o estorno.
 * O lote é a fonte preferencial; saldos derivados e item cobrem registros
 * históricos que ainda não tinham locationId materializado no lote.
 */
export function resolveEntryLotLocationId(
  lotLocationId: string | null | undefined,
  balanceLocationId: string | null | undefined,
  itemLocationId: string | null | undefined,
): string | undefined {
  return lotLocationId ?? balanceLocationId ?? itemLocationId ?? undefined;
}
