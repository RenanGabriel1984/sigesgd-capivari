/**
 * Gestão de Estoque SGGD — SOLICITAÇÃO MENSAL DE SUPRIMENTOS (regras puras).
 *
 * Uma solicitação mensal é um DOCUMENTO DE PLANEJAMENTO: registra o que se
 * pretende pedir ao fornecedor. Ela é papel, não estoque.
 *
 * REGRAS INEGOCIÁVEIS desta fase:
 *  - criar/editar/gerar solicitação NÃO cria entrada, saída, movimentação,
 *    reserva, lote nem altera qualquer saldo;
 *  - a quantidade SOLICITADA é digitada pelo operador e NUNCA é imposta pela
 *    sugestão (ideal − estoque);
 *  - a sugestão é apenas um número de apoio;
 *  - consumo mensal é PARÂMETRO do gestor; o sistema não o deduz de
 *    movimentações nem inventa histórico nesta fase;
 *  - o documento guarda a FOTOGRAFIA do momento (estoque atual/vazio) e não a
 *    recalcula depois — o que foi pedido é o que foi pedido.
 *
 * Fornecedor, parque de impressoras e modelo Gomaq entram como REFÉRENCIAS.
 * Nenhuma delas é copiada para dentro do produto de estoque.
 */

/* ─── Status do documento ──────────────────────────────────────────────────── */

/** Ciclo de vida enxuto — sem workflow de aprovação nesta fase. */
export type SupplyRequestStatus = "draft" | "ready_for_review" | "generated";

export const SUPPLY_REQUEST_STATUS_LABELS: Record<SupplyRequestStatus, string> = {
  draft: "Rascunho",
  ready_for_review: "Pronta para conferência",
  generated: "Gerada",
};

/** Ordem canônica do ciclo (usada nos testes e na ordenação da tela). */
export const SUPPLY_REQUEST_STATUS_ORDER: SupplyRequestStatus[] = [
  "draft",
  "ready_for_review",
  "generated",
];

/** Próximo status permitido; `null` quando o documento já foi gerado. */
export function nextSupplyRequestStatus(
  current: SupplyRequestStatus
): SupplyRequestStatus | null {
  const index = SUPPLY_REQUEST_STATUS_ORDER.indexOf(current);
  if (index < 0 || index === SUPPLY_REQUEST_STATUS_ORDER.length - 1) return null;
  return SUPPLY_REQUEST_STATUS_ORDER[index + 1];
}

/** É possível gerar (emitir) o documento no período informado? */
export function canGenerateSupplyRequest(input: {
  status: SupplyRequestStatus;
  itemCount: number;
  periodMonth: number;
  periodYear: number;
  validMonth: boolean;
}): boolean {
  return (
    input.status !== "generated" &&
    input.itemCount > 0 &&
    input.validMonth &&
    input.periodYear > 2000
  );
}

/* ─── Itens da solicitação ─────────────────────────────────────────────────── */

/** Um item do documento (suprimento e/ou equipamento de destino). */
export interface SupplyRequestItemInput {
  itemId: string;
  /** Produto de estoque (referência — o item NÃO é copiado). */
  productId: string | null;
  productName: string;
  /** Equipamento opcional ao qual o suprimento se destina. */
  equipmentModel: string | null;
  /** Fotografia do momento da solicitação. */
  currentStock: number;
  emptyStock: number;
  /** Sugestão do sistema — informativa. */
  suggestedQuantity: number;
  /** Quantidade REALMENTE solicitada, digitada pelo operador. */
  requestedQuantity: number;
  observation: string | null;
}

/**
 * Calcula a sugestão a partir do estoque atual.
 * A sugestão NUNCA substitui a quantidade solicitada.
 */
export function buildSuggestedQuantity(currentStock: number, idealStock: number | null): number {
  if (idealStock === null || !Number.isFinite(idealStock)) return 0;
  return Math.max(idealStock - currentStock, 0);
}

/**
 * Normaliza um item digitado pelo operador.
 *
 * A quantidade solicitada é preservada como o operador digitou — mesmo que
 * exista sugestão diferente. Só valores inválidos (negativo/NaN) caem para 0.
 */
export function normalizeSupplyRequestItem(input: {
  currentStock: number;
  emptyStock: number;
  suggestedQuantity: number;
  requestedQuantity: number;
  observation?: string | null;
  equipmentModel?: string | null;
}): {
  currentStock: number;
  emptyStock: number;
  suggestedQuantity: number;
  requestedQuantity: number;
  observation: string | null;
  equipmentModel: string | null;
} {
  const safe = (v: number): number =>
    Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  const note = (input.observation ?? "").trim();
  const model = (input.equipmentModel ?? "").trim();
  return {
    currentStock: safe(input.currentStock),
    emptyStock: safe(input.emptyStock),
    suggestedQuantity: safe(input.suggestedQuantity),
    requestedQuantity: safe(input.requestedQuantity),
    observation: note.length > 0 ? note : null,
    equipmentModel: model.length > 0 ? model : null,
  };
}

/** Um item pode ser salvo no documento? */
export function isValidSupplyRequestItem(input: {
  productId: string | null;
  requestedQuantity: number;
}): boolean {
  return input.productId !== null && input.requestedQuantity >= 0;
}

/** Agrupa os itens por modelo de equipamento (parque de impressoras). */
export function groupItemsByEquipmentModel<T extends { equipmentModel: string | null }>(
  items: T[]
): Array<{ model: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.equipmentModel?.trim() || "Sem equipamento vinculado";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([model, groupItems]) => ({ model, items: groupItems }))
    .sort((a, b) => a.model.localeCompare(b.model, "pt-BR"));
}

/* ─── Totais do documento (informativos; nada é reservado) ─────────────────── */

export interface SupplyRequestTotals {
  itemCount: number;
  requestedUnits: number;
  distinctProducts: number;
}

export function computeSupplyRequestTotals(
  items: Array<{ productId: string | null; requestedQuantity: number }>
): SupplyRequestTotals {
  const products = new Set<string>();
  let requestedUnits = 0;
  for (const item of items) {
    requestedUnits += item.requestedQuantity;
    if (item.productId) products.add(item.productId);
  }
  return {
    itemCount: items.length,
    requestedUnits,
    distinctProducts: products.size,
  };
}

/* ─── Necessidade estimada no planejamento (Gomaq) ─────────────────────────── */

/**
 * Rótulo da necessidade estimada.
 *
 * Nesta primeira implementação a necessidade é um PARÂMETRO MANUAL: o rótulo
 * deixa isso explícito para ninguém confundir com consumo calculado.
 */
export const NEED_SOURCE_LABELS = {
  parameter: "Parâmetro manual",
  none: "Não informado",
} as const;

export type NeedSource = keyof typeof NEED_SOURCE_LABELS;

export interface EstimatedNeedRow {
  currentStock: number;
  minimumStock: number | null;
  idealStock: number | null;
  monthlyConsumptionTarget: number | null;
  /** Nunca inventado: `null` quando não há parâmetro de consumo. */
  estimatedNeed: number | null;
  needSource: NeedSource;
  suggestedReplenishment: number;
}

export function buildEstimatedNeedRow(input: {
  currentStock: number;
  minimumStock: number | null;
  idealStock: number | null;
  monthlyConsumptionTarget: number | null;
}): EstimatedNeedRow {
  const estimatedNeed =
    input.monthlyConsumptionTarget !== null ? input.monthlyConsumptionTarget : null;
  const suggestedReplenishment =
    input.idealStock !== null ? Math.max(input.idealStock - input.currentStock, 0) : 0;
  return {
    ...input,
    estimatedNeed,
    needSource: estimatedNeed === null ? "none" : "parameter",
    suggestedReplenishment,
  };
}
