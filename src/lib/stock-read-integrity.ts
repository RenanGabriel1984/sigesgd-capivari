export interface GlobalStockBalance {
  physicalQuantity: number;
  reservedQuantity: number;
}

export interface ScopedStockBalance {
  productId?: string;
  areaId?: string;
  locationId?: string;
  quantity: number;
}

export interface LotStockBalance {
  lotNumber?: string;
  areaId?: string;
  locationId?: string;
  quantityAvailable: number;
  active?: boolean;
}

export interface ProductStockIntegrity {
  globalStock: GlobalStockBalance | null;
  locationQuantity: number;
  lotQuantity: number;
  issues: string[];
  consistent: boolean;
}

const TOLERANCE = 1e-9;

/**
 * Retorna o único saldo global válido. Um produto recém-cadastrado pode ainda
 * não ter registro; duplicidade ou quantidade impossível nunca vira zero.
 */
export function getOptionalSingleValidGlobalStock<T extends GlobalStockBalance>(
  rows: readonly T[],
  productLabel: string,
): T | null {
  if (rows.length > 1) {
    throw new Error(`Há registros globais de estoque duplicados para "${productLabel}". Regularize antes de continuar.`);
  }
  if (rows.length === 0) return null;

  const stock = rows[0];
  if (
    typeof stock.physicalQuantity !== "number" ||
    typeof stock.reservedQuantity !== "number" ||
    !Number.isFinite(stock.physicalQuantity) ||
    !Number.isFinite(stock.reservedQuantity) ||
    stock.physicalQuantity < 0 ||
    stock.reservedQuantity < 0 ||
    stock.reservedQuantity > stock.physicalQuantity
  ) {
    throw new Error(`O saldo global de "${productLabel}" está inconsistente. Regularize antes de continuar.`);
  }
  return stock;
}

/**
 * Detecta linhas locais duplicadas ou quantidades impossíveis sem somá-las
 * silenciosamente. A chave representa produto × área × local físico.
 */
export function validateUniqueScopedStockRows(
  rows: readonly ScopedStockBalance[],
  productLabel: string,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.locationId) {
      throw new Error(`Há saldo sem local físico definido para "${productLabel}".`);
    }
    if (
      typeof row.quantity !== "number" ||
      !Number.isFinite(row.quantity) ||
      row.quantity < 0
    ) {
      throw new Error(`Há saldo inválido por área/local para "${productLabel}".`);
    }
    const key = `${row.areaId ?? "__NO_AREA__"}|${row.locationId}`;
    if (seen.has(key)) {
      throw new Error(`Há saldos duplicados para "${productLabel}" na combinação área/local.`);
    }
    seen.add(key);
  }
}

/**
 * Conciliação somente leitura entre saldo global, buckets físicos e lotes.
 * Divergências são devolvidas ao relatório (não são corrigidas nem ocultadas).
 */
export function inspectProductStockIntegrity(
  globalRows: readonly GlobalStockBalance[],
  locationRows: readonly ScopedStockBalance[],
  lots: readonly LotStockBalance[],
  productLabel: string,
): ProductStockIntegrity {
  const issues: string[] = [];
  let globalStock: GlobalStockBalance | null = null;
  try {
    globalStock = getOptionalSingleValidGlobalStock(globalRows, productLabel);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Saldo global inválido.");
  }

  const locationByScope = new Map<string, number>();
  let locationQuantity = 0;
  const seenScopes = new Set<string>();
  for (const row of locationRows) {
    if (!row.locationId) {
      issues.push("Existe saldo local sem localização física.");
      continue;
    }
    if (typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity < 0) {
      issues.push("Existe saldo local negativo ou não finito.");
      continue;
    }
    const key = `${row.areaId ?? "__NO_AREA__"}|${row.locationId}`;
    if (seenScopes.has(key)) issues.push("Há linhas duplicadas para a mesma combinação de área e local físico.");
    seenScopes.add(key);
    locationByScope.set(key, (locationByScope.get(key) ?? 0) + row.quantity);
    locationQuantity += row.quantity;
  }

  const lotsByScope = new Map<string, number>();
  let lotQuantity = 0;
  for (const lot of lots) {
    const quantity = lot.quantityAvailable;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) {
      issues.push(`O lote ${lot.lotNumber ?? "(sem número)"} possui saldo inválido.`);
      continue;
    }
    if (lot.active === false && quantity > TOLERANCE) {
      issues.push(`O lote ${lot.lotNumber ?? "(sem número)"} está inativo com saldo positivo.`);
    }
    lotQuantity += quantity;
    if (quantity <= TOLERANCE) continue;
    if (!lot.areaId || !lot.locationId) {
      issues.push(`O lote ${lot.lotNumber ?? "(sem número)"} ainda não possui área e/ou local físico classificados.`);
      continue;
    }
    const key = `${lot.areaId}|${lot.locationId}`;
    lotsByScope.set(key, (lotsByScope.get(key) ?? 0) + quantity);
  }

  for (const key of new Set([...locationByScope.keys(), ...lotsByScope.keys()])) {
    const localQuantity = locationByScope.get(key) ?? 0;
    const scopedLotQuantity = lotsByScope.get(key) ?? 0;
    if (Math.abs(localQuantity - scopedLotQuantity) > TOLERANCE) {
      issues.push(`O saldo físico da área/local (${key}) diverge da soma dos lotes.`);
    }
  }

  if (globalStock) {
    if (Math.abs(globalStock.physicalQuantity - locationQuantity) > TOLERANCE) {
      issues.push("O saldo global diverge da soma dos saldos por área/local.");
    }
    if (Math.abs(globalStock.physicalQuantity - lotQuantity) > TOLERANCE) {
      issues.push("O saldo global diverge da soma dos saldos dos lotes.");
    }
  } else if (locationQuantity > TOLERANCE || lotQuantity > TOLERANCE) {
    issues.push("Há saldo por local/lote, mas não existe um registro global válido.");
  }

  return {
    globalStock,
    locationQuantity,
    lotQuantity,
    issues: [...new Set(issues)],
    consistent: issues.length === 0,
  };
}
