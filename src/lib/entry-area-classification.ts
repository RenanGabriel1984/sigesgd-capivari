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
