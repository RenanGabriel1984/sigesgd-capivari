/**
 * Gestão de Estoque SGGD — SUPRIMENTOS DE IMPRESSÃO (regras puras).
 *
 * Recorte operacional do estoque REAL pela Área/Subestoque "Impressoras".
 * Não cria segundo estoque: toda quantidade vem de `stock`/`lots`/`stockMovements`
 * existentes. A área é apenas uma LENTE de consulta.
 *
 * Tipos (Toner/Cartão/Ribbon/Papel/Etiqueta/Outros) são DERIVADOS do nome/categoria
 * — nenhum enum novo no banco, nenhum produto fictício, nenhum auto-fill.
 */

/* ─── Área operacional ──────────────────────────────────────────────────────── */

export const PRINT_AREA_NAME = "Impressoras";

/** Classificação de um suprimento, derivada do nome do produto. */
export type SupplyType = "Toner" | "Cartão" | "Ribbon" | "Papel" | "Etiqueta" | "Outros";

/**
 * Deriva o tipo do suprimento a partir do nome do produto (sem enum no banco).
 * "Toner MFC-L6902DW — Preto 20K" → "Toner"; "Cartão PVC…" → "Cartão"; etc.
 */
export function classifySupplyType(productName: string): SupplyType {
  const n = productName.toLowerCase();
  if (n.includes("toner")) return "Toner";
  if (n.includes("cartão") || n.includes("cartao")) return "Cartão";
  if (n.includes("ribbon")) return "Ribbon";
  if (n.includes("etiqueta")) return "Etiqueta";
  if (n.includes("papel")) return "Papel";
  return "Outros";
}

/** Cor extraída do nome (para toners: "Toner CX735 — Ciano" → "Ciano"). */
export function extractColor(productName: string): string | null {
  const colors = ["Preto", "Ciano", "Magenta", "Amarelo"];
  for (const c of colors) if (productName.includes(c)) return c;
  return null;
}

/** Rótulo de toner destacando modelo + cor: "AltaLink — Preto". */
export function tonerDisplayLabel(productName: string): string {
  const color = extractColor(productName);
  if (!color) return productName;
  const model = productName
    .replace(/toner/gi, "")
    .replace(new RegExp(`[—\\-–]*\\s*${color}.*$`, "i"), "")
    .replace(/\(xerox\)/gi, "")
    .trim();
  return `${model || productName} — ${color}`;
}

/* ─── Status de estoque ─────────────────────────────────────────────────────── */

export type StockStatus = "Normal" | "Baixo" | "Crítico";

/**
 * Normal > mínimo · Baixo <= mínimo (e > 0) · Crítico = 0.
 * Sem mínimo configurado → "Normal" (parâmetros indefinidos não geram alerta).
 */
export function stockStatus(current: number, minimum: number | null | undefined): StockStatus {
  if (current <= 0) return "Crítico";
  if (minimum != null && minimum > 0 && current <= minimum) return "Baixo";
  return "Normal";
}

export const STOCK_STATUS_STYLES: Record<StockStatus, { className: string }> = {
  Normal: { className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  Baixo: { className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  "Crítico": { className: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
};

/* ─── Linha do painel (derivada do estoque real) ───────────────────────────── */

export interface SupplyRowInput {
  productId: string;
  productName: string;
  brand: string | null | undefined;
  model: string | null | undefined;
  unitOfMeasure: string;
  currentStock: number;
  minimumStock: number | null | undefined;
  idealStock: number | null | undefined;
  /** Quantidade do produto que está FISICAMENTE na área Impressoras. */
  inArea?: number;
}

export interface SupplyRow extends SupplyRowInput {
  type: SupplyType;
  color: string | null;
  displayLabel: string;
  status: StockStatus;
  /** ideal − atual, somente quando AMBOS configurados; null caso contrário. */
  suggestedReorder: number | null;
  /** Reposição configurável? false → "Parâmetros não definidos". */
  parametersDefined: boolean;
}

export function buildSupplyRow(input: SupplyRowInput): SupplyRow {
  const type = classifySupplyType(input.productName);
  const status = stockStatus(input.currentStock, input.minimumStock);
  const parametersDefined =
    input.minimumStock != null && input.minimumStock > 0 &&
    input.idealStock != null && input.idealStock > 0;
  const suggestedReorder = parametersDefined
    ? Math.max(0, (input.idealStock as number) - input.currentStock)
    : null;
  return {
    ...input,
    type,
    color: extractColor(input.productName),
    displayLabel: type === "Toner" ? tonerDisplayLabel(input.productName) : input.productName,
    status,
    suggestedReorder,
    parametersDefined,
  };
}

/* ─── Totais dos cards (sempre derivados das linhas) ───────────────────────── */

export interface SupplyCardTotals {
  toners: number;
  cartoes: number;
  ribbons: number;
  papeis: number;
  etiquetas: number;
  lowStock: number;
}

export function computeCardTotals(rows: SupplyRow[]): SupplyCardTotals {
  const by = (t: SupplyType) =>
    rows.filter((r) => r.type === t).reduce((s, r) => s + r.currentStock, 0);
  return {
    toners: by("Toner"),
    cartoes: by("Cartão"),
    ribbons: by("Ribbon"),
    papeis: by("Papel"),
    etiquetas: by("Etiqueta"),
    lowStock: rows.filter((r) => r.status !== "Normal").length,
  };
}

/* ─── Consumo mensal (somente saída operacional) ───────────────────────────── */

/**
 * Definição de CONSUMO: `exit` operacional.
 * Transferências internas, devoluções e ajustes NÃO são consumo (a regra
 * rejeita explicitamente os tipos que não representam saída ao usuário).
 */
export function isOperationalConsumption(movementType: string): boolean {
  return movementType === "exit";
}

export interface MovementForConsumption {
  type: string;
  productId: string;
  quantity: number;
  timestamp: number;
  organizationId?: string | null;
}

export interface ConsumptionPeriod {
  /** Início do mês (ms epoch, inclusive). */
  start: number;
  /** Fim do mês (ms epoch, exclusivo). */
  end: number;
}

/** Janela do mês/ano informados (1º dia 00:00 → 1º dia do mês seguinte). */
export function monthWindow(year: number, month1to12: number): ConsumptionPeriod {
  return {
    start: new Date(year, month1to12 - 1, 1).getTime(),
    end: new Date(year, month1to12, 1).getTime(),
  };
}

export interface ProductConsumptionLine {
  productId: string;
  productName: string;
  type: SupplyType;
  brand: string | null;
  unitOfMeasure: string;
  entries: number;
  exits: number;
  currentStock: number;
}

/**
 * Consolida entradas/saídas do período por produto.
 * Somente `entry` e `exit` contam; transfer/adjustment/return são ignorados.
 */
export function computeMonthlyConsumption(
  movements: MovementForConsumption[],
  productMeta: Map<string, { name: string; brand: string | null | undefined; unitOfMeasure: string }>,
  currentStockByProduct: Map<string, number>,
  period: ConsumptionPeriod,
): ProductConsumptionLine[] {
  const acc = new Map<string, { entries: number; exits: number }>();
  for (const m of movements) {
    if (m.timestamp < period.start || m.timestamp >= period.end) continue;
    if (!isOperationalConsumption(m.type) && m.type !== "entry") continue;
    const cur = acc.get(m.productId) ?? { entries: 0, exits: 0 };
    if (m.type === "entry") cur.entries += m.quantity;
    else cur.exits += m.quantity;
    acc.set(m.productId, cur);
  }
  const lines: ProductConsumptionLine[] = [];
  for (const [productId, { entries, exits }] of acc) {
    const meta = productMeta.get(productId);
    if (!meta) continue;
    lines.push({
      productId,
      productName: meta.name,
      type: classifySupplyType(meta.name),
      brand: meta.brand ?? null,
      unitOfMeasure: meta.unitOfMeasure,
      entries,
      exits,
      currentStock: currentStockByProduct.get(productId) ?? 0,
    });
  }
  return lines.sort((a, b) => b.exits - a.exits || a.productName.localeCompare(b.productName));
}

/* ─── Retirada rápida (validações da UI; backend revalida) ─────────────────── */

export interface WithdrawValidation {
  ok: boolean;
  reason?: string;
  balanceAfter?: number;
}

/** Bloqueia quantidade <= 0 e maior que o disponível. */
export function validateWithdrawal(quantity: number, available: number): WithdrawValidation {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: "Quantidade deve ser maior que zero." };
  }
  if (quantity > available) {
    return { ok: false, reason: `Estoque insuficiente. Disponível: ${available}.` };
  }
  return { ok: true, balanceAfter: available - quantity };
}

/* ─── Conversão de embalagem e unidade-base (configurável; nunca inferida) ──── */

/**
 * Metadados de conversão de embalagem de um produto (schema products):
 * baseUnit/packagingUnit/conversionFactor — TODOS opcionais.
 * Conversão só existe quando explicitamente configurada; nada é inferido
 * do texto do nome (papel térmico 90 rolos NÃO vira 2.700 unidades).
 */
export interface PackagingConfig {
  baseUnit?: string | null;
  packagingUnit?: string | null;
  conversionFactor?: number | null;
}

export interface PackagingConversion {
  baseUnit: string;
  packagingUnit: string;
  factor: number;
}

/**
 * Lê a conversão configurada. Retorna null quando incompleta/inválida
 * (factor <= 0, não inteiro positivo configurável, ou campos ausentes).
 */
export function readPackagingConversion(p: PackagingConfig): PackagingConversion | null {
  const { baseUnit, packagingUnit, conversionFactor } = p;
  if (!baseUnit || !packagingUnit || conversionFactor == null) return null;
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) return null;
  return { baseUnit, packagingUnit, factor: conversionFactor };
}

/**
 * Operação logicamente possível com a composição atual (caixas fechadas + avulsas).
 * - "open_pack": abre `packs` caixas FECHADAS para unidades avulsas (integral).
 * - "take_pack": retira `packs` caixas FECHADAS (nunca desmonta).
 * - null: composição insuficiente.
 * NÃO inventa estado físico: a abertura exige caixa fechada disponível.
 */
export type PackOperation = "open_pack" | "take_pack";

export interface PackOperationPlan {
  operation: PackOperation;
  packs: number;
}

/**
 * Decide a operação para `units` unidades-base dada a composição física.
 * Regra operacional: sai primeiro das unidades avulsas; abrir caixa é evento
 * EXPLICITO e integral (uma caixa aberta deixa de ser fechada).
 */
export function planPackOperation(
  units: number,
  composition: { closedPacks: number; looseUnits: number; factor: number },
): PackOperationPlan | null {
  const { closedPacks, looseUnits, factor } = composition;
  if (!Number.isFinite(units) || units <= 0) return null;
  if (units <= looseUnits) return { operation: "take_pack", packs: 0 }; // só avulsas
  const fromOpenable = units - looseUnits;
  const packsNeeded = Math.ceil(fromOpenable / factor);
  if (packsNeeded > closedPacks) return null;
  if (fromOpenable % factor === 0) return { operation: "take_pack", packs: fromOpenable / factor };
  return { operation: "open_pack", packs: packsNeeded };
}

/* ─── Agrupamento por família física (mesmo produto em apresentações distintas) */

/**
 * Chave canônica de família: marca + nome sem o sufixo de apresentação
 * "— caixa fechada" / "— unidade avulsa" / "— caixa" / "— unidade".
 * Produtos sem sufixo agrupam por si mesmos (família de 1).
 */
export function deriveFamilyKey(productName: string, brand?: string | null): string {
  const base = productName
    .replace(/\s*[—\-–]\s*(caixa\s*fechada|unidade\s*avulsa|caixa|unidade)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${brand ?? ""}::${base.toLowerCase()}`;
}

export interface SupplyFamilyInput {
  productId: string;
  productName: string;
  brand: string | null;
  model: string | null;
  unitOfMeasure: string;
  currentStock: number;
  minimumStock: number;
  idealStock: number;
  inArea: number;
  /** Conversão explicitamente configurada (null = sem conversão). */
  packaging: PackagingConversion | null;
}

/** Um membro físico da família (registro ORIGINAL preservado). */
export interface FamilyMember {
  productId: string;
  productName: string;
  unitOfMeasure: string;
  currentStock: number;
  inArea: number;
  packaging: PackagingConversion | null;
  /** Quantidade expressa em unidades-base (sem conversão = quantidade própria). */
  baseUnits: number;
}

export interface SupplyFamily {
  /** Chave canônica da família. */
  familyKey: string;
  /** Nome comum (sem sufixo de apresentação) — rótulo exibido. */
  familyName: string;
  brand: string | null;
  type: SupplyType;
  model: string | null;
  /** Unidade operacional (base). */
  baseUnit: string;
  /** Estoque total da família em unidades-base. */
  baseStock: number;
  /** Estoque fisicamente na área Impressoras (unidades-base). */
  baseStockInArea: number;
  /** Detalhamento legível da composição física, ex.: "13 caixas fechadas + 18 un. avulsas". */
  compositionLabel: string;
  /** Registros originais — NUNCA descartados (rastreabilidade). */
  members: FamilyMember[];
  /** Parâmetros em unidades-base quando todos os membros configurados; senão null. */
  minimumStock: number | null;
  idealStock: number | null;
  status: StockStatus;
  /** Membro de retirada preferencial (com conversão; senão único membro com saldo). */
  withdrawMemberId: string | null;
  suggestedReorder: number | null;
  parametersDefined: boolean;
}

/** Rótulo da composição física, ex.: "13 caixas fechadas + 18 un. avulsas". */
export function compositionLabelFor(members: FamilyMember[]): string {
  const parts: string[] = [];
  for (const m of members) {
    if (m.currentStock <= 0) continue;
    if (m.packaging) {
      const plural = m.currentStock > 1 ? "s" : "";
      parts.push(`${m.currentStock} ${m.packaging.packagingUnit}${plural} fechada${plural}`);
    } else {
      const plural = m.currentStock > 1 ? "s" : "a";
      parts.push(`${m.currentStock} ${m.unitOfMeasure}. avulsa${plural}`);
    }
  }
  return parts.join(" + ") || "—";
}

/**
 * Agrupa linhas de suprimento em famílias físicas. Sem conversão configurada
 * o comportamento é idêntico ao anterior (família de 1, unidade de estoque).
 */
export function buildSupplyFamilies(inputs: SupplyFamilyInput[]): SupplyFamily[] {
  const groups = new Map<string, SupplyFamilyInput[]>();
  for (const input of inputs) {
    const key = deriveFamilyKey(input.productName, input.brand);
    const list = groups.get(key) ?? [];
    list.push(input);
    groups.set(key, list);
  }

  const families: SupplyFamily[] = [];
  for (const [familyKey, membersInput] of groups) {
    const first = membersInput[0];
    const members: FamilyMember[] = membersInput.map((m) => ({
      productId: m.productId,
      productName: m.productName,
      unitOfMeasure: m.unitOfMeasure,
      currentStock: m.currentStock,
      inArea: m.inArea,
      packaging: m.packaging,
      baseUnits: m.packaging ? m.currentStock * m.packaging.factor : m.currentStock,
    }));
    const baseStock = members.reduce((s, m) => s + m.baseUnits, 0);
    const baseStockInArea = members.reduce((s, m) => s + (m.packaging ? m.inArea * m.packaging.factor : m.inArea), 0);
    const baseUnit = members.find((m) => m.packaging)?.packaging?.baseUnit ?? first.unitOfMeasure;
    const mins = membersInput.map((m) => m.minimumStock);
    const ideals = membersInput.map((m) => m.idealStock);
    const allConfigured = mins.every((v) => v > 0) && ideals.every((v) => v > 0);
    const minimumStock = allConfigured ? mins.reduce((a, b) => a + b, 0) : null;
    const idealStock = allConfigured ? ideals.reduce((a, b) => a + b, 0) : null;
    const parametersDefined = minimumStock != null && idealStock != null && minimumStock > 0;
    const withdrawMember =
      members.find((m) => m.packaging && m.currentStock > 0) ??
      members.find((m) => m.currentStock > 0) ??
      members[0];
    const status = stockStatus(baseStock, minimumStock);
    families.push({
      familyKey,
      familyName: first.productName.replace(/\s*[—\-–]\s*(caixa\s*fechada|unidade\s*avulsa|caixa|unidade)\s*$/i, "").trim(),
      brand: first.brand,
      type: classifySupplyType(first.productName),
      model: first.model,
      baseUnit,
      baseStock,
      baseStockInArea,
      compositionLabel: compositionLabelFor(members),
      members,
      minimumStock,
      idealStock,
      status,
      withdrawMemberId: withdrawMember.productId,
      suggestedReorder: parametersDefined ? Math.max(0, idealStock! - baseStock) : null,
      parametersDefined,
    });
  }
  return families.sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.familyName.localeCompare(b.familyName) ||
      a.familyKey.localeCompare(b.familyKey),
  );
}

/* ─── Normalização de listas (contrato defensivo; nunca cast cego) ─────────── */

/**
 * Normaliza o retorno de consultas que podem chegar como array direto ou como
 * objeto paginado/estruturado (ex.: { orgs, byParent }) para um ARRAY plano.
 * Lança erro em tipo inesperado — nunca assume array por cast.
 */
export function normalizeOrgList<T>(data: unknown): T[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.orgs)) return obj.orgs as T[];
  }
  throw new Error(
    `formato inesperado de organizações (${typeof data}) — esperado array ou { orgs }`,
  );
}
