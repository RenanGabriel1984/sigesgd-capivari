/**
 * DANFE orientado a OCR — leitura semântica de campos estruturados.
 *
 * Responsabilidade:
 *   Ler um texto extraído da DANFE (camada textual do PDF ou OCR da
 *   rasterização) e produzir campos estruturados: número NF-e, série,
 *   data de emissão, chave de acesso de 44 dígitos, CNPJ/CPF do emitente,
 *   nome do receptor, transportador, observações/AF/empenho/processo,
 *   valor total da NF e itens identificáveis.
 *
 * Regra de ouro:
 *   NUNCA selecionamos automaticamente um resultado baseado SOMENTE na
 *   contagem de caracteres. Um texto maior não é automaticamente melhor.
 *   Campo não reconhecido fica `undefined` (pendente de conferência) —
 *   nunca é preenchido com gabarito, estimativa ou valor inventado.
 */

/** Regiões clássicas da DANFE (frações 0..1 da página) usadas pelo OCR. */
export const DANFE_REGIONS = [
  { key: "cabecalho", x: 0.02, y: 0.02, w: 0.96, h: 0.1 },
  { key: "chave", x: 0.09, y: 0.14, w: 0.45, h: 0.06 },
  { key: "emitente", x: 0.03, y: 0.2, w: 0.45, h: 0.14 },
  { key: "destinatario", x: 0.52, y: 0.2, w: 0.45, h: 0.14 },
  { key: "produtos", x: 0.03, y: 0.4, w: 0.94, h: 0.3 },
  { key: "totais", x: 0.6, y: 0.72, w: 0.37, h: 0.1 },
  { key: "dadosAdicionais", x: 0.03, y: 0.72, w: 0.5, h: 0.22 },
] as const;

export const DANFE_TRACKED_FIELDS = [
  { campo: "nfeNumber", titulo: "Número da NF-e" },
  { campo: "series", titulo: "Série" },
  { campo: "emissionDate", titulo: "Data de emissão" },
  { campo: "accessKey", titulo: "Chave de acesso" },
  { campo: "emitterCnpj", titulo: "CNPJ emitente" },
  { campo: "emitterName", titulo: "Razão social emitente" },
  { campo: "receiverCnpj", titulo: "CNPJ destinatário" },
  { campo: "receiverName", titulo: "Razão social destinatário" },
  { campo: "issuerCnpj", titulo: "CNPJ expedidor" },
  { campo: "items", titulo: "Itens da NF-e" },
] as const;

export interface OcrFieldTrace {
  field: keyof DanfeParseResult;
  value: string;
  source: string;
  confidence: number;
  isValid: boolean;
  notes: string;
}

export interface OcrTrace {
  rawText: string;
  pageOcrText: string;
  regionTexts: readonly string[];
  mergedOcr: string;
  parsedLayer: DanfeParseResult;
  parsedOcr: DanfeParseResult;
  best: DanfeParseResult;
  source: string;
  srcLayerBlob: string | null;
  fieldTraces: OcrFieldTrace[];
  comparison: {
    layerValid: number;
    ocrValid: number;
  };
}

export interface ItemCandidateTrace {
  field: keyof DanfeParseResult;
  raw: string;
  normalized: string;
  ok: boolean;
  score: number;
}

export interface DanfeItem {
  index?: number;
  lineNumber?: number;
  code: string;
  description: string;
  ncm?: string;
  quantity: number;
  unit: string;
  unitValue: number;
  totalValue: number;
}

/**
 * Campos ausentes ficam `undefined` — a tela de conferência mostra a pência
 * em vez de exibir valor vazio/inventado.
 */
export interface DanfeParseResult {
  ok: boolean;
  items: DanfeItem[];
  nfeNumber?: string;
  series?: string;
  emissionDate?: string;
  accessKey?: string;
  emitterCnpj?: string;
  emitterName?: string;
  emitterAddress?: string;
  emitterCity?: string;
  emitterState?: string;
  emitterPostalCode?: string;
  receiverCnpj?: string;
  receiverName?: string;
  transporterCnpj?: string;
  issuerCnpj?: string;
  issuerName?: string;
  afNumber?: string;
  empenhoNumber?: string;
  processNumber?: string;
  totalValue?: number;
}

export interface DanfeFieldSummary {
  found: number;
  total: number;
  missing: string[];
}

export function danfeFieldSummary(parsed: DanfeParseResult): DanfeFieldSummary {
  const tracked = DANFE_TRACKED_FIELDS;
  let found = 0;
  const missing: string[] = [];

  for (const field of tracked) {
    const value =
      field.campo === "items"
        ? parsed.items.length > 0
        : isFilledTrackedField(parsed, field.campo);
    if (value) {
      found++;
    } else {
      missing.push(field.titulo);
    }
  }

  return { found, total: tracked.length, missing };
}

/**
 * Conta SOMENTE valor real do campo, para o contador “X de 10 campos”
 * refletir o estado verdadeiro da leitura:
 *   • string: preenchida de fato (após trim) — vazio/não conta;
 *   • número: finito (zero inclusive) — NaN/não conta;
 *   • chave de acesso: os 44 dígitos COM dígito verificador válido;
 *   • ausente/undefined: pendente — nunca é contado nem inventado.
 */
function isFilledTrackedField(parsed: DanfeParseResult, campo: string): boolean {
  if (campo === "accessKey") {
    return validateAccessKey44(parsed.accessKey);
  }
  const value = parsed[campo as keyof DanfeParseResult];
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(value);
}

/**
 * Camada textual utilizável: um trecho curto (stub/placeholder) não substitui
 * a leitura do documento real, mas um texto longo de página é aproveitado
 * mesmo quando o OCR não achou a chave (leitura parcial segue possível).
 */
export function hasUsableTextLayer(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 100) return false;
  return /[0-9]{4,}/.test(trimmed) || /[A-Za-zÀ-ÿ]{4,}/.test(trimmed);
}

/**
 * Concatena a página com as regiões OCR, descartando linhas repetidas
 * (mesma linha lida na página inteira e na região — só espaços/caixa).
 */
export function mergeDanfeTexts(pageText: string, regionTexts: string[]): string {
  const parts: string[] = [];
  if (pageText) parts.push(pageText);
  for (const region of regionTexts) {
    if (region) parts.push(region);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of parts.join("\n").split(/\r?\n/)) {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out.join("\n");
}

function emptyResult(ok = false): DanfeParseResult {
  return { ok, items: [] };
}

function formatCnpjLocal(digits: string): string {
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

// ─── Tolerância ao ruído de OCR (glifos, rótulos e linhas adjacentes) ────────

/**
 * Glifos que o OCR troca com frequência em contexto NUMÉRICO: O→0, S→5, B→8,
 * I/l→1, Z→2, G→6. Aplicado apenas onde se espera dígito — nunca nas palavras
 * da descrição do produto.
 */
function normalizeDigitGlyphs(text: string): string {
  return text
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[Zz]/g, "2")
    .replace(/[Gg]/g, "6");
}

/**
 * Dígitos de um texto lido por OCR: normaliza glifos confundíveis e mantém
 * apenas números (descarta separadores de máscara/milhar).
 */
function digitsFromOcr(text: string | null | undefined): string {
  if (!text) return "";
  return normalizeDigitGlyphs(text).replace(/\D/g, "");
}

/**
 * Data (dia/mês/ano) tolerando separadores inconsistentes do OCR — inclusive
 * espaço ("28 / 09 / 2026") — normalizada para ISO (AAAA-MM-DD).
 */
function parseFlexibleDate(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(\d{1,2})\s*[/.,-]\s*(\d{1,2})\s*[/.,-]\s*(\d{2,4})/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!(day >= 1 && day <= 31)) return undefined;
  if (!(month >= 1 && month <= 12)) return undefined;
  if (!(year >= 2000 && year <= 2100)) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Chave de acesso ──────────────────────────────────────────────────────────

/**
 * Ruído típico de OCR dentro da chave: O→0, S→5, B→8, I/l→1. Só é aplicado
 * em blocos de 4 caracteres separados por espaço/ponto/hífen (formato da chave),
 * nunca em palavras do texto da DANFE.
 */
function normalizeKeyGlyphs(text: string): string {
  return text.replace(
    /[0-9OSosBIl]{4}(?:[ .\-/\r\n\t][0-9OSosBIl]{4,})+/g,
    (block) =>
      block
        .replace(/[Oo]/g, "0")
        .replace(/[Ss]/g, "5")
        .replace(/[Bb]/g, "8")
        .replace(/[Il]/g, "1"),
  );
}

/** Códigos de UF válidos (os 2 primeiros dígitos da chave). */
function isValidUfCode(code: string): boolean {
  if (!/^\d{2}$/.test(code)) return false;
  const n = Number(code);
  return (
    (n >= 11 && n <= 17) ||
    (n >= 21 && n <= 29) ||
    (n >= 31 && n <= 35) ||
    (n >= 41 && n <= 49) ||
    (n >= 50 && n <= 53)
  );
}

/** DV módulo 11: pesos 2..9 em ciclo da direita para a esquerda (SEFAZ). */
function accessKeyCheckDigit(base: string): string {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    const weight = 2 + ((base.length - 1 - i) % 8);
    sum += Number(base[i]) * weight;
  }
  const remainder = sum % 11;
  return remainder < 2 ? "0" : String(11 - remainder);
}

/** Estrutura (UF, AAMM, modelo 55/65) + dígito verificador. */
function isValidAccessKey44(digits: string): boolean {
  if (digits.length !== 44) return false;
  if (!/^\d{44}$/.test(digits)) return false;
  if (!isValidUfCode(digits.slice(0, 2))) return false;
  const month = Number(digits.slice(4, 6));
  if (!(month >= 1 && month <= 12)) return false;
  const model = digits.slice(20, 22);
  if (model !== "55" && model !== "65") return false;
  return digits.slice(43) === accessKeyCheckDigit(digits.slice(0, 43));
}

/**
 * Extrai a chave de 44 dígitos do texto. Retorna `undefined` quando o OCR não
 * reconheceu uma chave estruturalmente válida — o campo fica pendente de
 * conferência e NUNCA é preenchido com valor de gabarito.
 */
export function extractAccessKey44(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const digits = normalizeKeyGlyphs(text).replace(/\D/g, "");
  if (digits.length < 44) return undefined;
  for (let i = 0; i <= digits.length - 44; i++) {
    const candidate = digits.slice(i, i + 44);
    if (isValidAccessKey44(candidate)) return candidate;
  }
  return undefined;
}

export function validateAccessKey44(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 44) return false;
  return isValidAccessKey44(digits);
}

export type DanfeItemCandidateOptions = {
  quantity?: boolean;
  regionKey?: string;
};

interface ItemLine {
  index: number;
  code: string;
  description: string;
  ncm?: string;
  quantity: number;
  unit: string;
  unitValue: number;
  totalValue: number;
}

/** Unidades que são nomes de coluna — nunca a unidade de um item. */
const FORBIDDEN_UNITS = new Set([
  "NCM",
  "CST",
  "CFOP",
  "UNID",
  "ICMS",
  "IPI",
  "PIS",
  "COFINS",
  "ALIQ",
  "QTDE",
  "QUANT",
  "TOTAL",
  "VALOR",
  "PRODUTO",
  "SERVICO",
  "DESCRICAO",
  "MERCADORIA",
]);

/**
 * Unidades usuais da DANFE — usadas para reconhecer a ordem [UNID QUANT] do
 * layout clássico sem aceitar palavras quaisquer como unidade.
 */
const KNOWN_UNITS = new Set([
  "PC", "PÇ", "UN", "UND", "UNID", "CX", "KG", "G", "MG", "L", "LT", "ML",
  "MT", "M", "M2", "M3", "M²", "M³", "CM", "MM", "PAR", "PCT", "RL", "FD",
  "DZ", "JG", "KIT", "TB", "SC", "BB", "GL", "AMP", "KWH", "MWH", "MES",
  "TON", "T", "HR", "MIN", "DIA", "VERBA", "SERV", "PT", "FR", "GF", "LA",
]);

const HEADER_LINE_PATTERNS = [
  /DESCRI[ÇC][ÃA]O\s+DOS\s+PRODUTOS/i,
  /DESCRICAO\s+DOS\s+PRODUTOS/i,
  /VALOR\s+UNIT[ÁA]RIO/i,
  /ALIQ\.?\s+ICMS/i,
  /C[ÓO]D\.?\s*IGO/i,
  /DADOS\s+DOS\s+PRODUTOS/i,
  /N[ºo°]?\s*DO\s+PRODUTO/i,
];

const ITEM_INDEX_RE = /^\d{1,3}$/;
const ITEM_CODE_RE = /^\d{3,7}$/;
const QUANTITY_TOKEN_RE = /^\d{1,9}(?:[.,]\d{1,4})?$/;
const PRICE_TOKEN_RE = /^(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})$/;
const ALPHA_UNIT_RE = /^[A-Za-zÀ-ÿ]{1,6}\.?$/;

/**
 * Rótulos de coluna da tabela de produtos: o OCR às vezes os cola DENTRO da
 * linha do item ("… CHOCO NCM 84716053 CST 000 …"). São descartados na busca
 * pela janela de valores — nunca como unidade/descrição.
 */
const ITEM_COLUMN_LABELS = new Set([
  "NCM", "NCM/SH", "SH", "CST", "CSOSN", "CFOP", "UNID", "UNIDADE",
  "QUANT", "QUANTIDADE", "QTDE", "QTD", "VU", "VT", "V.UNIT", "VUNIT",
  "UNITARIO", "UNITÁRIO", "V.TOTAL", "VTOTAL", "ALIQ", "ICMS", "IPI",
]);

function isItemColumnLabel(token: string): boolean {
  return ITEM_COLUMN_LABELS.has(token.toUpperCase());
}

interface ValueWindow {
  start: number;
  unit: string;
  quantity: number;
  unitValue: number;
  totalValue: number;
}

function parsePrice(token: string): number {
  const hasComma = token.includes(",");
  const value = hasComma
    ? Number(token.replace(/\./g, "").replace(",", "."))
    : Number(token);
  return isFinite(value) ? value : 0;
}

function parseQuantity(token: string): number {
  if (!QUANTITY_TOKEN_RE.test(token)) return NaN;
  return Number(token.replace(",", "."));
}

function normalizedUnit(token: string): string {
  return token.replace(/[^A-Za-zÀ-ÿ]/g, "").toUpperCase();
}

/** Unidade plausível: sigla curta que NÃO é nome de coluna. */
function isUnitToken(token: string): boolean {
  if (!ALPHA_UNIT_RE.test(token)) return false;
  const clean = normalizedUnit(token);
  if (!clean) return false;
  return !FORBIDDEN_UNITS.has(clean);
}

/** Unidade reconhecida no layout [UNID QUANT] (sigla da DANFE ou 2–3 letras). */
function isKnownUnit(token: string): boolean {
  if (!isUnitToken(token)) return false;
  const clean = normalizedUnit(token);
  if (KNOWN_UNITS.has(clean)) return true;
  return /^[A-Z]{2,3}$/.test(token);
}

/**
 * Localiza a JANELA de valores do item — quantidade, unidade, valor unitário e
 * valor total — em QUALQUER posição da linha, sem depender do espaçamento nem
 * do número de colunas entre a descrição e os valores. Aceita as duas ordens
 * documentadas na DANFE ([QUANT UNID …] e [UNID QUANT …]), ignora colunas de
 * ICMS/IPI coladas DEPOIS do total e pula rótulos de coluna que o OCR colou no
 * meio da linha do item.
 */
function findItemValueWindow(tokens: string[]): ValueWindow | null {
  const indexes: number[] = [];
  const clean: string[] = [];
  tokens.forEach((token, index) => {
    if (isItemColumnLabel(token)) return;
    indexes.push(index);
    clean.push(token);
  });

  for (let i = 1; i <= clean.length - 4; i++) {
    const first = clean[i];
    const second = clean[i + 1];
    const priceToken = clean[i + 2];
    const totalToken = clean[i + 3];
    if (!PRICE_TOKEN_RE.test(priceToken) || !PRICE_TOKEN_RE.test(totalToken)) continue;

    // [quantidade] [unidade] [valor unitário] [valor total]
    if (QUANTITY_TOKEN_RE.test(first) && isUnitToken(second)) {
      const quantity = parseQuantity(first);
      if (isFinite(quantity) && quantity > 0) {
        return {
          start: indexes[i],
          unit: normalizedUnit(second),
          quantity,
          unitValue: parsePrice(priceToken),
          totalValue: parsePrice(totalToken),
        };
      }
    }

    // [unidade] [quantidade] [valor unitário] [valor total]
    if (QUANTITY_TOKEN_RE.test(second) && isKnownUnit(first)) {
      const quantity = parseQuantity(second);
      if (isFinite(quantity) && quantity > 0) {
        return {
          start: indexes[i],
          unit: normalizedUnit(first),
          quantity,
          unitValue: parsePrice(priceToken),
          totalValue: parsePrice(totalToken),
        };
      }
    }
  }
  return null;
}

/**
 * Código de coluna da tabela de produtos (NCM/CST/CFOP) que o OCR pode ter
 * colado ao fim da descrição. Números de 2 a 9 dígitos e NCM pontuado.
 */
function isTrailingColumnCode(token: string): boolean {
  if (/^\d{2,9}$/.test(token)) return true; // CST/CFOP/NCM sem pontuação
  if (/^\d{4}\.?\d{4}$/.test(token)) return true; // NCM pontuado (8471.6053)
  if (/^\d{2}\.\d{3}\.\d{3}$/.test(token)) return false; // parece CNPJ parcial
  return false;
}

/**
 * Descrição do item a partir dos tokens entre o código e a janela de valores:
 * códigos de coluna que vieram colados (NCM/CST/CFOP) são removidos do fim,
 * sem mexer no texto real do produto.
 */
function normalizeItemDescription(tokens: string[]): { description: string; ncm?: string } {
  let end = tokens.length;
  let ncm: string | undefined;

  while (end > 0) {
    const token = tokens[end - 1];
    if (isItemColumnLabel(token)) {
      end--;
      continue;
    }
    if (!isTrailingColumnCode(token)) break;
    const digits = token.replace(/[.\s]/g, "");
    if (!ncm && /^\d{8}$/.test(digits)) ncm = digits;
    end--;
  }

  const description = tokens
    .slice(0, end)
    .join(" ")
    .trim()
    .replace(/[-–—]+$/, "")
    .trim();
  return { description, ncm };
}

/**
 * Linha de item só é aceita com evidência completa: índice, código, descrição,
 * quantidade > 0, unidade real (não nome de coluna) e valores. Cabeçalhos,
 * linhas curtas e ruído de OCR nunca viram produto.
 */
function parseItemTokens(tokens: string[]): ItemLine | null {
  if (tokens.length < 6) return null;
  if (!ITEM_INDEX_RE.test(tokens[0])) return null;
  if (!ITEM_CODE_RE.test(tokens[1])) return null;

  const window = findItemValueWindow(tokens);
  if (!window) return null;

  const { description, ncm } = normalizeItemDescription(tokens.slice(2, window.start));
  if (description.length < 5) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(description)) return null;
  if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(description))) return null;

  return {
    index: Number(tokens[0]),
    code: tokens[1],
    description,
    ncm,
    quantity: window.quantity,
    unit: window.unit,
    unitValue: window.unitValue,
    totalValue: window.totalValue,
  };
}

function parseItemLine(rawLine: string | null | undefined): ItemLine | null {
  if (!rawLine) return null;
  const line = rawLine.trim().replace(/\s+/g, " ");
  if (!line) return null;
  if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(line))) return null;
  return parseItemTokens(line.split(" "));
}

export function isValidDanfeItemCandidate(
  line: string | null | undefined,
  _options: DanfeItemCandidateOptions = {},
): boolean {
  return parseItemLine(line) !== null;
}

export function isDanfeParseBetter(a: DanfeParseResult, b: DanfeParseResult): boolean {
  const aValid = countValid(a);
  const bValid = countValid(b);
  if (aValid !== bValid) {
    return aValid > bValid;
  }
  if (a.accessKey && !b.accessKey) return true;
  if (!a.accessKey && b.accessKey) return false;
  if (a.emitterCnpj && !b.emitterCnpj) return true;
  if (!a.emitterCnpj && b.emitterCnpj) return false;
  return (a.nfeNumber ?? "").length > (b.nfeNumber ?? "").length;
}

// ─── Parser principal ─────────────────────────────────────────────────────

type SectionKey = "emitente" | "destinatario" | "transportador" | "expedidor";

interface SectionData {
  cnpj?: string;
  cnpjIndex?: number;
  name?: string;
  city?: string;
  uf?: string;
  cep?: string;
  address?: string;
}

const SECTION_PATTERNS: Array<{ key: SectionKey; re: RegExp }> = [
  { key: "transportador", re: /TRANSPORTADOR(?:A)?|REDESPACHO/i },
  { key: "expedidor", re: /EXPEDI[ÇC][ÃA]O/i },
  { key: "destinatario", re: /DESTINAT[ÁA]RIO|REMETENTE|DESTINATARIO|RECEBEDOR/i },
  { key: "emitente", re: /IDENTIFICA[ÇC][ÃA]O\s+DO\s+EMITENTE|\bEMITENTE\b/i },
];

interface SectionLabelMatch {
  key: SectionKey;
  index: number;
  end: number;
}

function sectionLabelMatch(line: string): SectionLabelMatch | undefined {
  for (const { key, re } of SECTION_PATTERNS) {
    const found = line.match(re);
    if (found) return { key, index: found.index ?? 0, end: (found.index ?? 0) + found[0].length };
  }
  return undefined;
}

/** Siglas de UF válidas — evita confundir ruído de 2 letras com o estado. */
const UF_LIST = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
  "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC",
  "SE", "SP", "TO",
]);

/**
 * CNPJ com tolerância ao OCR: aceita máscara com glifos trocados
 * (O↔0, S↔5, B↔8, I↔1) e também os 14 dígitos sem pontuação. Um candidato só é
 * aceito quando NÃO faz parte de uma sequência numérica maior — a chave de
 * acesso de 44 dígitos, por exemplo, nunca é lida como CNPJ.
 */
function findCnpjCandidates(line: string): Array<{ raw: string; formatted: string }> {
  const found: Array<{ raw: string; formatted: string }> = [];
  const seen = new Set<string>();
  const push = (raw: string, start: number) => {
    const before = start > 0 ? line[start - 1] : "";
    const after = start + raw.length < line.length ? line[start + raw.length] : "";
    if (/[0-9A-Za-z]/.test(before) || /[0-9A-Za-z]/.test(after)) return;
    const digits = digitsFromOcr(raw);
    if (digits.length !== 14) return;
    if (seen.has(digits)) return;
    seen.add(digits);
    found.push({ raw, formatted: formatCnpjLocal(digits) });
  };

  const glyph = "[0-9OoQIl|!SsBbZzGg]";
  const masked = new RegExp(
    `${glyph}{2}\\.?\\s*${glyph}{3}\\.?\\s*${glyph}{3}[/\\s]?${glyph}{4}[-.\\s]?${glyph}{2}`,
    "g",
  );
  for (const match of line.matchAll(masked)) {
    if (match.index !== undefined) push(match[0], match.index);
  }

  for (const match of line.matchAll(/\d{14}/g)) {
    if (match.index !== undefined) push(match[0], match.index);
  }

  return found;
}

function formatCepLocal(value: string): string {
  const digits = digitsFromOcr(value);
  if (digits.length !== 8) return value;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
}

/** Palavras de rótulo que NUNCA são razão social/nome. */
const SECTION_WORD =
  /^(?:REMETENTE|DESTINAT[ÁA]RIO|TRANSPORTADOR(?:A)?|EXPEDIDOR|EMITENTE|REDESPACHO|ENDERE[ÇC]O|MUNIC[ÍI]PIO|CIDADE|UF|INSCRI[ÇC][ÃA]O|FONE|CEP|DADOS|IDENTIFICA[ÇC][ÃA]O|DOCUMENTO|AUXILIAR|NATUREZA|PROTOCOLO)$/i;

const NAME_BLACKLIST =
  /^(DANFE|NF-?e|CHAVE|NATUREZA|PROTOCOLO|INSCRI|DATA|DESTINAT|TRANSPORT|EXPEDI|EMITENTE|VALOR|DADOS|CNPJ|CPF|CEP|FONE|DESCRI|C[ÓO]D|S[ÉE]RIE|GRUPO)/i;
const STREET_PREFIX = /^(RUA|AVENIDA|TRAVESSA|ALAMEDA|RODOVIA|ESTRADA|PRA[ÇC]A)\b/i;

function isNameCandidate(line: string | undefined): line is string {
  if (!line) return false;
  const value = line.trim();
  if (value.length < 5) return false;
  if (/\d/.test(value)) return false;
  if (SECTION_WORD.test(value)) return false;
  if (NAME_BLACKLIST.test(value)) return false;
  if (STREET_PREFIX.test(value)) return false;
  if (/^[A-Za-zÀ-ÿ\s'.]+\/[A-Za-z]{2}$/.test(value)) return false; // cidade/UF
  if (!/[A-Za-zÀ-ÿ]{3,}/.test(value)) return false;
  return true;
}

/**
 * Nome a partir de um texto que sobrou na linha (depois do rótulo ou do CNPJ):
 * remove resíduos de rótulo/pontuação e só aceita texto com cara de razão
 * social — nunca um rótulo ou um número.
 */
function nameFromText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw
    .replace(/\b(?:CNPJ|CPF)\b\s*:?/gi, " ")
    .replace(/[|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[:\-–—.,;]+/, "")
    .trim();
  return isNameCandidate(value) ? value : undefined;
}

/** Rótulo de razão social/nome — valor na mesma linha ou na linha seguinte. */
function nameLabelValue(line: string, next?: string): string | undefined {
  const match = line.match(
    /^(?:RAZ[ÃA]O\s+SOCIAL|NOME\s+(?:DO\s+|DA\s+)?(?:DESTINAT[ÁA]RIO|EMITENTE|REMETENTE|RECEBEDOR|FORNECEDOR))\s*:?\s*(.*)$/i,
  );
  if (!match) return undefined;
  const inline = nameFromText(match[1]);
  if (inline) return inline;
  return nameFromText(next);
}

function isCityLike(line: string | undefined): boolean {
  if (!line) return false;
  const value = line.trim();
  if (value.length < 3) return false;
  if (/\d/.test(value)) return false;
  if (value.includes(":")) return false;
  if (SECTION_WORD.test(value)) return false;
  if (NAME_BLACKLIST.test(value)) return false;
  if (STREET_PREFIX.test(value)) return false;
  if (/^[A-Za-zÀ-ÿ\s'.]+\/[A-Za-z]{2}$/.test(value)) return false;
  return /[A-Za-zÀ-ÿ]{3,}/.test(value);
}

// ─── Campos identificados por rótulo ────────────────────────────────────────

/** Número da NF-e: rótulo "NF-e Nº", "Nº" ou "Nº DA NOTA", valor na mesma linha ou na seguinte. */
const NF_NUMBER_LABEL = /(?:NF-?E?|NOTA\s+FISCAL)?\s*N(?:[º°oO]|UM(?:ERO)?|ÚMERO)\.?\s*:?\s*(?:DA\s+)?(?:NOTA\s+FISCAL|NF-?E?|NOTA)?\.?\s*:?\s*/i;

function readLeadingNumber(raw: string | undefined): string | undefined {
  if (!raw || /^[A-Za-zÀ-ÿ]/.test(raw)) return undefined;
  const match = raw.match(/\d[\d.\s]*\d|\d/);
  if (!match) return undefined;
  const digits = match[0].replace(/\D/g, "");
  if (!digits || digits.length > 9) return undefined;
  if (!/[1-9]/.test(digits)) return undefined;
  return digits.replace(/^0+(?=\d)/, "");
}

function extractNfeNumber(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(NF_NUMBER_LABEL);
    if (!match) continue;
    const rest = line.slice((match.index ?? 0) + match[0].length);
    const sameLine = readLeadingNumber(rest);
    if (sameLine) return sameLine;
    // Rótulo e valor separados pelo OCR: a linha seguinte só vale quando não é
    // a linha da série/chave/emissão (o número lido seria de outro campo).
    const next = lines[i + 1];
    if (!next || /S[ÉE]RIE|CHAVE|EMISS|PROTOCOLO/i.test(next)) continue;
    const found = readLeadingNumber(next);
    if (found) return found;
  }
  return undefined;
}

const SERIES_LABEL = /S[ÉE]RIE\s*\.?\s*:?\s*/i;

function readSeriesDigits(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\b\d{1,3}\b/);
  return match ? match[0] : undefined;
}

function extractSeries(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(SERIES_LABEL);
    if (!match) continue;
    const rest = line.slice((match.index ?? 0) + match[0].length);
    const sameLine = readSeriesDigits(rest);
    if (sameLine) return sameLine;
    const found = readSeriesDigits(lines[i + 1]);
    if (found) return found;
  }
  return undefined;
}

const EMISSION_LABEL = /(?:DATA\s+(?:DE\s+|DA\s+)?)?EMISS[ÃA]O\s*\.?\s*:?\s*/i;

function extractEmissionDate(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(EMISSION_LABEL);
    if (!match) continue;
    const rest = line.slice((match.index ?? 0) + match[0].length);
    const sameLine = parseFlexibleDate(rest);
    if (sameLine) return sameLine;
    for (let step = 1; step <= 2; step++) {
      const next = lines[i + step];
      if (next === undefined || EMISSION_LABEL.test(next)) break;
      if (step === 1 && /SA[ÍI]DA|PROTOCOLO|CHAVE/i.test(next)) break;
      const value = parseFlexibleDate(next);
      if (value) return value;
    }
  }
  return undefined;
}

function extractLabeledCode(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match) return undefined;
  const value = match[1].replace(/\s+/g, "").trim();
  return value || undefined;
}

function extractAfNumber(text: string): string | undefined {
  return extractLabeledCode(text, /\bAF\s*[:\-]?\s*([0-9]{1,6}(?:\/[0-9]{1,4})?)/i);
}

function extractEmpenhoNumber(text: string): string | undefined {
  return extractLabeledCode(text, /\bEMPENHO\s*[:\-]?\s*([0-9]{1,6}(?:\/[0-9]{1,4})?)/i);
}

function extractProcessNumber(text: string): string | undefined {
  return extractLabeledCode(
    text,
    /\bPROCESSO(?:\s+ADMINISTRATIVO)?\s*[:\-]?\s*([0-9][0-9.\/-]{2,})/i,
  );
}

/** Rótulos do total da NF (o valor pode cair na linha seguinte, no OCR). */
const TOTAL_VALUE_LABEL =
  /(?:VALOR|VL)\.?\s*TOTAL(?:\s+(?:DA|DO|DE))?(?:\s+NF-?E?|\s+NOTA(?:\s+FISCAL)?|\s+PRODUTOS?)?\s*\.?\s*:?\s*/i;

function readMoney(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/);
  if (!match) return undefined;
  const value = parsePrice(match[0]);
  return isFinite(value) ? value : undefined;
}

function extractTotalValue(lines: string[]): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TOTAL_VALUE_LABEL);
    if (!match) continue;
    const rest = line.slice((match.index ?? 0) + match[0].length);
    const sameLine = readMoney(rest);
    if (sameLine !== undefined) return sameLine;
    for (let step = 1; step <= 2; step++) {
      const next = lines[i + step];
      if (next === undefined || TOTAL_VALUE_LABEL.test(next)) break;
      const value = readMoney(next);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

/**
 * Itens da NF-e. A linha do produto é aceita com índice + código + descrição +
 * janela de valores; quando o OCR quebra a linha do produto em duas, a junção
 * só acontece com evidência dos DOIS lados (índice/código e descrição/valores).
 */
function extractItems(lines: string[]): DanfeItem[] {
  const items: DanfeItem[] = [];
  const seen = new Set<string>();

  for (let position = 0; position < lines.length; position++) {
    const line = lines[position];
    const tokens = line.split(" ");
    let parsed = parseItemTokens(tokens);
    let consumedNext = false;

    if (!parsed && ITEM_INDEX_RE.test(tokens[0] ?? "") && ITEM_CODE_RE.test(tokens[1] ?? "")) {
      const next = lines[position + 1];
      if (next) {
        const merged = parseItemTokens([...tokens, ...next.split(" ")]);
        if (merged) {
          parsed = merged;
          consumedNext = true;
        }
      }
    }

    if (!parsed) continue;
    const key = line.trim().replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue; // linha repetida por OCR/regiões nunca duplica produto
    seen.add(key);
    items.push({
      index: parsed.index,
      lineNumber: position + 1,
      code: parsed.code,
      description: parsed.description,
      ncm: parsed.ncm,
      quantity: parsed.quantity,
      unit: parsed.unit,
      unitValue: parsed.unitValue,
      totalValue: parsed.totalValue,
    });
    if (consumedNext) position++;
  }

  return items;
}

/**
 * Nome da seção: rótulo explícito, senão o texto com cara de razão social mais
 * próximo do CNPJ (a linha imediatamente acima na DANFE).
 */
function findNameNearCnpj(lines: string[], cnpjIndex: number | undefined): string | undefined {
  if (cnpjIndex === undefined) return undefined;
  const from = Math.max(0, cnpjIndex - 4);
  for (let i = cnpjIndex; i >= from; i--) {
    const explicit = nameLabelValue(lines[i] ?? "", lines[i + 1]);
    if (explicit) return explicit;
  }
  for (let i = cnpjIndex; i >= from; i--) {
    const candidate = lines[i];
    if (isNameCandidate(candidate)) return candidate.trim();
  }
  for (let i = cnpjIndex + 1; i <= cnpjIndex + 2; i++) {
    const candidate = lines[i];
    if (isNameCandidate(candidate)) return candidate.trim();
  }
  return undefined;
}

export function parseDanfeText(text: string | null | undefined): DanfeParseResult {
  if (!text || !text.trim()) return emptyResult(false);

  const clean = text.replace(/\r\n?/g, "\n").trim();
  const lines = clean
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  const sections: Record<SectionKey, SectionData> = {
    emitente: {},
    destinatario: {},
    transportador: {},
    expedidor: {},
  };
  let section: SectionKey = "emitente";

  lines.forEach((line, index) => {
    const label = sectionLabelMatch(line);
    if (label) {
      section = label.key;
      const trailing = nameFromText(line.slice(label.end));
      if (trailing && !sections[section].name) sections[section].name = trailing;
    }

    const data = sections[section];

    if (!data.cnpj) {
      const candidates = findCnpjCandidates(line);
      if (candidates.length) {
        data.cnpj = candidates[0].formatted;
        data.cnpjIndex = index;
        // Nome lido na MESMA linha do CNPJ ("INCOTECH COMPANY LTDA CNPJ …").
        const inline = nameFromText(line.replace(candidates[0].raw, " "));
        if (inline && !data.name) data.name = inline;
      }
    }

    const explicitName = nameLabelValue(line, lines[index + 1]);
    if (explicitName && !data.name) data.name = explicitName;

    const cityLabeled = line.match(/^(?:Cidade|Munic[íi]pio)\s*:\s*(.+)$/i);
    const labeledCity = cityLabeled ? nameFromText(cityLabeled[1]) : undefined;
    if (labeledCity && !data.city) data.city = labeledCity;

    const ufLabeled = line.match(/^(?:UF|Estado)\s*:?\s*([A-Za-z]{2})\b/i);
    if (ufLabeled && !data.uf && UF_LIST.has(ufLabeled[1].toUpperCase())) {
      data.uf = ufLabeled[1].toUpperCase();
    }

    // "Cidade/UF" — pode vir sozinha, colada ao CEP ou a um complemento.
    const cityUf = line.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.]{1,40}?)\s*\/\s*([A-Za-z]{2})\b/);
    if (cityUf) {
      const city = nameFromText(cityUf[1]);
      if (city && !data.city) data.city = city;
      if (!data.uf && UF_LIST.has(cityUf[2].toUpperCase())) data.uf = cityUf[2].toUpperCase();
    }

    // "CIDADE UF" em colunas separadas (o OCR perde a barra de "Cidade/UF").
    if (!data.uf) {
      const tokens = line.split(" ");
      const ufToken = tokens[1] ?? "";
      const ufCandidate = ufToken.replace(/[^A-Za-z]/g, "").toUpperCase();
      if (
        tokens.length >= 2 &&
        tokens.length <= 5 &&
        ufToken === ufToken.toUpperCase() &&
        ufCandidate.length === 2 &&
        UF_LIST.has(ufCandidate)
      ) {
        const city = nameFromText(tokens[0].replace(/[,;.]+$/, ""));
        if (city) {
          if (!data.city) data.city = city;
          data.uf = ufCandidate;
        }
      }
    }

    const cep = line.match(/\bCEP\s*:?\s*([\dOoQIl|!SsBbZzGg]{5})[\s.-]?([\dOoQIl|!SsBbZzGg]{3})\b/i);
    if (cep && !data.cep) {
      const formatted = formatCepLocal(`${cep[1]}${cep[2]}`);
      if (digitsFromOcr(formatted).length === 8) data.cep = formatted;
    }

    const labeledAddress = line.match(/^(?:Endere[çc]o|Endereco)\s*:?\s*(.+)$/i);
    const streetAddress = STREET_PREFIX.test(line) ? line : undefined;
    const address = labeledAddress ? labeledAddress[1].trim() : streetAddress;
    if (address && !data.address) data.address = address;

    if (/^[A-Za-z]{2}$/.test(line)) {
      const upper = line.toUpperCase();
      if (!data.uf && UF_LIST.has(upper)) {
        data.uf = upper;
        const previous = lines[index - 1];
        if (!data.city && isCityLike(previous)) data.city = previous!.trim();
      }
    }
  });

  for (const key of Object.keys(sections) as SectionKey[]) {
    const data = sections[key];
    if (data.name) continue;
    data.name = findNameNearCnpj(lines, data.cnpjIndex);
  }

  const nfeNumber = extractNfeNumber(lines);
  const series = extractSeries(lines);
  const emissionDate = extractEmissionDate(lines);
  const accessKey = extractAccessKey44(clean);
  const items = extractItems(lines);
  const totalValue = extractTotalValue(lines);
  const afNumber = extractAfNumber(clean);
  const empenhoNumber = extractEmpenhoNumber(clean);
  const processNumber = extractProcessNumber(clean);

  const emitter = sections.emitente;
  const receiver = sections.destinatario;
  const transporter = sections.transportador;
  const issuer = sections.expedidor;

  const ok = Boolean(
    nfeNumber ||
      series ||
      emissionDate ||
      accessKey ||
      emitter.cnpj ||
      emitter.name ||
      receiver.cnpj ||
      receiver.name ||
      transporter.cnpj ||
      issuer.cnpj ||
      afNumber ||
      empenhoNumber ||
      processNumber ||
      totalValue !== undefined ||
      items.length,
  );

  return {
    ok,
    items,
    nfeNumber,
    series,
    emissionDate,
    accessKey,
    emitterCnpj: emitter.cnpj,
    emitterName: emitter.name,
    emitterAddress: emitter.address,
    emitterCity: emitter.city,
    emitterState: emitter.uf,
    emitterPostalCode: emitter.cep,
    receiverCnpj: receiver.cnpj,
    receiverName: receiver.name,
    transporterCnpj: transporter.cnpj,
    issuerCnpj: issuer.cnpj,
    issuerName: issuer.name,
    afNumber,
    empenhoNumber,
    processNumber,
    totalValue,
  };
}

export function buildOcrTrace(
  rawText: string | undefined,
  pageOcrText: string | undefined,
  regionTexts: readonly string[],
  mergedOcr: string,
  parsedLayer: DanfeParseResult,
  parsedOcr: DanfeParseResult,
  best: DanfeParseResult,
  source: string,
  srcLayerBlob?: string | null,
): OcrTrace {
  return {
    rawText: rawText ?? "",
    pageOcrText: pageOcrText ?? "",
    regionTexts,
    mergedOcr,
    parsedLayer,
    parsedOcr,
    best,
    source,
    srcLayerBlob: srcLayerBlob ?? null,
    fieldTraces: buildFieldTraces(best, source, srcLayerBlob),
    comparison: {
      layerValid: countValid(parsedLayer),
      ocrValid: countValid(parsedOcr),
    },
  };
}

function countValid(parsed: DanfeParseResult): number {
  let count = 0;
  if (parsed.nfeNumber) count++;
  if (parsed.series) count++;
  if (parsed.emissionDate) count++;
  if (parsed.accessKey) count++;
  if (parsed.emitterCnpj) count++;
  if (parsed.emitterName) count++;
  if (parsed.receiverCnpj) count++;
  if (parsed.receiverName) count++;
  if (parsed.issuerCnpj) count++;
  if (parsed.issuerName) count++;
  return count;
}

function buildFieldTraces(
  parsed: DanfeParseResult,
  source: string,
  srcLayerBlob?: string | null,
): OcrFieldTrace[] {
  const fields: Array<{ field: keyof DanfeParseResult; value: string }> = [
    { field: "nfeNumber", value: parsed.nfeNumber ?? "" },
    { field: "series", value: parsed.series ?? "" },
    { field: "emissionDate", value: parsed.emissionDate ?? "" },
    { field: "accessKey", value: parsed.accessKey ?? "" },
    { field: "emitterCnpj", value: parsed.emitterCnpj ?? "" },
    { field: "emitterName", value: parsed.emitterName ?? "" },
    { field: "receiverCnpj", value: parsed.receiverCnpj ?? "" },
    { field: "receiverName", value: parsed.receiverName ?? "" },
    { field: "issuerCnpj", value: parsed.issuerCnpj ?? "" },
    { field: "issuerName", value: parsed.issuerName ?? "" },
  ];

  void srcLayerBlob;
  return fields.map(({ field, value }) => ({
    field,
    value,
    source,
    confidence: value ? 85 : 0,
    isValid: Boolean(value),
    notes: value ? "" : "Não encontrado",
  }));
}

