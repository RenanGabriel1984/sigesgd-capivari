import type { GlobalStockBalance } from "./stock-read-integrity";

export interface ApprovedRequestForReservation {
  _id: string;
  status: string;
}

export interface RequestItemForReservation {
  requestId: string;
  productId: string;
  quantityApproved: number;
}

/** Soma aprovada das linhas de solicitações que ainda mantêm reserva. */
export function expectedReservedQuantityForProduct(
  productId: string,
  requests: readonly ApprovedRequestForReservation[],
  items: readonly RequestItemForReservation[],
): number {
  const approvedRequestIds = new Set(
    requests.filter((request) => request.status === "approved").map((request) => request._id),
  );
  let expected = 0;
  for (const item of items) {
    if (item.productId !== productId || !approvedRequestIds.has(item.requestId)) continue;
    if (!Number.isFinite(item.quantityApproved) || item.quantityApproved < 0) {
      throw new Error("Há quantidade aprovada inválida vinculada à reserva do produto.");
    }
    expected += item.quantityApproved;
  }
  if (!Number.isFinite(expected)) {
    throw new Error("O total de reservas esperado não é um número finito.");
  }
  return expected;
}

/**
 * Compara o saldo reservado real com as solicitações que continuam aprovadas.
 * Reserva órfã/faltante bloqueia novas operações; nenhum saldo é corrigido
 * automaticamente.
 */
export function assertReservedQuantityMatchesApprovedRequests(input: {
  stock: GlobalStockBalance | null;
  requests: readonly ApprovedRequestForReservation[];
  items: readonly RequestItemForReservation[];
  productId: string;
  productLabel: string;
}): number {
  const expected = expectedReservedQuantityForProduct(
    input.productId,
    input.requests,
    input.items,
  );
  const actual = input.stock?.reservedQuantity ?? 0;
  if (!Number.isFinite(actual) || actual < 0) {
    throw new Error(`O saldo reservado de "${input.productLabel}" é inválido.`);
  }
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(
      `Reserva divergente para "${input.productLabel}": estoque reservado ${actual}, ` +
      `solicitações aprovadas ${expected}. Operação bloqueada; confira aprovações, entregas e cancelamentos.`,
    );
  }
  return expected;
}
