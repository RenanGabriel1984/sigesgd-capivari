export function assertUniqueApprovalItemIds(
  items: readonly { itemId: string }[],
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      throw new Error("A mesma linha da solicitação foi enviada mais de uma vez.");
    }
    seen.add(item.itemId);
  }
}

export function getDeliveryStockAdjustment(
  quantityApproved: number,
  quantityDelivered: number,
): { physicalToRemove: number; reservedToRelease: number; unusedReservation: number } {
  if (!Number.isFinite(quantityApproved) || quantityApproved <= 0) {
    throw new Error("Quantidade aprovada inválida para concluir a entrega.");
  }
  if (!Number.isFinite(quantityDelivered) || quantityDelivered <= 0 || quantityDelivered > quantityApproved) {
    throw new Error("Quantidade entregue deve ser maior que zero e não pode exceder a quantidade aprovada.");
  }
  return {
    physicalToRemove: quantityDelivered,
    reservedToRelease: quantityApproved,
    unusedReservation: quantityApproved - quantityDelivered,
  };
}

export function assertCompleteDeliveryItemIds(
  approvedItems: readonly { itemId: string }[],
  deliveredItems: readonly { itemId: string }[],
): void {
  const approvedIds = new Set(approvedItems.map((item) => item.itemId));
  const deliveredIds = new Set(deliveredItems.map((item) => item.itemId));
  if (deliveredIds.size !== deliveredItems.length) {
    throw new Error("A mesma linha da solicitação foi enviada mais de uma vez para entrega.");
  }
  const missing = [...approvedIds].filter((id) => !deliveredIds.has(id));
  const unexpected = [...deliveredIds].filter((id) => !approvedIds.has(id));
  if (missing.length || unexpected.length) {
    throw new Error("A entrega deve informar todas as linhas aprovadas da solicitação. Atualize a tela e tente novamente.");
  }
}


export function assertCompleteApprovalItemIds(
  requestItems: readonly { itemId: string }[],
  approvalItems: readonly { itemId: string }[],
): void {
  const requestIds = new Set(requestItems.map((item) => item.itemId));
  const approvalIds = new Set(approvalItems.map((item) => item.itemId));
  if (approvalIds.size !== approvalItems.length) {
    throw new Error("A mesma linha da solicitação foi enviada mais de uma vez para aprovação.");
  }
  const missing = [...requestIds].filter((id) => !approvalIds.has(id));
  const unexpected = [...approvalIds].filter((id) => !requestIds.has(id));
  if (missing.length || unexpected.length) {
    throw new Error("A aprovação deve informar todas as linhas da solicitação. Atualize a tela e tente novamente.");
  }
}
