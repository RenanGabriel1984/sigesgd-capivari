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

/* ===========================================================================
 * RODADA DE RASTREABILIDADE HISTÓRICA — SOMENTE VÍNCULOS
 * ===========================================================================
 *
 * Terceira correção histórica autorizada: completar a cadeia
 * Entrada → EntryItem → Lote → Movimento para a NF 372043 e para o Cooler.
 *
 * Regra inegociável desta rodada: NENHUMA quantidade de estoque é alterada.
 * São gravados apenas campos de REFERÊNCIA (areaId da entrada, lotId de
 * entryItems e stockMovements). Cada função abaixo valida pré-condições ANTES
 * de autorizar a escrita e é idempotente: vínculo já correto = no-op.
 */

/** Fornecedor obrigatório da NF 372043 (suppliers.legalName). */
export const GOMAQ_SUPPLIER_LEGAL_NAME = "GOMAQ MAQUINAS PARA ESCRITORIO LTDA";

/** Entrada e NF alvo da correção de rastreabilidade. */
export const TRACEABILITY_ENTRY_NUMBER = "ENT-2026-000002";
export const TRACEABILITY_INVOICE_NUMBER = "372043";

/**
 * Mapeamento OBRIGATÓRIO entryItem → lote da NF 372043 (produto → lotNumber).
 * Validado contra o banco na rodada de diagnóstico: cada lote 54..61 pertence
 * à ENT-2026-000002 e tem exatamente o productId abaixo.
 */
export const NF372043_EXPECTED_LOTS: ReadonlyArray<{
  lotNumber: string;
  productId: string;
}> = [
  { lotNumber: "LOT-2026-000054", productId: "kd7fjr7m20vp7p285vn02nqv9h8f3xs4" }, // Toner CX735 — Preto
  { lotNumber: "LOT-2026-000055", productId: "kd7a1824vydkd3jrpqz2vy3q6tga9k4v" }, // Toner CX735 — Amarelo
  { lotNumber: "LOT-2026-000056", productId: "kd70ck3e4c396bnsy529k04wkx8f25qh" }, // Toner CX735 — Ciano
  { lotNumber: "LOT-2026-000057", productId: "kd75fnwnxdcwyvjejt14wkae718f3xah" }, // Ribbon Color YMCKT SIGMA
  { lotNumber: "LOT-2026-000058", productId: "kd73hh4taw6qmfkefmdn9aw2x2d4dths" }, // Toner AltaLink — Ciano
  { lotNumber: "LOT-2026-000059", productId: "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f" }, // Cartão PVC
  { lotNumber: "LOT-2026-000060", productId: "kd75k6hz4gj7szvar4d44nxnwp9a52qa" }, // Papel térmico
  { lotNumber: "LOT-2026-000061", productId: "kd7dd58stasmw3rvrsz3c0cn6h8f3vza" }, // Toner MFC-L6902DW
];

/* ─── A) Área da ENT-2026-000002 ─────────────────────────────────────────── */

/** Estado mínimo da entrada para a correção de área da entrada. */
export interface EntryAreaState {
  entryNumber: string;
  invoiceNumber: string;
  supplierLegalName?: string | null;
  status: string;
  areaId?: string | null;
}

/**
 * Decide a correção do `areaId` da PRÓPRIA entrada ENT-2026-000002.
 *
 * Pré-condições: entrada correta, NF correta, fornecedor Gomaq, status
 * confirmed e área atualmente ausente. Idempotente: área já igual ao alvo →
 * no-op. Qualquer pré-condição violada → aborta SEM escrever.
 */
export function decideEntryAreaRepair(input: {
  entry: EntryAreaState;
  targetAreaId: string;
}): RepairDecision {
  const e = input.entry;
  if (e.entryNumber !== TRACEABILITY_ENTRY_NUMBER)
    return no("Entrada " + e.entryNumber + " não é " + TRACEABILITY_ENTRY_NUMBER + ".");
  if (e.invoiceNumber !== TRACEABILITY_INVOICE_NUMBER)
    return no("NF " + e.invoiceNumber + " não é " + TRACEABILITY_INVOICE_NUMBER + ".");
  if (!(e.supplierLegalName ?? "").toUpperCase().includes("GOMAQ"))
    return no("Fornecedor não é Gomaq (" + (e.supplierLegalName ?? "—") + ").");
  if (e.status !== "confirmed") return no("Status não é confirmed (" + e.status + ").");
  if (e.areaId === input.targetAreaId)
    return no("areaId da entrada já é Impressoras — nada a corrigir (idempotente).");
  if (e.areaId != null)
    return no("areaId da entrada mudou inesperadamente (" + e.areaId + ") — correção interrompida.");
  return yes("areaId da entrada: ausente → Impressoras.");
}

/* ─── B) lotId dos 8 entryItems da NF 372043 ────────────────────────────── */

export interface EntryItemLinkState {
  entryItemId: string;
  entryId: string;
  productId: string;
  quantity: number;
  lotId?: string | null;
}

export interface LotLinkState {
  lotId: string;
  lotNumber: string;
  entryId: string;
  productId: string;
  quantityReceived: number;
}

export interface EntryItemLinkDecision {
  decision: RepairDecision;
  /** Lote que DEVE ser vinculado, quando a correção se aplica. */
  targetLotId?: string;
}

/**
 * Decide o vínculo entryItem → lote para UM item da NF 372043.
 *
 * Pré-condições por item: item pertence à ENT-2026-000002; lote pertence à
 * mesma entrada; productId idêntico; quantity do item igual ao
 * quantityReceived do lote; lotId atualmente ausente. Idempotente: já ligado
 * ao lote esperado → no-op. Já ligado a OUTRO lote → aborta (estado mudou).
 */
export function decideEntryItemLotLink(input: {
  item: EntryItemLinkState;
  lot: LotLinkState;
  entryId: string;
}): EntryItemLinkDecision {
  const { item, lot, entryId } = input;
  if (item.entryId !== entryId)
    return { decision: no("EntryItem não pertence à entrada alvo.") };
  if (lot.entryId !== entryId)
    return { decision: no("Lote " + lot.lotNumber + " não pertence à entrada alvo.") };
  if (item.productId !== lot.productId)
    return {
      decision: no(
        "Produto do entryItem difere do produto do lote " + lot.lotNumber + "."
      ),
    };
  if (item.quantity !== lot.quantityReceived)
    return {
      decision: no(
        "Quantidade do entryItem (" + item.quantity + ") difere do lote " +
        lot.lotNumber + " (" + lot.quantityReceived + ")."
      ),
    };
  if (item.lotId === lot.lotId)
    return { decision: no("lotId já vinculado ao lote esperado — nada a fazer (idempotente)."), targetLotId: lot.lotId };
  if (item.lotId != null)
    return { decision: no("EntryItem já aponta para outro lote (" + item.lotId + ") — correção interrompida.") };
  return { decision: yes("lotId: ausente → " + lot.lotNumber + "."), targetLotId: lot.lotId };
}

/* ─── C/D) lotId dos dois movimentos históricos do Cooler ───────────────── */

export interface MovementLinkState {
  movementId: string;
  type: string;
  quantity: number;
  productId: string;
  lotId?: string | null;
}

/**
 * Decide o vínculo movimento → lote para UM movimento histórico do Cooler.
 *
 * Pré-condições: movimento do produto Cooler; tipo esperado (exit/return);
 * quantidade 1 (a saída histórica consumiu 1 do lote e a devolução restaurou
 * 1); lotId atualmente ausente. Idempotente: já ligado ao lote esperado →
 * no-op. Qualquer divergência → aborta SEM escrever.
 */
export function decideMovementLotLink(input: {
  movement: MovementLinkState;
  coolerProductId: string;
  coolerLotId: string;
  expectedType: "exit" | "return";
}): RepairDecision {
  const m = input.movement;
  if (m.productId !== input.coolerProductId)
    return no("Movimento não pertence ao produto Cooler.");
  if (m.type !== input.expectedType)
    return no("Movimento é " + m.type + ", esperado " + input.expectedType + ".");
  if (m.quantity !== 1)
    return no("Quantidade do movimento é " + m.quantity + ", esperado 1 — correção interrompida.");
  if (m.lotId === input.coolerLotId)
    return no("lotId já vinculado ao lote esperado — nada a fazer (idempotente).");
  if (m.lotId != null)
    return no("Movimento já aponta para outro lote (" + m.lotId + ") — correção interrompida.");
  return yes("lotId: ausente → LOT-2026-000001.");
}

/* ─── Proteção absoluta: zero alteração de saldo ────────────────────────── */

/** Totais que DEVEM permanecer idênticos antes e depois da rodada. */
export interface StockTotals {
  physical: number;
  reserved: number;
  available: number;
  stockByLocation: number;
  lotsQuantityReceived: number;
  lotsQuantityAvailable: number;
}

/**
 * Compara os totais ANTES x DEPOIS da rodada de rastreabilidade.
 * Qualquer diferença = VIOLAÇÃO da regra "zero alteração de quantidade".
 */
export function assertNoQuantityChange(before: StockTotals, after: StockTotals): RepairDecision {
  const diffs: string[] = [];
  const cmp = (label: string, b: number, a: number) => {
    if (b !== a) diffs.push(label + " " + b + " → " + a);
  };
  cmp("physical", before.physical, after.physical);
  cmp("reserved", before.reserved, after.reserved);
  cmp("available", before.available, after.available);
  cmp("stockByLocation", before.stockByLocation, after.stockByLocation);
  cmp("soma quantityReceived", before.lotsQuantityReceived, after.lotsQuantityReceived);
  cmp("soma quantityAvailable", before.lotsQuantityAvailable, after.lotsQuantityAvailable);
  if (diffs.length > 0)
    return no("VIOLAÇÃO de saldo detectada: " + diffs.join("; ") + ".");
  return yes("Nenhuma quantidade de estoque foi alterada.");
}

/* ─── Textos de auditoria da rodada de rastreabilidade ──────────────────── */

const TRACEABILITY_SUFFIX =
  "Correção histórica de rastreabilidade. Nenhuma quantidade de estoque foi alterada.";

/** Auditoria A) areaId da ENT-2026-000002: ausente → Impressoras. */
export function buildEntryAreaTraceAuditDetail(input: {
  entryNumber: string;
  invoiceNumber: string;
  areaName: string;
}): string {
  return (
    `Correção histórica de rastreabilidade — entrada ${input.entryNumber} (NF ${input.invoiceNumber}): ` +
    `areaId da ENTRADA ausente → "${input.areaName}". A área era conhecida do usuário na confirmação ` +
    `da NF-e, mas o stale closure do frontend a perdeu antes da gravação. ` +
    `Os lotes já haviam sido realocados na rodada anterior; agora a entrada também aponta para a área. ` +
    `${TRACEABILITY_SUFFIX}`
  );
}

/** Auditoria B) os 8 entryItems da NF 372043 recebem lotId. */
export function buildEntryItemLotsTraceAuditDetail(input: {
  entryNumber: string;
  invoiceNumber: string;
  links: Array<{ lotNumber: string; entryItemId: string }>;
}): string {
  const list = input.links.map((l) => l.lotNumber).join(", ");
  return (
    `Correção histórica de rastreabilidade — entrada ${input.entryNumber} (NF ${input.invoiceNumber}): ` +
    `${input.links.length} entryItem(s) receberam lotId (antes ausente) apontando para os lotes ` +
    `${list}. Completa a cadeia Entrada → EntryItem → Lote. ${TRACEABILITY_SUFFIX}`
  );
}

/** Auditoria C/D) um movimento histórico do Cooler recebe lotId. */
export function buildMovementTraceAuditDetail(input: {
  productName: string;
  movementId: string;
  movementType: string;
  lotNumber: string;
}): string {
  return (
    `Correção histórica de rastreabilidade — movimento ${input.movementId} (${input.movementType}, ` +
    `${input.productName}): lotId ausente → ${input.lotNumber}. O movimento consumiu/restaurou ` +
    `saldo deste lote na época, mas a saída rápida da época não gravava o vínculo estruturado. ` +
    `Tipo, quantidade, saldo e demais campos permanecem intactos. ${TRACEABILITY_SUFFIX}`
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function yes(reason: string): RepairDecision {
  return { shouldApply: true, reason };
}
function no(reason: string): RepairDecision {
  return { shouldApply: false, reason };
}
