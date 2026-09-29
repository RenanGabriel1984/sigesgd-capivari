/**
 * Gestão de Estoque SGGD — SUPRIMENTOS DE IMPRESSÃO (regras puras).
 *
 * Recorte operacional do estoque REAL pela Área/Subestoque "Impressoras".
 * Não cria segundo estoque: toda quantidade vem de `stock`/`lots`/`stockMovements`
 * existentes. A área é apenas uma LENTE de consulta.
 *
 * Tipos (Toner/Cartão/Ribbon/Papel/Etiqueta/Outros) são DERIVADOS do nome/categoria
 * — nenhum enum novo no banco, nenhum produto fictício, nenhum auto-fill.
 */

/* ─── Área operacional ──────────────────────────────────────────────────────── */

export const PRINT_AREA_NAME = "Impressoras";

/** Classificação de um suprimento, derivada do nome do produto. */
export type SupplyType = "Toner" | "Cartão" | "Ribbon" | "Papel" | "Etiqueta" | "Outros";

/**
 * Deriva o tipo do suprimento a partir do nome do produto (sem enum no banco).
 * "Toner MFC-L6902DW — Preto 20K" → "Toner"; "Cartão PVC…" → "Cartão"; etc.
 */
export function classifySupplyType(productName: string): SupplyType {
  const n = productName.toLowerCase();
  if (n.includes("toner")) return "Toner";
  if (n.includes("cartão") || n.includes("cartao")) return "Cartão";
  if (n.includes("ribbon")) return "Ribbon";
  if (n.includes("etiqueta")) return "Etiqueta";
  if (n.includes("papel")) return "Papel";
  return "Outros";
}

/** Cor extraída do nome (para toners: "Toner CX735 — Ciano" → "Ciano"). */
export function extractColor(productName: string): string | null {
  const colors = ["Preto", "Ciano", "Magenta", "Amarelo"];
  for (const c of colors) if (productName.includes(c)) return c;
  return null;
}

/** Rótulo de toner destacando modelo + cor: "AltaLink — Preto". */
export function tonerDisplayLabel(productName: string): string {
  const color = extractColor(productName);
  if (!color) return productName;
  const model = productName
    .replace(/toner/gi, "")
    .replace(new RegExp(`[—\\-–]*\\s*${color}.*$`, "i"), "")
    .replace(/\(xerox\)/gi, "")
    .trim();
  return `${model || productName} — ${color}`;
}

/* ─── Status de estoque ─────────────────────────────────────────────────────── */

export type StockStatus = "Normal" | "Baixo" | "Crítico";

/**
 * Normal > mínimo · Baixo <= mínimo (e > 0) · Crítico = 0.
 * Sem mínimo configurado → "Normal" (parâmetros indefinidos não geram alerta).
 */
export function stockStatus(current: number, minimum: number | null | undefined): StockStatus {
  if (current <= 0) return "Crítico";
  if (minimum != null && minimum > 0 && current <= minimum) return "Baixo";
  return "Normal";
}

export const STOCK_STATUS_STYLES: Record<StockStatus, { className: string }> = {
  Normal: { className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  Baixo: { className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  "Crítico": { className: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
};

/* ─── Linha do painel (derivada do estoque real) ───────────────────────────── */

export interface SupplyRowInput {
  productId: string;
  productName: string;
  brand: string | null | undefined;
  model: string | null | undefined;
  unitOfMeasure: string;
  currentStock: number;
  minimumStock: number | null | undefined;
  idealStock: number | null | undefined;
  /** Quantidade do produto que está FISICAMENTE na área Impressoras. */
  inArea?: number;
}

export interface SupplyRow extends SupplyRowInput {
  type: SupplyType;
  color: string | null;
  displayLabel: string;
  status: StockStatus;
  /** ideal − atual, somente quando AMBOS configurados; null caso contrário. */
  suggestedReorder: number | null;
  /** Reposição configurável? false → "Parâmetros não definidos". */
  parametersDefined: boolean;
}

export function buildSupplyRow(input: SupplyRowInput): SupplyRow {
  const type = classifySupplyType(input.productName);
  const status = stockStatus(input.currentStock, input.minimumStock);
  const parametersDefined =
    input.minimumStock != null && input.minimumStock > 0 &&
    input.idealStock != null && input.idealStock > 0;
  const suggestedReorder = parametersDefined
    ? Math.max(0, (input.idealStock as number) - input.currentStock)
    : null;
  return {
    ...input,
    type,
    color: extractColor(input.productName),
    displayLabel: type === "Toner" ? tonerDisplayLabel(input.productName) : input.productName,
    status,
    suggestedReorder,
    parametersDefined,
  };
}

/* ─── Totais dos cards (sempre derivados das linhas) ───────────────────────── */

export interface SupplyCardTotals {
  toners: number;
  cartoes: number;
  ribbons: number;
  papeis: number;
  etiquetas: number;
  lowStock: number;
}

export function computeCardTotals(rows: SupplyRow[]): SupplyCardTotals {
  const by = (t: SupplyType) =>
    rows.filter((r) => r.type === t).reduce((s, r) => s + r.currentStock, 0);
  return {
    toners: by("Toner"),
    cartoes: by("Cartão"),
    ribbons: by("Ribbon"),
    papeis: by("Papel"),
    etiquetas: by("Etiqueta"),
    lowStock: rows.filter((r) => r.status !== "Normal").length,
  };
}

/* ─── Consumo mensal (somente saída operacional) ───────────────────────────── */

/**
 * Definição de CONSUMO: `exit` operacional.
 * Transferências internas, devoluções e ajustes NÃO são consumo (a regra
 * rejeita explicitamente os tipos que não representam saída ao usuário).
 */
export function isOperationalConsumption(movementType: string): boolean {
  return movementType === "exit";
}

export interface MovementForConsumption {
  type: string;
  productId: string;
  quantity: number;
  timestamp: number;
  organizationId?: string | null;
}

export interface ConsumptionPeriod {
  /** Início do mês (ms epoch, inclusive). */
  start: number;
  /** Fim do mês (ms epoch, exclusivo). */
  end: number;
}

/** Janela do mês/ano informados (1º dia 00:00 → 1º dia do mês seguinte). */
export function monthWindow(year: number, month1to12: number): ConsumptionPeriod {
  return {
    start: new Date(year, month1to12 - 1, 1).getTime(),
    end: new Date(year, month1to12, 1).getTime(),
  };
}

export interface ProductConsumptionLine {
  productId: string;
  productName: string;
  type: SupplyType;
  brand: string | null;
  unitOfMeasure: string;
  entries: number;
  exits: number;
  currentStock: number;
}

/**
 * Consolida entradas/saídas do período por produto.
 * Somente `entry` e `exit` contam; transfer/adjustment/return são ignorados.
 */
export function computeMonthlyConsumption(
  movements: MovementForConsumption[],
  productMeta: Map<string, { name: string; brand: string | null | undefined; unitOfMeasure: string }>,
  currentStockByProduct: Map<string, number>,
  period: ConsumptionPeriod,
): ProductConsumptionLine[] {
  const acc = new Map<string, { entries: number; exits: number }>();
  for (const m of movements) {
    if (m.timestamp < period.start || m.timestamp >= period.end) continue;
    if (!isOperationalConsumption(m.type) && m.type !== "entry") continue;
    const cur = acc.get(m.productId) ?? { entries: 0, exits: 0 };
    if (m.type === "entry") cur.entries += m.quantity;
    else cur.exits += m.quantity;
    acc.set(m.productId, cur);
  }
  const lines: ProductConsumptionLine[] = [];
  for (const [productId, { entries, exits }] of acc) {
    const meta = productMeta.get(productId);
    if (!meta) continue;
    lines.push({
      productId,
      productName: meta.name,
      type: classifySupplyType(meta.name),
      brand: meta.brand ?? null,
      unitOfMeasure: meta.unitOfMeasure,
      entries,
      exits,
      currentStock: currentStockByProduct.get(productId) ?? 0,
    });
  }
  return lines.sort((a, b) => b.exits - a.exits || a.productName.localeCompare(b.productName));
}

/* ─── Retirada rápida (validações da UI; backend revalida) ─────────────────── */

export interface WithdrawValidation {
  ok: boolean;
  reason?: string;
  balanceAfter?: number;
}

/** Bloqueia quantidade <= 0 e maior que o disponível. */
export function validateWithdrawal(quantity: number, available: number): WithdrawValidation {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: "Quantidade deve ser maior que zero." };
  }
  if (quantity > available) {
    return { ok: false, reason: `Estoque insuficiente. Disponível: ${available}.` };
  }
  return { ok: true, balanceAfter: available - quantity };
}
