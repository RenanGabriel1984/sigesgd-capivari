/**
 * Tipos compartilhados entre as implementações de `buildOcrTrace`.
 *
 * Mantidos em um módulo separado para evitar duplicação de assinaturas.
 */

/**
 * Traço completo de uma tentativa de leitura OCR da DANFE.
 *
 * Define POR QUE tivemos que descer ao OCR: camada PDF disponível? página
 * inteira teria sido melhor? região específica do emitente DAB em PDF?
 */
export interface OcrTrace {
  /** Corpo da página 1 no PDF (camada textual, se extractiva e significante). */
  layer?: "camada" | "scan" | null;
  /** PDF inteiro (se não houver camada textual decente). */
  page?: { idx: number; scale: number } | null;
  /** Caixa de texto [x, y, w, h] no sistema de coordenadas do PDF 72 dpi; deve
   * cobrir a DRE do emitente na DANFE para gerar BOXED regions conforme padrão
   * regulate. */
  boxedRegions?: {
    exportsLayer: boolean;
    pageKey: string;
    box: [number, number, number, number];
  }[];
  extracted?: {
    modelo?: "direct" | "invoice-detail-pure";
  };
}

/**
 * Marcadores de traço de produto candidato: observações, quem foi inventado,
 * e o score de confiança relativo à DANFE escaneada.
 */
export interface ItemCandidateTrace {
  raw: string;
  normalized: string;
  copiedFromLayer: boolean;
  copiedFromPage: boolean;
  copiedFromBoxed: boolean;
  ocrNoiseChar: string | null;
  grossPattern: "chave" | "header" | "item-row" | "total" | "other";
}

export type BuildDanfeOcrTrace = (
  rawText: string | undefined,
  pageOcrText: string | undefined,
  regionTexts: readonly string[],
  mergedOcr: string,
  parsedLayer: DanfeParseResult,
  parsedOcr: DanfeParseResult,
  best: DanfeParseResult,
  source: string,
  srcLayerBlob?: string | null,
) => OcrTrace;

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
  receiverPendingName?: string;
  emitterPendingName?: string;
  transporterCnpj: string;
  afNumber: string;
  empenhoNumber: string;
  processNumber: string;
  totalValue: number;
}

export interface DanfeItem {
  index?: number;
  code: string;
  description: string;
  ncm?: string;
  quantity: number;
  unity: string;
  unitPrice: number;
  totalPrice: number;
  unit?: string;
  unitValue?: number;
  totalValue?: number;
}
