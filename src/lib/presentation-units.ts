/**
 * Gestão de Estoque SGGD — UNIDADE-BASE × APRESENTAÇÃO/EMBALAGEM
 * (regras puras de apresentação).
 *
 * ─── A DISTINÇÃO QUE IMPORTA ─────────────────────────────────────────────────
 *   UNIDADE-BASE  → a unidade OFICIAL do estoque. É nela que o saldo mora:
 *                   "2 kits", "180 rolos", "668 un". Nunca é substituída.
 *   APRESENTAÇÃO  → a embalagem física: caixa, pacote, saco, kit, pack, spray,
 *                   frasco, pote, cartucho, blister. É informação AUXILIAR:
 *                   "2 kits ≈ 12 peças (1 kit = 6 peças)".
 *
 * "Spray" (assim como pote, frasco, cartucho, blister e pack) é SEMPRE
 * apresentação/embalagem física — nunca uma unidade-base obrigatória. Um
 * limpador de contatos é "un" na base e "spray" na apresentação.
 *
 * ─── NUNCA ───────────────────────────────────────────────────────────────────
 * • não substitui o saldo "2 kits" por "12 peças";
 * • não funde "13 caixas + 18 avulsas" num saldo único de 668 (a composição
 *   original continua visível — é rastreabilidade);
 * • não converte histórico, lote, movimentação ou NF-e;
 * • não altera quantidade alguma: tudo aqui é texto calculado.
 */

/* ─── Catálogo de apresentações ─────────────────────────────────────────────── */

/** Embalagens/apresentações físicas suportadas no cadastro. */
export const PRESENTATION_UNITS = [
  "caixa",
  "pacote",
  "saco",
  "kit",
  "pack",
  "spray",
  "frasco",
  "pote",
  "cartucho",
  "blister",
  "rolo",
  "un",
] as const;

export type PresentationUnit = (typeof PRESENTATION_UNITS)[number];

/** Apresentações que NUNCA devem ser exigidas como unidade-base. */
export const PHYSICAL_PRESENTATION_UNITS = [
  "caixa",
  "pacote",
  "saco",
  "pack",
  "spray",
  "frasco",
  "pote",
  "cartucho",
  "blister",
] as const;

/** Unidades que fazem sentido como unidade-base (contagem de peças/medida). */
export const BASE_UNITS_PREFERRED = ["un", "pc", "peça", "rolo", "metro", "m", "pct", "kit", "po", "jogo"] as const;

export type PresentationRole = "base" | "apresentacao" | "ambiguo";

/** A unidade é uma embalagem física (spray, pote, pack, caixa…)? */
export function isPhysicalPresentation(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const normalized = unit.trim().toLowerCase();
  return (PHYSICAL_PRESENTATION_UNITS as readonly string[]).includes(normalized);
}

/** A unidade está no catálogo de apresentações conhecido? */
export function isKnownPresentation(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const normalized = unit.trim().toLowerCase();
  return (PRESENTATION_UNITS as readonly string[]).includes(normalized);
}

/**
 * Papel da unidade no cadastro.
 *
 *   base        → unidade oficial do estoque (un, pc, rolo, metro, pct, kit…);
 *   apresentacao→ embalagem física (spray, pote, pack, caixa…);
 *   ambíguo     → "kit" pode ser as duas coisas (jogo de chaves É a base;
 *                 pilha AAA tem kit como embalagem).
 */
export function presentationRole(unit: string | null | undefined): PresentationRole {
  if (!unit) return "apresentacao";
  const normalized = unit.trim().toLowerCase();
  if (isPhysicalPresentation(normalized)) return "apresentacao";
  if ((BASE_UNITS_PREFERRED as readonly string[]).includes(normalized)) {
    // "kit" e "jogo" são base quando descrevem o próprio item (jogo de chaves)
    // e também embalagem (1 kit = 2 pilhas): o papel é decidedor do contexto.
    return normalized === "kit" || normalized === "jogo" ? "ambiguo" : "base";
  }
  return "apresentacao";
}

/** Nota exibida quando a apresentação é confundida com a unidade-base. */
export const SPRAY_PRESENTATION_NOTE =
  "Spray é a APRESENTAÇÃO do produto (a embalagem física), não a unidade-base. " +
  "A unidade-base do limpador de contatos é “un”.";

/* ─── Composição de kits e packs (auxiliar, sem tocar no saldo) ─────────────── */

export interface PackComposition {
  /** Saldo na unidade-base — a verdade do estoque. */
  baseQuantity: number;
  baseUnit: string;
  /** Quantas embalagens o saldo representa. */
  packs: number;
  packagingUnit: string;
  /** 1 embalagem = N unidades-base. */
  factor: number;
  /** Equivalente calculado (baseQuantity). */
  equivalentQuantity: number;
  /** "2 kits = 12 peças (1 kit = 6 peças)" */
  label: string;
}

function plural(unit: string, count: number): string {
  if (count === 1) return unit;
  if (unit === "un" || unit === "pc") return unit;
  return `${unit}s`;
}

/**
 * Representa kits/packs sem substituir a unidade-base.
 *
 *   Jogo de chaves — 6 peças: 2 kits, 1 kit = 6 peças  → "2 kits = 12 peças"
 *   Jogo de chaves — 8 peças: 1 kit,  1 kit = 8 peças  → "1 kit = 8 peças"
 *   Pilha AAA:               3 packs, 1 pack = 2 pilhas → "3 packs = 6 pilhas"
 *
 * O `baseQuantity` devolvido é EXATAMENTE o saldo informado: a conversão é
 * sempre acessória.
 */
export function describePackComposition(input: {
  baseQuantity: number;
  baseUnit: string;
  factor: number;
  packagingUnit: string;
}): PackComposition | null {
  const factor = input.factor;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const baseUnit = input.baseUnit.trim();
  const packagingUnit = input.packagingUnit.trim();
  if (!baseUnit || !packagingUnit) return null;

  const packs = Math.floor(Math.max(input.baseQuantity, 0) / factor);
  const equivalentQuantity = Math.max(input.baseQuantity, 0);
  const baseText = `${equivalentQuantity} ${plural(baseUnit, equivalentQuantity)}`;
  const packText = `${packs} ${plural(packagingUnit, packs)}`;

  return {
    baseQuantity: input.baseQuantity,
    baseUnit,
    packs,
    packagingUnit,
    factor,
    equivalentQuantity,
    label:
      packs === 0
        ? `${baseText} — sem ${plural(packagingUnit, 2)} completos`
        : `${baseText} = ${packText} (1 ${packagingUnit} = ${factor} ${plural(baseUnit, factor)})`,
  };
}

/* ─── Composição física preservada (rastreabilidade) ────────────────────────── */

export interface CompositionComponent {
  /** Quantidade no contador da composição (caixas fechadas, avulsos…). */
  quantity: number;
  /** Unidade do componente. */
  unit: string;
  /** Fator da embalagem (1 caixa = 50 un) quando o componente é embalado. */
  factor?: number;
  /** Unidade-base equivalente do componente. */
  baseUnit?: string;
}

export interface PhysicalComposition {
  /** Componentes preservados (nunca fundidos em um saldo só). */
  components: CompositionComponent[];
  /** "13 caixas + 18 un. avulsas" */
  partsLabel: string;
  /** Total apenas em unidades-base. */
  totalBase: number;
  baseUnit: string;
  /** "13 caixas + 18 un. avulsas = 668 un" */
  label: string;
}

/**
 * Composição física preservada.
 *
 *   13 caixas (1 caixa = 50 un) + 18 un. avulsas
 *     → partsLabel: "13 caixas + 18 un. avulsas"
 *     → totalBase:  668 un
 *     → label:      "13 caixas + 18 un. avulsas = 668 un"
 *
 * Os 13 lotes/caixas NÃO viram um saldo único: a composição original continua
 * visível ao lado do equivalente, exatamente como pede a rastreabilidade.
 */
export function summarizePhysicalComposition(
  components: CompositionComponent[],
  baseUnit: string
): PhysicalComposition {
  const parts: string[] = [];
  let totalBase = 0;

  for (const component of components) {
    if (component.quantity <= 0) continue;
    const factor = component.factor ?? 1;
    totalBase += component.quantity * factor;
    const unitText = `${component.quantity} ${plural(component.unit, component.quantity)}`;
    // Componente embalado mantém a embalagem ("13 caixas"); componente avulso
    // é marcado como tal ("18 un. avulsas") para não parecer igual à caixa.
    parts.push(factor > 1 ? unitText : `${unitText} avuls${component.quantity === 1 ? "o" : "as"}`);
  }

  const partsLabel = parts.length > 0 ? parts.join(" + ") : "—";
  return {
    components,
    partsLabel,
    totalBase,
    baseUnit,
    label: parts.length > 0 ? `${partsLabel} = ${totalBase} ${plural(baseUnit, totalBase)}` : "—",
  };
}

/** Nunca funde a composição num saldo: o texto JOINTO continua separado. */
export const COMPOSITION_PRESERVES_LOTS_NOTE =
  "A composição física é preservada: 13 caixas continuam 13 caixas. O total em unidades é apenas o equivalente informativo.";

/* ─── Correção cadastral de APRESENTAÇÃO (somente produtos) ─────────────────── */

/** Alvo da correção: "Limpa contato" é UNIDADE-BASE "un", APRESENTAÇÃO "spray". */
export const LIMPA_CONTATO_PRESENTATION_FIX = {
  from: "pote",
  to: "spray",
  baseUnit: "un",
} as const;

export interface PresentationFixState {
  baseUnit?: string | null;
  packagingUnit?: string | null;
  conversionFactor?: number | null;
}

export interface PresentationFixDecision {
  shouldApply: boolean;
  reason: string;
  before: { baseUnit: string | null; packagingUnit: string | null; conversionFactor: number | null };
  after: { baseUnit: string | null; packagingUnit: string | null; conversionFactor: number | null };
  /** Campos que a correção grava — apenas apresentação. */
  patch: { packagingUnit: string } | null;
}

/**
 * Decide a correção de apresentação.
 *
 * Regras:
 *  - a unidade-base permanece a UNIDADE-BASE (o limpador é contado em "un");
 *  - a apresentação vai de "pote" para "spray" (é um spray, não um pote);
 *  - NENHUMA quantidade, lote, movimentação, entrada ou NF-e é tocada: o patch
 *    devolvido contém um único campo cadastral;
 *  - idempotente: já estando "spray", nada é gravado.
 */
export function decidePresentationUnitFix(
  current: PresentationFixState,
  target: { from: string; to: string; baseUnit: string } = LIMPA_CONTATO_PRESENTATION_FIX
): PresentationFixDecision {
  const before = {
    baseUnit: current.baseUnit ?? null,
    packagingUnit: current.packagingUnit ?? null,
    conversionFactor: current.conversionFactor ?? null,
  };
  const after = { ...before, packagingUnit: target.to };

  if ((current.packagingUnit ?? "").toLowerCase() === target.to) {
    return { shouldApply: false, reason: `Apresentação já é "${target.to}".`, before, after, patch: null };
  }
  if ((current.packagingUnit ?? "").toLowerCase() !== target.from) {
    return {
      shouldApply: false,
      reason: `Apresentação atual é "${current.packagingUnit ?? "—"}" (esperado "${target.from}"): revisão manual necessária.`,
      before,
      after,
      patch: null,
    };
  }
  if ((current.baseUnit ?? "").toLowerCase() !== target.baseUnit) {
    return {
      shouldApply: false,
      reason: `Unidade-base é "${current.baseUnit ?? "—"}" (esperado "${target.baseUnit}"): revisão manual necessária.`,
      before,
      after,
      patch: null,
    };
  }
  return {
    shouldApply: true,
    reason: `Apresentação "${target.from}" → "${target.to}" (unidade-base "${target.baseUnit}" preservada).`,
    before,
    after,
    patch: { packagingUnit: target.to },
  };
}

/** Detalhe de auditoria da correção de apresentação. */
export function buildPresentationFixAuditDetail(
  productName: string,
  decision: PresentationFixDecision
): string {
  return (
    `Apresentação de "${productName}" — ${decision.reason} ` +
    `Unidade-base mantida em ${decision.after.baseUnit ?? "—"}; ` +
    `fator de conversão inalterado (${decision.after.conversionFactor ?? "não parametrizado"}). ` +
    "Correção exclusivamente CADISTRAL: nenhuma quantidade, lote, movimentação ou NF-e foi alterada."
  );
}
