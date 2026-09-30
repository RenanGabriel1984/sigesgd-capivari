/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE REPOSIÇÃO (regras puras).
 *
 * Parâmetros de reposição são INDEPENDENTES do estoque físico. Nada aqui
 * altera saldo, cria lote, movimentação, reserva ou pedido: as funções deste
 * arquivo recebem números e devolvem CLASSIFICAÇÕES e SUGESTÕES.
 *
 * ─── DIMENSÕES QUE NÃO SE CONFUNDEM ─────────────────────────────────────────
 *   estoque físico     = `stock.physicalQuantity`   (o que existe)
 *   estoque reservado  = `stock.reservedQuantity`   (comprometido)
 *   estoque disponível = físico − reservado         (o que pode sair)
 *   mínimo             = ponto de atenção para reposição
 *   ideal              = quantidade desejada após reposição
 *   consumo mensal     = referência operacional de planejamento
 *   quantidade sugerida= max(ideal − disponível, 0)  — INFORMATIVA
 *
 * `null` ≠ `0`:
 *   minimumStock = null  → "ainda não parametrizado" (produto fora do plano)
 *   minimumStock = 0     → "zero é um valor real configurado"
 *
 * A sugestão NUNCA cria pedido, entrada, saída ou reserva. Ela é um número
 * mostrado na tela para o operador decidir.
 *
 * ─── EMBALAGEM (camada auxiliar) ────────────────────────────────────────────
 * Quando o produto tem embalagem configurada (1 caixa = 30 rolos), a tela
 * mostra o equivalente do saldo ao lado ("≈ 6 caixas"). Os parâmetros de
 * mínimo/ideal/consumo NUNCA são convertidos: a unidade oficial do estoque e
 * dos parâmetros é sempre a UNIDADE BASE.
 */
import {
  describeEquivalent,
  type PackagingConfig,
} from "./packaging-parameters";

/* ─── Semântica dos parâmetros ─────────────────────────────────────────────── */

/** Parâmetros de reposição de UM produto, já normalizados. */
export interface ReplenishmentParameters {
  /** null = ainda não parametrizado (NÃO é o mesmo que 0). */
  minimumStock: number | null;
  /** null = ainda não parametrizado. */
  idealStock: number | null;
  /** null = sem referência de consumo (nunca calculada automaticamente). */
  monthlyConsumptionTarget: number | null;
  /** Ausente/null = produto não participa da fila de reposição. */
  replenishmentEnabled: boolean;
  replenishmentNote: string | null;
}

/** Campos crus do produto (schema `products`), ainda não normalizados. */
export interface RawReplenishmentFields {
  minimumStock?: number | null;
  idealStock?: number | null;
  monthlyConsumptionTarget?: number | null;
  replenishmentEnabled?: boolean | null;
  replenishmentNote?: string | null;
}

/**
 * Normaliza os parâmetros brutos.
 *
 * `undefined`/`null` → `null` (não parametrizado).
 * Números NEGATIVOS são normalizados para `null` (um mínimo negativo não tem
 * sentido e não pode virar sugestão de reposição).
 */
export function readReplenishmentParameters(raw: RawReplenishmentFields): ReplenishmentParameters {
  const nonNegative = (v: number | null | undefined): number | null =>
    v == null || !Number.isFinite(v) || v < 0 ? null : v;

  const note = (raw.replenishmentNote ?? "").trim();
  return {
    minimumStock: nonNegative(raw.minimumStock),
    idealStock: nonNegative(raw.idealStock),
    monthlyConsumptionTarget: nonNegative(raw.monthlyConsumptionTarget),
    replenishmentEnabled: raw.replenishmentEnabled === true,
    replenishmentNote: note.length > 0 ? note : null,
  };
}

/**
 * O produto foi parametrizado?
 *
 * TRUE quando ao menos um parâmetro de reposição tem VALOR — inclusive 0.
 * Um mínimo 0 é uma decisão real do gestor e conta como parametrizado.
 */
export function isParametrized(p: ReplenishmentParameters): boolean {
  return (
    p.minimumStock !== null ||
    p.idealStock !== null ||
    p.monthlyConsumptionTarget !== null
  );
}

/* ─── Situação / status de reposição (classificação única) ─────────────────── */

/**
 * Status de reposição. EXATAMENTE UM por produto — sem classificação
 * conflitante. A precedência é fixa e documentada:
 *
 *   1. sem parâmetro algum            → "Não parametrizado"
 *   2. disponível <= mínimo          → "Reposição necessária"
 *   3. disponível <  ideal            → "Reposição sugerida"
 *   4. disponível >= ideal            → "Normal"
 */
export type ReplenishmentStatusKey =
  | "not_parametrized"
  | "replenish_required"
  | "replenish_suggested"
  | "normal";

export const REPLENISHMENT_STATUS_LABELS: Record<ReplenishmentStatusKey, string> = {
  not_parametrized: "NÃO PARAMETRIZADO",
  replenish_required: "REPOSIÇÃO NECESSÁRIA",
  replenish_suggested: "REPOSIÇÃO SUGERIDA",
  normal: "NORMAL",
};

export const REPLENISHMENT_STATUS_BADGE: Record<ReplenishmentStatusKey, string> = {
  not_parametrized: "border-slate-200 bg-slate-50 text-slate-600",
  replenish_required: "border-rose-200 bg-rose-50 text-rose-700",
  replenish_suggested: "border-amber-200 bg-amber-50 text-amber-700",
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/** Rótulos por extenso, usados na tela e nos relatórios. */
export const REPLENISHMENT_STATUS_LONG: Record<ReplenishmentStatusKey, string> = {
  not_parametrized: "Não parametrizado",
  replenish_required: "Reposição necessária",
  replenish_suggested: "Reposição sugerida",
  normal: "Normal",
};

/**
 * Classifica o status de reposição de um produto.
 *
 * Usa o estoque DISPONÍVEL (físico − reservado), nunca o físico puro: um item
 * totalmente reservado não pode ser considerado "normal".
 */
export function replenishmentStatus(
  availableStock: number,
  parameters: ReplenishmentParameters
): ReplenishmentStatusKey {
  if (!isParametrized(parameters)) return "not_parametrized";

  const { minimumStock: min, idealStock: ideal } = parameters;

  // Precedência 1: ABAIXO/IGUAL AO MÍNIMO prevalece sobre qualquer outra
  // situação — é o dado que exige ação imediata.
  if (min !== null && availableStock <= min) return "replenish_required";

  // Precedência 2: entre o mínimo e o ideal há reposição SUGERIDA.
  if (ideal !== null && availableStock < ideal) return "replenish_suggested";

  // Precedência 3: no nível desejado (ou acima dele).
  return "normal";
}

/* ─── Quantidade sugerida (INFORMATIVA; nunca vira pedido) ─────────────────── */

/**
 * Sugestão de reposição = max(ideal − disponível, 0).
 *
 * Retorna 0 quando não há ideal definido ou quando o estoque já cobriu o
 * ideal. NÃO cria pedido, NÃO reserva, NÃO movimenta.
 */
export function suggestedReplenishmentQuantity(
  availableStock: number,
  parameters: ReplenishmentParameters
): number {
  const ideal = parameters.idealStock;
  if (ideal === null) return 0;
  return Math.max(ideal - availableStock, 0);
}

/**
 * "Necessidade estimada" para o planejamento.
 *
 * SEM histórico de consumo, o valor é PARÂMETRO MANUAL: devolve
 * `source: "parameter"` e NUNCA um número inventado a partir de movimento.
 * O sistema não calcula consumo médio nesta fase.
 */
export interface EstimatedNeed {
  quantity: number;
  /** `parameter` = digitado pelo gestor; `none` = sem base configurada. */
  source: "parameter" | "none";
}

export function estimatedMonthlyNeed(parameters: ReplenishmentParameters): EstimatedNeed {
  if (parameters.monthlyConsumptionTarget === null) {
    return { quantity: 0, source: "none" };
  }
  return { quantity: parameters.monthlyConsumptionTarget, source: "parameter" };
}

/* ─── Linha da tabela de parametrização ────────────────────────────────────── */

export interface StockParameterRowInput {
  productId: string;
  productName: string;
  categoryName: string | null;
  areaName: string | null;
  unitOfMeasure: string;
  /** Saldo FÍSICO real (exibido como referência; nunca alterado aqui). */
  physicalStock: number;
  /** Saldo RESERVADO real. */
  reservedStock: number;
  parameters: ReplenishmentParameters;
  /**
   * Embalagem configurada (somente leitura). Os parâmetros de reposição
   * NUNCA são convertidos: a unidade oficial continua sendo a unidade base.
   */
  packaging?: PackagingConfig | null;
}

export interface StockParameterRow extends StockParameterRowInput {
  /** físico − reservado, nunca negativo. */
  availableStock: number;
  parametrized: boolean;
  status: ReplenishmentStatusKey;
  statusLabel: string;
  suggestedQuantity: number;
  need: EstimatedNeed;
  /** Unidade base efetiva (baseUnit configurada ou a do produto). */
  baseUnit: string;
  /** Texto auxiliar "≈ 6 caixas" (null quando não há embalagem). */
  equivalentLabel: string | null;
}

/** Monta a linha completa da tabela a partir dos saldos reais. */
export function buildStockParameterRow(input: StockParameterRowInput): StockParameterRow {
  const availableStock = Math.max(input.physicalStock - input.reservedStock, 0);
  const status = replenishmentStatus(availableStock, input.parameters);
  const baseUnit = input.packaging?.baseUnit?.trim() || input.unitOfMeasure;
  return {
    ...input,
    availableStock,
    parametrized: isParametrized(input.parameters),
    status,
    statusLabel: REPLENISHMENT_STATUS_LONG[status],
    suggestedQuantity: suggestedReplenishmentQuantity(availableStock, input.parameters),
    need: estimatedMonthlyNeed(input.parameters),
    baseUnit,
    // SOMENTE apresentação: os parâmetros continuam na unidade base.
    equivalentLabel: describeEquivalent(availableStock, input.packaging, baseUnit),
  };
}

/* ─── Edição em lote (salvar SOMENTE o que mudou) ─────────────────────────── */

/** Campos editáveis na tabela. `null` = "não parametrizado" (limpar). */
export interface ParameterDraft {
  minimumStock: number | null;
  idealStock: number | null;
  monthlyConsumptionTarget: number | null;
  replenishmentEnabled: boolean;
  replenishmentNote: string | null;
}

/** Conversão de um texto digitado em valor de parâmetro. */
export function parseParameterInput(raw: string): number | null {
  const trimmed = raw.trim();
  // Vazio = não parametrizado (NÃO zero).
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Rótulo de um campo, usado na auditoria (antes → depois). */
export type ParameterField = keyof ParameterDraft;

export const PARAMETER_FIELD_LABELS: Record<ParameterField, string> = {
  minimumStock: "Estoque mínimo",
  idealStock: "Estoque ideal",
  monthlyConsumptionTarget: "Consumo mensal",
  replenishmentEnabled: "Reposição",
  replenishmentNote: "Observação da reposição",
};

/** Uma alteração efetiva de um produto. */
export interface ParameterChange {
  productId: string;
  field: ParameterField;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

/**
 * Compara rascunho × salvo e devolve APENAS as diferenças.
 *
 * Uma linha não editada nunca aparece no resultado — é o que garante
 * "salvar somente os produtos modificados".
 */
export function diffParameterDraft(
  productId: string,
  current: ParameterDraft,
  draft: ParameterDraft
): ParameterChange[] {
  const fields: ParameterField[] = [
    "minimumStock",
    "idealStock",
    "monthlyConsumptionTarget",
    "replenishmentEnabled",
    "replenishmentNote",
  ];
  const changes: ParameterChange[] = [];
  for (const field of fields) {
    const before = current[field];
    const after = draft[field];
    if (before === after) continue;
    changes.push({ productId, field, before, after });
  }
  return changes;
}

/** Rascunho inicial derivado dos parâmetros já salvos. */
export function draftFromParameters(p: ReplenishmentParameters): ParameterDraft {
  return {
    minimumStock: p.minimumStock,
    idealStock: p.idealStock,
    monthlyConsumptionTarget: p.monthlyConsumptionTarget,
    replenishmentEnabled: p.replenishmentEnabled,
    replenishmentNote: p.replenishmentNote,
  };
}

/**
 * Rascunho a partir do texto digitado na tabela.
 * `enabled` é o switch "Reposição" da linha; a nota vem do textarea.
 */
export function draftFromInputs(input: {
  minimum: string;
  ideal: string;
  monthly: string;
  enabled: boolean;
  note: string;
}): ParameterDraft {
  const note = input.note.trim();
  return {
    minimumStock: parseParameterInput(input.minimum),
    idealStock: parseParameterInput(input.ideal),
    monthlyConsumptionTarget: parseParameterInput(input.monthly),
    replenishmentEnabled: input.enabled,
    replenishmentNote: note.length > 0 ? note : null,
  };
}

/** Validação de consistência mínima/ideal (informativa; não bloqueia). */
export function validateParameters(draft: ParameterDraft): string | null {
  const { minimumStock: min, idealStock: ideal, monthlyConsumptionTarget: monthly } = draft;
  if (min !== null && ideal !== null && ideal < min) {
    return "Estoque ideal menor que o estoque mínimo — confirme os valores.";
  }
  if (monthly !== null && monthly === 0) {
    return "Consumo mensal 0 significa produto sem consumo no período.";
  }
  return null;
}

/* ─── Filtros e contadores da tela ─────────────────────────────────────────── */

export interface ParameterFilters {
  search: string;
  categoryName: string | null;
  areaName: string | null;
  onlyUnparametrized: boolean;
  onlyBelowMinimum: boolean;
  onlyReplenishmentEnabled: boolean;
}

export const EMPTY_PARAMETER_FILTERS: ParameterFilters = {
  search: "",
  categoryName: null,
  areaName: null,
  onlyUnparametrized: false,
  onlyBelowMinimum: false,
  onlyReplenishmentEnabled: false,
};

/** Aplica busca + filtros às linhas. A busca cobre produto e categoria. */
export function applyParameterFilters(
  rows: StockParameterRow[],
  filters: ParameterFilters
): StockParameterRow[] {
  const term = filters.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.onlyUnparametrized && r.parametrized) return false;
    if (filters.onlyReplenishmentEnabled && !r.parameters.replenishmentEnabled) return false;
    if (filters.onlyBelowMinimum && r.status !== "replenish_required") return false;
    if (filters.categoryName && r.categoryName !== filters.categoryName) return false;
    if (filters.areaName && r.areaName !== filters.areaName) return false;
    if (!term) return true;
    return (
      r.productName.toLowerCase().includes(term) ||
      (r.categoryName ?? "").toLowerCase().includes(term)
    );
  });
}

export interface ParameterCounters {
  /** Total de produtos na base (independente dos filtros). */
  total: number;
  parametrized: number;
  notParametrized: number;
  /** Itens que exigem reposição (abaixo/igual ao mínimo). */
  needsReplenishment: number;
}

/**
 * Contadores calculados SOBRE O CONJUNTO INTEIRO, não sobre o resultado do
 * filtro — "53 produtos / 20 parametrizados / 33 não parametrizados" precisa
 * descrever a base real, não a fatia visível.
 */
export function computeParameterCounters(rows: StockParameterRow[]): ParameterCounters {
  const parametrized = rows.filter((r) => r.parametrized).length;
  return {
    total: rows.length,
    parametrized,
    notParametrized: rows.length - parametrized,
    needsReplenishment: rows.filter((r) => r.status === "replenish_required").length,
  };
}

/** Valida um mês de período de solicitação mensal (1..12). */
export function isValidPeriodMonth(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

/** Rótulo do período, ex.: "03/2026". */
export function periodLabel(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${year}`;
}
