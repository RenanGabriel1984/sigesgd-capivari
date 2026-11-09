/**
 * SIGESGD Capivari — D3: EDIÇÃO CONFERIDA DOS ITENS DA NF-e.
 *
 * Módulo PURO com a regra usada pela tabela de conferência
 * (`NfeReviewTable`). Antes desta correção quantidade, unidade e valores eram
 * somente leitura (ou editáveis apenas quando inválidos): um erro do OCR ia
 * direto para o estoque, sem chance de correção.
 *
 * Garantias:
 *  • quantidade e valor unitário sempre editáveis;
 *  • total do item recalculado (quantidade × unitário) enquanto o usuário não
 *    informar o total manualmente;
 *  • divergência entre total informado e matemática do item é EXPLÍCITA e
 *    bloqueia o avanço (nada de confirmar divergência em silêncio);
 *  • quantidade inválida/negativa bloqueia;
 *  • o valor reconhecido pelo OCR é preservado para comparação.
 */
import type { NfeData, NfeItem } from "./nfe";

/** Mesma tolerância monetária usada pelo parser da DANFE. */
export const NFE_ITEM_TOTAL_TOLERANCE = 0.05;

/** Valores como vieram do documento/OCR (para destacar alterações). */
export interface NfeItemOriginalValues {
  quantity: number;
  unit: string;
  unitValue?: number;
  totalValue?: number;
}

export function originalValuesOf(item: NfeItem): NfeItemOriginalValues {
  return {
    quantity: item.quantity,
    unit: item.unit ?? "",
    unitValue: item.unitValue,
    totalValue: item.totalValue,
  };
}

const MONEY_TOLERANCE = NFE_ITEM_TOTAL_TOLERANCE;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Converte texto digitado em número.
 * Aceita o formato brasileiro ("1.323,50"), o formato com ponto decimal
 * ("1323.50") e inteiros ("25"). Devolve `null` quando não há número válido.
 */
export function parseDecimalInput(raw: string): number | null {
  const text = (raw ?? "")
    .replace(/R\$\s*/gi, "")
    .replace(/\s+/g, "")
    .trim();
  if (!text) return null;

  let normalized = text;
  if (text.includes(",")) {
    // Formato brasileiro: ponto é separador de milhar, vírgula é decimal.
    normalized = text.replace(/\./g, "").replace(",", ".");
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Quantidade digitada: precisa ser número finito e maior que zero. */
export function parseQuantityInput(raw: string): number | null {
  const value = parseDecimalInput(raw);
  if (value === null || value <= 0) return null;
  return value;
}

/** Valor monetário digitado: número finito e não negativo. */
export function parseMoneyInput(raw: string): number | null {
  const value = parseDecimalInput(raw);
  if (value === null || value < 0) return null;
  return roundMoney(value);
}

export interface NfeItemRevision {
  quantityChanged: boolean;
  unitChanged: boolean;
  unitValueChanged: boolean;
  totalValueChanged: boolean;
  anyChanged: boolean;
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= 0.0001;
}

/** O que o usuário alterou em relação ao valor reconhecido no documento. */
export function nfeItemRevision(
  item: NfeItem,
  original?: NfeItemOriginalValues | null,
): NfeItemRevision {
  if (!original) {
    return {
      quantityChanged: false,
      unitChanged: false,
      unitValueChanged: false,
      totalValueChanged: false,
      anyChanged: false,
    };
  }
  const quantityChanged = !sameNumber(item.quantity, original.quantity);
  const unitChanged = (item.unit ?? "") !== (original.unit ?? "");
  const unitValueChanged = !sameNumber(item.unitValue, original.unitValue);
  const totalValueChanged = !sameNumber(item.totalValue, original.totalValue);
  return {
    quantityChanged,
    unitChanged,
    unitValueChanged,
    totalValueChanged,
    anyChanged: quantityChanged || unitChanged || unitValueChanged || totalValueChanged,
  };
}

export interface NfeItemTotalMismatch {
  expected: number;
  informed: number;
  difference: number;
}

/**
 * Confere a matemática do item: total informado = quantidade × unitário.
 * Devolve `null` quando não há dados suficientes (não inventa divergência).
 */
export function nfeItemTotalMismatch(item: NfeItem): NfeItemTotalMismatch | null {
  const quantity = Number(item.quantity);
  const unitValue = item.unitValue;
  const totalValue = item.totalValue;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (unitValue == null || !Number.isFinite(unitValue) || unitValue < 0) return null;
  if (totalValue == null || !Number.isFinite(totalValue)) return null;

  const expected = roundMoney(quantity * unitValue);
  const difference = roundMoney(totalValue - expected);
  if (Math.abs(difference) <= MONEY_TOLERANCE) return null;
  return { expected, informed: totalValue, difference };
}

/**
 * Aplica uma edição em quantidade/unitário/total mantendo a consistência:
 *  • alterar quantidade ou unitário RECALCULA o total;
 *  • informar o total explicitamente vale como correção manual do total.
 */
export function reconcileItemTotal(
  item: NfeItem,
  patch: { quantity?: number; unitValue?: number | null; totalValue?: number | null },
): NfeItem {
  const next: NfeItem = { ...item };
  let recalculate = false;

  if (patch.quantity !== undefined) {
    next.quantity = patch.quantity;
    recalculate = true;
  }
  if (patch.unitValue !== undefined) {
    next.unitValue = patch.unitValue ?? undefined;
    recalculate = true;
  }
  if (patch.totalValue !== undefined) {
    next.totalValue = patch.totalValue ?? undefined;
    recalculate = false;
  }

  if (recalculate) {
    const quantity = Number(next.quantity);
    const unitValue = next.unitValue;
    if (
      Number.isFinite(quantity) &&
      quantity > 0 &&
      typeof unitValue === "number" &&
      Number.isFinite(unitValue)
    ) {
      // Só recalcula se o total já existia (documento trazia) ou se o próprio
      // usuário acabou de mexer na quantidade/unitário de um item com total.
      next.totalValue = roundMoney(quantity * unitValue);
    }
  }

  return next;
}

export interface NfeReviewValidationResult {
  ok: boolean;
  /** Índice da primeira linha com problema (-1 quando não há). */
  index: number;
  message: string;
}

/**
 * Validação única antes de avançar/resumir/confirmar:
 *  • quantidade precisa ser número finito e > 0;
 *  • valores não podem ser negativos;
 *  • total do item não pode divergir da quantidade × unitário.
 */
export function validateNfeReviewItems(
  rows: ReadonlyArray<{ item: NfeItem }>,
): NfeReviewValidationResult {
  for (let index = 0; index < rows.length; index++) {
    const item = rows[index].item;
    const label = `Item ${item.lineNumber ?? index + 1} (cód. ${item.code || "—"})`;

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return {
        ok: false,
        index,
        message: `${label}: informe uma quantidade maior que zero antes de continuar.`,
      };
    }
    if (item.unitValue != null && (!Number.isFinite(item.unitValue) || item.unitValue < 0)) {
      return {
        ok: false,
        index,
        message: `${label}: o valor unitário não pode ser negativo.`,
      };
    }
    if (item.totalValue != null && (!Number.isFinite(item.totalValue) || item.totalValue < 0)) {
      return {
        ok: false,
        index,
        message: `${label}: o valor total não pode ser negativo.`,
      };
    }

    const mismatch = nfeItemTotalMismatch(item);
    if (mismatch) {
      return {
        ok: false,
        index,
        message:
          `${label}: o total informado (R$ ${mismatch.informed.toFixed(2)}) não confere com ` +
          `quantidade × valor unitário (R$ ${mismatch.expected.toFixed(2)}). ` +
          "Corrija o valor antes de continuar.",
      };
    }
  }

  return { ok: true, index: -1, message: "" };
}

export interface NfeReviewTotals {
  itemsTotal: number;
  documentTotal?: number;
  difference?: number;
  /** true apenas quando existe total no documento e ele diverge da soma. */
  diverges: boolean;
}

/** Soma dos itens × total do documento (para o aviso da conferência). */
export function nfeReviewTotals(
  rows: ReadonlyArray<{ item: NfeItem }>,
  documentTotal?: number,
): NfeReviewTotals {
  const itemsTotal = roundMoney(
    rows.reduce((total, row) => total + (Number(row.item.totalValue) || 0), 0),
  );
  if (documentTotal == null || !Number.isFinite(documentTotal)) {
    return { itemsTotal, diverges: false };
  }
  const difference = roundMoney(documentTotal - itemsTotal);
  return {
    itemsTotal,
    documentTotal: roundMoney(documentTotal),
    difference,
    diverges: Math.abs(difference) > MONEY_TOLERANCE,
  };
}

/** Formata número para exibição em campo editável (vírgula decimal). */
export function formatDecimalInput(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value).replace(".", ",");
}

/**
 * Devolve a NF-e com os itens REVISADOS da conferência.
 *
 * Sem isso a correção do usuário (quantidade/unidade/valores) ficaria só na
 * tela: `buildEntryDraftFromNfe` lê `nfe.items`, e o rascunho continuaria com
 * os valores do OCR. Nenhum outro campo fiscal é alterado.
 */
export function nfeWithReviewedItems(
  nfe: NfeData,
  rows: ReadonlyArray<{ item: NfeItem }>,
): NfeData {
  return { ...nfe, items: rows.map((row) => row.item) };
}
