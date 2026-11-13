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


export interface GlobalStockBalanceRow {
  physicalQuantity: number;
  reservedQuantity: number;
}

/**
 * Retorna o saldo único válido ou null quando o produto ainda não possui
 * registro global. Duplicidades e valores fisicamente impossíveis bloqueiam.
 */
export function getOptionalSingleValidGlobalStock<T extends GlobalStockBalanceRow>(
  rows: readonly T[],
  productLabel: string,
): T | null {
  if (rows.length > 1) {
    throw new Error(`Há registros globais de estoque duplicados para "${productLabel}". Regularize antes de continuar.`);
  }
  if (rows.length === 0) return null;

  const stock = rows[0];
  const physical = Number(stock.physicalQuantity);
  const reserved = Number(stock.reservedQuantity);
  if (
    !Number.isFinite(physical) ||
    !Number.isFinite(reserved) ||
    physical < 0 ||
    reserved < 0 ||
    reserved > physical
  ) {
    throw new Error(`O saldo global de "${productLabel}" está inconsistente. Regularize antes de continuar.`);
  }
  return stock;
}

/** Exige o registro global quando a operação necessariamente consome estoque. */
export function requireSingleValidGlobalStock<T extends GlobalStockBalanceRow>(
  rows: readonly T[],
  productLabel: string,
): T {
  const stock = getOptionalSingleValidGlobalStock(rows, productLabel);
  if (!stock) {
    throw new Error(`Registro global de estoque não encontrado para "${productLabel}".`);
  }
  return stock;
}
