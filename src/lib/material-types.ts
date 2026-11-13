/**
 * Gestão de Estoque SGGD — Regras puras de CLASSIFICAÇÃO DE MATERIAL (entrada/lote).
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

export const PATRIMONY_STATUS_VALUES = [
  "in_stock", "in_use", "maintenance", "idle", "transferred",
  "disposal_pending", "unserviceable", "disposed",
] as const;
export type PatrimonyStatus = (typeof PATRIMONY_STATUS_VALUES)[number];
export const PATRIMONY_STATUS_LABELS: Record<PatrimonyStatus, string> = {
  in_stock: "Em estoque",
  in_use: "Em uso",
  maintenance: "Em manutenção",
  idle: "Ocioso",
  transferred: "Transferido",
  disposal_pending: "Em processo de baixa",
  unserviceable: "Inservível",
  disposed: "Baixado",
};

export interface PatrimonyUnitDraft {
  patrimonyNumber?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  acquisitionDate?: string;
  incorporationDate?: string;
  acquisitionValue?: string;
  accountingValue?: string;
  residualValue?: string;
  accumulatedDepreciation?: string;
  netBookValue?: string;
  locationId?: string;
  secretariaId?: string;
  departamentoId?: string;
  unidadeId?: string;
  responsibleDestiny?: string;
  patrimonyStatus?: PatrimonyStatus;
  observation?: string;
}

/**
 * Valida as unidades patrimoniais de um item de entrada.
 * Retorna `null` quando válido ou uma mensagem de erro (pt-BR).
 *
 * Regras:
 *  - Material de consumo: NÃO exige patrimônio e NÃO aceita unidades
 *    patrimoniais registradas.
 *  - Material permanente: exige EXATAMENTE uma unidade de identificação por
 *    quantidade recebida. O número oficial do patrimônio é atribuído
 *    posteriormente pelo setor de Patrimônio e não bloqueia o recebimento.
 */
export function validateEntryUnits(input: {
  materialType?: MaterialType | null;
  quantity: number;
  units: PatrimonyUnitDraft[];
  productName?: string;
  requireSerial?: boolean;
}): string | null {
  const label = input.productName ? ` (${input.productName})` : "";
  const units = input.units ?? [];

  if (!isPermanent(input.materialType)) {
    if (units.length > 0) {
      return (
        `Material de consumo não possui unidades patrimoniais${label}. ` +
        `Classifique a entrada como "Material permanente" para registrar as unidades.`
      );
    }
    return null;
  }

  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    return `Material permanente${label}: a quantidade recebida deve ser um número inteiro positivo.`;
  }

  if (units.length !== input.quantity) {
    return (
      `Material permanente${label}: informe uma identificação provisória por unidade recebida. ` +
      `Recebido: ${input.quantity}, unidades registradas: ${units.length}.`
    );
  }

  if (input.requireSerial) {
    for (let index = 0; index < units.length; index++) {
      if (!units[index].serialNumber?.trim()) {
        return `Material permanente${label}: a unidade ${index + 1} exige número de série no recebimento.`;
      }
    }
  }

  // O número oficial de patrimônio é atribuído pelo setor de Patrimônio após
  // o recebimento. Quando o produto exige série, ela é registrada no ato.
  return null;
}

/**
 * Título da seção de unidades patrimoniais (para UI).
 */
export function unitsSectionLabel(quantity: number): string {
  return `Unidades patrimoniais (${quantity})`;
}
