import {
  parseDanfeText,
  isValidDanfeItemCandidate,
  danfeFieldSummary,
} from "./danfe-ocr";

export type ItemCandidateTrace = {
  line: number;
  raw: string;
  valid: boolean;
  accepted: boolean;
  structured?: {
    lineNumber?: number;
    code?: string;
    description: string;
    quantity?: number;
    unit?: string;
    unitValue?: number;
    totalValue?: number;
  } | null;
  rejectReason?: string;
};

export type OcrTrace = {
  rawTextLength: number;
  rawTextPreview: string;
  pageOcrLength: number;
  pageOcrPreview: string;
  regionTexts: { key: string; length: number; preview: string }[];
  extractedItemCandidates: ItemCandidateTrace[];
  parsed: ReturnType<typeof parseDanfeText>;
  summary: ReturnType<typeof danfeFieldSummary>;
};

export function buildOcrTrace(
  rawText: string | undefined | null,
  pageOcrText: string | undefined | null,
  regionTexts: readonly string[],
): OcrTrace {
  const rawLines = (rawText ?? "").split(/[\r\n]+/).filter((l) => l.trim().length > 0);
  const pageLines = (pageOcrText ?? "").split(/[\r\n]+/).filter((l) => l.trim().length > 0);

  const extractedItemCandidates: ItemCandidateTrace[] = [];
  const seen = new Set<string>();
  for (const line of pageLines) {
    const key = line.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const valid = isValidDanfeItemCandidate(line);
    let structured: ItemCandidateTrace["structured"] = null;
    let rejectedReason = "";
    if (valid) {
      const parsed = parseDanfeText(line + "\n");
      if (parsed.items.length > 0) {
        structured = {
          lineNumber: parsed.items[0].lineNumber,
          code: parsed.items[0].code,
          description: parsed.items[0].description,
          quantity: parsed.items[0].quantity,
          unit: parsed.items[0].unit,
          unitValue: parsed.items[0].unitValue,
          totalValue: parsed.items[0].totalValue,
        };
      } else {
        rejectedReason = "linha válida como candidata, mas parseDanfeText não produziu item estruturado";
      }
    } else {
      rejectedReason = "linha rejeitada pela validação estrutural";
    }
    extractedItemCandidates.push({
      line: extractedItemCandidates.length + 1,
      raw: key,
      valid,
      accepted: false,
      structured,
      rejectReason: rejectedReason,
    });
  }

  const parsed = parseDanfeText(rawText);
  const summary = danfeFieldSummary(parsed);

  return {
    rawTextLength: rawText?.length ?? 0,
    rawTextPreview: rawText ?? "",
    pageOcrLength: pageOcrText?.length ?? 0,
    pageOcrPreview: pageOcrText ?? "",
    regionTexts: [],
    extractedItemCandidates,
    parsed,
    summary,
  };
}
