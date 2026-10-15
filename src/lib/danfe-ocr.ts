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
 */

export const DANFE_REGIONS = [
  { key: "chaveDeAcesso", x: 9.05, y: 14, w: 4.5, h: 0.95 },
] as const;

export const DANFE_TRACKED_FIELDS = [
  { campo: "nfeNumber", titulo: "Número da NF-e" },
  { campo: "series", titulo: "Série" },
  { campo: "emissionDate", titulo: "Data de emissão" },
  { campo: "accessKey", titulo: "Chave de acesso" },
  { campo: "emitterCnpj", titulo: "CNPJ emitente" },
  { campo: "emitterName", titulo: "Razão social emitente" },
  { campo: "receiverCnpj", titulo: "CNPJ receptor" },
  { campo: "receiverName", titulo: "Razão social receptor" },
  { campo: "issuerCnpj", titulo: "CNPJ expedidor" },
  { campo: "issuerName", titulo: "Razão social expedidor" },
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

export interface DanfeParseResult {
  ok: boolean;
  items: DanfeItem[];
  nfeNumber: string;
  series: string;
  emissionDate: string;
  accessKey: string;
  emitterCnpj: string;
  emitterName: string;
  emitterAddress: string;
  emitterCity: string;
  emitterState: string;
  emitterPostalCode: string;
  receiverCnpj: string;
  receiverName: string;
  transporterCnpj: string;
  issuerCnpj: string;
  issuerName: string;
  afNumber: string;
  empenhoNumber: string;
  processNumber: string;
  totalValue: number;
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
    if (parsed[field.campo as keyof DanfeParseResult]) {
      found++;
    } else {
      missing.push(field.titulo);
    }
  }

  return { found, total: tracked.length, missing };
}

export function hasUsableTextLayer(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 20) return false;
  if (!/[0-9]{40,}/.test(trimmed)) return false;
  return true;
}

export function mergeDanfeTexts(pageText: string, regionTexts: string[]): string {
  const parts: string[] = [];
  if (pageText) parts.push(pageText);
  for (const region of regionTexts) {
    if (region) parts.push(region);
  }
  return parts.join("\n").trim();
}

export function parseDanfeText(text: string | null | undefined): DanfeParseResult {
  if (!text) {
    return {
      ok: false,
      items: [],
      nfeNumber: "",
      series: "",
      emissionDate: "",
      accessKey: "",
      emitterCnpj: "",
      emitterName: "",
      emitterAddress: "",
      emitterCity: "",
      emitterState: "",
      emitterPostalCode: "",
      receiverCnpj: "",
      receiverName: "",
      transporterCnpj: "",
      issuerCnpj: "",
      issuerName: "",
      afNumber: "",
      empenhoNumber: "",
      processNumber: "",
      totalValue: 0,
    };
  }

  const clean = text.replace(/[\s\S]/g, (ch) => ch).trim();
  const lines = clean.split(/\n/).map((l) => l.trim()).filter(Boolean);

  const nfeNumber = extractNfeNumber(clean);
  const series = extractSeries(lines);
  const emissionDate = extractEmissionDate(lines);
  const accessKey = extractAccessKey44(clean);
  const emitterCnpj = extractCnpj(clean, "emitente");
  const emitterName = extractName(clean, "emitente");
  const emitterAddress = extractAddress(lines);
  const emitterCity = extractCity(lines);
  const emitterState = extractState(lines);
  const emitterPostalCode = extractPostalCode(lines);
  const receiverCnpj = extractCnpj(clean, "receptor");
  const receiverName = extractName(clean, "receptor");
  const transporterCnpj = extractCnpj(clean, "transportador");
  const issuerCnpj = extractCnpj(clean, "expedidor");
  const issuerName = extractName(clean, "expedidor");
  const afNumber = extractAfNumber(clean);
  const empenhoNumber = extractEmpenhoNumber(clean);
  const processNumber = extractProcessNumber(clean);
  const totalValue = extractTotalValue(clean);

  const ok = !!(nfeNumber && accessKey && emitterCnpj);

  return {
    ok,
    items: extractItems(lines),
    nfeNumber,
    series,
    emissionDate,
    accessKey,
    emitterCnpj,
    emitterName,
    emitterAddress,
    emitterCity,
    emitterState,
    emitterPostalCode,
    receiverCnpj,
    receiverName,
    transporterCnpj,
    issuerCnpj,
    issuerName,
    afNumber,
    empenhoNumber,
    processNumber,
    totalValue,
  };
}

export function extractAccessKey44(text: string | null | undefined): string {
  if (!text) return "";
  const digitsOnly = text.replace(/\D/g, "");
  if (digitsOnly.length < 44) return "";

  for (let i = 0; i <= digitsOnly.length - 44; i++) {
    const candidate = digitsOnly.slice(i, i + 44);
    if (isValidAccessKey44(candidate)) {
      return candidate;
    }
  }

  // Fallback: re-tenta achando grupos de 8 dígitos separados por não-dígitos
  const groups = text.split(/\D+/).filter((g) => g.length >= 14);
  if (groups.length >= 4) {
    const joined = groups.slice(0, 4).map((g) => g.replace(/\D/g, "")).join("");
    if (joined.length >= 44) {
      const candidate = joined.slice(0, 44);
      if (isValidAccessKey44(candidate)) {
        return candidate;
      }
    }
  }

  return "";
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

export function isValidDanfeItemCandidate(
  line: string | null | undefined,
  options: DanfeItemCandidateOptions = {},
): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/\b\d{4,}\b/.test(trimmed) || /^-?\d{1,4}(\.\d{1,2})?$/.test(trimmed)) {
    return true;
  }
  if (options.quantity || options.regionKey !== undefined) {
    const qtyMatch = trimmed.match(/\b(\d{1,9}(\.\d{1,2})?)\b/);
    if (qtyMatch && parseFloat(qtyMatch[1]) > 0) {
      return true;
    }
  }
  return false;
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
  return a.nfeNumber.length > b.nfeNumber.length;
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
    { field: "nfeNumber", value: parsed.nfeNumber },
    { field: "series", value: parsed.series },
    { field: "emissionDate", value: parsed.emissionDate },
    { field: "accessKey", value: parsed.accessKey },
    { field: "emitterCnpj", value: parsed.emitterCnpj },
    { field: "emitterName", value: parsed.emitterName },
    { field: "receiverCnpj", value: parsed.receiverCnpj },
    { field: "receiverName", value: parsed.receiverName },
    { field: "issuerCnpj", value: parsed.issuerCnpj },
    { field: "issuerName", value: parsed.issuerName },
  ];

  return fields.map(({ field, value }) => ({
    field,
    value,
    source,
    confidence: value ? 85 : 0,
    isValid: Boolean(value),
    notes: value ? "" : "Não encontrado",
  }));
}

function extractNfeNumber(text: string): string {
  const regex = /NF-?e?\s*(?:N[ºo])\s*(?:n[ºo])\s*([0-9]{6,10})/i;
  const match = text.match(regex);
  if (match && match[1]) {
    return match[1];
  }
  const fallbacks = [
    /nfe\s*([0-9]{6,10})/i,
    /nº\s*([0-9]{6,10})/i,
    /nu\s*([0-9]{6,10})/i,
  ];
  for (const pattern of fallbacks) {
    const m = text.match(pattern);
    if (m && m[1]) return m[1];
  }
  return "";
}

function extractSeries(lines: string[]): string {
  for (const line of lines) {
    if (/\bserie\b/i.test(line)) {
      const match = line.match(/(\d{1,3})/);
      if (match) return match[1];
    }
  }
  return "";
}

function extractEmissionDate(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/(\d{2}[/\-.]\d{2}[/\-.]\d{4})/);
    if (match) {
      const parts = match[1].split(/[/\-.]/);
      if (parts.length === 3) {
        const day = parts[0].padStart(2, "0");
        const month = parts[1].padStart(2, "0");
        const year = parts[2];
        return `${day}/${month}/${year}`;
      }
    }
  }
  return "";
}

function extractCnpj(text: string, context: string): string {
  const patterns = [
    new RegExp(`${context}[\\:\\s]*?(?:CNPJ|CPF|Cnpj)[\\:\\s\\-]*?([0-9]{2}\\.?[0-9]{3}\\.?[0-9]{3}\\/?[0-9]{4}\\-?[0-9]{2})`, "i"),
    new RegExp(`${context}[\\:\\s]*?(?:CNPJ|CPF|Cnpj)[\\:\\s\\-]*?([0-9]{14})`, "i"),
    new RegExp(`CNPJ[\\:\\s\\-]*?([0-9]{2}\\.?[0-9]{3}\\.?[0-9]{3}\\/?[0-9]{4}\\-?[0-9]{2})`, "i"),
    new RegExp(`CNPJ[\\:\\s\\-]*?([0-9]{14})`, "i"),
    new RegExp(`CPF[\\:\\s\\-]*?([0-9]{3}\\.?[0-9]{3}\\.?[0-9]{3}\\-?[0-9]{2})`, "i"),
    new RegExp(`CPF[\\:\\s\\-]*?([0-9]{11})`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const cleaned = match[1].replace(/\D/g, "");
      if (cleaned.length === 14) {
        return formatCnpj(cleaned);
      }
      if (cleaned.length === 11) {
        return formatCpf(cleaned);
      }
    }
  }
  return "";
}

function extractName(text: string, context: string): string {
  const lines = text.split(/\n/);
  const contextIndex = lines.findIndex((line) =>
    new RegExp(`${context}[\\:\\s]`, "i").test(line)
  );

  if (contextIndex === -1) return "";

  const startLine = lines[contextIndex];
  let namePart = startLine.split(new RegExp(`${context}[\\:\\s]`, "i"))[1] || "";

  if (namePart.length < 5 && contextIndex + 1 < lines.length) {
    const nextLine = lines[contextIndex + 1];
    namePart = (namePart + " " + nextLine).trim();
  }

  const name = namePart
    .replace(/\.$/, "")
    .trim()
    .split(/[0-9]{2}\./)[0]
    .trim();

  return name || "";
}

function extractAddress(lines: string[]): string {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/\b(rua|avenida|travessa|alameda|rodovia|estrada|outro)\b/i.test(lower)) {
      return line.replace(/\s+(?:CEP|UF|Estado)\s*/g, "").replace(/\s+,/g, ",").trim();
    }
  }
  return "";
}

function extractCity(lines: string[]): string {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/\b(cidade|município)\b/i.test(lower)) {
      const match = line.match(/^(?:Cidade|Município)\s*:\s*(.+)/i);
      if (match) return match[1].trim();
      const parts = line.split(/:\s*/);
      return parts[1]?.trim() || "";
    }
  }
  return "";
}

function extractState(lines: string[]): string {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/\b(uf|estado)\b/i.test(lower)) {
      const match = line.match(/^(?:UF|Estado)\s*:\s*([A-Z]{2})/i);
      if (match) return match[1].trim().toUpperCase();
      const parts = line.split(/:\s*/);
      const code = parts[1]?.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) return code;
    }
  }
  return "";
}

function extractPostalCode(lines: string[]): string {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/\bcep\b/i.test(lower)) {
      const match = line.match(/CEP\s*[:\s]*(\d{5}[-\s]?\d{3})/i);
      if (match) {
        const cleaned = match[1].replace(/\D/g, "");
        if (cleaned.length === 8) {
          return `${cleaned.slice(0, 5)}-${cleaned.slice(5, 8)}`;
        }
      }
    }
  }
  return "";
}

function extractAfNumber(text: string): string {
  const match = text.match(/\bAF[:\s]*([^,\n]+)/i);
  if (match) return match[1].trim();
  return "";
}

function extractEmpenhoNumber(text: string): string {
  const match = text.match(/\bEmpenho[:\s]*([^,\n]+)/i);
  if (match) return match[1].trim();
  return "";
}

function extractProcessNumber(text: string): string {
  const match = text.match(/\bProcesso[:\s]*([^,\n]+)/i);
  if (match) return match[1].trim();
  return "";
}

function extractTotalValue(text: string | null | undefined): number {
  if (!text) return 0;
  const match = text.match(/Valor Total[:\s]*R\$\s*([\d.,]+)/i);
  if (match) {
    const cleaned = match[1].replace(/\./g, "").replace(",", ".");
    const value = Number(cleaned);
    return isFinite(value) ? value : 0;
  }
  return 0;
}

function extractItems(lines: string[]): DanfeItem[] {
  const items: DanfeItem[] = [];
  let index = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(?:it\s*)?(?:nº\s*)?(?:[\d\.]{8,12})\s*(.+?)(?:\s{2,}|\t|$)/i);
    if (!match) continue;

    const description = match[1].trim();
    if (description.length < 3) continue;
    if (/\bTotal\b/i.test(description)) continue;
    if (/\bA Montant OAB\b/i.test(description)) continue;

    const quantityMatch = trimmed.match(/(\d{1,9}(?:,\d{1,2})?)\s*(?:un\.?|und\.?|kg|g|mg|un|pcs?|cxb?|vl\.?|l\.?|ml\.?)?\s*$/i);
    const quantity = quantityMatch ? parseFloat(quantityMatch[1].replace(",", ".")) : 0;

    const unitPriceMatch = trimmed.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:vl\.?|r\$|unit|v\.?)?\s*$/i);
    const unitPrice = unitPriceMatch ? parseFloat(unitPriceMatch[1].replace(/\./g, "").replace(",", ".")) : 0;

    const totalPriceMatch = trimmed.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:tot\.?|total|vl\.? total)?\s*$/i);
    const totalPrice = totalPriceMatch ? parseFloat(totalPriceMatch[1].replace(/\./g, "").replace(",", ".")) : 0;

    items.push({
      index,
      code: "",
      description,
      ncm: "",
      quantity: quantity || 1,
      unit: "",
      unitValue: unitPrice,
      totalValue: totalPrice || unitPrice || 0,
    });

    index++;
  }

  return items;
}

function isValidAccessKey44(digits: string): boolean {
  if (digits.length !== 44) return false;
  if (!/^\d{44}$/.test(digits)) return false;

  const base = digits.slice(0, 43);
  const providedDv = digits.slice(43);

  const sum1 = base.split("").reduce((acc, d, i) => {
    const peso = 44 - i;
    return acc + parseInt(d, 10) * peso;
  }, 0);

  const dv1 = sum1 % 11;
  const expectedDv1 = dv1 < 2 ? 0 : 11 - dv1;

  return providedDv === String(expectedDv1);
}

function formatCnpj(digits: string): string {
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

function formatCpf(digits: string): string {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}
