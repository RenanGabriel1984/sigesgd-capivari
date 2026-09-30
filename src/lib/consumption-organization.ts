/**
 * Gestão de Estoque SGGD — CONSUMO POR SECRETARIA / DEPARTAMENTO / UNIDADE
 * (regras puras).
 *
 * Objetivo: responder perguntas reais de gestão com dados REAIS do SIGESGD —
 *
 *   "Quanto a Secretaria de Educação consumiu de toner nos últimos 12 meses?"
 *   "Quanto a Secretaria de Saúde consumiu de cartão PVC?"
 *   "Qual departamento mais retirou determinado produto?"
 *   "Quanto cada Secretaria consumiu em determinado período?"
 *
 * ─── REGRAS ──────────────────────────────────────────────────────────────────
 * • Só entram movimentações que representem SAÍDA efetiva (ver
 *   `isConsumptionMovement`: entrada, transferência, ajuste, devolução e
 *   movimento cancelado ficam de fora);
 * • agrupamento NUNCA mistura dimensões: cada saída entra uma única vez, na
 *   dimensão pedida;
 * • quando a saída não tem solicitação vinculada, ela NÃO é atribuída a
 *   nenhuma Secretaria — vai para "Sem solicitação vinculada", jamais para uma
 *   Secretaria inventada;
 * • NENHUM valor é estimado. Sem custo confiável, o texto é
 *   "Custo não informado".
 */
import {
  isConsumptionMovement,
  type ConsumableMovement,
  type ConsumptionPeriod,
} from "./consumption-history";

/** Movimentação enrichida com a hierarquia organizacional da solicitação. */
export interface OrganizationalMovement extends ConsumableMovement {
  productId: string;
  productName?: string;
  categoryName?: string | null;
  secretariaName?: string | null;
  departamentoName?: string | null;
  unidadeName?: string | null;
  /** Custo unitário do LOTE de origem, quando conhecido. */
  unitCost?: number | null;
}

export const NO_ORGANIZATION_LABEL = "Sem solicitação vinculada";
export const COST_UNAVAILABLE_LABEL = "Custo não informado";

export type ConsumptionDimension =
  | "secretaria"
  | "departamento"
  | "unidade"
  | "product"
  | "category";

export const CONSUMPTION_DIMENSION_LABELS: Record<ConsumptionDimension, string> = {
  secretaria: "Secretaria",
  departamento: "Departamento",
  unidade: "Unidade",
  product: "Produto",
  category: "Categoria",
};

/** Nome da organização de uma saída, conforme a dimensão pedida. */
export function organizationOf(movement: OrganizationalMovement, dimension: ConsumptionDimension): string {
  if (dimension === "product") return movement.productName ?? "Produto não identificado";
  if (dimension === "category") return movement.categoryName ?? "Categoria não identificada";
  if (dimension === "secretaria") return movement.secretariaName || NO_ORGANIZATION_LABEL;
  if (dimension === "departamento") return movement.departamentoName || NO_ORGANIZATION_LABEL;
  return movement.unidadeName || NO_ORGANIZATION_LABEL;
}

export interface ConsumptionAggregate {
  key: string;
  label: string;
  dimension: ConsumptionDimension;
  /** Quantidade consumida (somente saídas reais). */
  quantity: number;
  /** Número de saídas que compuseram o total. */
  exitCount: number;
  /** Custo total — `null` quando não há custo confiável. */
  cost: number | null;
  /** Texto de custo pronto para exibição. */
  costLabel: string;
}

/**
 * Custo unitário confiável.
 *
 * Só aceita custo de LOTE/ITEM DE ENTRADA explicitamente cadastrado e maior
 * que zero. Ausente, zero ou negativo ⇒ `null` (nunca média inventada).
 */
export function resolveConsumptionUnitCost(movement: OrganizationalMovement): number | null {
  const cost = movement.unitCost;
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return null;
  return cost;
}

/** "Custo não informado" quando não há dado confiável. */
export function describeConsumptionCost(quantity: number, unitCost: number | null): {
  total: number | null;
  label: string;
} {
  if (unitCost == null) return { total: null, label: COST_UNAVAILABLE_LABEL };
  const total = Math.round(quantity * unitCost * 100) / 100;
  return {
    total,
    label: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total),
  };
}

/**
 * Consolida o consumo por uma dimensão organizacional.
 *
 * Só saídas reais entram. Cada agregado informa o custo apenas quando TODAS as
 * saídas do grupo têm custo confiável — um grupo parcialmente sem custo é
 * "Custo não informado" (evita custo parcial enganoso).
 */
export function aggregateConsumptionBy(
  movements: OrganizationalMovement[],
  dimension: ConsumptionDimension
): ConsumptionAggregate[] {
  const groups = new Map<string, { quantity: number; exitCount: number; costSum: number; costKnown: boolean }>();

  for (const movement of movements) {
    if (!isConsumptionMovement(movement)) continue;
    const key = organizationOf(movement, dimension);
    const bucket = groups.get(key) ?? { quantity: 0, exitCount: 0, costSum: 0, costKnown: true };
    bucket.quantity += Math.max(movement.quantity, 0);
    bucket.exitCount += 1;
    const unitCost = resolveConsumptionUnitCost(movement);
    if (unitCost == null) {
      bucket.costKnown = false;
    } else {
      bucket.costSum += unitCost * Math.max(movement.quantity, 0);
    }
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .map(([label, bucket]) => {
      const cost = bucket.costKnown ? Math.round(bucket.costSum * 100) / 100 : null;
      return {
        key: label,
        label,
        dimension,
        quantity: bucket.quantity,
        exitCount: bucket.exitCount,
        cost,
        costLabel:
          cost === null
            ? COST_UNAVAILABLE_LABEL
            : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cost),
      };
    })
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, "pt-BR"));
}

/**
 * Cruzamento Secretaria × Produto (a pergunta "quanto a Secretaria X consumiu
 * do produto Y"), preservando o mesmo rigor: só saídas, sem custo inventado.
 */
export interface CrossAggregate extends ConsumptionAggregate {
  productName: string;
}

export function aggregateConsumptionByOrganizationAndProduct(
  movements: OrganizationalMovement[],
  dimension: ConsumptionDimension
): CrossAggregate[] {
  const rows: CrossAggregate[] = [];
  const products = new Map<string, string>();
  for (const m of movements) {
    if (isConsumptionMovement(m)) products.set(m.productId, m.productName ?? "Produto não identificado");
  }
  for (const [productId, productName] of products) {
    const subset = movements.filter((m) => m.productId === productId);
    for (const aggregate of aggregateConsumptionBy(subset, dimension)) {
      rows.push({ ...aggregate, productName });
    }
  }
  return rows.sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, "pt-BR"));
}

/** Série do período para contexto do relatório (só meses com saída real). */
export interface PeriodConsumptionReport {
  period: ConsumptionPeriod;
  bySecretaria: ConsumptionAggregate[];
  byDepartment: ConsumptionAggregate[];
  byUnit: ConsumptionAggregate[];
  byProduct: ConsumptionAggregate[];
  byCategory: ConsumptionAggregate[];
  totalQuantity: number;
  totalExitCount: number;
  /** true quando o período não contém nenhuma saída real. */
  withoutHistory: boolean;
  note: string;
}

export function buildPeriodConsumptionReport(
  movements: OrganizationalMovement[],
  period: ConsumptionPeriod,
  startMs: number
): PeriodConsumptionReport {
  const inPeriod = movements.filter((m) => m.timestamp >= startMs);
  const bySecretaria = aggregateConsumptionBy(inPeriod, "secretaria");
  const totalExitCount = bySecretaria.reduce((sum, a) => sum + a.exitCount, 0);
  return {
    period,
    bySecretaria,
    byDepartment: aggregateConsumptionBy(inPeriod, "departamento"),
    byUnit: aggregateConsumptionBy(inPeriod, "unidade"),
    byProduct: aggregateConsumptionBy(inPeriod, "product"),
    byCategory: aggregateConsumptionBy(inPeriod, "category"),
    totalQuantity: bySecretaria.reduce((sum, a) => sum + a.quantity, 0),
    totalExitCount,
    withoutHistory: totalExitCount === 0,
    note:
      totalExitCount === 0
        ? "Sem saídas reais registradas no período — nada é estimado."
        : "Consumo calculado exclusivamente a partir das saídas registradas.",
  };
}
