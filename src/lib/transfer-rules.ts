/**
 * Gestão de Estoque SGGD — Regras puras de TRANSFERÊNCIA de estoque.
 *
 * A transferência reduz a origem, aumenta o destino, PRESERVA o lote/origem
 * no registro, cria movimentação TRANSFERÊNCIA e registra auditoria.
 * Estas funções apenas calculam — nenhuma escrita acontece aqui.
 */

export interface TransferInput {
  productName: string;
  quantity: number;
  fromLocationName: string;
  toLocationName: string;
  /** lote/origem preservado no registro da transferência */
  lotId?: string | null;
  lotNumber?: string | null;
  /** motivo da transferência (padrão: reorganização de estoque) */
  reason?: string | null;
}

export interface TransferPlan {
  /** saldo da origem após a transferência */
  fromQuantityAfter: number;
  /** saldo do destino após a transferência */
  toQuantityAfter: number;
  /** o lote/origem é preservado no registro (nunca recriado) */
  keepsLot: boolean;
  lotId: string | null;
  movementType: "transfer";
  auditDetail: string;
}

export function planTransfer(input: {
  fromQuantity: number;
  toQuantity: number;
} & TransferInput): TransferPlan {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantidade da transferência deve ser maior que zero");
  }
  if (input.quantity > input.fromQuantity) {
    throw new Error(
      `Estoque insuficiente na origem (${input.fromLocationName}). ` +
        `Disponível: ${input.fromQuantity}, transferência: ${input.quantity}.`
    );
  }
  if (input.fromLocationName === input.toLocationName) {
    throw new Error("Origem e destino não podem ser o mesmo local");
  }

  const lotSuffix = input.lotNumber ? ` | lote: ${input.lotNumber}` : "";
  const reason = input.reason?.trim() || "reorganização de estoque";
  return {
    fromQuantityAfter: input.fromQuantity - input.quantity,
    toQuantityAfter: input.toQuantity + input.quantity,
    keepsLot: true,
    lotId: input.lotId ?? null,
    movementType: "transfer",
    auditDetail:
      `Transferência de ${input.quantity}x ${input.productName}: ` +
      `${input.fromLocationName} → ${input.toLocationName}` +
      ` | motivo: ${reason}${lotSuffix}`,
  };
}
