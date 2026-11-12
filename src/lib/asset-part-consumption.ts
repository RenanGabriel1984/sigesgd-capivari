export interface AssetPartLotCandidate {
  id: string;
  lotNumber: string;
  receivedAt: number;
  quantityAvailable: number;
  active?: boolean;
  locationId?: string;
  areaId?: string;
}

export interface AssetPartLotAllocation {
  lotId: string;
  lotNumber: string;
  quantity: number;
  locationId: string;
  areaId?: string;
}

export interface AssetPartLocationConsumption {
  locationId: string;
  areaId?: string;
  quantity: number;
}

/**
 * Produces a FIFO consumption plan without mutating database rows.
 * A lot without a physical location is rejected: the system must never guess
 * which cabinet/substock to reduce.
 */
export function planAssetPartFifoConsumption(
  candidates: AssetPartLotCandidate[],
  requestedQuantity: number,
): AssetPartLotAllocation[] {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error("Quantidade de instalação deve ser um número positivo.");
  }

  const eligible = candidates
    .filter(
      (lot) =>
        lot.active !== false &&
        Number.isFinite(lot.quantityAvailable) &&
        lot.quantityAvailable > 0,
    )
    .sort(
      (a, b) =>
        a.receivedAt - b.receivedAt ||
        a.lotNumber.localeCompare(b.lotNumber) ||
        a.id.localeCompare(b.id),
    );

  let remaining = requestedQuantity;
  const allocations: AssetPartLotAllocation[] = [];

  for (const lot of eligible) {
    if (remaining <= 0) break;
    const quantity = Math.min(lot.quantityAvailable, remaining);
    if (quantity <= 0) continue;

    if (!lot.locationId?.trim()) {
      throw new Error(
        `O lote ${lot.lotNumber} não possui local físico registrado. Regularize a localização antes da instalação.`,
      );
    }

    allocations.push({
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      quantity,
      locationId: lot.locationId,
      areaId: lot.areaId || undefined,
    });
    remaining -= quantity;
  }

  if (remaining > 0) {
    throw new Error(
      `Lotes insuficientes. Faltam ${remaining} unidade(s) sem lote/local disponível.`,
    );
  }

  return allocations;
}

export function groupAssetPartConsumptionByLocation(
  allocations: AssetPartLotAllocation[],
): AssetPartLocationConsumption[] {
  const groups = new Map<string, AssetPartLocationConsumption>();

  for (const allocation of allocations) {
    const key = `${allocation.locationId}\u0000${allocation.areaId ?? ""}`;
    const current = groups.get(key);
    if (current) {
      current.quantity += allocation.quantity;
    } else {
      groups.set(key, {
        locationId: allocation.locationId,
        areaId: allocation.areaId,
        quantity: allocation.quantity,
      });
    }
  }

  return [...groups.values()];
}
