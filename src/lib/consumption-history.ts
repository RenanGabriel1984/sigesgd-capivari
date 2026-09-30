/**
 * Gestão de Estoque SGGD — HISTÓRICO DE CONSUMO (regras puras).
 *
 * ─── O QUE ESTE MÓDULO É ──────────────────────────────────────────────────────
 * Uma camada de CÁLCULO sobre as movimentações REAIS já registradas. Ela nunca
 * cadastra, estima ou inventa consumo: o único número que sai daqui é a soma das
 * saídas que de fato existem em `stockMovements`.
 *
 * ─── O QUE CONTA COMO CONSUMO ────────────────────────────────────────────────
 * SOMENTE a movimentação de SAÍDA efetiva:
 *
 *   ✔ type = "exit" e não cancelada
 *
 * ─── O QUE NUNCA CONTA COMO CONSUMO ──────────────────────────────────────────
 *   ✘ entrada (type = "entry")
 *   ✘ transferência entre áreas / locais (type = "transfer")
 *   ✘ ajuste de inventário (type = "adjustment")
 *   ✘ devolução (type = "return") — devolução é o caminho inverso da saída
 *   ✘ movimentação cancelada (canceled = true)
 *   ✘ movimentação meramente cadastral, de implantação ou de parametrização
 *
 * ─── SEM HISTÓRICO ≠ CONSUMO ZERO ────────────────────────────────────────────
 * Sem saídas registradas o sistema NÃO mostra "0": mostra
 * "Sem histórico suficiente" / "Aguardando movimentações". Esse é o estado
 * normal enquanto o SIGESGD acumula dados reais de produção.
 */

export type MovementType = "entry" | "exit" | "transfer" | "adjustment" | "return";

export interface ConsumableMovement {
  _id: string;
  productId: string;
  type: MovementType;
  quantity: number;
  timestamp: number;
  canceled?: boolean;
  /** Saída de devolução? Nunca é consumo. */
  exitMovementId?: string;
  /** Solicitação vinculada (origem organizacional da saída). */
  requestId?: string;
  observation?: string;
}

/* ─── Classificação da movimentação ─────────────────────────────────────────── */

/** A movimentação representa consumo real (saída efetiva)? */
export function isConsumptionMovement(movement: ConsumableMovement): boolean {
  if (!movement || movement.canceled === true) return false;
  if (movement.type !== "exit") return false;
  // Uma devolução chega como "return" referenciando a saída original; mesmo
  // que um registro isolado apareça como "exit" com vínculo de devolução, ele
  // não é consumo.
  if (movement.exitMovementId) return false;
  return true;
}

/** Motivo pelo qual a movimentação NÃO conta como consumo (rastreabilidade). */
export function consumptionExclusionReason(movement: ConsumableMovement): string | null {
  if (isConsumptionMovement(movement)) return null;
  if (movement.canceled === true) return "movimentação cancelada";
  switch (movement.type) {
    case "entry":
      return "entrada";
    case "transfer":
      return "transferência";
    case "adjustment":
      return "ajuste";
    case "return":
      return "devolução";
    default:
      return "movimentação sem saída efetiva";
  }
}

/* ─── Períodos ──────────────────────────────────────────────────────────────── */

export type ConsumptionPeriodKey = "30d" | "60d" | "90d" | "6m" | "12m";

export interface ConsumptionPeriod {
  key: ConsumptionPeriodKey;
  label: string;
  /** Quantidade de meses cobertos — base do consumo médio mensal. */
  months: number;
  /** Duração aproximada em dias (para o cálculo da janela). */
  days: number;
}

export const CONSUMPTION_PERIODS: ConsumptionPeriod[] = [
  { key: "30d", label: "Últimos 30 dias", months: 1, days: 30 },
  { key: "60d", label: "Últimos 60 dias", months: 2, days: 60 },
  { key: "90d", label: "Últimos 90 dias", months: 3, days: 90 },
  { key: "6m", label: "Últimos 6 meses", months: 6, days: 183 },
  { key: "12m", label: "Últimos 12 meses", months: 12, days: 365 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function getConsumptionPeriod(key: ConsumptionPeriodKey): ConsumptionPeriod {
  return CONSUMPTION_PERIODS.find((p) => p.key === key) ?? CONSUMPTION_PERIODS[0];
}

/** Início da janela do período (inclusive), em milissegundos. */
export function consumptionPeriodStart(period: ConsumptionPeriod, now: number): number {
  return now - period.days * DAY_MS;
}

/* ─── Seleção das saídas do período ─────────────────────────────────────────── */

export function selectConsumptionMovements(
  movements: ConsumableMovement[],
  period: ConsumptionPeriod,
  now: number
): ConsumableMovement[] {
  const start = consumptionPeriodStart(period, now);
  return movements.filter(
    (m) => isConsumptionMovement(m) && m.timestamp >= start && m.timestamp <= now
  );
}

/* ─── Resumo de consumo ─────────────────────────────────────────────────────── */

export const CONSUMPTION_INSUFFICIENT_LABEL = "Sem histórico suficiente";
export const CONSUMPTION_PENDING_LABEL = "Aguardando movimentações";

export interface ConsumptionSummary {
  /** Houve AO MENOS UMA saída real no período? */
  hasHistory: boolean;
  /** Quantidade consumida (soma das saídas). 0 quando não há histórico. */
  quantity: number;
  /** Quantidade de saídas registradas. */
  exitCount: number;
  /** Consumo médio mensal no período (arredondado para 2 casas). */
  monthlyAverage: number;
  /** Timestamp da última saída; null quando não há histórico. */
  lastExitAt: number | null;
  /** Timestamp do primeiro consumo registrado; null quando não há histórico. */
  firstExitAt: number | null;
  periodKey: ConsumptionPeriodKey;
  periodLabel: string;
  /** Rótulo pronto para exibição ("Consumo calculado" ou "Sem histórico…"). */
  statusLabel: string;
  /** Movimentações do período que foram DESCARTADAS e por quê. */
  excludedCount: number;
}

/**
 * Resume o consumo de um conjunto de movimentações em um período.
 *
 * Sem nenhuma saída real, devolve `hasHistory: false` e rótulo
 * "Sem histórico suficiente" — NUNCA um "0" que finja um cálculo feito.
 */
export function summarizeConsumption(
  movements: ConsumableMovement[],
  period: ConsumptionPeriod,
  now: number
): ConsumptionSummary {
  const inPeriod = movements.filter((m) => m.timestamp >= consumptionPeriodStart(period, now) && m.timestamp <= now);
  const consumptions = inPeriod.filter(isConsumptionMovement);
  const excludedCount = inPeriod.length - consumptions.length;

  const hasHistory = consumptions.length > 0;
  const quantity = consumptions.reduce((sum, m) => sum + Math.max(m.quantity, 0), 0);
  const timestamps = consumptions.map((m) => m.timestamp);

  return {
    hasHistory,
    quantity,
    exitCount: consumptions.length,
    monthlyAverage: hasHistory ? round2(quantity / period.months) : 0,
    lastExitAt: hasHistory ? Math.max(...timestamps) : null,
    firstExitAt: hasHistory ? Math.min(...timestamps) : null,
    periodKey: period.key,
    periodLabel: period.label,
    statusLabel: hasHistory ? "Consumo calculado" : CONSUMPTION_INSUFFICIENT_LABEL,
    excludedCount,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Consumo de UM produto (movimentações já filtradas ou não — o filtro é interno). */
export function summarizeProductConsumption(
  productId: string,
  movements: ConsumableMovement[],
  period: ConsumptionPeriod,
  now: number
): ConsumptionSummary & { productId: string } {
  return { productId, ...summarizeConsumption(movements.filter((m) => m.productId === productId), period, now) };
}

/** Série mensal de consumo (para tendência futura) — apenas meses com saída real. */
export interface MonthlyConsumptionPoint {
  /** "AAAA-MM" */
  month: string;
  quantity: number;
  exitCount: number;
}

export function monthlyConsumptionSeries(
  movements: ConsumableMovement[],
  now: number,
  months: number
): MonthlyConsumptionPoint[] {
  const buckets = new Map<string, { quantity: number; exitCount: number }>();
  for (let i = 0; i < months; i++) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    buckets.set(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, {
      quantity: 0,
      exitCount: 0,
    });
  }
  for (const m of movements) {
    if (!isConsumptionMovement(m) || m.timestamp > now) continue;
    const date = new Date(m.timestamp);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.quantity += Math.max(m.quantity, 0);
    bucket.exitCount += 1;
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, ...value }));
}
