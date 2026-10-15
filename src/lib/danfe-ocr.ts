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

const HEADER_LINE_PATTERNS = [
  /DESCRI[ÇC][ÃA]O\s+DOS\s+PRODUTOS/i,
  /DESCRICAO\s+DOS\s+PRODUTOS/i,
  /VALOR\s+UNIT[ÁA]RIO/i,
  /ALIQ\.?\s+ICMS/i,
  /C[ÓO]D\.?\s*IGO/i,
];

function isPriceToken(token: string): boolean {
  return /^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(token) || /^\d+,\d{2}$/.test(token);
}

function parsePrice(token: string): number {
  const value = Number(token.replace(/\./g, "").replace(",", "."));
  return isFinite(value) ? value : 0;
}

function parseQuantity(token: string): number {
  if (!/^\d{1,9}(?:[.,]\d{1,4})?$/.test(token)) return NaN;
  return Number(token.replace(",", "."));
}

/**
 * Linha de item só é aceita com evidência completa: índice, código, descrição,
 * quantidade > 0, unidade real (não nome de coluna) e valores. Cabeçalhos,
 * linhas curtas e ruído de OCR nunca viram produto.
 */
function parseItemLine(rawLine: string | null | undefined): ItemLine | null {
  if (!rawLine) return null;
  const line = rawLine.trim().replace(/\s+/g, " ");
  if (!line) return null;
  if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(line))) return null;

  const tokens = line.split(" ");
  if (tokens.length < 6) return null;
  if (!/^\d{1,3}$/.test(tokens[0])) return null;
  if (!/^\d{3,6}$/.test(tokens[1])) return null;

  const totalToken = tokens[tokens.length - 1];
  const unitPriceToken = tokens[tokens.length - 2];
  const unitToken = tokens[tokens.length - 3];
  const quantityToken = tokens[tokens.length - 4];

  if (!isPriceToken(totalToken) || !isPriceToken(unitPriceToken)) return null;
  if (!/^[A-Za-z]{1,6}$/.test(unitToken)) return null;
  if (FORBIDDEN_UNITS.has(unitToken.toUpperCase())) return null;

  const quantity = parseQuantity(quantityToken);
  if (!isFinite(quantity) || quantity <= 0) return null;

  const description = tokens.slice(2, tokens.length - 4).join(" ").trim();
  if (description.length < 5) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(description)) return null;
  if (HEADER_LINE_PATTERNS.some((pattern) => pattern.test(description))) return null;

  return {
    index: Number(tokens[0]),
    code: tokens[1],
    description,
    quantity,
    unit: unitToken.toUpperCase(),
    unitValue: parsePrice(unitPriceToken),
    totalValue: parsePrice(totalToken),
  };
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

function sectionLabelFor(line: string): SectionKey | undefined {
  if (/TRANSPORTADOR|TRANSPORTADORA|REDESPACHO/i.test(line)) return "transportador";
  if (/EXPEDI[ÇC][ÃA]O/i.test(line)) return "expedidor";
  if (/DESTINAT[ÁA]RIO|REMETENTE/i.test(line)) return "destinatario";
  if (/DADOS\s+DO\s+EMITENTE|\bEMITENTE\b/i.test(line)) return "emitente";
  return undefined;
}

function findCnpj(line: string): string | undefined {
  const labeled = line.match(
    /CNPJ\s*[:\-]?\s*((?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})|\d{14})/i,
  );
  const masked = line.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  const plain = labeled ? labeled[1] : masked ? masked[0] : line.match(/\b\d{14}\b/)?.[0];
  if (!plain) return undefined;
  const digits = plain.replace(/\D/g, "");
  if (digits.length !== 14) return undefined;
  return formatCnpjLocal(digits);
}

function nameLabel(line: string): string | undefined {
  const match = line.match(/^(?:Raz[ãa]o\s+Social|Nome\s+Do\s+Destinat[áa]rio)\s*:\s*(.+)$/i);
  if (!match) return undefined;
  const value = match[1].trim();
  return value || undefined;
}

const NAME_BLACKLIST =
  /^(DANFE|NF-?e|CHAVE|NATUREZA|PROTOCOLO|INSCRI|DATA|DESTINAT|TRANSPORT|EXPEDI|EMITENTE|VALOR|DADOS|CNPJ|CPF|CEP|FONE|DESCRI|C[ÓO]D|S[ÉE]RIE|GRUPO)/i;
const STREET_PREFIX = /^(RUA|AVENIDA|TRAVESSA|ALAMEDA|RODOVIA|ESTRADA|PRA[ÇC]A)\b/i;

function isNameCandidate(line: string | undefined): line is string {
  if (!line) return false;
  const value = line.trim();
  if (value.length < 5) return false;
  if (/\d/.test(value)) return false;
  if (NAME_BLACKLIST.test(value)) return false;
  if (STREET_PREFIX.test(value)) return false;
  if (/^[A-Za-zÀ-ÿ\s'.]+\/[A-Za-z]{2}$/.test(value)) return false; // cidade/UF
  if (!/[A-Za-zÀ-ÿ]{3,}/.test(value)) return false;
  return true;
}

function isCityLike(line: string | undefined): boolean {
  if (!line) return false;
  const value = line.trim();
  if (value.length < 3) return false;
  if (/\d/.test(value)) return false;
  if (value.includes(":")) return false;
  if (NAME_BLACKLIST.test(value)) return false;
  if (STREET_PREFIX.test(value)) return false;
  if (/^[A-Za-zÀ-ÿ\s'.]+\/[A-Za-z]{2}$/.test(value)) return false;
  return /[A-Za-zÀ-ÿ]{3,}/.test(value);
}

function formatCepLocal(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return value;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
}

function extractNfeNumber(text: string): string | undefined {
  const match =
    text.match(/NF-?e?\s*N[ºo°]\.?\s*:?\s*(\d{1,10})/i) ||
    text.match(/N[ºo°]\.?\s*:?\s*(\d{1,10})/i);
  if (!match) return undefined;
  const number = match[1].replace(/^0+(?=\d)/, "");
  return number || undefined;
}

function extractSeries(text: string): string | undefined {
  const match = text.match(/s[eéi]rie\s*[:.]?\s*(\d{1,3})/i);
  return match ? match[1] : undefined;
}

function extractEmissionDate(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!/emi/i.test(line)) continue;
    const match = line.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
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

function extractTotalValue(lines: string[]): number | undefined {
  for (const line of lines) {
    if (!/valor\s*total/i.test(line)) continue;
    const match = line.match(/r\$\s*([\d.]+,\d{2})/i);
    if (!match) continue;
    const value = Number(match[1].replace(/\./g, "").replace(",", "."));
    if (isFinite(value)) return value;
  }
  return undefined;
}

function extractItems(lines: string[]): DanfeItem[] {
  const items: DanfeItem[] = [];
  const seen = new Set<string>();

  lines.forEach((line, position) => {
    const parsedLine = parseItemLine(line);
    if (!parsedLine) return;
    const key = line.trim().replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) return; // linha repetida por OCR/regiões nunca duplica produto
    seen.add(key);
    items.push({
      index: parsedLine.index,
      lineNumber: position + 1,
      code: parsedLine.code,
      description: parsedLine.description,
      quantity: parsedLine.quantity,
      unit: parsedLine.unit,
      unitValue: parsedLine.unitValue,
      totalValue: parsedLine.totalValue,
    });
  });

  return items;
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
    const label = sectionLabelFor(line);
    if (label) section = label;

    const data = sections[section];

    const cnpj = findCnpj(line);
    if (cnpj && !data.cnpj) {
      data.cnpj = cnpj;
      data.cnpjIndex = index;
    }

    const explicitName = nameLabel(line);
    if (explicitName && !data.name) data.name = explicitName;

    const cityLabeled = line.match(/^(?:Cidade|Munic[íi]pio)\s*:\s*(.+)$/i);
    if (cityLabeled && !data.city) data.city = cityLabeled[1].trim();

    const ufLabeled = line.match(/^(?:UF|Estado)\s*:\s*([A-Za-z]{2})\b/i);
    if (ufLabeled && !data.uf) data.uf = ufLabeled[1].toUpperCase();

    const cityUf = line.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.]{1,40})\/([A-Za-z]{2})$/);
    if (cityUf) {
      if (!data.city) data.city = cityUf[1].trim();
      if (!data.uf) data.uf = cityUf[2].toUpperCase();
    }

    const cep = line.match(/\bCEP\s*[:\s]?\s*(\d{5}-?\d{3})\b/i);
    if (cep && !data.cep) data.cep = formatCepLocal(cep[1]);

    const labeledAddress = line.match(/^(?:Endere[çc]o|Endereco)\s*:\s*(.+)$/i);
    const streetAddress = STREET_PREFIX.test(line) ? line : undefined;
    const address = labeledAddress ? labeledAddress[1].trim() : streetAddress;
    if (address && !data.address) data.address = address;

    if (/^[A-Za-z]{2}$/.test(line) && !data.uf) {
      data.uf = line.toUpperCase();
      const previous = lines[index - 1];
      if (!data.city && isCityLike(previous)) data.city = previous!.trim();
    }
  });

  for (const key of Object.keys(sections) as SectionKey[]) {
    const data = sections[key];
    if (data.cnpjIndex === undefined || data.name) continue;
    for (const position of [data.cnpjIndex - 1, data.cnpjIndex + 1]) {
      const candidate = lines[position];
      const value = nameLabel(candidate ?? "") ?? candidate;
      if (isNameCandidate(value)) {
        data.name = value.trim();
        break;
      }
    }
  }

  const nfeNumber = extractNfeNumber(clean);
  const series = extractSeries(clean);
  const emissionDate = extractEmissionDate(lines);
  const accessKey = extractAccessKey44(clean);
  const totalValue = extractTotalValue(lines);
  const items = extractItems(lines);
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

