/**
 * SIGESGD — ÁREAS / SUBESTOQUES (conceito independente).
 *
 * Dimensões que NÃO se misturam:
 *   PRODUTO · CATEGORIA · FORNECEDOR · ÁREA/SUBESTOQUE · LOCAL FÍSICO · LOTE
 *
 * Exemplo:
 *   Produto:   Toner CX735 Preto
 *   Categoria: Suprimentos de Impressão
 *   Fornecedor: Gomaq
 *   Área:      Impressoras / Gomaq      ← ESCOLHA/REGRA DE DESTINO do usuário
 *   Local:     Armário TI 02
 *   Lote:      NF 372043
 *
 * REGRAS DESTA MÓDULO:
 *  1. O fornecedor NUNCA determina automaticamente a área
 *     (outro fornecedor pode fornecer exatamente o mesmo produto).
 *  2. A categoria NÃO define sozinha o subestoque — ela apenas classifica
 *     o produto; poderá gerar uma SUGESTÃO futura, sempre confirmável.
 *  3. O MESMO produto pode existir em áreas diferentes ao mesmo tempo.
 */

export interface AreaChoiceInput {
  /** Área escolhida pelo usuário na entrada/NF-e (null = sem área) */
  userSelectedAreaId?: string | null;
  /**
   * Contexto complementar — usado apenas para sugestões futuras,
   * NUNCA para determinar a área automaticamente.
   */
  supplierId?: string | null;
  categoryId?: string | null;
}

/**
 * Resolve a área/subestoque de destino de uma entrada.
 *
 * A área é EXCLUSIVAMENTE a escolha do usuário. Fornecedor e categoria
 * entram apenas como contexto (para uma futura sugestão confirmável) e
 * nunca sobrescrevem a decisão.
 */
export function resolveStockAreaChoice(input: AreaChoiceInput): string | null {
  return input.userSelectedAreaId ? input.userSelectedAreaId : null;
}

/**
 * Sugestão FUTURA de área pela categoria — meramente informativa.
 * O usuário sempre pode confirmar ou alterar (resolveStockAreaChoice
 * continua sendo a fonte da verdade).
 *
 * Hoje não há regras cadastradas; retorna null.
 */
export function suggestAreaByCategory(
  _categoryId?: string | null
): string | null {
  return null;
}

/** Rótulo de exibição quando a entrada não possui área definida. */
export const NO_AREA_LABEL = "Sem área (estoque geral)";

/** Exemplo canônico usado em documentação/testes. */
export const IMPRESSORAS_GOMAQ_AREA = "Impressoras / Gomaq";
