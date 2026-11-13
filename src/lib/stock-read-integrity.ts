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
  limitations: string[];
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

export function requireSingleValidGlobalStock<T extends GlobalStockBalance>(
  rows: readonly T[],
  productLabel: string,
): T {
  const stock = getOptionalSingleValidGlobalStock(rows, productLabel);
  if (!stock) {
    throw new Error(`Registro de estoque não encontrado para "${productLabel}".`);
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
    const key = `${row.productId ?? "__SAME_PRODUCT__"}|${row.areaId ?? "__NO_AREA__"}|${row.locationId}`;
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
  const limitations: string[] = [];
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
    // Na estrutura atual do banco, stockByLocation registra produto × armário.
    // A área é derivada dos lotes; por isso uma linha física sem areaId cobre
    // conjuntamente todas as áreas guardadas naquele armário.
    const key = row.areaId
      ? `${row.areaId}|${row.locationId}`
      : `*|${row.locationId}`;
    if (seenScopes.has(key)) issues.push("Há linhas duplicadas para a mesma combinação de área e local físico.");
    seenScopes.add(key);
    locationByScope.set(key, (locationByScope.get(key) ?? 0) + row.quantity);
    locationQuantity += row.quantity;
  }

  const lotsByScope = new Map<string, number>();
  let lotQuantity = 0;
  let hasUnlocatedPositiveLots = false;
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
    if (!lot.areaId) {
      issues.push(`O lote ${lot.lotNumber ?? "(sem número)"} ainda não possui área classificada.`);
    }
    // O schema atual não possui localização atual por lote. Quando não há
    // vínculo explícito, não inferir que o armário original da entrada ainda
    // seja o armário atual (transferências parciais podem dividir o lote).
    if (!lot.locationId) {
      hasUnlocatedPositiveLots = true;
      continue;
    }
    const key = lot.areaId
      ? `${lot.areaId}|${lot.locationId}`
      : `*|${lot.locationId}`;
    lotsByScope.set(key, (lotsByScope.get(key) ?? 0) + quantity);
  }

  if (hasUnlocatedPositiveLots) {
    limitations.push("O modelo atual não registra a localização atual por lote; não é possível conciliar lote × armário com segurança.");
  }

  const lotTotalsByLocation = new Map<string, number>();
  for (const [key, quantity] of lotsByScope) {
    const locationId = key.slice(key.lastIndexOf("|") + 1);
    lotTotalsByLocation.set(locationId, (lotTotalsByLocation.get(locationId) ?? 0) + quantity);
  }

  for (const [key, localQuantity] of locationByScope) {
    if (hasUnlocatedPositiveLots) continue;
    const [areaId, locationId] = key.split("|");
    // Um registro físico legado sem areaId representa todas as áreas do
    // armário. Só comparamos o total do armário; a abertura por área vem dos lotes.
    const expectedLotQuantity = areaId === "*"
      ? lotTotalsByLocation.get(locationId) ?? 0
      : lotsByScope.get(key) ?? 0;
    if (Math.abs(localQuantity - expectedLotQuantity) > TOLERANCE) {
      issues.push(`O saldo físico da área/local (${key}) diverge da soma dos lotes.`);
    }
  }

  for (const key of lotsByScope.keys()) {
    if (hasUnlocatedPositiveLots) continue;
    const locationId = key.slice(key.lastIndexOf("|") + 1);
    const wildcardKey = `*|${locationId}`;
    if (!locationByScope.has(key) && !locationByScope.has(wildcardKey)) {
      issues.push(`Há lote com saldo sem bucket físico correspondente na localização ${locationId}.`);
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
    limitations: [...new Set(limitations)],
    consistent: issues.length === 0,
  };
}
