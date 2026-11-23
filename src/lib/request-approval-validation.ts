/**
 * Prevents duplicate request-item identifiers in one approval payload.
 *
 * Approval persists quantityApproved on each request item but increments the
 * stock reservation for every payload entry. Repeating an item ID would
 * therefore reserve the same line more than once while storing only the last
 * approved quantity.
 */
export function assertUniqueApprovalItemIds(
  items: readonly { itemId: string }[],
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      throw new Error(
        "A mesma linha da solicitação foi enviada mais de uma vez para aprovação. Atualize a tela e tente novamente.",
      );
    }
    seen.add(item.itemId);
  }
}
