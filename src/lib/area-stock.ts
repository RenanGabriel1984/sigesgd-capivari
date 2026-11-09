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
