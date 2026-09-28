/**
 * Gestão de Estoque SGGD — APRESENTAÇÃO de SALDO na tela de Produtos.
 *
 * Módulo PURO (sem React e sem runtime Convex).
 *
 * ─── O PROBLEMA ───────────────────────────────────────────────────────────────
 *
 * A tela de Produtos agrupava SEIS números em uma única grade `grid-cols-3`:
 *
 *     linha 1:  Atual   | Reservado | Disponível
 *     linha 2:  Mínimo  | Ideal     | Máximo
 *
 * Como "Reservado" era exibido como "0" (e não como "—"), o resultado em telas
 * estreitas era ambíguo: a fileira de zeros de "Mínimo / Ideal / Máximo" podia
 * ser lida como se o estoque estivesse zerado e reservado.
 *
 * Nenhuma reserva existia: `reservedQuantity = 0` em 57/57 produtos, e a
 * solicitação existente havia sido cancelada com a reserva liberada. O
 * problema era de LEITURA, não de dado.
 *
 * ─── A REGRA ──────────────────────────────────────────────────────────────────
 *
 * • "Reservado" é uma coluna OPCIONAL: zero nela significa "não há reserva",
 *   não "o saldo reservado é zero". Exibir "—" remove a ambiguidade.
 * • "Atual" e "Disponível" são saldos REAIS e continuam exibindo "0" quando
 *   o estoque é realmente zero — ocultá-los esconderia informação importante.
 * • Nenhuma lógica de estoque é alterada. Isto formata valores já calculados.
 */

/** Rótulo usado quando um valor numérico não se aplica. */
export const EMPTY_VALUE_LABEL = "—";

/** Opções de apresentação de uma quantidade de estoque. */
export interface FormatStockQuantityOptions {
  /**
   * Quando `true`, o valor zero é apresentado como "—" em vez de "0".
   * Use apenas em colunas OPCIONAIS (ex.: Reservado), nunca em saldos reais.
   */
  zeroAsEmpty?: boolean;
}

/**
 * Formata uma quantidade de estoque para exibição.
 *
 *   formatStockQuantity(0)                          → "0"   (saldo real)
 *   formatStockQuantity(0, { zeroAsEmpty: true })   → "—"
 *   formatStockQuantity(15)                         → "15"
 */
export function formatStockQuantity(
  value: number,
  options: FormatStockQuantityOptions = {},
): string {
  const { zeroAsEmpty = false } = options;
  if (!Number.isFinite(value)) return EMPTY_VALUE_LABEL;
  if (zeroAsEmpty && value === 0) return EMPTY_VALUE_LABEL;
  return String(value);
}

/**
 * Calcula o saldo disponível: físico menos reservado.
 *
 * Extraído para que a conta usada na UI seja explícita e testável, e para
 * que nenhum outro valor seja exibido no lugar de "Disponível".
 */
export function computeAvailableStock(physical: number, reserved: number): number {
  return physical - reserved;
}

/** Saldo de um produto, a partir do registro de estoque (`stock`). */
export function stockSummary(stock?: {
  physicalQuantity: number;
  reservedQuantity: number;
} | null): { physical: number; reserved: number; available: number } {
  const physical = stock?.physicalQuantity ?? 0;
  const reserved = stock?.reservedQuantity ?? 0;
  return { physical, reserved, available: computeAvailableStock(physical, reserved) };
}
