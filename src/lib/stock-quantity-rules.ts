/**
 * Regras compartilhadas para quantidades físicas de estoque.
 * Unidades contáveis não admitem frações; metro e unidades livres podem.
 */
const DISCRETE_UNITS = new Set(["un", "pc", "cx", "rl", "pct", "po", "kt"]);

export function isDiscreteStockUnit(
  unitOfMeasure?: string | null,
  hasSerial = false,
): boolean {
  return hasSerial || DISCRETE_UNITS.has((unitOfMeasure ?? "").trim().toLowerCase());
}

export function isValidStockQuantity(
  quantity: number,
  unitOfMeasure?: string | null,
  hasSerial = false,
  allowZero = false,
): boolean {
  if (!Number.isFinite(quantity) || (allowZero ? quantity < 0 : quantity <= 0)) {
    return false;
  }
  return !isDiscreteStockUnit(unitOfMeasure, hasSerial) || Number.isSafeInteger(quantity);
}
