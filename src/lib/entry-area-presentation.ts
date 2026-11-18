export interface EntryAreaPresentationItem {
  product?: { name?: string | null } | null;
  area?: { name?: string | null } | null;
}

export interface EntryAreaPresentationRow {
  productName: string;
  areaName: string;
}

/**
 * Resolve the area shown in the entry history for each item.
 * New records use the item area; historical records fall back to the entry area.
 */
export function resolveEntryAreaPresentation(
  items: EntryAreaPresentationItem[] | null | undefined,
  defaultAreaName?: string | null,
): EntryAreaPresentationRow[] {
  return (items ?? []).map((item) => ({
    productName: item.product?.name?.trim() || "Produto não identificado",
    areaName: item.area?.name?.trim() || defaultAreaName?.trim() || "Área não classificada",
  }));
}
