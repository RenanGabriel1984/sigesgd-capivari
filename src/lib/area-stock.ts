/** Planejamento puro de reserva FIFO restrito à mesma área e local físico. */
export interface AreaLotCandidate {
  lotId: string; lotNumber: string; receivedAt: number;
  quantityAvailable: number; quantityReserved: number;
  areaId?: string; locationId?: string; active: boolean;
}
export interface AreaLotAllocation { lotId: string; quantity: number; }

export function planFifoAreaLotAllocation(
  lots: AreaLotCandidate[], requestedQuantity: number, areaId: string, locationId: string,
): { allocations: AreaLotAllocation[]; remaining: number } {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
    throw new Error("Quantidade solicitada inválida para alocação FIFO.");
  }
  let remaining = requestedQuantity;
  const allocations: AreaLotAllocation[] = [];
  const eligible = lots.filter((lot) =>
    lot.active && lot.areaId === areaId && lot.locationId === locationId &&
    Number.isFinite(lot.quantityAvailable) && Number.isFinite(lot.quantityReserved) &&
    lot.quantityAvailable - lot.quantityReserved > 0
  ).sort((a,b)=>a.receivedAt-b.receivedAt || a.lotNumber.localeCompare(b.lotNumber));
  for (const lot of eligible) {
    if (remaining <= 0) break;
    const quantity = Math.min(Math.max(0, lot.quantityAvailable-lot.quantityReserved), remaining);
    if (quantity <= 0) continue;
    allocations.push({lotId:lot.lotId,quantity});
    remaining-=quantity;
  }
  return {allocations,remaining};
}


export interface AreaLocationStockRow {
  quantity: number;
}

export interface AreaLocationLotBalance {
  lotNumber: string;
  quantityAvailable: number;
  quantityReserved: number;
  active: boolean;
}

export type AreaLocationBalanceValidation =
  | { valid: true; stockQuantity: number; lotQuantity: number }
  | { valid: false; error: string };

/**
 * Exige que o saldo físico produto × área × local seja único e feche com a
 * soma dos lotes da mesma origem. Inclui reservas para impedir lote negativo
 * ou reservado acima do saldo.
 */
export function validateAreaLocationLotBalance(
  rows: readonly AreaLocationStockRow[],
  lots: readonly AreaLocationLotBalance[],
): AreaLocationBalanceValidation {
  if (rows.length === 0) {
    return { valid: false, error: "Saldo físico da área/local não encontrado." };
  }
  if (rows.length > 1) {
    return { valid: false, error: "Há saldos físicos duplicados na combinação área/local." };
  }

  const stockQuantity = rows[0].quantity;
  if (typeof stockQuantity !== "number" || !Number.isFinite(stockQuantity) || stockQuantity < 0) {
    return { valid: false, error: "O saldo físico da área/local está inválido." };
  }

  let lotQuantity = 0;
  for (const lot of lots) {
    if (
      typeof lot.quantityAvailable !== "number" ||
      !Number.isFinite(lot.quantityAvailable) ||
      lot.quantityAvailable < 0
    ) {
      return { valid: false, error: `O lote ${lot.lotNumber} possui saldo físico inválido.` };
    }
    if (
      typeof lot.quantityReserved !== "number" ||
      !Number.isFinite(lot.quantityReserved) ||
      lot.quantityReserved < 0 ||
      lot.quantityReserved > lot.quantityAvailable + 1e-9
    ) {
      return { valid: false, error: `O lote ${lot.lotNumber} possui reserva incompatível com o saldo físico.` };
    }
    if (!lot.active && lot.quantityAvailable > 0) {
      return { valid: false, error: `O lote ${lot.lotNumber} está inativo com saldo positivo.` };
    }
    lotQuantity += lot.quantityAvailable;
  }

  if (!Number.isFinite(lotQuantity) || Math.abs(stockQuantity - lotQuantity) > 1e-9) {
    return { valid: false, error: "O saldo físico da área/local diverge da soma dos lotes." };
  }

  return { valid: true, stockQuantity, lotQuantity };
}
