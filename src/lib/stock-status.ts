/**
 * SIGESGD — Situação de Estoque
 *
 * Classificador único da situação operacional de cada produto, usado nas telas
 * de Produtos, Estoque e Detalhe do Produto.
 *
 * As cores são SEMÂNTICAS (independentes da identidade institucional):
 *   - vermelho  → estoque zerado (CRÍTICO)
 *   - âmbar     → abaixo do mínimo
 *   - azul      → normal
 *   - verde     → no nível ideal
 *   - violeta   → acima do ideal
 */

export type StockSituationKey =
  | "critical"
  | "below_min"
  | "normal"
  | "ideal"
  | "above_ideal";

export const STOCK_SITUATION_LABELS: Record<StockSituationKey, string> = {
  critical: "CRÍTICO",
  below_min: "ABAIXO DO MÍNIMO",
  normal: "NORMAL",
  ideal: "ESTOQUE IDEAL",
  above_ideal: "ACIMA DO IDEAL",
};

export const STOCK_SITUATION_BADGE_CLASSES: Record<StockSituationKey, string> = {
  critical: "border-rose-200 bg-rose-50 text-rose-700",
  below_min: "border-amber-200 bg-amber-50 text-amber-700",
  normal: "border-sky-200 bg-sky-50 text-sky-700",
  ideal: "border-emerald-200 bg-emerald-50 text-emerald-700",
  above_ideal: "border-violet-200 bg-violet-50 text-violet-700",
};

/**
 * Classifica a situação do estoque a partir do saldo físico e dos níveis
 * mínimo/ideal configurados no produto.
 *
 * Regras:
 *  - 0 unidades                          → CRÍTICO
 *  - 0 < estoque < mínimo                → ABAIXO DO MÍNIMO
 *  - mínimo <= estoque < ideal           → NORMAL
 *  - estoque === ideal (> 0)             → ESTOQUE IDEAL
 *  - estoque > ideal                     → ACIMA DO IDEAL
 *  - níveis não configurados (mín=0 e ideal=0) com estoque > 0 → NORMAL
 */
export function getStockSituation(
  physical: number,
  minimumStock: number,
  idealStock: number
): StockSituationKey {
  if (physical <= 0) return "critical";
  if (minimumStock > 0 && physical < minimumStock) return "below_min";
  if (idealStock > 0 && physical === idealStock) return "ideal";
  if (idealStock > 0 && physical > idealStock) return "above_ideal";
  return "normal";
}