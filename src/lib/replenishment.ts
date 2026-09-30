/**
 * Gestão de Estoque SGGD — PLANEJAMENTO DE REPOSIÇÃO (regras puras).
 *
 * ─── O QUE ESTE MÓDULO É ──────────────────────────────────────────────────────
 * Uma camada ANALÍTICA sobre o estoque real. Ele classifica, conta e filtra
 * produtos para o planejamento — e NUNCA escreve nada:
 *
 *   • não cria entrada, saída, lote, movimentação, reserva ou solicitação;
 *   • não cria fornecedor, pedido de compra ou solicitação mensal;
 *   • não altera saldo (físico, reservado, disponível, por local ou por área);
 *   • não altera `minimumStock` nem `idealStock`;
 *   • não infere consumo, tendência ou custo.
 *
 * ─── CONCEITO CORRIGIDO DE "REPOSIÇÃO" ───────────────────────────────────────
 * O campo historicamente chamado "Reposição" NÃO é uma ordem de compra. Ele é o
 * opt-in do produto no planejamento:
 *
 *   "Participa do planejamento de reposição" (booleano `replenishmentEnabled`)
 *
 *   Quando ativado, o produto participa dos alertas e do planejamento de
 *   reposição ao atingir o estoque mínimo.
 *
 * Com a flag DESATIVADA o produto continua aparecendo com sua situação de
 * estoque normalmente — ele apenas não entra na fila de alertas/planejamento.
 *
 * ─── SITUAÇÃO × PLANEJAMENTO ────────────────────────────────────────────────
 *   situação cadastral : o que o estoque é hoje (independe da flag)
 *   planejamento       : o que o gestor precisa decidir (depende da flag)
 *
 *     estoque 8 · mínimo 10 · ideal 50 · planejamento = NÃO
 *       → situação cadastral : "Abaixo do mínimo"
 *       → participa do planejamento: não
 *       → nenhum item de reposição é gerado
 */
import {
  isParametrized,
  replenishmentStatus,
  suggestedReplenishmentQuantity,
  REPLENISHMENT_STATUS_BADGE,
  type ReplenishmentParameters,
  type ReplenishmentStatusKey,
  type StockParameterRow,
} from "./stock-parameters";

/* ─── Textos de UX (o que o gestor lê) ──────────────────────────────────────── */

/** Nome do campo booleano exibido na tela (o campo interno segue idêntico). */
export const REPLENISHMENT_PLANNING_LABEL = "Participa do planejamento de reposição";

/** Texto de ajuda do campo. */
export const REPLENISHMENT_PLANNING_HELP =
  "Quando ativado, o produto participa dos alertas e do planejamento de reposição ao atingir o estoque mínimo.";

/** O que marcar o campo NÃO faz — exibido junto ao checkbox. */
export const REPLENISHMENT_PLANNING_ONLY_NOTE =
  "Marcar este campo NÃO cria entrada, solicitação de compra, fornecedor, pedido, lote nem movimentação. " +
  "Ele também não altera o estoque, o lote, o estoque mínimo ou o estoque ideal.";

/** Por que o consumo deixou de ser digitado. */
export const CONSUMPTION_AUTO_NOTICE =
  "Consumo será calculado automaticamente a partir das saídas registradas no SIGESGD.";

/** Aviso exibido nos cards de alerta do Dashboard. */
export const REPLENISHMENT_ALERT_NOTICE =
  "Alertas de reposição derivados apenas do estoque real e dos parâmetros cadastrados. " +
  "Nenhuma compra, entrada ou solicitação é criada automaticamente.";

/* ─── Situação cadastral (independe da flag de planejamento) ────────────────── */

export type ReplenishmentSituationKey = ReplenishmentStatusKey;

/**
 * Rótulos da situação CADASTRAL — a situação do estoque como ela é, sem dizer
 * que algo deve ser comprado. "Reposição necessária" é decisão de planejamento;
 * "Abaixo do mínimo" é um fato.
 */
export const REPLENISHMENT_SITUATION_LABELS: Record<ReplenishmentSituationKey, string> = {
  not_parametrized: "Não parametrizado",
  replenish_required: "Abaixo do mínimo",
  replenish_suggested: "Entre o mínimo e o ideal",
  normal: "Normal",
};

/** Rótulo curto da situação cadastral. */
export function replenishmentSituationLabel(status: ReplenishmentSituationKey): string {
  return REPLENISHMENT_SITUATION_LABELS[status];
}

/** Mesma cor do status já existente na tela de parâmetros. */
export const REPLENISHMENT_SITUATION_BADGE = REPLENISHMENT_STATUS_BADGE;

/* ─── Opt-in de planejamento ────────────────────────────────────────────────── */

/** O produto foi marcado para participar do planejamento de reposição? */
export function participatesInPlanning(parameters: ReplenishmentParameters): boolean {
  return parameters.replenishmentEnabled === true;
}

/** Texto curto da coluna da tela. */
export function planningParticipationLabel(parameters: ReplenishmentParameters): string {
  return participatesInPlanning(parameters) ? "Sim" : "Não";
}

/* ─── Necessidade para atingir o ideal (INFORMATIVA) ────────────────────────── */

/**
 * Necessidade para atingir o estoque IDEAL = max(ideal − disponível, 0).
 *
 * Puramente informativa: não cria pedido, não reserva, não movimenta.
 */
export function needToReachIdeal(availableStock: number, parameters: ReplenishmentParameters): number {
  return suggestedReplenishmentQuantity(availableStock, parameters);
}

/* ─── Linha de alerta / planejamento ────────────────────────────────────────── */

export type ReplenishmentPlanningLevel = "necessary" | "suggested" | null;

export interface ReplenishmentAlertRow {
  productId: string;
  productName: string;
  categoryName: string | null;
  areaName: string | null;
  /** Estoque DISPONÍVEL real (físico − reservado). */
  availableStock: number;
  baseUnit: string;
  minimumStock: number | null;
  idealStock: number | null;
  /** max(ideal − disponível, 0) — informativo. */
  needToIdeal: number;
  /** Situação CADASTRAL (independe da flag). */
  situation: ReplenishmentSituationKey;
  situationLabel: string;
  /** Opt-in do gestor. */
  participatesInPlanning: boolean;
  /** Nível dentro do planejamento (null = fora do planejamento). */
  planningLevel: ReplenishmentPlanningLevel;
  planningLabel: string;
  parametrized: boolean;
}

export interface ReplenishmentAlertInput {
  productId: string;
  productName: string;
  categoryName?: string | null;
  areaName?: string | null;
  baseUnit: string;
  availableStock: number;
  parameters: ReplenishmentParameters;
}

/** Rótulo do nível de planejamento. */
export const REPLENISHMENT_PLANNING_LABELS: Record<"necessary" | "suggested", string> = {
  necessary: "Reposição necessária",
  suggested: "Reposição sugerida",
};

/**
 * Constrói a linha de alerta.
 *
 * Um produto entra no planejamento quando, e SOMENTE quando:
 *   1. tem mínimo configurado (ou seja, está parametrizado); e
 *   2. `replenishmentEnabled` é verdadeiro; e
 *   3. o disponível está <= mínimo (necessária) ou entre mínimo e ideal (sugerida).
 */
export function buildReplenishmentAlertRow(input: ReplenishmentAlertInput): ReplenishmentAlertRow {
  const { availableStock, parameters } = input;
  const situation = replenishmentStatus(availableStock, parameters);
  const participates = participatesInPlanning(parameters);
  const parametrized = isParametrized(parameters);

  let planningLevel: ReplenishmentPlanningLevel = null;
  if (participates && situation === "replenish_required") planningLevel = "necessary";
  else if (participates && situation === "replenish_suggested") planningLevel = "suggested";

  return {
    productId: input.productId,
    productName: input.productName,
    categoryName: input.categoryName ?? null,
    areaName: input.areaName ?? null,
    availableStock,
    baseUnit: input.baseUnit,
    minimumStock: parameters.minimumStock,
    idealStock: parameters.idealStock,
    needToIdeal: needToReachIdeal(availableStock, parameters),
    situation,
    situationLabel: REPLENISHMENT_SITUATION_LABELS[situation],
    participatesInPlanning: participates,
    planningLevel,
    planningLabel: planningLevel ? REPLENISHMENT_PLANNING_LABELS[planningLevel] : "—",
    parametrized,
  };
}

/** Constrói as linhas de alerta a partir das linhas da parametrização. */
export function buildReplenishmentAlertRows(rows: StockParameterRow[]): ReplenishmentAlertRow[] {
  return rows.map((row) =>
    buildReplenishmentAlertRow({
      productId: row.productId,
      productName: row.productName,
      categoryName: row.categoryName,
      areaName: row.areaName,
      baseUnit: row.baseUnit,
      availableStock: row.availableStock,
      parameters: row.parameters,
    })
  );
}

/* ─── Contadores dos cards do Dashboard ─────────────────────────────────────── */

export interface ReplenishmentCounters {
  /** Produtos com mínimo + planejamento ativo + disponível <= mínimo. */
  necessary: number;
  /** Produtos com mínimo e ideal + planejamento ativo + disponível entre os dois. */
  suggested: number;
  /** Participam do planejamento (qualquer nível). */
  participating: number;
  /**
   * Estão ABAIXO do mínimo mas com o planejamento DESATIVADO.
   * Continuam visíveis na parametrização e não geram alerta.
   */
  belowMinimumWithoutPlanning: number;
  /** Sem mínimo/ideal configurados — nunca contam como alerta. */
  notParametrized: number;
}

export function computeReplenishmentCounters(rows: ReplenishmentAlertRow[]): ReplenishmentCounters {
  return {
    necessary: rows.filter((r) => r.planningLevel === "necessary").length,
    suggested: rows.filter((r) => r.planningLevel === "suggested").length,
    participating: rows.filter((r) => r.participatesInPlanning).length,
    belowMinimumWithoutPlanning: rows.filter(
      (r) => r.situation === "replenish_required" && !r.participatesInPlanning
    ).length,
    notParametrized: rows.filter((r) => !r.parametrized).length,
  };
}

/* ─── Filtro da visão de alertas (usado nos cards do Dashboard) ─────────────── */

export type ReplenishmentAlertFilter =
  | "all"
  | "necessary"
  | "suggested"
  | "without_planning";

export const REPLENISHMENT_ALERT_FILTER_PARAM = "situacao";

/** Rótulos das visões filtradas. */
export const REPLENISHMENT_ALERT_FILTER_LABELS: Record<ReplenishmentAlertFilter, string> = {
  all: "Todos os produtos",
  necessary: REPLENISHMENT_PLANNING_LABELS.necessary,
  suggested: REPLENISHMENT_PLANNING_LABELS.suggested,
  without_planning: "Abaixo do mínimo sem planejamento",
};

export function applyReplenishmentAlertFilter(
  rows: ReplenishmentAlertRow[],
  filter: ReplenishmentAlertFilter
): ReplenishmentAlertRow[] {
  if (filter === "necessary") return rows.filter((r) => r.planningLevel === "necessary");
  if (filter === "suggested") return rows.filter((r) => r.planningLevel === "suggested");
  if (filter === "without_planning") {
    return rows.filter((r) => r.situation === "replenish_required" && !r.participatesInPlanning);
  }
  return rows;
}

/** Link da visão filtrada (o Dashboard navega por aqui). */
export function replenishmentAlertHref(filter: ReplenishmentAlertFilter): string {
  if (filter === "all") return "/stock-parameters";
  return `/stock-parameters?${REPLENISHMENT_ALERT_FILTER_PARAM}=${filter}`;
}

/** Lê o filtro a partir da query string da URL. */
export function readReplenishmentAlertFilter(search: string): ReplenishmentAlertFilter {
  try {
    const value = new URLSearchParams(search).get(REPLENISHMENT_ALERT_FILTER_PARAM);
    if (value === "necessary" || value === "suggested" || value === "without_planning") return value;
  } catch {
    /* query string inválida = nenhum filtro */
  }
  return "all";
}
