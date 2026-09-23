/**
 * SIGESGD — Regras puras de CLASSIFICAÇÃO DE MATERIAL (entrada/lote).
 *
 *   Material de CONSUMO   → toner, ribbon, cabo, conector, fita isolante,
 *                           pasta térmica... NÃO exige patrimônio.
 *   Material PERMANENTE   → computador, notebook, monitor, switch,
 *                           routerboard... exige unidade patrimonial.
 *
 * Estrutura:
 *   Produto → Unidade patrimonial → Patrimônio / Serial
 *
 * O mesmo produto pode ter VÁRIAS unidades com patrimônios diferentes —
 * o patrimônio NUNCA fica no cadastro do produto.
 */

export const MATERIAL_TYPE_VALUES = ["consumption", "permanent"] as const;
export type MaterialType = (typeof MATERIAL_TYPE_VALUES)[number];

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  consumption: "Material de consumo",
  permanent: "Material permanente",
};

export function isPermanent(materialType?: MaterialType | null): boolean {
  return materialType === "permanent";
}

export interface PatrimonyUnitDraft {
  patrimonyNumber?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  locationId?: string;
  responsibleDestiny?: string;
  observation?: string;
}

/**
 * Valida as unidades patrimoniais de um item de entrada.
 * Retorna `null` quando válido ou uma mensagem de erro (pt-BR).
 *
 * Regras:
 *  - Material de consumo: NÃO exige patrimônio e NÃO aceita unidades
 *    patrimoniais registradas.
 *  - Material permanente: exige EXATAMENTE uma unidade por quantidade
 *    recebida, e cada unidade precisa de número de patrimônio
 *    (ou, no mínimo, número de série quando o patrimônio for atribuído
 *    posteriormente — aqui exigimos patrimônio).
 */
export function validateEntryUnits(input: {
  materialType?: MaterialType | null;
  quantity: number;
  units: PatrimonyUnitDraft[];
  productName?: string;
}): string | null {
  const label = input.productName ? ` (${input.productName})` : "";
  const units = input.units ?? [];

  if (!isPermanent(input.materialType)) {
    if (units.length > 0) {
      return (
        `Material de consumo não possui unidades patrimoniais${label}. ` +
        `Classifique a entrada como "Material permanente" para registrar patrimônios.`
      );
    }
    return null;
  }

  if (units.length !== input.quantity) {
    return (
      `Material permanente${label}: informe uma unidade patrimonial por unidade recebida. ` +
      `Recebido: ${input.quantity}, unidades registradas: ${units.length}.`
    );
  }

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const hasPatrimony = !!(u.patrimonyNumber && u.patrimonyNumber.trim());
    if (!hasPatrimony) {
      return (
        `Material permanente${label}: a unidade ${i + 1} precisa do número de patrimônio.`
      );
    }
  }
  return null;
}

/**
 * Título da seção de unidades patrimoniais (para UI).
 */
export function unitsSectionLabel(quantity: number): string {
  return `Unidades patrimoniais (${quantity})`;
}
