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
 *
 * Rodada 18 — hierarquia de evidência (aprendida nos relatórios reais):
 *   1. CHAVE DE ACESSO válida (44 dígitos + DV) é a fonte autoritativa de
 *      modelo, série, número e AAMM — nenhum número lido de região ambígua
 *      prevalece sobre ela;
 *   2. rótulos da DANFE (NOME, CNPJ/CPF, VALOR TOTAL DA NOTA…) com valor na
 *      mesma linha ou na adjacente, dentro da seção correta;
 *   3. contexto estrutural (bloco cidade/UF/CEP, janela de valores do item).
 *   Linhas de chave (sequências longas de dígitos) NUNCA são fonte de CNPJ;
 *   CNPJ só é aceito com dígito verificador válido.
 */
import { isValidCnpj } from "./br-validators";

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
  /**
   * Observações por campo: origem da escolha, conflito com a chave de acesso e
   * motivo de pendência. Exibidas no diálogo e no relatório de diagnóstico.
   */
  notes?: Record<string, string>;
  /** Confiança por campo (0..100), usada para marcar baixa confiança. */
  confidence?: Record<string, number>;
}

export interface DanfeFieldSummary {
  found: number;
  total: number;
  missing: string[];
}

/** Resultado da validação de um campo (Rodada 18 §7). */
export interface DanfeFieldValidation {
  campo: string;
  titulo: string;
  ok: boolean;
  note: string;
  confidence: number;
}

/** Tolerância entre quantidade × valor unitário e o total do item. */
const ITEM_TOTAL_TOLERANCE = 0.05;

function itemIsCoherent(item: DanfeItem): boolean {
  if (!(item.quantity > 0)) return false;
  if (!(item.unitValue >= 0) || !(item.totalValue > 0)) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(item.description) || item.description.trim().length < 5) return false;
  if (!/^\d{3,7}$/.test(item.code)) return false;
  const expected = item.quantity * item.unitValue;
  const tolerance = Math.max(ITEM_TOTAL_TOLERANCE, expected * 0.01);
  return Math.abs(expected - item.totalValue) <= tolerance;
}

function isValidDateString(value: string | undefined): boolean {
  if (!value) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function looksLikeLegalName(value: string | undefined, strict = true): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 5) return false;
  if (!/[A-Za-zÀ-ÿ]{3,}/.test(trimmed)) return false;
  if (strict) {
    if (/\d/.test(trimmed)) return false;
    if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
    if (LABEL_START_TOKEN.test(trimmed)) return false;
  }
  return true;
}

/**
 * Validação campo a campo (Rodada 18 §7): um campo só conta como identificado
 * quando passa na validação ESPECÍFICA dele — número/série coerentes com a
 * chave válida, data realmente válida, CNPJ com DV válido, item com total
 * coerente com quantidade × valor unitário.
 */
export function validateDanfeFields(parsed: DanfeParseResult): DanfeFieldValidation[] {
  const keyParts = parseAccessKey44(parsed.accessKey);
  const notes = parsed.notes ?? {};
  const confidence = parsed.confidence ?? {};

  const build = (
    campo: string,
    titulo: string,
    ok: boolean,
    fallbackNote: string,
  ): DanfeFieldValidation => ({
    campo,
    titulo,
    ok,
    note: ok ? (notes[campo] ?? "") : (notes[campo] || fallbackNote),
    confidence: ok ? (confidence[campo] ?? 80) : Math.min(confidence[campo] ?? 0, 40),
  });

  const nfeNumberMatchesKey = keyParts ? parsed.nfeNumber === keyParts.number : true;
  const seriesMatchesKey = keyParts ? parsed.series === keyParts.series : true;
  const dateMatchesKey = (() => {
    if (!keyParts || !parsed.emissionDate) return true;
    const [year, month] = parsed.emissionDate.split("-").map(Number);
    return year === keyParts.year && month === keyParts.month;
  })();
  const coherentItems = parsed.items.filter(itemIsCoherent);

  return [
    build(
      "nfeNumber",
      "Número da NF-e",
      Boolean(parsed.nfeNumber && /^\d{1,9}$/.test(parsed.nfeNumber) && nfeNumberMatchesKey),
      keyParts ? "Número conflita ou diverge da chave de acesso válida." : "Número não identificado.",
    ),
    build(
      "series",
      "Série",
      Boolean(parsed.series && /^\d{1,3}$/.test(parsed.series) && seriesMatchesKey),
      keyParts ? "Série conflita ou diverge da chave de acesso válida." : "Série não identificada.",
    ),
    build(
      "emissionDate",
      "Data de emissão",
      isValidDateString(parsed.emissionDate) && dateMatchesKey,
      keyParts
        ? "Data ausente, inválida ou em conflito com o AAMM da chave de acesso."
        : "Data ausente ou inválida.",
    ),
    build(
      "accessKey",
      "Chave de acesso",
      validateAccessKey44(parsed.accessKey),
      "Chave de 44 dígitos não reconhecida ou com dígito verificador inválido.",
    ),
    build(
      "emitterCnpj",
      "CNPJ emitente",
      Boolean(parsed.emitterCnpj && isValidCnpj(parsed.emitterCnpj)),
      "CNPJ do emitente ausente ou com dígito verificador inválido.",
    ),
    build(
      "emitterName",
      "Razão social emitente",
      looksLikeLegalName(parsed.emitterName, false),
      "Razão social do emitente não identificada na região do fornecedor.",
    ),
    build(
      "receiverCnpj",
      "CNPJ destinatário",
      Boolean(parsed.receiverCnpj && isValidCnpj(parsed.receiverCnpj)),
      "CNPJ do destinatário ausente ou com dígito verificador inválido.",
    ),
    build(
      "receiverName",
      "Razão social destinatário",
      looksLikeLegalName(parsed.receiverName, false),
      "Razão social do destinatário não identificada na seção DESTINATÁRIO/REMETENTE.",
    ),
    build(
      "issuerCnpj",
      "CNPJ expedidor",
      Boolean(parsed.issuerCnpj && isValidCnpj(parsed.issuerCnpj)),
      "Sem evidência do expedidor no documento.",
    ),
    build(
      "items",
      "Itens da NF-e",
      coherentItems.length > 0,
      parsed.items.length
        ? "Item lido sem coerência entre quantidade, valor unitário e total."
        : "Nenhum item identificado com segurança.",
    ),
  ];
}

/**
 * Contador “X de 10 campos”: conta SOMENTE campos que passaram na validação
 * específica — não basta ter algum texto preenchido.
 */
export function danfeFieldSummary(parsed: DanfeParseResult): DanfeFieldSummary {
  const validations = validateDanfeFields(parsed);
  const byField = new Map(validations.map((validation) => [validation.campo, validation]));
  let found = 0;
  const missing: string[] = [];

  for (const field of DANFE_TRACKED_FIELDS) {
    const validation = byField.get(field.campo);
    if (validation?.ok) {
      found++;
    } else {
      missing.push(field.titulo);
    }
  }

  return { found, total: DANFE_TRACKED_FIELDS.length, missing };
}

/**
 * Pendências para a interface: campos que NÃO passaram na validação (com o
 * motivo: conflito com a chave, DV inválido, ausência de evidência…).
 */
export function danfeFieldNotes(parsed: DanfeParseResult): DanfeFieldValidation[] {
  return validateDanfeFields(parsed).filter((validation) => !validation.ok);
}

/**
 * Observações informativas: campos válidos cuja origem merece registro (por
 * exemplo, número/série que vieram da chave de acesso porque o OCR conflitou).
 */
export function danfeFieldWarnings(parsed: DanfeParseResult): DanfeFieldValidation[] {
  return validateDanfeFields(parsed).filter((validation) => validation.ok && validation.note);
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
  return { ok, items: [], notes: {}, confidence: {} };
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
function parseFlexibleDate(raw: string | null | undefined, requireComplete = false): string | undefined {
  if (!raw) return undefined;
  // Glifos trocados em posição numérica ("28/O9/2O26") já saíram do OCR real:
  // normaliza ANTES de validar — nunca em texto descritivo.
  const normalized = normalizeDigitGlyphs(raw);

  const build = (year: number, month: number, day: number): string | undefined => {
    if (!(day >= 1 && day <= 31)) return undefined;
    if (!(month >= 1 && month <= 12)) return undefined;
    if (!(year >= 2000 && year <= 2100)) return undefined;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  // Formato ISO impresso ("2026-09-28") — checado ANTES de dd/mm/aaaa, senão
  // "2026-09-28" seria lido como 26/09/2028.
  const iso = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const value = build(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (value) return value;
  }

  const match = normalized.match(/(\d{1,2})\s*[/.,-]\s*(\d{1,2})\s*[/.,-]\s*(\d{2,4})/);
  if (!match) return undefined;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  return build(year, Number(match[2]), Number(match[1]));
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
        .replace(/[Il]/g, "1")
        .replace(/"?/g, ""),
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

export interface AccessKeyParts {
  /** Código IBGE da UF do emitente (2 dígitos). */
  ufCode: string;
  /** Ano de emissão (4 dígitos, derivado do AAMM). */
  year: number;
  /** Mês de emissão (1..12, derivado do AAMM). */
  month: number;
  /** CNPJ do emitente em dígitos. */
  emitterCnpjDigits: string;
  /** Modelo do documento: 55 (NF-e) ou 65 (NFC-e). */
  model: string;
  /** Série como impressa na chave (3 dígitos). */
  series: string;
  /** Número da NF-e sem zeros à esquerda. */
  number: string;
}

/**
 * Decomposição PADRONIZADA da chave de acesso (layout oficial):
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) cNF(8) cDV(1).
 *
 * Só devolve partes quando a chave tem 44 dígitos e passa no DV — assim o
 * número/série derivados dela são evidência forte (não leitura ambígua) para
 * confrontar com o que o OCR devolveu.
 */
export function parseAccessKey44(raw: string | null | undefined): AccessKeyParts | undefined {
  if (!raw) return undefined;
  const digits = normalizeDigitGlyphs(raw).replace(/\D/g, "");
  if (digits.length !== 44) return undefined;
  if (!isValidAccessKey44(digits)) return undefined;
  const number = digits.slice(25, 34).replace(/^0+(?=\d)/, "");
  if (!number) return undefined;
  return {
    ufCode: digits.slice(0, 2),
    year: 2000 + Number(digits.slice(2, 4)),
    month: Number(digits.slice(4, 6)),
    emitterCnpjDigits: digits.slice(6, 20),
    model: digits.slice(20, 22),
    series: digits.slice(22, 25),
    number,
  };
}

/**
 * Maior sequência de dígitos de uma linha, ignorando separadores de máscara.
 * Linhas com sequências longas (chave de acesso, protocolo) não podem ser
 * fonte de CNPJ/valores de coluna — o OCR lê a chave como um bloco numérico.
 */
function longestDigitRun(text: string): number {
  const compact = text.replace(/[\s.,/\-]/g, "");
  let best = 0;
  let run = 0;
  for (const char of compact) {
    if (char >= "0" && char <= "9") {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** Limite a partir do qual a linha é considerada bloco numérico (chave/nº). */
const LONG_DIGIT_RUN = 20;

export type DanfeItemCandidateOptions = {
  quantity?: boolean;
  regionKey?: string;
};

interface ItemLine {
  index?: number;
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
  // "DADOS DO PRODUTO/SERVIÇO" (singular — como sai no OCR real) e variantes.
  /DADOS\s+DO(?:S)?\s+PRODUTOS?/i,
  /PRODUTO(?:S)?\s*\/\s*SERVI[ÇC]OS?/i,
  /N[ºo°]?\s*DO\s+PRODUTO/i,
];

const ITEM_INDEX_RE = /^\d{1,3}$/;
const ITEM_CODE_RE = /^\d{3,7}$/;
const QUANTITY_TOKEN_RE = /^\d{1,9}(?:[.,]\d{1,4})?$/;
// Aceita 2 a 4 decimais: o OCR real do PDF/PNG já imprimiu preços e
// quantidades com 4 casas (ex.: "52,9400", "25,0000") — travar em 2
// decimais fazia o item inteiro deixar de ser identificado (defeito real da
// Rodada 21).
const PRICE_TOKEN_RE = /^(?:\d{1,3}(?:\.\d{3})*,\d{2,4}|\d+,\d{2,4}|\d+\.\d{2,4})$/;

/** O OCR pode colar o total em duas partes: "1.323,"
 * "50". Se parte, detectamos "R$ 1, 323,50" e "1.323,"+"50" e
 * reconstruímos o valor real sem precisar da próxima linha.
 */
function prefixedMoneyToken(raw: string): boolean {
  return /^R\$\s*/i.test(raw);
}

function looksLikeSplitPrice(first: string, second: string): boolean {
  return /,\s*$/.test(first) && /^\d{2}$/.test(second);
}

function reconstructSplitPrice(first: string, second: string): number {
  const joined = first.replace(/\s*,\s*$/, "") + "," + second;
  const value = parsePrice(joined);
  return isFinite(value) ? value : NaN;
}

function findSplitPriceInItemLine(tokens: string[]): ValueWindow | null {
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (PRICE_TOKEN_RE.test(current) && looksLikeSplitPrice(current, next)) {
      const unitValue = parsePrice(current);
      const totalValue = reconstructSplitPrice(current, next);
      if (!isFinite(unitValue) || totalValue <= unitValue) continue;
      const previousIndex = i - 1;
      if (previousIndex < 0) continue;
      const quantityToken = tokens[previousIndex];
      const quantity = parseQuantity(quantityToken);
      if (!isFinite(quantity) || quantity <= 0) continue;
      const unitTokenIndex = previousIndex - 1;
      if (unitTokenIndex < 0) continue;
      const unitToken = tokens[unitTokenIndex];
      if (!isUnitToken(unitToken) && !isKnownUnit(unitToken)) continue;
      return {
        start: unitTokenIndex,
        unit: normalizedUnit(unitToken),
        quantity,
        unitValue,
        totalValue,
      };
    }
  }
  return null;
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

/** Código de produto aceitável SEM o número do item (linha consolidada do OCR). */
const ITEM_CODE_NO_INDEX_RE = /^\d{4,7}$/;

const ALPHA_UNIT_RE = /^[A-Za-zÀ-ÿ]{1,6}\.?$/;

interface ValueWindow {
  start: number;
  unit: string;
  quantity: number;
  unitValue: number;
  totalValue: number;
}

/** Código de produto aceitável SEM o número do item (linha consolidada do OCR). */

function parsePrice(token: string): number {
  const compact = token.replace(/\s+/g, "");
  const value = compact.includes(",")
    ? Number(compact.replace(/\./g, "").replace(",", "."))
    : Number(compact);
  // NUMERO obrigatório: retornar a string "1323.50" faria comparações como
  // `joined > value` virarem lexicográficas ("1323.50" > "323.50" = falso) e
  // o total truncado seria aceito.
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
  return /^[A-Z]{2,3}$/.test(clean);
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

  const candidates: ValueWindow[] = [];
  for (let i = 1; i <= clean.length - 4; i++) {
    const first = clean[i];
    const second = clean[i + 1];
    const priceToken = clean[i + 2];
    const totalToken = clean[i + 3];

    // Evitamos o ruído de "Le323,50" e "R$ 1, 323,50" que não serve como
    // janela de valores do item real.
    if (totalToken.startsWith("Le") || prefixedMoneyToken(totalToken) || prefixedMoneyToken(priceToken)) continue;

    if (!PRICE_TOKEN_RE.test(priceToken) || !PRICE_TOKEN_RE.test(totalToken)) continue;

    // [quantidade] [unidade] [valor unitário] [valor total]
    if (QUANTITY_TOKEN_RE.test(first) && isUnitToken(second)) {
      const quantity = parseQuantity(first);
      if (isFinite(quantity) && quantity > 0) {
        candidates.push({
          start: indexes[i],
          unit: normalizedUnit(second),
          quantity,
          unitValue: parsePrice(priceToken),
          totalValue: parsePrice(totalToken),
        });
      }
    }

    // [unidade] [quantidade] [valor unitário] [valor total]
    if (QUANTITY_TOKEN_RE.test(second) && isKnownUnit(first)) {
      const quantity = parseQuantity(second);
      if (isFinite(quantity) && quantity > 0) {
        candidates.push({
          start: indexes[i],
          unit: normalizedUnit(first),
          quantity,
          unitValue: parsePrice(priceToken),
          totalValue: parsePrice(totalToken),
        });
      }
    }
  }

  return candidates;
}

  if (candidates.length === 0 && findSplitPriceInItemLine(tokens)) {
    const splitCandidate = findSplitPriceInItemLine(tokens);
    if (splitCandidate) candidates.push(splitCandidate);
  }

  if (candidates.length === 0) return null;
  // Colunas numéricas vizinhas podem casar MAIS de uma janela (ex.: "5102 PC
  // 25,0000 52,94" — CFOP + quantidade parecem uma janela falsa). A janela
  // COHERENTE (quantidade × valor unitário ≈ total) é a escolhida — nunca a
  // primeira que casa.
  const coherent = candidates.find((candidate) => {
    if (!(candidate.totalValue > 0)) return false;
    const expected = candidate.quantity * candidate.unitValue;
    const tolerance = Math.max(ITEM_TOTAL_TOLERANCE, expected * 0.01);
    return Math.abs(expected - candidate.totalValue) <= tolerance;
  });
  return coherent ?? candidates[0];
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
    // Separadores de coluna que o OCR colou na descrição ("… CHOCO | 84716053")
    // nunca fazem parte do nome do produto.
    .replace(/[|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:;,.]+|[-–—:;,.]+$/g, "")
    .trim();
  return { description, ncm };
}

/**
 * Linha de item: aceita duas formas com evidência completa
 *   • [nº do item] [código] descrição … [janela de valores]
 *   • [código] descrição … [janela de valores]  (linha consolidada do OCR,
 *     que perde o número do item e às vezes parte das colunas)
 * Cabeçalhos, linhas curtas e ruído de OCR nunca viram produto.
 */
function parseItemTokens(
  tokens: string[],
  options: { allowNoIndex?: boolean } = {},
): ItemLine | null {
  if (tokens.length < 5) return null;

  let index: number | undefined;
  let code: string;
  let descriptionFrom: number;

  if (ITEM_INDEX_RE.test(tokens[0]) && ITEM_CODE_RE.test(tokens[1] ?? "")) {
    index = Number(tokens[0]);
    code = tokens[1];
    descriptionFrom = 2;
  } else if (options.allowNoIndex && ITEM_CODE_NO_INDEX_RE.test(tokens[0] ?? "")) {
    code = tokens[0];
    descriptionFrom = 1;
  } else {  return null;
}

  const window = findItemValueWindow(tokens);
  if (!window || window.start <= descriptionFrom) return null;

  const { description, ncm } = normalizeItemDescription(
    tokens.slice(descriptionFrom, window.start),
  );
  if (description.length < 5) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(description)) return null;
  if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(description))) return null;
  if (SECTION_WORD_TOKEN.test(description)) return null;

  return {
    index,
    code,
    description,
    ncm,
    quantity: window.quantity,
    unit: window.unit,
    unitValue: window.unitValue,
    totalValue: window.totalValue,
  };
}

/**
 * Tokens de uma linha de item: "R$" e separadores colados pelo OCR nunca fazem
 * (defeito real da Rodada 21: "PC 25,0000 R$ 52,94 R$ …", com o total à
 * direita, quebrava a janela de valores e o item deixava de ser identificado).
 */
function splitItemTokens(line: string): string[] {
  return line
    .replace(/R\$\s*/gi, " ")
    .split(" ")
    .filter((token) => token.length > 0 && !/^[|=:]$/.test(token));
}

function parseItemLine(rawLine: string | null | undefined): ItemLine | null {
  if (!rawLine) return null;
  const line = rawLine.trim().replace(/\s+/g, " ");
  if (!line) return null;
  if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(line))) return null;
  return (
    parseItemTokens(splitItemTokens(line)) ??
    parseItemTokens(splitItemTokens(line), { allowNoIndex: true })
  );
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
  // Item reconhecido é evidência forte: o texto consolidado (com o código
  // completo) ganha da região que perdeu os primeiros dígitos.
  if (a.items.length !== b.items.length) return a.items.length > b.items.length;
  if (a.receiverCnpj && !b.receiverCnpj) return true;
  if (!a.receiverCnpj && b.receiverCnpj) return false;
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

interface CityUfCep {
  city?: string;
  uf?: string;
  cep?: string;
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
 * (O↔0, S↔5, B↔8, I↔1) e separadores virando vírgula/ponto/espaço
 * ("44,723.674/0001-90") e também os 14 dígitos sem pontuação.
 *
 * Duas travas estruturais:
 *   • linhas com sequência numérica longa (chave de acesso/protocolo) são
 *     descartadas ANTES de procurar CNPJ — é assim que a chave virava
 *     "55.001.000/0029-67" (modelo+série+número da própria chave);
 *   • o dígito verificador é validado: CNPJ inválido não é aceito como campo
 *     reconhecido (fica pendente para conferência manual).
 */
function findCnpjCandidates(line: string): Array<{ raw: string; formatted: string }> {
  if (longestDigitRun(line) >= LONG_DIGIT_RUN) return [];

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
    if (!isValidCnpj(digits)) return; // DV obrigatório
    found.push({ raw, formatted: formatCnpjLocal(digits) });
  };

  const glyph = "[0-9OoQIl|!SsBbZzGg]";
  const separator = "[.,\\s]?";
  const masked = new RegExp(
    `${glyph}{2}${separator}${glyph}{3}${separator}${glyph}{3}[./\\s]?${glyph}{4}[-.,\\s]?${glyph}{2}`,
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

/**
 * Linha que COMEÇA com rótulo/coluna da DANFE nunca é razão social — cobre os
 * falsos positivos reais: "REMETENTE ne", "CONTROLE DO FISCO", cabeçalho da
 * tabela de produtos ("DESCRIÇÃO DO PRODUTO/SERVIÇO ..."), "MODELO", "SÉRIE".
 * A regra é por INÍCIO da linha (e não por qualquer palavra) justamente para
 * não descartar razões sociais legítimas como "MUNICÍPIO DE CAPIVARI" ou
 * "DISTRIBUIDORA DE PRODUTOS …".
 */
const LABEL_START_TOKEN =
  /^(?:REMETENTE|DESTINAT[ÁA]RIO|TRANSPORTADOR(?:A)?|EXPEDIDOR|EMITENTE|REDESPACHO|CONTROLE|FISCO|DANFE|CHAVE|NATUREZA|PROTOCOLO|INSCRI[ÇC][ÃA]O|FONE|FAX|MODELO|M[ÓO]DULO|S[ÉE]RIE|N[ÚU]MERO|DATA|DADOS|CNPJ|CPF|CEP|DESCRI[ÇC][ÃA]O|C[ÓO]D(?:IGO)?\b|GRUPO|PRODUTO|PRODUTOS|SERVI[ÇC]O|SERVI[ÇC]OS|QUANT|QTDE|VALOR|UNIT[ÁA]RIO|TOTAL|ALIQ|ICMS|IPI|PIS|COFINS|CST|CFOP|NCM|UNID(?:ADE)?|ENDERE[ÇC]O|MUNIC[ÍI]PIO\s*:|CIDADE\s*:|UF\s*:|ESTADO\s*:|PEDIDO|EMPENHO\s*:|AF\s*:|BASE\s+DE|VENDEDOR|VIA\b|NOME)\b/i;

/** Palavras de rótulo que aparecem como UMA linha inteira (nada de valor). */
const SECTION_WORD_TOKEN =
  /(?:^|\s)(?:REMETENTE|DESTINAT[ÁA]RIO|TRANSPORTADOR(?:A)?|EXPEDIDOR|EMITENTE|REDESPACHO)(?:\s|$)/i;

const NAME_BLACKLIST =
  /^(DANFE|NF-?e|CHAVE|NATUREZA|PROTOCOLO|INSCRI|DATA|DESTINAT|TRANSPORT|EXPEDI|EMITENTE|VALOR|DADOS|CNPJ|CPF|CEP|FONE|DESCRI|C[ÓO]D|S[ÉE]RIE|GRUPO|MODELO|CONTROLE|DOCUMENTO\s+AUXILIAR)/i;
const STREET_PREFIX = /^(RUA|AVENIDA|TRAVESSA|ALAMEDA|RODOVIA|ESTRADA|PRA[ÇC]A)\b/i;

/**
 * Lendas de coluna/rodapé que o OCR entrega SEM número — por isso não são
 * pegues pelo preto-lista de INÍCIO de linha. Defeito real da Rodada 21:
 * "IPJICPF = INSCRICAO ESTADUAL" vencia a proximidade com o CNPJ do
 * destinatário e virava a razão social (esperado: MUNICIPIO DE CAPIVARI).
 */
const NAME_LEGEND =
  /(?:CNPJ|CPF|INSCRI[ÇC][ÃA]O|INSC\b|\bESTADUAL\b|\bFONE\b|\bFAX\b|\bCEP\b|=)/i;

/**
 * Palavra de localização (bairro/cidade) que SOZINHA nunca é razão social —
 * era daí que vinha o emitente "Centro" (bairro da DANFE real).
 */
const LOCATION_WORD =
  /^(?:CENTRO|BAIRRO|JARDIM|VILA|PARQUE|DISTRITO|S[ÍI]TIO|ILHA|ZONA|LOTEAMENTO|SETOR|N[ÚU]CLEO|CIDADE)$/i;

/** Sufixos que indicam razão social (usados só para PREFERIR um candidato). */
const CORPORATE_HINT =
  /\b(LTDA|ME|MEI|EPP|EIRELI|S\.?A\.?|S\s?\/\s?A|COMPANY|COMPANHIA|CIA\b|COM[ÉE]RCIO|IND[ÚU]STRIA|DISTRIBUIDORA|PREFEITURA|MUNIC[ÍI]PIO|FUNDA[ÇC][ÃA]O|SECRETARIA)/i;

function isNameCandidate(line: string | undefined): line is string {
  if (!line) return false;
  const value = line.trim();
  if (value.length < 5) return false;
  if (/\d/.test(value)) return false;
  if (SECTION_WORD_TOKEN.test(value)) return false;
  if (NAME_BLACKLIST.test(value)) return false;
  if (NAME_LEGEND.test(value)) return false;
  const singleToken = value.replace(/[.\s]+$/, "");
  if (!/\s/.test(singleToken) && LOCATION_WORD.test(singleToken)) return false;
  if (STREET_PREFIX.test(value)) return false;
  if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (LABEL_START_TOKEN.test(value)) return false;
  if (/^[A-Za-zÀ-ÿ\s'.]+\/[A-Za-z]{2}$/.test(value)) return false; // cidade/UF
  if (/[|]/.test(value)) return false; // colunas coladas por OCR
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
  if (SECTION_WORD_TOKEN.test(value)) return false;
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

const EMISSION_ALT_LABEL = /(?:DATA\s+(?:DE\s+|DA\s+)?)?EMISSO[ÃA]?(?:\s+(?:ELETRONICA|GRATUITA|PRESENCIAL|N\s*FOLHA))?\s*\.?\s*:?\s*/i;

/** Seções seguintes ao cabeçalho — marcam o fim da área de emissão. */
const POST_HEADER_SECTION_RE =
  /DESTINAT[ÁA]RIO|REMETENTE|RECEBEDOR|TRANSPORTADOR|EXPEDI[ÇC][ÃA]O/i;

/**
 * Data de emissão: rótulo com valor na mesma linha ou nas linhas seguintes.
 *   • linhas de RÓTULO sem data (ex.: "CHAVE DE ACESSO" entre o rótulo e a
 *     data, como no PDF real) são PULADAS — não encerram a busca;
 *   • linhas de OUTROS campos com data (saída/protocolo) nunca viram emissão;
 *   • glifos trocados em posição numérica são tolerados;
 *   • último recurso, apenas com chave válida: data isolada do cabeçalho cujo
 *     AAMM confere com a chave — leitura do documento (nunca inventada), com a
 *     origem registrada em `note` para conferência humana.
 */
function extractEmissionDate(
  lines: string[],
  key?: AccessKeyParts,
): { value?: string; note?: string } {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(EMISSION_LABEL);            if (!match) {
    // Rótulos alternativos sem a palavra EXATAS "EMISSÃO" ("DATA DE
    // EMISSO", "EMISSO GRATUITA", "DATA DA EMISSO") ainda são
    // emissão quando o OCR abreviou o sufixo.
    const alt = line.match(EMISSION_ALT_LABEL);
              if (alt) continue;
              continue;
            }
            const start = match.index ?? 0;

            // Valor ANTES do rótulo na mesma linha (colunas invertidas pelo OCR/PDF).
            const before = parseFlexibleDate(line.slice(0, start));
            if (before) return { value: before };

            const rest = line.slice(start + match[0].length);
            const sameLine = parseFlexibleDate(rest);
            if (sameLine) return { value: sameLine };

    for (let step = 1; step <= 3; step++) {
      const next = lines[i + step];
      if (next === undefined) break;
      if (EMISSION_LABEL.test(next)) break;
      if (SECTION_PATTERNS.some(({ re }) => re.test(next))) break;
      const value = parseFlexibleDate(next);
      if (!value) continue; // linha de rótulo sem data: pula (ex.: CHAVE DE ACESSO)            // "DATA DA SAÍDA 29/09/2026" não é emissão — mas não encerra a busca:
            // a emissão pode estar logo abaixo.
            if (/SA[ÍI]DA|ENTRADA|PROTOCOLO|S[aá]F[eé]RA|CI[ÃA]O/i.test(next)) continue;
      return { value };
    }
  }

  if (key) {
    const headerEnd = lines.findIndex(
      (line, index) => index > 0 && POST_HEADER_SECTION_RE.test(line),
    );
    const limit = headerEnd === -1 ? Math.ceil(lines.length * 0.5) : headerEnd;
    for (let i = 0; i < limit; i++) {
      const line = lines[i];
      if (/SA[ÍI]DA|VENC|VALID|NASC/i.test(line)) continue;
      const value = parseFlexibleDate(line);
      if (!value) continue;
      const [year, month] = value.split("-").map(Number);
      if (year === key.year && month === key.month) {
        return {
          value,
          note:
            "Data encontrada no cabeçalho sem rótulo adjacente; confere com o AAMM da chave de acesso — confirme visualmente.",
        };
      }
    }
  }

  return {};
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
  const normalized = raw
    .replace(/R\$\s*/gi, " ")
    // Milhar partido pelo OCR: dígito + ponto + três dígitos separados por
    // espaço ("1. 323,50") são recolados ANTES de ler o valor — sem isso o
    // regex casaba só as três últimas casas e o total da nota perdia o
    // primeiro dígito (defeito real da Rodada 21: 323,50 no lugar de 1323,50).
    // Adicionalmente, o OCR pode entregar "1, 323,50" (vírgula que separa
    // o milhar do decimal) e o valor real deve ser restaurado sem perder o
    // primeiro dígito, sem quebrar valores como "323,50".
    .replace(/(\d)\s*\.\s*(\d{3})\b/g, "$1.$2")
    .replace(/(\d)\s*,\s*(\d{3},\d{2})/g, "$1.$2");
  const match = normalized.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/);
  if (!match) return undefined;
  const value = parsePrice(match[0]);
  return isFinite(value) && value > 0 ? value : undefined;
}

/** Linha essencialmente numérica — a coluna de valores de uma tabela de totais. */
function isValueOnlyLine(line: string): boolean {
  return line.replace(/R\s*\$/gi, " ").replace(/[0-9.,\s]/g, "").trim().length === 0;
}

interface TotalCandidate {
  value: number;
  index: number;
  source: string;
}

/**
 * Todos os candidatos de total associados ao rótulo correto (VALOR TOTAL DA
 * NOTA/NF), na mesma linha ou nas linhas de VALORES logo abaixo — sem somar
 * ocorrências repetidas do texto consolidado nem valores de ICMS/IPI.
 * Valores zerados são descartados: total 0 nunca é um total válido.
 */
function collectTotalCandidates(lines: string[]): TotalCandidate[] {
  const candidates: TotalCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TOTAL_VALUE_LABEL);
    if (!match) continue;

    const rest = line.slice((match.index ?? 0) + match[0].length);
    const sameLine = readMoney(rest);
    if (sameLine !== undefined && sameLine > 0) {
      candidates.push({ value: sameLine, index: i, source: "rótulo do total (mesma linha)" });
      continue;
    }

    // Coluna de valores: o OCR costuma despejar os rótulos de todos os quadros
    // e SÓ DEPOIS os números. Pulamos as linhas de rótulo (com letras) e
    // aceitamos as linhas que são apenas valor — sem atravessar outra seção.
      for (let step = 1; step <= 6; step++) {
      const next = lines[i + step];
      if (next === undefined) break;
      if (SECTION_PATTERNS.some(({ re }) => re.test(next))) break;
      if (/(?:DADOS\s+ADICIONAIS|CONTROLE\s+DO\s+FISCO|OBSERVA[ÇC][ÕO]ES|TRANSPORTADOR)/i.test(next)) break;
      if (!isValueOnlyLine(next)) continue;
      const value = readMoney(next);
      if (value !== undefined && value > 0) {
        // Valor partido em DUAS linhas: "1." ficou na linha do rótulo e
        // "323,50" na coluna — junta antes de aceitar o valor truncado.
        const tail = rest.trim();
        const joined = /\d[\d.,]*$/.test(tail) ? readMoney(`${tail} ${next}`) : undefined;
        candidates.push(
          joined !== undefined && joined > value
            ? {
                value: joined,
                index: i + step,
                source: `coluna de valores ${step} linha(s) abaixo do rótulo — milhar reconstruído`,
              }
            : {
                value,
                index: i + step,
                source: `coluna de valores ${step} linha(s) abaixo do rótulo do total`,
              },
        );
        break;
      }
    }
  }

  return candidates;
}

/**
 * Escolha do total: candidato contextualizado pelo rótulo; quando a soma dos
 * itens é conhecida e coincide com um dos candidatos, ele é o preferido (é a
 * única evidência cruzada disponível). A origem da escolha é registrada.
 */
function extractTotalValue(
  lines: string[],
  items: DanfeItem[],
): { value?: number; source?: string } {
  const candidates = collectTotalCandidates(lines);
  if (candidates.length === 0) return {};

  const itemsSum = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.totalValue) ? item.totalValue : 0),
    0,
  );
  if (itemsSum > 0) {
    const match = candidates.find((candidate) => Math.abs(candidate.value - itemsSum) < 0.011);
    if (match) {
      return {
        value: match.value,
        source: `${match.source} — confere com a soma dos itens`,
      };
    }
  }

  return { value: candidates[0].value, source: candidates[0].source };
}

/**
 * Itens da NF-e, a partir do texto CONSOLIDADO (página + regiões):
 *   • linha com nº do item + código OU linha consolidada começando pelo código;
 *   • quando o OCR quebra o produto em duas linhas, a junção só acontece com
 *     evidência dos DOIS lados e nunca “rouba” a linha de outro item;
 *   • código truncado na região ("742" para "231742") é unificado no código
 *     mais completo, sem duplicar o produto.
 */
function extractItems(lines: string[]): DanfeItem[] {
  const items: DanfeItem[] = [];
  const seen = new Set<string>();

  for (let position = 0; position < lines.length; position++) {
    const line = lines[position];
    const tokens = splitItemTokens(line);
    let parsed = parseItemTokens(tokens) ?? parseItemTokens(tokens, { allowNoIndex: true });
    let consumedNext = false;

    const startsLikeItem =
      ITEM_INDEX_RE.test(tokens[0] ?? "") && ITEM_CODE_RE.test(tokens[1] ?? "");
    // Linha consolidada SEM nº do item (código + descrição) também pode precisar
    // da linha seguinte quando o OCR separou descrição e colunas de valores.
    const startsLikeCode =
      !startsLikeItem && ITEM_CODE_NO_INDEX_RE.test(tokens[0] ?? "");

    if (!parsed && (startsLikeItem || startsLikeCode)) {
      const next = lines[position + 1];
      const nextTokens = next ? splitItemTokens(next) : null;
      const nextIsOwnItem =
        nextTokens !== null &&
        (parseItemTokens(nextTokens) !== null ||
          parseItemTokens(nextTokens, { allowNoIndex: true }) !== null);
      // Junta só quando a linha seguinte NÃO é um item por si só.
      if (nextTokens && !nextIsOwnItem) {
        const merged = parseItemTokens([...tokens, ...nextTokens]);
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

  return mergeTruncatedItems(items);
}

/**
 * A leitura regional costuma perder os PRIMEIROS dígitos do código. Quando duas
 * linhas descrevem o mesmo produto e um código é sufixo do outro, mantemos o
 * código mais completo — sem criar item novo nem duplicar quantidade.
 */
function mergeTruncatedItems(items: DanfeItem[]): DanfeItem[] {
  const out: DanfeItem[] = [];
  for (const item of items) {
    const twin = out.find(
      (candidate) =>
        candidate.code !== item.code &&
        (candidate.code.endsWith(item.code) || item.code.endsWith(candidate.code)) &&
        candidate.description === item.description &&
        candidate.quantity === item.quantity &&
        Math.abs(candidate.totalValue - item.totalValue) < 0.011,
    );
    if (twin) {
      if (item.code.length > twin.code.length) {
        twin.code = item.code;
        if (twin.index === undefined) twin.index = item.index;
      }
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

/**
 * Bloco endereço do emitente: cidade, UF e CEP a partir de contexto coerente
 * ("Tubarão/SC", "Tubarao - SC - CEP: 88701-600", "Cidade: …", "UF: SC").
 * Sigla isolada NUNCA é aceita sem esse contexto — era daí que vinha "RR".
 */
function parseCityUfCep(line: string): CityUfCep {
  const result: CityUfCep = {};

  const cep = line.match(
    /\bCEP\s*[:\-]?\s*([\dOoQIl|!SsBbZzGg]{5})[\s.\-]?([\dOoQIl|!SsBbZzGg]{3})\b/i,
  );
  if (cep) {
    const digits = digitsFromOcr(`${cep[1]}${cep[2]}`);
    if (digits.length === 8) result.cep = `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
  }

  const labeledCity = line.match(/^(?:Cidade|Munic[íi]pio)\s*:\s*(.+)$/i);
  if (labeledCity) {
    const city = nameFromText(labeledCity[1]);
    if (city) result.city = city;
  }

  const labeledUf = line.match(/^(?:UF|Estado)\s*:?\s*([A-Za-z]{2})\b/i);
  if (labeledUf && UF_LIST.has(labeledUf[1].toUpperCase())) {
    result.uf = labeledUf[1].toUpperCase();
  }

  // "Cidade/UF" (com barra) — pode vir colada ao CEP ou a um complemento.
  const slash = line.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.]{1,40}?)\s*\/\s*([A-Za-z]{2})\b/);
  if (slash) {
    const city = nameFromText(slash[1]);
    if (city) result.city = result.city ?? city;
    if (UF_LIST.has(slash[2].toUpperCase())) result.uf = result.uf ?? slash[2].toUpperCase();
  }

  // "Cidade - UF" (hífen) — endereço do emitente na DANFE real.
  const dashed = line.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.]{1,40}?)\s*[-–]\s*([A-Za-z]{2})\b/);
  if (dashed) {
    const city = nameFromText(dashed[1]);
    if (city) result.city = result.city ?? city;
    if (UF_LIST.has(dashed[2].toUpperCase())) result.uf = result.uf ?? dashed[2].toUpperCase();
  }

  return result;
}

/** Ruído de OCR/seções que nunca faz parte do endereço. */
const ADDRESS_NOISE =
  /\b(?:CONTROLE\s+DO\s+FISCO|FISCO|DANFE|DOCUMENTO\s+AUXILIAR|AUXILIAR|ELETR[ÔO]NICA?|VIA|MODELO|S[ÉE]RIE|N[ÚU]MERO|DATA\s+DE\s+EMISS[ÃA]O|CHAVE\s+DE\s+ACESSO)\b/gi;

function cleanAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(ADDRESS_NOISE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;.-]+/, "")
    .replace(/[\s,;-]+$/, "")
    .trim();
  return cleaned.length >= 6 ? cleaned : undefined;
}

/**
 * Nome da seção: rótulo explícito, senão o candidato a razão social dentro da
 * PRÓPRIA seção — priorizando quem está logo ACIMA do CNPJ e quem tem sufixo de
 * razão social (LTDA/COMPANY/MUNICÍPIO…). Nunca cruza para outra seção.
 */
function findNameNearCnpj(
  lines: string[],
  cnpjIndex: number | undefined,
  sectionIndexes: number[],
): string | undefined {
  if (cnpjIndex === undefined || sectionIndexes.length === 0) return undefined;

  for (const index of sectionIndexes) {
    const explicit = nameLabelValue(lines[index] ?? "", lines[index + 1]);
    if (explicit) return explicit;
  }

  const anchor = sectionIndexes.indexOf(cnpjIndex);
  const limit = anchor >= 0 ? anchor : sectionIndexes.length - 1;
  const above: string[] = [];
  // Janela de 12 linhas: no PDF real a razão social fica várias linhas acima do
  // CNPJ (endereço/bairro/CEP/telefone no meio) e a proximidade estreita escolhia
  // o bairro "CENTRO" como emitente.
  for (let position = limit; position >= Math.max(0, limit - 12); position--) {
    const candidate = lines[sectionIndexes[position]];
    if (isNameCandidate(candidate)) above.push(candidate.trim());
  }
  if (above.length) {
    const corporate = above.find((candidate) => CORPORATE_HINT.test(candidate));
    return corporate ?? above[0];
  }

  for (let position = limit + 1; position <= limit + 2 && position < sectionIndexes.length; position++) {
    const candidate = lines[sectionIndexes[position]];
    if (isNameCandidate(candidate) && CORPORATE_HINT.test(candidate.trim())) {
      return candidate.trim();
    }
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
  const sectionIndexes: Record<SectionKey, number[]> = {
    emitente: [],
    destinatario: [],
    transportador: [],
    expedidor: [],
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
    sectionIndexes[section].push(index);

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

    const block = parseCityUfCep(line);
    if (block.city && !data.city) data.city = block.city;
    if (block.uf && !data.uf) data.uf = block.uf;
    if (block.cep && !data.cep) data.cep = block.cep;

    // Cidade e UF em DUAS linhas: só vale com o bloco cidade/UF/CEP montado
    // (a linha da UF seguida do CEP) — sigla solta em região duvidosa é ruído.
    if (/^[A-Z]{2}$/.test(line) && !data.uf && UF_LIST.has(line)) {
      const previous = lines[index - 1];
      const nextHasCep = /CEP/i.test(lines[index + 1] ?? "");
      if (nextHasCep && isCityLike(previous)) {
        data.uf = line;
        if (!data.city) data.city = previous!.trim();
      }
    }

    const labeledAddress = line.match(/^(?:Endere[çc]o|Endereco)\s*:?\s*(.+)$/i);
    const streetAddress = STREET_PREFIX.test(line) ? line : undefined;
    const address = cleanAddress(labeledAddress ? labeledAddress[1] : streetAddress);
    if (address && !data.address) data.address = address;
  });

  for (const key of Object.keys(sections) as SectionKey[]) {
    const data = sections[key];
    if (data.name) continue;
    data.name = findNameNearCnpj(lines, data.cnpjIndex, sectionIndexes[key]);
  }

  const accessKey = extractAccessKey44(clean);
  const keyParts = parseAccessKey44(accessKey);
  const items = extractItems(lines);
  const totalResult = extractTotalValue(lines, items);

  // ─── Número, série e emissão: a chave válida é a fonte autoritativa ────
  const notes: Record<string, string> = {};
  const confidence: Record<string, number> = {};

  const ocrNumber = extractNfeNumber(lines);
  const ocrSeries = extractSeries(lines);
  const emissionRead = extractEmissionDate(lines, keyParts);
  const ocrDate = emissionRead.value;

  let nfeNumber = ocrNumber;
  if (keyParts) {
    if (ocrNumber && ocrNumber !== keyParts.number) {
      notes.nfeNumber = `Leitura do OCR (${ocrNumber}) conflita com a chave de acesso; prevalece o número da chave (${keyParts.number}).`;
      confidence.nfeNumber = 60;
    } else {
      confidence.nfeNumber = ocrNumber ? 95 : 90;
      if (!ocrNumber) notes.nfeNumber = "Número derivado da chave de acesso validada.";
    }
    nfeNumber = keyParts.number;
  } else if (ocrNumber) {
    confidence.nfeNumber = 75;
  }

  let series = ocrSeries;
  if (keyParts) {
    if (ocrSeries && ocrSeries !== keyParts.series) {
      notes.series = `Leitura do OCR (${ocrSeries}) conflita com a chave de acesso; prevalece a série da chave (${keyParts.series}).`;
      confidence.series = 60;
    } else {
      confidence.series = ocrSeries ? 95 : 90;
      if (!ocrSeries) notes.series = "Série derivada da chave de acesso validada.";
    }
    series = keyParts.series;
  } else if (ocrSeries) {
    confidence.series = 70;
  }  type EmissionResult = { value?: string; note?: string };
  const emission = ((): EmissionResult => {
    const origin = emissionRead.note;
    if (keyParts && ocrDate) {
      const [year, month] = ocrDate.split("-").map(Number);
      if (year === keyParts.year && month === keyParts.month) {
        return {
          value: ocrDate,
          note: [origin, "Data confere com o AAMM da chave de acesso."]
            .filter(Boolean)
            .join(" "),
        };
      }
      return {
        note: `Data lida pelo OCR (${ocrDate}) conflita com o AAMM da chave (${keyParts.month}/${keyParts.year}) — pendente de conferência manual.`,
      };
    }
    if (ocrDate) return { value: ocrDate, note: origin ?? "Data lida do rótulo de emissão." };
    if (keyParts) {
      // Data parcial do cabeçalho (ex.: "28/09/2" ou "28 / 09 / 2026") é
      // evidência do documento — não inferimos diretamente pelo AAMM da chave,
      // mas usamos o AAMM para confirmar e completar o ano quando a leitura
      // OCR ficou truncada.
      const headerYear = keyParts.year;
      const headerMonth = keyParts.month;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/SA[ÍI]DA|ENTRADA|PROTOCOLO|S[aá]F[eé]RA|CI[ÃA]O|DESTINAT|REMET/i.test(line)) break;
        let matched = false;
        const localPartial = line.match(/\b(\d{1,2})\s*[/.,-]?\s*(\d{1,2})\s*[/.,-]?\s*(\d{0,4})\b/);
        if (localPartial) {
          matched = true;
          const day = Number(localPartial[1]);
          const month = Number(localPartial[2]);
          const year = localPartial[3] ? Number(localPartial[3]) : headerYear;
          if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
            if (month === headerMonth && year === headerYear) {
              const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              return {
                value: candidate,
                note:
                  localPartial[3]
                    ? "Data reconstruída a partir do cabeçalho com validação explícita (dia/mês/ano)."
                    : "Data parcial no cabeçalho — ano completado pelo AAMM da chave de acesso, dia/mês vindos da leitura OCR.",
              };
            }
          }
        }
        if (!matched) {
          const slashPartial = line.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[\/.,-]?\s*(\d{0,4})/);
          if (slashPartial) {
            const day = Number(slashPartial[1]);
            const month = Number(slashPartial[2]);
            const year = slashPartial[3] ? Number(slashPartial[3]) : headerYear;
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
              if (month === headerMonth && year === headerYear) {
                const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                return {
                  value: candidate,
                  note:
                    slashPartial[3]
                      ? "Data reconstruída a partir do cabeçalho com validação explícita (dia/mês/ano)."
                      : "Data parcial no cabeçalho — ano completado pelo AAMM da chave de acesso, dia/mês vindos da leitura OCR.",
                };
              }
            }
          }
        }
      }
      return { note: `Somente o mês/ano constam da chave (${keyParts.month}/${keyParts.year}) — informe a data completa.` };
    }
    return {};
  })();
  const emissionDate = emission.value;
  if (emission.note) notes.emissionDate = emission.note;
  confidence.emissionDate = emissionDate ? 90 : 0;
  if (emissionDate && /Somente o mês\/ano/.test(notes.emissionDate ?? "")) {
    notes.emissionDate = "Somente o mês/ano constam da chave de acesso — data completa pendente de conferência.";
  }

  const totalValue = totalResult.value;
  if (totalResult.source) notes.totalValue = `Origem: ${totalResult.source}.`;

  const afNumber = extractAfNumber(clean);
  const empenhoNumber = extractEmpenhoNumber(clean);
  const processNumber = extractProcessNumber(clean);

  const emitter = sections.emitente;
  const receiver = sections.destinatario;
  const transporter = sections.transportador;
  const issuer = sections.expedidor;

  if (emitter.cnpj && keyParts && digitsFromOcr(emitter.cnpj) === keyParts.emitterCnpjDigits) {
    notes.emitterCnpj = "CNPJ do emitente confere com o emitente da chave de acesso.";
    confidence.emitterCnpj = 95;
  } else if (emitter.cnpj) {
    confidence.emitterCnpj = 80;
  }
  if (receiver.cnpj) confidence.receiverCnpj = 85;
  if (emitter.name) confidence.emitterName = 80;
  if (receiver.name) confidence.receiverName = 80;
  if (items.length) confidence.items = 85;

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
    notes,
    confidence,
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
  // Item reconhecido conta como evidência (é o que distingue o texto
  // consolidado — com o código completo — da região truncada).
  if (parsed.items.length) count++;
  return count;
}

/**
 * Trilha de auditoria por campo, alinhada com a validação (§7): `isValid` só é
 * verdadeiro quando o campo passa na validação específica; a nota registra a
 * origem da escolha, o conflito com a chave e a pendência de conferência.
 */
function buildFieldTraces(
  parsed: DanfeParseResult,
  source: string,
  srcLayerBlob?: string | null,
): OcrFieldTrace[] {
  void srcLayerBlob;
  const values: Record<string, string> = {
    nfeNumber: parsed.nfeNumber ?? "",
    series: parsed.series ?? "",
    emissionDate: parsed.emissionDate ?? "",
    accessKey: parsed.accessKey ?? "",
    emitterCnpj: parsed.emitterCnpj ?? "",
    emitterName: parsed.emitterName ?? "",
    receiverCnpj: parsed.receiverCnpj ?? "",
    receiverName: parsed.receiverName ?? "",
    issuerCnpj: parsed.issuerCnpj ?? "",
    issuerName: parsed.issuerName ?? "",
    items: parsed.items.map((item) => item.code).join(", "),
    totalValue: parsed.totalValue !== undefined ? String(parsed.totalValue) : "",
  };

  return validateDanfeFields(parsed).map((validation) => ({
    field: validation.campo as keyof DanfeParseResult,
    value: values[validation.campo] ?? "",
    source,
    confidence: validation.confidence,
    isValid: validation.ok,
    notes: validation.note,
  }));
}

