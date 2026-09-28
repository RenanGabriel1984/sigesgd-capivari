/**
 * Gestão de Estoque SGGD — Regras puras de DEVOLUÇÃO vinculada à SAÍDA real.
 *
 * Nenhum estoque é alterado aqui: estas funções apenas calculam/validam.
 * O efeito real (repor saldo, movimentação e auditoria) acontece em
 * `src/convex/returns.ts`.
 *
 * Conceito:
 *   SAÍDA (movimentação type "exit") → material retirado
 *   → material não utilizado → DEVOLUÇÃO (parcial ou total)
 *   → retorno ao estoque → movimentação type "return" → auditoria
 */

export const RETURN_CONDITION_VALUES = [
  "unused",
  "partially_used",
  "defective",
  "other",
] as const;

export type ReturnCondition = (typeof RETURN_CONDITION_VALUES)[number];

export const RETURN_CONDITION_LABELS: Record<ReturnCondition, string> = {
  unused: "Não utilizado",
  partially_used: "Utilizado parcialmente",
  defective: "Com defeito",
  other: "Outro",
};

export interface ReturnRecordLike {
  exitMovementId?: string | null;
  requestId?: string | null;
  productId?: string;
  quantity: number;
}

/**
 * Quantidade já devolvida para uma determinada SAÍDA.
 *
 * Considera tanto devoluções novas (vinculadas por `exitMovementId`) quanto
 * devoluções legadas vindas de entrega de solicitação (vinculadas por
 * `requestId` + `productId`).
 */
export function returnedQuantityForExit(
  returns: ReturnRecordLike[],
  exit: { _id: string; productId: string; requestId?: string | null }
): number {
  return returns
    .filter((r) => {
      if (r.exitMovementId) return r.exitMovementId === exit._id;
      // Legado: devolução sem vínculo direto com a movimentação
      return (
        !!exit.requestId &&
        r.requestId === exit.requestId &&
        (!r.productId || r.productId === exit.productId)
      );
    })
    .reduce((sum, r) => sum + r.quantity, 0);
}

/**
 * Quantidade ainda disponível para devolver em uma saída.
 *   saiu 5, já devolveu 2 → disponível 3
 */
export function returnableQuantity(
  exitQuantity: number,
  alreadyReturned: number
): number {
  return Math.max(0, exitQuantity - alreadyReturned);
}

/**
 * Valida uma devolução parcial. Lança erro (pt-BR) quando inválida.
 *   saiu 5, devolveu 0, quer devolver 4 → OK (fica 1)
 *   saiu 5, devolveu 2, quer devolver 4 → FALHA (só resta 3)
 *   saiu 5, devolveu 2, quer devolver 3 → OK (total devolvido = 5)
 */
export function validateReturnQuantity(args: {
  exitQuantity: number;
  alreadyReturned: number;
  requested: number;
}): string | null {
  const { exitQuantity, alreadyReturned, requested } = args;
  if (!Number.isFinite(requested) || requested <= 0) {
    return "Quantidade da devolução deve ser maior que zero";
  }
  const available = returnableQuantity(exitQuantity, alreadyReturned);
  if (requested > available) {
    return (
      `Quantidade para devolução (${requested}) excede o disponível para devolver (${available}). ` +
      `Retirado na saída: ${exitQuantity}, já devolvido: ${alreadyReturned}.`
    );
  }
  return null;
}

/**
 * Repõe o saldo físico após uma devolução (nunca deixa negativo).
 *   estoque 3 + devolução 2 = 5
 */
export function applyReturnToStock(
  physicalQuantity: number,
  returnedQuantity: number
): number {
  return physicalQuantity + Math.max(0, returnedQuantity);
}

/**
 * Repõe o saldo de um local físico após uma devolução.
 */
export function applyReturnToLocation(
  locationQuantity: number,
  returnedQuantity: number
): number {
  return locationQuantity + Math.max(0, returnedQuantity);
}

/** Texto de auditoria padrão de uma devolução (sem dados sensíveis). */
export function buildReturnAuditDetail(input: {
  quantity: number;
  productName: string;
  exitLabel: string;
  condition?: ReturnCondition | null;
  reason: string;
}): string {
  const condition = input.condition
    ? ` | condição: ${RETURN_CONDITION_LABELS[input.condition]}`
    : "";
  return (
    `Devolução de ${input.quantity}x ${input.productName} ` +
    `— saída ${input.exitLabel}${condition} | motivo: ${input.reason}`
  );
}

/** Rótulo de exibição da saída original (número SAI-… ou data/hora). */
export function formatExitLabel(exit: {
  exitNumber?: string | null;
  timestamp: number;
}): string {
  return exit.exitNumber ?? new Date(exit.timestamp).toLocaleString("pt-BR");
}

// ─── LOTE DE ORIGEM DA DEVOLUÇÃO (atomicidade) ─────────────────────────────────

/**
 * DEVOLUÇÃO ATÔMICA: o lote de origem é obrigatório.
 *
 * ─── O PROBLEMA ───────────────────────────────────────────────────────────────
 *
 * A devolução restaurava o saldo global (`stock.physicalQuantity`) SEMPRE, mas
 * só restaurava `lots.quantityAvailable` quando `lotId` vinha informado. Como a
 * "saída rápida" não gravava `stockMovements.lotId`, a devolução resolvia:
 *
 *     stock:                    14 → 15   (restaurado)
 *     lots.quantityAvailable:   14 → 14   (NÃO restaurado)
 *
 * Um estado parcial, permanente e silenciosamente inconsistente — foi a origem
 * da divergência 3337 x 3338 (lote LOT-2026-000001, Cooler Intel).
 *
 * ─── A REGRA ──────────────────────────────────────────────────────────────────
 *
 * Se a saída consumiu lote, a devolução PRECISA devolver ao mesmo lote. Sem
 * lote resolvível, a operação é REJEITADA por inteiro: nada é gravado. Não há
 * FIFO silencioso e não há caminho que restaure apenas metade do estoque.
 * Falhar completamente é preferível a deixar o estoque inconsistente.
 */

/** Motivo pelo qual a devolução não pode prosseguir (ou `null` se pode). */
export interface UnresolvableLotReason {
  /** A saída não consumiu nenhum lote (ex.: material sem rastreio de lote). */
  exitDidNotConsumeLot: boolean;
  /** A saída consumiu lote(s), mas o vínculo não pôde ser resolvido. */
  lotIdMissing: boolean;
}

/**
 * Determina se a devolução pode prosseguir.
 *
 * Retorna `null` quando a devolução está apta, ou o motivo da recusa quando
 * o lote de origem é obrigatório mas não foi resolvido.
 *
 * @param exitLotId Lote de origem resolvido da saída (structured lotId).
 * @param requiresLot Se o produto desta devolução exige rastreio por lote.
 */
export function resolveReturnLotGuard(input: {
  exitLotId?: string | null;
  requiresLot: boolean;
}): UnresolvableLotReason | null {
  if (!input.requiresLot) return null;
  if (input.exitLotId) return null;
  return { exitDidNotConsumeLot: false, lotIdMissing: true };
}

/** Mensagem de erro (pt-BR) para uma devolução sem lote resolvível. */
export function buildUnresolvableLotMessage(input: {
  productName: string;
  exitLabel: string;
  reason: UnresolvableLotReason;
}): string {
  const base =
    `Não foi possível devolver "${input.productName}": o lote de origem da saída ` +
    `${input.exitLabel} não pôde ser identificado.`;
  if (input.reason.exitDidNotConsumeLot) {
    return (
      base +
      ` A devolução exige rastreio por lote e a saída não registra lote consumido. ` +
      `Nenhum estoque foi alterado — a operação foi cancelada integralmente.`
    );
  }
  return (
    base +
    ` Identifique o lote antes de devolver. ` +
    `Nenhum estoque foi alterado — a operação foi cancelada integralmente.`
  );
}
