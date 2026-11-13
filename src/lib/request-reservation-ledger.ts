export interface RequestItemReservationLedgerRow {
  requestItemId: string;
  productId: string;
  lotId: string;
  areaId: string;
  locationId: string;
  quantity: number;
  quantityRemaining: number;
  quantityDelivered: number;
  quantityReleased: number;
}

export interface RequestItemReservationLedgerResult {
  remaining: number;
  error: string | null;
}

/**
 * Confere se a soma das alocações por lote fecha exatamente com a quantidade
 * aprovada e se cada reserva conserva a equação alocada = restante + entregue
 * + liberada. Impede cancelamento/entrega que deixaria reserva global órfã.
 */
export function validateRequestItemReservationLedger(input: {
  requestItemId: string;
  productId: string;
  areaId: string;
  locationId: string;
  quantityApproved: number;
  reservations: RequestItemReservationLedgerRow[];
}): RequestItemReservationLedgerResult {
  const fail = (error: string): RequestItemReservationLedgerResult => ({ remaining: 0, error });
  const epsilon = 1e-9;
  if (!Number.isFinite(input.quantityApproved) || input.quantityApproved <= 0) {
    return fail("A quantidade aprovada do item é inválida. Regularize antes de movimentar reservas.");
  }
  if (!input.reservations.length) {
    return fail("A solicitação aprovada não possui reservas por lote. Regularize antes de entregar ou cancelar.");
  }

  let allocated = 0;
  let remaining = 0;
  let delivered = 0;
  let released = 0;
  for (const reservation of input.reservations) {
    if (
      reservation.requestItemId !== input.requestItemId ||
      reservation.productId !== input.productId ||
      reservation.areaId !== input.areaId ||
      reservation.locationId !== input.locationId ||
      !reservation.lotId
    ) {
      return fail("Uma reserva não corresponde ao item, produto, área ou local da solicitação.");
    }
    const values = [
      reservation.quantity,
      reservation.quantityRemaining,
      reservation.quantityDelivered,
      reservation.quantityReleased,
    ];
    if (
      values.some((value) => !Number.isFinite(value)) ||
      reservation.quantity <= 0 ||
      reservation.quantityRemaining < 0 ||
      reservation.quantityDelivered < 0 ||
      reservation.quantityReleased < 0
    ) {
      return fail("A reserva por lote contém quantidade inválida.");
    }
    if (Math.abs(
      reservation.quantity -
      reservation.quantityRemaining -
      reservation.quantityDelivered -
      reservation.quantityReleased
    ) > epsilon) {
      return fail("O histórico da reserva por lote não fecha entre alocado, entregue, liberado e restante.");
    }
    allocated += reservation.quantity;
    remaining += reservation.quantityRemaining;
    delivered += reservation.quantityDelivered;
    released += reservation.quantityReleased;
  }

  if (Math.abs(allocated - input.quantityApproved) > epsilon) {
    return fail("As reservas por lote não correspondem à quantidade aprovada. Regularize antes de entregar ou cancelar.");
  }
  if (Math.abs(allocated - remaining - delivered - released) > epsilon) {
    return fail("O saldo das reservas por lote está inconsistente. Regularize antes de entregar ou cancelar.");
  }
  return { remaining, error: null };
}
