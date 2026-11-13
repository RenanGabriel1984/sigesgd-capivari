export interface LotLocationTransferPlan {
  sourceQuantityAfter: number;
  destinationQuantityAfter: number;
}

/**
 * Calcula a redistribuição de um lote entre dois armários.
 * Transferência não altera o total do lote; apenas move saldo entre locais.
 */
export function planLotLocationTransfer(input: {
  sourceQuantity: number;
  destinationQuantity: number;
  quantity: number;
}): LotLocationTransferPlan {
  const { sourceQuantity, destinationQuantity, quantity } = input;
  if (![sourceQuantity, destinationQuantity, quantity].every(Number.isFinite)) {
    throw new Error("Quantidades da transferência do lote devem ser finitas.");
  }
  if (sourceQuantity < 0 || destinationQuantity < 0 || quantity <= 0) {
    throw new Error("Quantidades inválidas para transferência do lote.");
  }
  if (sourceQuantity < quantity) {
    throw new Error(`Saldo do lote no armário de origem insuficiente. Disponível: ${sourceQuantity}.`);
  }
  return {
    sourceQuantityAfter: sourceQuantity - quantity,
    destinationQuantityAfter: destinationQuantity + quantity,
  };
}
