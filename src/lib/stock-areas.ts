/**
 * Gestão de Estoque SGGD — ÁREAS / SUBESTOQUES (conceito independente).
 *
 * Dimensões que NÃO se misturam:
 *   PRODUTO · CATEGORIA · FORNECEDOR · ÁREA/SUBESTOQUE · LOCAL FÍSICO · LOTE
 *
 * Exemplo:
 *   Produto:    Toner AltaLink — Ciano
 *   Categoria:  Suprimentos de Impressão
 *   Fornecedor: (o da NF-e daquela entrada)   ← cadastral/histórico
 *   Área:       Impressoras                   ← ESCOLHA/REGRA DE DESTINO
 *   Local:      Armário de suprimentos / Prateleira 2
 *   Lote:       NF 372043
 *
 * REGRAS DESTE MÓDULO:
 *  1. O fornecedor NUNCA determina automaticamente a área — e o nome da área
 *     NUNCA contém fornecedor. Uma nova licitação troca a empresa contratada
 *     sem alterar a estrutura nem o histórico das entradas antigas.
 *  2. A categoria NÃO define sozinha o subestoque — ela apenas classifica o
 *     produto; poderá gerar uma SUGESTÃO futura, sempre confirmável.
 *  3. O MESMO produto pode existir em áreas diferentes ao mesmo tempo.
 *  4. A área é uma divisão OPERACIONAL do estoque; o local físico é onde o
 *     material está guardado. Uma mesma área pode ter vários locais físicos.
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

/** Área/subestoque de referência: estoque geral da Secretaria. */
export const AREA_TI_GERAL = "TI Geral";

/** Área/subestoque de referência: suprimentos e materiais de impressão. */
export const AREA_IMPRESSORAS = "Impressoras";

/**
 * Áreas de referência da estrutura oficial.
 *
 * São apenas DESTINOS de estoque: não carregam fornecedor, categoria nem
 * localização física. Ampliações futuras seguem o mesmo modelo.
 */
export const BASELINE_STOCK_AREAS: Array<{ name: string; description: string }> = [
  {
    name: AREA_TI_GERAL,
    description: "Estoque geral de TI da Secretaria (referência inicial da estrutura).",
  },
  {
    name: AREA_IMPRESSORAS,
    description:
      "Suprimentos e materiais de impressão. A área não pertence a nenhum fornecedor: o fornecedor de cada entrada permanece no histórico.",
  },
];
