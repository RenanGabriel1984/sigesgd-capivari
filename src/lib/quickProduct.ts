/**
 * Cadastro rápido de produto a partir da conferência da NF-e (R31 §1).
 *
 * Funções PURAS, extraídas da tela de Entradas para permitir validação
 * automatizada sem infraestrutura de teste de interação React:
 *
 *  • quickProductPrefill       → pré-preenchimento a partir do item da NF-e;
 *  • validateQuickProductForm  → validação de nome/categoria (obrigatórios);
 *  • associateQuickProduct     → associa o produto novo À LINHA que originou
 *                                o cadastro, preservando todos os demais campos;
 *  • shouldUpsertNfeAlias      → gating: alias só com fornecedor identificado.
 *
 * NENHUMA destas funções cria entrada, movimentação, lote ou saldo de estoque.
 * O estoque só muda quando o usuário confirma a entrada pelo fluxo existente
 * (entries.create + entries.confirm).
 */
import {
  extractNfeProductHints,
  mapNfeUnit,
  type NfeItem,
  type ProductAssociationType,
  type ProductMatchSource,
  type ProductMatchStatus,
} from "@/lib/nfe";

export type QuickProductFormState = {
  name: string;
  description: string;
  categoryId: string;
  unitOfMeasure: string;
  brand: string;
  model: string;
  specification: string;
};

export const emptyQuickProductForm = (): QuickProductFormState => ({
  name: "",
  description: "",
  categoryId: "",
  unitOfMeasure: "un",
  brand: "",
  model: "",
  specification: "",
});

/**
 * Pré-preenche o formulário a partir do item da NF-e selecionado:
 *  • nome e descrição recebem a descrição fiscal LIMPA (sem NCM/CST);
 *  • unidade usa o mapeamento já existente (mapNfeUnit — PC → pc);
 *  • marca/modelo só quando há evidência no documento (extractNfeProductHints).
 */
export function quickProductPrefill(item: NfeItem): QuickProductFormState {
  const hints = extractNfeProductHints(item);
  const description = (item.description ?? "").trim();
  // "outro" (unidade desconhecida) não existe no seletor — cai no padrão "un".
  const unitOfMeasure = hints.unitOfMeasure !== "outro" ? hints.unitOfMeasure : "un";
  return {
    name: description,
    description,
    categoryId: "",
    unitOfMeasure,
    brand: hints.brand ?? "",
    model: hints.model ?? "",
    specification: "",
  };
}

export type QuickProductValidation =
  | { ok: true; name: string; description: string; categoryId: string }
  | { ok: false; error: string };

/** Nome e categoria são obrigatórios (mesma regra do cadastro em Produtos). */
export function validateQuickProductForm(
  form: QuickProductFormState,
): QuickProductValidation {
  const name = form.name.trim();
  if (!name) {
    return { ok: false, error: "Informe o nome do produto." };
  }
  if (!form.categoryId) {
    return { ok: false, error: "Selecione ou crie uma categoria para o produto." };
  }
  return {
    ok: true,
    name,
    description: form.description.trim(),
    categoryId: form.categoryId,
  };
}

export type QuickProductAssociableRow = {
  item: NfeItem;
  productId: string;
  matchStatus: ProductMatchStatus;
  matchScore: number;
  matchSource?: ProductMatchSource;
  matchReason?: string;
  associationType: ProductAssociationType;
  locationId?: string;
  supplierLot?: string;
};

/**
 * Associa o produto recém-criado APENAS à linha que originou o cadastro.
 * Todos os demais campos da linha (código do fornecedor, descrição, NCM,
 * CST, unidade, quantidade, valores, local, lote) são preservados por
 * spread — e nenhuma outra linha é tocada.
 *
 * `associationType: "created"` protege a linha de ser sobrescrita pelo
 * rematch automático (ver reconcileNfeReviewMatches em "@/lib/nfe").
 */
export function associateQuickProduct<
  T extends QuickProductAssociableRow,
>(rows: T[], itemIndex: number, productId: string): T[] {
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= rows.length) {
    return rows;
  }
  return rows.map((row, position) =>
    position === itemIndex
      ? {
          ...row,
          productId,
          matchStatus: "found" as const,
          matchScore: 100,
          matchSource: "new_product" as const,
          associationType: "created" as const,
        }
      : row,
  );
}

/**
 * Snapshot das linhas no momento da abertura do formulário. Cancelar
 * restaura exatamente este estado — nenhuma linha é alterada como efeito
 * colateral de abrir/fechar o cadastro rápido (R31.3 §1).
 */
export function snapshotReviewRows<T>(rows: readonly T[]): T[] {
  return [...rows];
}

/**
 * Alias (memória de correspondência fornecedor/código → produto) só é
 * memorizado quando há FORNECEDOR IDENTIFICADO e descrição utilizável.
 * A ausência de alias nunca impede a associação da linha atual.
 */
export function shouldUpsertNfeAlias(
  row: { item: NfeItem } | undefined,
  supplierId: string | null | undefined,
): boolean {
  if (!row || !supplierId) return false;
  return Boolean((row.item.description ?? "").trim());
}
