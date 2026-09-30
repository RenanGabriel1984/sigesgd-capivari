/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE UNIDADES E EMBALAGENS
 * (/packaging-parameters).
 *
 * ─── O QUE ESTE MÓDULO É ────────────────────────────────────────────────────
 * Uma camada AUXILIAR de apresentação sobre o estoque:
 *
 *   1 caixa = 30 rolos     ← configuração cadastral
 *   estoque = 180 rolos    ← dado FÍSICO, na unidade BASE (jamais convertido)
 *
 * ─── O QUE ESTE MÓDULO NUNCA FAZ ───────────────────────────────────────────
 *  - não altera quantidade em `stock`, `stockByLocation` ou `lots`;
 *  - não cria movimentações, entradas, saídas ou reservas;
 *  - não converte estoque existente (180 vira 6 apenas na PRÉVIA textual);
 *  - não reescreve a quantidade fiscal de NF-e;
 *  - não infere fator de conversão a partir de descrições de documento.
 *
 * Tudo aqui é PURO: apenas valida, formata e calcula a leitura equivalente.
 * A gravação (exclusivamente em campos de `products`) fica no backend.
 */
import {
  readPackagingConversion,
  type PackagingConfig,
  type PackagingConversion,
} from "./print-supplies";

export type { PackagingConfig, PackagingConversion };

/* ─── Unidades controladas (catálogo enxuto, version 1) ────────────────────── */

export const PACKAGING_UNITS = [
  "un",
  "caixa",
  "pacote",
  "saco",
  "kit",
  "rolo",
  "pote",
  "metro",
] as const;

export type PackagingUnit = (typeof PACKAGING_UNITS)[number];

export const BASE_UNITS = PACKAGING_UNITS;
export const PACKAGING_UNITS_OPTIONS = PACKAGING_UNITS;

/** Valor mostrado quando o campo não está parametrizado (nunca "0"). */
export const EMPTY_PACKAGING_FIELD = "—";

/* ─── Rótulos e status ──────────────────────────────────────────────────────── */

export const PACKAGING_STATUS_CONFIGURADO = "Configurado";
export const PACKAGING_STATUS_NAO_PARAMETRIZADO = "Não parametrizado";
export const PACKAGING_STATUS_INCOMPLETO = "Configuração incompleta";

export type PackagingStatus =
  | "configurado"
  | "nao_parametrizado"
  | "incompleto";

export const PACKAGING_STATUS_LABELS: Record<PackagingStatus, string> = {
  configurado: PACKAGING_STATUS_CONFIGURADO,
  nao_parametrizado: PACKAGING_STATUS_NAO_PARAMETRIZADO,
  incompleto: PACKAGING_STATUS_INCOMPLETO,
};

export const PACKAGING_STATUS_BADGE: Record<PackagingStatus, string> = {
  configurado: "badge-success",
  nao_parametrizado: "badge-neutral",
  incompleto: "badge-warning",
};

/** Aviso exibido na tela — reforça que nada de estoque é convertido. */
export const PACKAGING_SCREEN_NOTICE =
  "Configuração exclusivamente cadastral: a quantidade em estoque continua sendo a unidade BASE. " +
  "Salvar grava apenas baseUnit/packagingUnit/conversionFactor no produto e gera auditoria — nunca cria lote, entrada, saída, movimentação ou alteração de quantidade.";

/* ─── Leitura da configuração vigente ───────────────────────────────────────── */

export interface PackagingSettings {
  baseUnit: string | null;
  packagingUnit: string | null;
  conversionFactor: number | null;
}

/** Lê os três campos do produto, preservando null = "não parametrizado". */
export function readPackagingSettings(product: PackagingConfig | null | undefined): PackagingSettings {
  return {
    baseUnit: product?.baseUnit ?? null,
    packagingUnit: product?.packagingUnit ?? null,
    conversionFactor: product?.conversionFactor ?? null,
  };
}

/** A configuração está completa e válida? (os três campos + fator > 1) */
export function hasConfiguredPackaging(product: PackagingConfig | null | undefined): boolean {
  return readPackagingConversion(product ?? {}) !== null;
}

/** Status da linha: configurado / não parametrizado / incompleto. */
export function packagingStatus(product: PackagingConfig | null | undefined): PackagingStatus {
  const settings = readPackagingSettings(product);
  const present = [settings.baseUnit, settings.packagingUnit, settings.conversionFactor];
  const anyPresent = present.some((v) => v != null);
  if (!anyPresent) return "nao_parametrizado";
  return hasConfiguredPackaging(product) ? "configurado" : "incompleto";
}

/* ─── Validação ─────────────────────────────────────────────────────────────── */

export interface PackagingValidation {
  ok: boolean;
  /** Mensagem principal (a primeira encontrada). */
  error: string | null;
  /** Todos os problemas encontrados, para exibir junto. */
  errors: string[];
}

export const PACKAGING_ERRORS = {
  baseUnitRequired: "Unidade base é obrigatória para configurar a embalagem.",
  packagingUnitRequired: "Unidade de embalagem é obrigatória quando o fator é maior que 1.",
  factorRequired: "Informe o fator de conversão (quantas unidades-base cabem em uma embalagem).",
  factorZero: "O fator de conversão não pode ser zero.",
  factorNegative: "O fator de conversão não pode ser negativo.",
  factorNotInteger: "O fator de conversão deve ser um número inteiro (sem decimais).",
  factorTooSmall: "O fator de conversão deve ser no mínimo 1.",
  sameUnits: "A unidade de embalagem deve ser diferente da unidade base.",
} as const;

/**
 * Valida a configuração enviada pela tela.
 *
 * Regras (versão 1): fator inteiro positivo, mínimo 1; unidade base
 * obrigatória; unidade de embalagem obrigatória quando há conversão.
 * `baseUnit` vazio + resto vazio = configuração limpa (remover), o que é
 * permitido e não é erro.
 */
export function validatePackagingConfig(input: {
  baseUnit?: string | null;
  packagingUnit?: string | null;
  conversionFactor?: number | string | null;
}): PackagingValidation {
  const errors: string[] = [];
  const baseUnit = (input.baseUnit ?? "").trim();
  const packagingUnit = (input.packagingUnit ?? "").trim();
  const rawFactor = input.conversionFactor;

  const isEmptyConfig = !baseUnit && !packagingUnit && (rawFactor === null || rawFactor === undefined || rawFactor === "");

  // 1) fator
  let factor: number | null = null;
  if (rawFactor !== null && rawFactor !== undefined && rawFactor !== "") {
    const parsed = typeof rawFactor === "number" ? rawFactor : Number(String(rawFactor).replace(",", ".").trim());
    if (!Number.isFinite(parsed)) {
      errors.push(PACKAGING_ERRORS.factorRequired);
    } else if (parsed === 0) {
      errors.push(PACKAGING_ERRORS.factorZero);
    } else if (parsed < 0) {
      errors.push(PACKAGING_ERRORS.factorNegative);
    } else if (!Number.isInteger(parsed)) {
      errors.push(PACKAGING_ERRORS.factorNotInteger);
    } else if (parsed < 1) {
      errors.push(PACKAGING_ERRORS.factorTooSmall);
    } else {
      factor = parsed;
    }
  }

  if (isEmptyConfig) {
    // Remover a configuração é uma operação válida (deixa "não parametrizado").
    return { ok: true, error: null, errors: [] };
  }

  // 2) unidades
  if (!baseUnit) errors.push(PACKAGING_ERRORS.baseUnitRequired);
  if (factor !== null && factor > 1 && !packagingUnit) {
    errors.push(PACKAGING_ERRORS.packagingUnitRequired);
  }
  if (baseUnit && packagingUnit && baseUnit.toLowerCase() === packagingUnit.toLowerCase()) {
    errors.push(PACKAGING_ERRORS.sameUnits);
  }
  if (baseUnit && factor === null && packagingUnit) {
    // Embalagem declarada sem fator não é conversão: sinaliza a lacuna.
    errors.push(PACKAGING_ERRORS.factorRequired);
  }

  return { ok: errors.length === 0, error: errors[0] ?? null, errors };
}

/** Converte os campos do formulário em valores graváveis (ou null). */
export function normalizePackagingInput(input: {
  baseUnit?: string | null;
  packagingUnit?: string | null;
  conversionFactor?: number | string | null;
}): { baseUnit: string | null; packagingUnit: string | null; conversionFactor: number | null } {
  const baseUnit = (input.baseUnit ?? "").trim();
  const packagingUnit = (input.packagingUnit ?? "").trim();
  const raw = input.conversionFactor;
  const parsed =
    raw === null || raw === undefined || raw === ""
      ? null
      : Number(String(raw).replace(",", ".").trim());
  return {
    baseUnit: baseUnit || null,
    packagingUnit: packagingUnit || null,
    conversionFactor: parsed !== null && Number.isFinite(parsed) ? parsed : null,
  };
}

/* ─── Textos de conversão e PRÉVIA ──────────────────────────────────────────── */

/** "1 caixa = 30 rolos" (rói o plural da unidade de forma simples). */
export function formatConversion(conversion: PackagingConversion | null): string {
  if (!conversion) return EMPTY_PACKAGING_FIELD;
  return `1 ${conversion.packagingUnit} = ${conversion.factor} ${pluralizeUnit(conversion.baseUnit, conversion.factor)}`;
}

/** Plural simples: rolo → rolos, caixa → caixas, un → un. */
export function pluralizeUnit(unit: string, count: number): string {
  const u = unit.trim();
  if (!u) return u;
  if (u === "un") return "un";
  if (count === 1) return u;
  if (u.endsWith("l")) return `${u}s`; // rolo → rolos, papel → papeis… (simples)
  return `${u}s`;
}

export interface PackagingPreview {
  /** Quantidade na unidade BASE (o dado físico, intacto). */
  baseQuantity: number;
  baseUnit: string;
  /** Quantas embalagens exatas. */
  packs: number;
  packagingUnit: string;
  /** Resto em unidades-base (0 quando a divisão é exata). */
  remainder: number;
  /** Divisão exata? */
  exact: boolean;
  /** Texto pronto para exibição: "180 rolos = 6 caixas" ou "… 6 caixas + 5 rolos". */
  text: string;
}

/**
 * PRÉVIA MATEMÁTICA — apenas apresentação.
 *
 * 180 / 30 → "180 rolos = 6 caixas"
 * 185 / 30 → "185 rolos = 6 caixas + 5 rolos"
 *
 * NUNCA arredonda: o resto é exibido. E NUNCA altera o estoque — o valor
 * devolvido em `baseQuantity` é exatamente o que foi informado.
 */
export function buildPackagingPreview(input: {
  baseQuantity: number;
  baseUnit?: string | null;
  conversion: PackagingConversion | null;
}): PackagingPreview | null {
  const baseUnit = (input.baseUnit ?? "").trim() || input.conversion?.baseUnit || "un";
  const quantity = input.baseQuantity;

  if (!input.conversion) {
    return {
      baseQuantity: quantity,
      baseUnit,
      packs: 0,
      packagingUnit: "",
      remainder: quantity,
      exact: false,
      text: `${formatQuantity(quantity, baseUnit)}`,
    };
  }

  const { factor, packagingUnit } = input.conversion;
  const packs = Math.floor(Math.max(quantity, 0) / factor);
  const remainder = Math.max(quantity, 0) - packs * factor;
  const left = formatQuantity(quantity, baseUnit);
  const packsText = formatQuantity(packs, packagingUnit);
  const text =
    remainder === 0
      ? `${left} = ${packsText}`
      : `${left} = ${packsText} + ${formatQuantity(remainder, baseUnit)}`;

  return {
    baseQuantity: quantity,
    baseUnit,
    packs,
    packagingUnit,
    remainder,
    exact: remainder === 0,
    text,
  };
}

/** "180 rolos" / "1 caixa" — número com plural da própria unidade. */
export function formatQuantity(quantity: number, unit: string): string {
  const n = Number.isFinite(quantity) ? quantity : 0;
  return `${n} ${pluralizeUnit(unit, n)}`;
}

/** Versão compacta para a tabela: "≈ 6 caixas" (nunca substitui a unidade base). */
export function formatApproximatePacks(conversion: PackagingConversion | null, baseQuantity: number): string | null {
  if (!conversion) return null;
  const packs = Math.floor(Math.max(baseQuantity, 0) / conversion.factor);
  return `≈ ${formatQuantity(packs, conversion.packagingUnit)}`;
}

/* ─── Rascunho e diff da edição individual ──────────────────────────────────── */

export interface PackagingDraft {
  baseUnit: string;
  packagingUnit: string;
  conversionFactor: string;
}

export const EMPTY_PACKAGING_DRAFT: PackagingDraft = {
  baseUnit: "",
  packagingUnit: "",
  conversionFactor: "",
};

export function draftFromSettings(settings: PackagingSettings): PackagingDraft {
  return {
    baseUnit: settings.baseUnit ?? "",
    packagingUnit: settings.packagingUnit ?? "",
    conversionFactor: settings.conversionFactor === null ? "" : String(settings.conversionFactor),
  };
}

/** Humaniza um campo para a auditoria. */
export function describePackagingValue(
  value: string | number | null | undefined,
  field: "baseUnit" | "packagingUnit" | "conversionFactor"
): string {
  if (value === null || value === undefined || value === "") return "não parametrizado";
  if (field === "conversionFactor") return String(value);
  return String(value);
}

/**
 * Diferenças entre o rascunho e o salvo.
 *
 * Idempotência: quando nada muda, a lista vem VAZIA e a mutation nem chega a
 * ser chamada — nenhum registro e nenhuma auditoria duplicada.
 */
export function diffPackagingDraft(
  current: PackagingSettings,
  draft: PackagingDraft
): { field: keyof PackagingSettings; before: string | number | null; after: string | number | null }[] {
  const next = normalizePackagingInput(draft);
  const changes: { field: keyof PackagingSettings; before: string | number | null; after: string | number | null }[] = [];
  const push = (field: keyof PackagingSettings, after: string | number | null) => {
    const before = current[field] ?? null;
    const afterValue = after ?? null;
    if (before === afterValue) return;
    changes.push({ field, before, after: afterValue });
  };
  push("baseUnit", next.baseUnit);
  push("packagingUnit", next.packagingUnit);
  push("conversionFactor", next.conversionFactor);
  return changes;
}

/* ─── Linha da tabela ───────────────────────────────────────────────────────── */

export interface PackagingRow {
  productId: string;
  productName: string;
  categoryName: string | null;
  /** Saldo físico REAL (nunca convertido). */
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
  /** Unidade de medida já cadastrada no produto (fonte da unidade base). */
  unitOfMeasure: string;
  settings: PackagingSettings;
  status: PackagingStatus;
  /** Texto da conversão ("1 caixa = 30 rolos") ou "—". */
  conversionLabel: string;
  /** Prévia do saldo atual (nunca altera o estoque). */
  preview: PackagingPreview | null;
}

export interface PackagingRowInput {
  productId: string;
  productName: string;
  categoryName?: string | null;
  unitOfMeasure: string;
  physicalStock: number;
  reservedStock: number;
  packaging?: PackagingConfig | null;
}

/** Monta a linha da tabela com saldos REAIS e conversão apenas textual. */
export function buildPackagingRow(input: PackagingRowInput): PackagingRow {
  const settings = readPackagingSettings(input.packaging);
  const conversion = readPackagingConversion(input.packaging ?? {});
  const baseUnit = settings.baseUnit ?? input.unitOfMeasure;
  const availableStock = Math.max(input.physicalStock - input.reservedStock, 0);

  return {
    productId: input.productId,
    productName: input.productName,
    categoryName: input.categoryName ?? null,
    physicalStock: input.physicalStock,
    reservedStock: input.reservedStock,
    availableStock,
    unitOfMeasure: input.unitOfMeasure,
    settings,
    status: packagingStatus(input.packaging),
    conversionLabel: formatConversion(conversion),
    preview: buildPackagingPreview({
      baseQuantity: availableStock,
      baseUnit,
      conversion,
    }),
  };
}

export interface PackagingFilters {
  search: string;
  categoryName: string | null;
  status: PackagingStatus | "todos";
}

export const EMPTY_PACKAGING_FILTERS: PackagingFilters = {
  search: "",
  categoryName: null,
  status: "todos",
};

/** Filtros da tabela (busca por nome, categoria e status). */
export function applyPackagingFilters(rows: PackagingRow[], filters: PackagingFilters): PackagingRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (search && !row.productName.toLowerCase().includes(search)) return false;
    if (filters.categoryName && row.categoryName !== filters.categoryName) return false;
    if (filters.status !== "todos" && row.status !== filters.status) return false;
    return true;
  });
}

export function computePackagingCounters(rows: PackagingRow[]) {
  return {
    total: rows.length,
    configurados: rows.filter((r) => r.status === "configurado").length,
    naoParametrizados: rows.filter((r) => r.status === "nao_parametrizado").length,
    incompletos: rows.filter((r) => r.status === "incompleto").length,
  };
}

/**
 * Equivalente de uma quantidade em unidades-base para exibição auxiliar.
 * Usado por /stock-parameters e pelo painel de suprimentos: os parâmetros
 * (mínimo/ideal/consumo) NUNCA são convertidos — apenas exibidos ao lado.
 */
export function describeEquivalent(
  baseQuantity: number | null | undefined,
  packaging: PackagingConfig | null | undefined,
  baseUnit?: string | null
): string | null {
  if (baseQuantity === null || baseQuantity === undefined) return null;
  const conversion = readPackagingConversion(packaging ?? {});
  if (!conversion) return null;
  const preview = buildPackagingPreview({
    baseQuantity,
    baseUnit: baseUnit ?? conversion.baseUnit,
    conversion,
  });
  return preview ? `≈ ${preview.text}` : null;
}
