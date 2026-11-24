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
      issues.push("O saldo global diverge da soma dos saldos por armário.");
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
    consistent: issues.length === 0 && limitations.length === 0,
  };
}


export interface ProductLedgerLot {
  lotId: string;
  productId?: string;
  lotNumber?: string;
  quantityAvailable: number;
  active?: boolean;
}

export interface ProductLedgerLotLocationBalance {
  lotId: string;
  productId?: string;
  locationId?: string;
  quantityAvailable: number;
}

/**
 * Valida global × armários × lotes × lotes/armários sem corrigir dados.
 * Produtos legados sem histórico de lotes continuam válidos; lotes zerados
 * também não exigem a criação artificial de linhas de saldo por localização.
 */
export function assertProductLedgerSnapshot(
  input: {
    globalRows: readonly GlobalStockBalance[];
    locationRows: readonly ScopedStockBalance[];
    lots: readonly ProductLedgerLot[];
    lotLocationBalances: readonly ProductLedgerLotLocationBalance[];
  },
  productLabel: string,
): GlobalStockBalance | null {
  const stock = getOptionalSingleValidGlobalStock(input.globalRows, productLabel);
  validateUniqueScopedStockRows(input.locationRows, productLabel);

  const locationTotals = new Map<string, number>();
  let physicalByLocation = 0;
  for (const row of input.locationRows) {
    const locationId = String(row.locationId);
    locationTotals.set(locationId, (locationTotals.get(locationId) ?? 0) + row.quantity);
    physicalByLocation += row.quantity;
  }
  const globalPhysical = stock?.physicalQuantity ?? 0;
  if (Math.abs(globalPhysical - physicalByLocation) > TOLERANCE) {
    throw new Error("O saldo global de \"" + productLabel + "\" diverge da soma dos armários. Operação bloqueada.");
  }

  // Sem lotes e sem vínculos é o caso histórico legítimo: não inventar lotes.
  if (input.lots.length === 0 && input.lotLocationBalances.length === 0) return stock;
  if (input.lots.length === 0) {
    throw new Error("O produto \"" + productLabel + "\" possui saldos lote/armário órfãos.");
  }

  const lotsById = new Map<string, ProductLedgerLot>();
  let lotTotal = 0;
  for (const lot of input.lots) {
    if (!lot.lotId || lotsById.has(String(lot.lotId))) {
      throw new Error("Há lotes duplicados ou sem identificador para \"" + productLabel + "\".");
    }
    if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) {
      throw new Error("O lote " + (lot.lotNumber ?? lot.lotId) + " de \"" + productLabel + "\" possui saldo inválido.");
    }
    if (lot.active === false && lot.quantityAvailable > TOLERANCE) {
      throw new Error("O lote inativo " + (lot.lotNumber ?? lot.lotId) + " de \"" + productLabel + "\" possui saldo positivo.");
    }
    lotsById.set(String(lot.lotId), lot);
    lotTotal += lot.quantityAvailable;
  }

  // Lotes exclusivamente zerados não exigem linhas de saldo artificiais.
  if (input.lotLocationBalances.length === 0 && lotTotal <= TOLERANCE) {
    if (Math.abs(globalPhysical) > TOLERANCE) {
      throw new Error("Há saldo físico sem lote/localização rastreável para \"" + productLabel + "\".");
    }
    return stock;
  }
  if (input.lotLocationBalances.length === 0) {
    throw new Error("Rastreabilidade de lote incompleta para o produto \"" + productLabel + "\": há lotes com saldo, mas sem vínculos por armário.");
  }

  const lotTotalsById = new Map<string, number>();
  const lotTotalsByLocation = new Map<string, number>();
  const seenLotLocations = new Set<string>();
  let balanceTotal = 0;
  for (const balance of input.lotLocationBalances) {
    if (!balance.locationId || !balance.lotId) {
      throw new Error("Há saldo lote/armário sem identificação para \"" + productLabel + "\".");
    }
    if (!Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
      throw new Error("Há saldo lote/armário inválido para \"" + productLabel + "\".");
    }
    const lot = lotsById.get(String(balance.lotId));
    if (!lot || (lot.productId && balance.productId && lot.productId !== balance.productId)) {
      throw new Error("Há saldo de lote órfão ou incompatível para \"" + productLabel + "\".");
    }
    const key = String(balance.lotId) + "::" + String(balance.locationId);
    if (seenLotLocations.has(key)) {
      throw new Error("Há saldo duplicado do mesmo lote no armário para \"" + productLabel + "\".");
    }
    seenLotLocations.add(key);
    balanceTotal += balance.quantityAvailable;
    lotTotalsById.set(String(balance.lotId), (lotTotalsById.get(String(balance.lotId)) ?? 0) + balance.quantityAvailable);
    lotTotalsByLocation.set(String(balance.locationId), (lotTotalsByLocation.get(String(balance.locationId)) ?? 0) + balance.quantityAvailable);
  }

  for (const lot of input.lots) {
    const allocated = lotTotalsById.get(String(lot.lotId)) ?? 0;
    if (Math.abs(allocated - lot.quantityAvailable) > TOLERANCE) {
      throw new Error("O lote " + (lot.lotNumber ?? lot.lotId) + " de \"" + productLabel + "\" diverge dos seus armários.");
    }
  }
  if (
    Math.abs(globalPhysical - lotTotal) > TOLERANCE ||
    Math.abs(lotTotal - balanceTotal) > TOLERANCE
  ) {
    throw new Error("Os saldos global, dos lotes e dos armários de \"" + productLabel + "\" não estão conciliados.");
  }

  const allLocationIds = new Set([...locationTotals.keys(), ...lotTotalsByLocation.keys()]);
  for (const locationId of allLocationIds) {
    const local = locationTotals.get(locationId) ?? 0;
    const lotsAtLocation = lotTotalsByLocation.get(locationId) ?? 0;
    if (Math.abs(local - lotsAtLocation) > TOLERANCE) {
      throw new Error("O saldo por lote diverge do saldo físico no armário " + locationId + " de \"" + productLabel + "\".");
    }
  }
  return stock;
}
