/**
 * Gestão de Estoque SGGD — CORREÇÕES HISTÓRICAS PONTUAIS (regras puras).
 *
 * Módulo PURO: contém as PRÉ-CONDIÇÕES e as REGRAS DE IDEMPOTÊNCIA das duas
 * correções históricas autorizadas. Nenhuma escrita acontece aqui; a
 * aplicação é feita pelas mutations em `src/convex/dataRepairs.ts`.
 *
 * ─── AS DUAS CORREÇÕES ────────────────────────────────────────────────────────
 *
 * 1. ÁREA DOS 8 LOTES DA NF 372043 (ENT-2026-000002)
 *    O usuário escolheu "Impressoras" na conferência da NF-e, mas um stale
 *    closure no frontend fez o backend receber `areaId: undefined`. Os 8 lotes
 *    foram criados sem área e a entrada aparece como "Sem área".
 *    Correção: gravar `areaId` = Impressoras nos 8 lotes JÁ EXISTENTES.
 *
 * 2. `quantityAvailable` DO LOTE LOT-2026-000001 (Cooler Intel)
 *    Uma saída reduziu o lote de 15 para 14, mas a devolução seguinte
 *    restaurou apenas o saldo global (14 → 15) e não o `quantityAvailable`
 *    do lote, porque o `lotId` estruturado não existia na saída. O lote ficou
 *    com `quantityAvailable = 14` contra `quantityReceived = 15`, gerando a
 *    divergência 3337 x 3338 na tela de Áreas/Subestoques.
 *    Correção: `quantityAvailable` 14 → 15.
 *
 * ─── REGRAS INEGOCIÁVEIS ──────────────────────────────────────────────────────
 *
 * • Nenhuma quantidade da NF 372043 é alterada.
 * • Nenhum lote é criado, removido ou desativado.
 * • Nenhuma entrada é criada, estornada ou alterada.
 * • O estoque físico global NÃO é tocado pelas duas correções.
 * • Nenhuma movimentação de estoque é criada para a correção do lote: trata-se
 *   de reconciliação histórica, não de um novo movimento de estoque.
 * • As duas correções são IDEMPOTENTES: reexecutar não muda nada e não gera
 *   auditoria duplicada.
 * • Pré-condições verificadas ANTES de escrever; se o estado já mudou,
 *   a correção é abortada e o motivo fica registrado.
 */

/** Resultado de uma decisão de correção: aplicar, ou não aplicar e por quê. */
export interface RepairDecision {
  /** `true` apenas quando a correção deve ser efetivamente aplicada. */
  shouldApply: boolean;
  /** Motivo legível para o relatório/auditoria. */
  reason: string;
}

/** Estado mínimo de um lote, para avaliar a correção de área. */
export interface LotAreaState {
  lotId: string;
  areaId?: string | null;
}

export interface AreaRepairInput {
  /** Área de destino (Impressoras). */
  targetAreaId: string;
  /** Todos os lotes que DEVEM receber a área. */
  lots: LotAreaState[];
}

/**
 * Decide a correção de área dos lotes da NF 372043.
 *
 * Idempotência: lotes que JÁ possuem a área alvo não são tocados e não geram
 * auditoria. Se todos já estiverem corretos, nada é aplicado.
 */
export function decideAreaRepair(input: AreaRepairInput): {
  decision: RepairDecision;
  /** IDs dos lotes que realmente precisam mudar. */
  lotIdsToFix: string[];
  /** IDs dos lotes que já estavam corretos (não serão tocados). */
  alreadyCorrect: string[];
} {
  const alreadyCorrect: string[] = [];
  const lotIdsToFix: string[] = [];

  for (const lot of input.lots) {
    if (lot.areaId === input.targetAreaId) alreadyCorrect.push(lot.lotId);
    else lotIdsToFix.push(lot.lotId);
  }

  if (lotIdsToFix.length === 0) {
    return {
      decision: {
        shouldApply: false,
        reason: `Os ${alreadyCorrect.length} lote(s) já possuem a área de destino — nada a corrigir.`,
      },
      lotIdsToFix,
      alreadyCorrect,
    };
  }

  return {
    decision: {
      shouldApply: true,
      reason:
        `${lotIdsToFix.length} lote(s) sem a área de destino serão corrigidos ` +
        `(${alreadyCorrect.length} já corretos, preservados).`,
    },
    lotIdsToFix,
    alreadyCorrect,
  };
}

export interface LotAvailabilityInput {
  /** `quantityAvailable` atualmente gravado no lote. */
  currentAvailable: number;
  /** `quantityReceived` do lote (não deve ser alterado). */
  received: number;
  /** Valor histórico esperado após a reconciliação. */
  expectedAvailable: number;
}

/**
 * Decide a correção de `quantityAvailable` do lote.
 *
 * PRÉ-CONDIÇÃO OBRIGATÓRIA: só corrige quando o valor atual é EXATAMENTE o
 * valor inconsistente known-good. Se já estiver correto, nada é feito
 * (idempotência). Se estiver com qualquer outro valor, a correção é ABORTADA
 * — o estado mudou desde o diagnóstico e não deve ser sobrescrito às cegas.
 */
export function decideLotAvailabilityRepair(
  input: LotAvailabilityInput
): RepairDecision {
  if (input.currentAvailable === input.expectedAvailable) {
    return {
      shouldApply: false,
      reason:
        `quantityAvailable já está ${input.currentAvailable} (igual ao esperado) — ` +
        `correção já aplicada anteriormente; nada a fazer.`,
    };
  }
  return {
    shouldApply: true,
    reason:
      `quantityAvailable ${input.currentAvailable} → ${input.expectedAvailable} ` +
      `(quantityReceived permanece ${input.received}).`,
  };
}

/**
 * PRÉ-CONDIÇÃO explícita do valor inconsistente observado no diagnóstico.
 *
 * A correção do Cooler só vale para `currentAvailable === 14`. Qualquer outro
 * valor significa que o banco mudou desde o diagnóstico: a correção é
 * interrompida e o caso reportado como "estado mudou inesperadamente".
 */
export const COOLER_LOT_INCONSISTENT_AVAILABLE = 14;
export const COOLER_LOT_EXPECTED_AVAILABLE = 15;

export function isCoolerLotStateUnchanged(
  currentAvailable: number
): boolean {
  return currentAvailable === COOLER_LOT_INCONSISTENT_AVAILABLE;
}

/** Monta o texto de auditoria da correção de área. */
export function buildAreaRepairAuditDetail(input: {
  entryNumber: string;
  invoiceNumber: string;
  areaName: string;
  lotNumbers: string[];
  fixedCount: number;
}): string {
  return (
    `Correção histórica de área — entrada ${input.entryNumber} (NF ${input.invoiceNumber}): ` +
    `${input.fixedCount} lote(s) realocados de "Sem área (estoque geral)" para a área "${input.areaName}". ` +
    `Lotes: ${input.lotNumbers.join(", ")}. ` +
    `Motivo: a área "Impressoras" foi escolhida pelo usuário na conferência da NF-e, ` +
    `mas um stale closure no frontend (setState seguido de mutation no mesmo tick) fez o ` +
    `backend receber areaId=undefined; a escolha foi perdida apenas na gravação, ` +
    `sem qualquer alteração de quantidade, local físico, produto ou fornecedor.`
  );
}

/** Monta o texto de auditoria da correção de `quantityAvailable` do lote. */
export function buildLotAvailabilityAuditDetail(input: {
  lotNumber: string;
  productName: string;
  previousAvailable: number;
  newAvailable: number;
  received: number;
  exitMovementRef: string;
  returnMovementRef: string;
}): string {
  return (
    `Correção histórica de consistência de lote — ${input.lotNumber} (${input.productName}): ` +
    `quantityAvailable ${input.previousAvailable} → ${input.newAvailable} ` +
    `(quantityReceived permanece ${input.received}). ` +
    `Motivo: a devolução histórica restaurou o saldo global do produto, mas não o ` +
    `quantityAvailable deste lote, porque a saída de origem (${input.exitMovementRef}) ` +
    `não gravava o lotId estruturado e a devolução (${input.returnMovementRef}) ` +
    `dependia desse vínculo. Nenhuma quantidade física foi alterada e nenhuma ` +
    `movimentação de estoque foi criada — apenas a reconciliação do saldo do lote.`
  );
}
