import { parseDanfeText, isValidDanfeItemCandidate, danfeFieldSummary } from "./danfe-ocr";

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

type OcrTrace = {
  rawTextLength: number;
  rawTextPreview: string;
  pageOcrLength: number;
  pageOcrPreview: string;
  regionTexts: { key: string; length: number; preview: string }[];
  extractedItemCandidates: ItemCandidateTrace[];
  parsed: ReturnType<typeof parseDanfeText>;
  summary: ReturnType<typeof danfeFieldSummary>;
};

export function buildOcrTrace(rawText: string | undefined | null, pageOcrText: string | undefined | null, regionTexts: { key: string; text: string }[]): OcrTrace {
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
      line: pageLines.length,
      raw: key.slice(0, 300),
      valid,
      accepted: valid && structured !== null,
      structured,
      rejectReason: rejectedReason,
    });
  }

  const parsed = parseDanfeText([rawText ?? "", pageOcrText ?? "", ...regionTexts.map((r) => r.text)].join("\n"));
  const summary = danfeFieldSummary(parsed);

  return {
    rawTextLength: rawLines.length,
    rawTextPreview: rawLines.slice(0, 80).map((l) => l.trim()).join("\n"),
    pageOcrLength: pageLines.length,
    pageOcrPreview: pageLines.slice(0, 120).join("\n"),
    regionTexts: regionTexts.map((r) => ({ key: r.key, length: r.text.split(/[\r\n]+/).filter((l) => l.trim().length > 0).length, preview: r.text.slice(0, 400) })),
    extractedItemCandidates,
    parsed,
    summary,
  };
}
