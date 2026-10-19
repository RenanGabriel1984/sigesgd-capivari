/**
 * Leitura de RELATÓRIOS JSON do OCR da DANFE (Rodada 20).
 *
 * Utilitários puros, sem nenhuma dependência de banco: servem tanto à tela de
 * desenvolvimento (`/dev/danfe-lab`) quanto aos testes automatizados que leem
 * fixtures JSON versionadas no repositório.
 *
 * O formato dos relatórios não é rígido (o objeto `rastreio` pode aninhar
 * `pageOcrText`/`regionTexts`/`mergedOcr`, e o documento pode vir como objeto
 * único, array de dois relatórios ou texto puro), então a extração é feita
 * com varredura profunda, tolerante a aninhamento e a ordem de chaves.
 */
import { mergeDanfeTexts } from "./danfe-ocr";

/** Textos de OCR de UM documento (PDF ou PNG). */
export interface OcrReportPayload {
  /** Rótulo identificador (arquivo declarado no JSON ou ordinal). */
  label: string;
  /** Camada textual do PDF (se houver). */
  rawText?: string;
  /** OCR da página inteira. */
  pageOcrText?: string;
  /** Recortes regionais. */
  regionTexts: string[];
  /** Texto consolidado gravado no relatório (o que o app calculou). */
  mergedOcr?: string;
}

/** Chaves de OCR procuradas em qualquer nível do JSON. */
const OCR_TEXT_KEYS = ["mergedOcr", "pageOcrText", "regionTexts"] as const;

/** Chaves cujo valor-string vira o rótulo do relatório. */
const LABEL_KEYS = [
  "arquivo",
  "fileName",
  "filename",
  "file",
  "nome",
  "name",
  "titulo",
  "title",
  "rotulo",
  "label",
];

/** Estruturas que o relatório pode conter — checklist exibido na tela. */
export const REPORT_STRUCTURE_KEYS = [
  "rastreio",
  "pageOcrText",
  "regionTexts",
  "mergedOcr",
  "parsedLayer",
  "parsedOcr",
  "fieldTraces",
  "comparison",
] as const;

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function labelFrom(node: Dict, fallback: string): string {
  for (const key of LABEL_KEYS) {
    const value = asString(node[key]);
    if (value && value.length <= 160) return value;
  }
  return fallback;
}

function toPayload(node: Dict, label: string): OcrReportPayload {
  const regions = Array.isArray(node.regionTexts)
    ? node.regionTexts.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    label,
    rawText: asString(node.rawText) ?? asString(node.textLayer),
    pageOcrText: asString(node.pageOcrText),
    regionTexts: regions,
    mergedOcr: asString(node.mergedOcr),
  };
}

/**
 * Varre qualquer estrutura JSON e devolve UM payload por objeto que contenha
 * textos de OCR (`pageOcrText`, `regionTexts` ou `mergedOcr`), preservando o
 * rótulo declarado (ex.: nome do arquivo) quando existir.
 *
 * Um array com os dois relatórios (PDF e PNG) gera dois payloads.
 */
export function collectOcrReports(input: unknown): OcrReportPayload[] {
  const out: OcrReportPayload[] = [];
  const visited = new Set<object>();

  const walk = (node: unknown, inheritedLabel: string): void => {
    if (typeof node === "string") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) =>
        walk(entry, inheritedLabel || `relatorio-${index + 1}`),
      );
      return;
    }
    if (!isDict(node) || visited.has(node)) return;
    visited.add(node);

    const label = labelFrom(node, inheritedLabel);
    const hasOcrText = OCR_TEXT_KEYS.some(
      (key) => node[key] !== undefined && node[key] !== null,
    );
    if (hasOcrText) {
      out.push(toPayload(node, label));
      return; // não desce: o aninhamento interno é do mesmo documento
    }
    for (const value of Object.values(node)) walk(value, label);
  };

  walk(input, "");
  return out.map((payload, index) => ({
    ...payload,
    label: payload.label || `relatorio-${index + 1}`,
  }));
}

/**
 * Monta o texto que o PRÓPRIO aplicativo alimentaria no parser:
 *   • usa `mergedOcr` gravado no relatório (resultado de `mergeDanfeTexts`);
 *   • sem ele, recalcula exatamente como `DanfeImportDialog`
 *     (`mergeDanfeTexts(página, regiões)`).
 */
export function buildReportText(payload: OcrReportPayload): {
  text: string;
  source: string;
} {
  const stored = payload.mergedOcr?.trim();
  if (stored) {
    return { text: payload.mergedOcr!, source: "mergedOcr (gravado no relatório)" };
  }
  const page = payload.rawText ?? payload.pageOcrText ?? "";
  const merged = mergeDanfeTexts(page, payload.regionTexts);
  if (merged.trim()) {
    return {
      text: merged,
      source: "mergeDanfeTexts(página/camada + regiões) — recalculado",
    };
  }
  const fallback = (payload.pageOcrText ?? payload.rawText ?? "").trim();
  if (fallback) return { text: fallback, source: "pageOcrText" };
  return { text: "", source: "nenhum" };
}

/** Checklist: quais estruturas do relatório existem em QUALQUER nível. */
export function reportStructure(input: unknown): Array<{
  key: string;
  found: boolean;
}> {
  const present = new Set<string>();
  const visited = new Set<object>();

  const walk = (node: unknown): void => {
    if (typeof node === "string" || node === null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isDict(node) || visited.has(node)) return;
    visited.add(node);
    for (const key of Object.keys(node)) present.add(key);
    for (const value of Object.values(node)) walk(value);
  };

  walk(input);
  return REPORT_STRUCTURE_KEYS.map((key) => ({
    key,
    found: present.has(key),
  }));
}

/**
 * Interpreta o conteúdo colado/carregado: JSON (objeto ou array) ou texto
 * puro de OCR. Lança Error com mensagem amigável quando o formato não serve.
 */
export function parseReportInput(raw: string): {
  input: unknown;
  reports: OcrReportPayload[];
  structure: Array<{ key: string; found: boolean }>;
  isPlainText: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Cole o JSON do relatório (ou o texto OCR) para analisar.");

  const tryJson = (): unknown | undefined => {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  };

  const json = tryJson();
  if (json !== undefined) {
    const reports = collectOcrReports(json);
    if (reports.length === 0) {
      throw new Error(
        "JSON válido, mas sem textos OCR (pageOcrText, regionTexts ou mergedOcr) em nenhum nível.",
      );
    }
    return { input: json, reports, structure: reportStructure(json), isPlainText: false };
  }

  // Não é JSON: aceita como texto OCR puro (útil para conferência rápida).
  if (trimmed.length >= 40) {
    const payload: OcrReportPayload = {
      label: "texto-colido",
      mergedOcr: trimmed,
      regionTexts: [],
    };
    return {
      input: trimmed,
      reports: [payload],
      structure: reportStructure({ mergedOcr: trimmed }),
      isPlainText: true,
    };
  }

  throw new Error(
    "Conteúdo não é JSON válido e não contém texto OCR suficiente (mínimo de 40 caracteres).",
  );
}
