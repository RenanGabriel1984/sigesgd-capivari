/**
 * Gestão de Estoque SGGD — UNIDADE DE ESTOQUE × EMBALAGEM (fiscal × operacional).
 *
 * ─── O PROBLEMA ─────────────────────────────────────────────────────────────
 * NF-e 372043, item "BOBINA TERMICA BRANCA 80X40 CAIXA C 30 UNID":
 *
 *   quantidade fiscal ............ 90
 *   estoque operacional ......... 180 (90 da carga inicial + 90 da NF)
 *
 * A descrição contém "CAIXA C 30 UNID", mas isso é TEXTO FISCAL, não uma regra
 * de conversión. Aplicar 90 × 30 = 2.700 reescreveria o histórico do estoque.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────────
 *   1. A quantidade FISCAL da NF é preservada exatamente como foi informada.
 *   2. A quantidade OPERACIONAL do estoque é independente da fiscal.
 *   3. Conversão entre as duas só existe com CONFIGURAÇÃO EXPLÍCITA do produto
 *      (baseUnit / packagingUnit / conversionFactor — os três campos juntos).
 *   4. Nenhuma descrição ("CAIXA C 30 UNID", "PACOTE C 100", "CAIXA C 50"…)
 *      é interpretada como fator, em nenhuma hipótese.
 *
 * Este módulo é PURO: não grava, não cria movimentação, não altera saldo,
 * lote, entrada ou histórico. Ele apenas prepara a estrutura de embalagem.
 */
import {
  readPackagingConversion,
  type PackagingConfig,
  type PackagingConversion,
} from "@/lib/print-supplies";

export type { PackagingConfig, PackagingConversion };

/** Rótulos que separam, na interface, o que é fiscal do que é operacional. */
export const FISCAL_QUANTITY_LABEL = "Quantidade fiscal";
export const OPERATIONAL_QUANTITY_LABEL = "Quantidade operacional de estoque";

/** Aviso exibido quando não há conversão configurada (fiscal = operacional). */
export const NO_PACKAGING_CONVERSION_NOTE =
  "Embalagem não configurada: a quantidade fiscal permanece igual à quantidade operacional de estoque.";

/** Aviso exibido quando há conversão configurada (aplica-se só a novas leituras). */
export const CONFIGURED_PACKAGING_NOTE =
  "Conversão configurada: aplica-se somente a novas leituras — o estoque já existente não é convertido retroativamente.";

/** Nomes de embalagem que NUNCA viram fator automaticamente. */
export const UNSAFE_DESCRIPTION_PACKING_PATTERNS = [
  "caixa c",
  "caixa com",
  "pacote c",
  "cx c",
  "unid por caixa",
  "un por caixa",
  "unidades por caixa",
] as const;

/**
 * PROVA de que a conversão vem de configuração explícita — e NUNCA do texto.
 *
 * Uma descrição de NF é evidência FISCAL. Esta função é deliberadamente
 * fechada: devolve sempre `null`, existe para tornar impossível (e testável)
 * qualquer tentativa de extrair "30" de "CAIXA C 30 UNID".
 */
export function readDescriptionPackagingHint(
  _description?: string | null
): PackagingConversion | null {
  void _description;
  return null;
}

/** A descrição menciona alguma embalagem? (apenas para EXIBIÇÃO de aviso) */
export function mentionsPackaging(description?: string | null): boolean {
  const text = (description ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!text.trim()) return false;
  return UNSAFE_DESCRIPTION_PACKING_PATTERNS.some((pattern) => text.includes(pattern));
}

export interface FiscalQuantityInput {
  /** Quantidade como consta no documento fiscal (NUNCA é reescrita). */
  fiscalQuantity: number;
  /** Unidade fiscal declarada no documento (ex.: "UN", "CX"). */
  fiscalUnit?: string | null;
  /** Conversão EXPLICITA do produto; null ⇒ sem conversão. */
  packaging?: PackagingConfig | null;
  /** Unidade operacional do produto (ex.: "bobina", "rolo"). */
  operationalUnit?: string | null;
}

export interface FiscalQuantityView {
  fiscalQuantity: number;
  fiscalUnit: string;
  baseQuantity: number;
  baseUnit: string;
  packaging: PackagingConversion | null;
  /** Fator realmente aplicado: 1 quando não há conversão configurada. */
  appliedFactor: number;
  note: string;
}

/**
 * Leitura de apoio (NÃO grava nada): mostra a quantidade fiscal e, quando —
 * e somente quando — a conversão está configurada, a equivalente operacional.
 *
 * Sem configuração explícita, `baseQuantity === fiscalQuantity`: a descrição
 * do documento jamais altera o número.
 */
export function buildFiscalQuantityView(input: FiscalQuantityInput): FiscalQuantityView {
  const packaging = readPackagingConversion(input.packaging ?? {});
  const factor = packaging?.factor ?? 1;
  return {
    fiscalQuantity: input.fiscalQuantity,
    fiscalUnit: (input.fiscalUnit ?? "").trim() || (packaging?.packagingUnit ?? "UN"),
    baseQuantity: input.fiscalQuantity * factor,
    baseUnit: (input.operationalUnit ?? "").trim() || packaging?.baseUnit || "un",
    packaging,
    appliedFactor: factor,
    note: packaging ? CONFIGURED_PACKAGING_NOTE : NO_PACKAGING_CONVERSION_NOTE,
  };
}

/* ─── Estrutura de embalagem (preparação; NUNCA aplica) ─────────────────────── */

export interface PackagingReadiness {
  /** A conversão desejada já está configurada no produto? */
  alreadyConfigured: boolean;
  /** Conversão vigente (null quando o produto não tem embalagem configurada). */
  current: PackagingConversion | null;
  /** Conversão desejada, já validada. */
  desired: PackagingConversion | null;
  /** O que ainda falta configurar (vazio = pronto). */
  gaps: string[];
  /** Campos que seriam gravados em `products` — nada além disso. */
  productFields: { baseUnit?: string; packagingUnit?: string; conversionFactor?: number } | null;
  /** Invariantes do roteiro: prepared ⇒ nenhum dado físico é tocado. */
  touchesStock: false;
  createsMovement: false;
  convertsExistingStock: false;
}

export interface PackagingReadinessInput {
  /** Configuração atual do produto (products.baseUnit/packagingUnit/...). */
  current?: PackagingConfig | null;
  desired?: {
    baseUnit?: string | null;
    packagingUnit?: string | null;
    conversionFactor?: number | null;
  } | null;
}

/**
 * Verifica se a estrutura de embalagem desejada está pronta — SEM GRAVAR.
 *
 * Para "Bobina térmica branca 80x40" o alvo é:
 *   unidade-base "bobina" · unidade de embalagem "caixa" · fator 30
 *
 * Enquanto o produto não tiver os três campos, `alreadyConfigured` é false e
 * `gaps` lista o que falta. Nenhum saldo, lote, movimentação ou histórico é
 * tocado — nem por este cálculo, nem pela futura gravação da configuração.
 */
export function packagingReadiness(input: PackagingReadinessInput): PackagingReadiness {
  const current = readPackagingConversion(input.current ?? {});
  const desired = readPackagingConversion(input.desired ?? {});
  const gaps: string[] = [];

  if (input.desired) {
    const d = input.desired;
    if (!d.baseUnit?.trim()) gaps.push('Unidade-base ausente (ex.: "bobina").');
    if (!d.packagingUnit?.trim()) gaps.push('Unidade de embalagem ausente (ex.: "caixa").');
    if (d.conversionFactor == null) gaps.push("Fator de conversão ausente.");
    else if (!Number.isFinite(d.conversionFactor) || d.conversionFactor <= 0) {
      gaps.push("Fator de conversão deve ser maior que zero.");
    } else if (!Number.isInteger(d.conversionFactor)) {
      gaps.push("Fator de conversão deve ser inteiro positivo.");
    }
    if (
      d.baseUnit?.trim() &&
      d.packagingUnit?.trim() &&
      d.baseUnit.trim().toLowerCase() === d.packagingUnit.trim().toLowerCase()
    ) {
      gaps.push("Unidade-base e unidade de embalagem devem ser distintas.");
    }
    // Nenhuma lacuna e ainda sem conversão válida ⇒ configuração rejeitada.
    if (gaps.length === 0 && !desired) {
      gaps.push("Configuração de embalagem inválida ou incompleta.");
    }
  }

  const alreadyConfigured = Boolean(desired && current && current.factor === desired.factor && current.baseUnit === desired.baseUnit && current.packagingUnit === desired.packagingUnit);

  return {
    alreadyConfigured,
    current,
    desired,
    gaps,
    productFields: alreadyConfigured || !desired
      ? null
      : {
          baseUnit: desired.baseUnit,
          packagingUnit: desired.packagingUnit,
          conversionFactor: desired.factor,
        },
    touchesStock: false,
    createsMovement: false,
    convertsExistingStock: false,
  };
}

/** Texto do alvo de embalagem para exibição (sem aplicar nada). */
export function describePackagingTarget(c: PackagingConversion | null): string {
  if (!c) return "Sem conversão de embalagem configurada";
  return `1 ${c.packagingUnit} = ${c.factor} ${c.baseUnit}`;
}
