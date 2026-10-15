"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker } from "tesseract.js";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  formatAccessKeyGrouped,
  formatCnpj,
} from "@/lib/br-validators";
import {
  DANFE_REGIONS,
  danfeFieldSummary,
  extractAccessKey44,
  hasUsableTextLayer,
  isDanfeParseBetter,
  mergeDanfeTexts,
  parseDanfeText,
  validateAccessKey44,
  type DanfeParseResult,
} from "@/lib/danfe-ocr";
import { buildOcrTrace } from "@/lib/ocrtrace";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_OCR_WIDTH = 1100;
const OCR_LANG = "por";

export type DanfeImportResult = DanfeParseResult & {
  supplierId?: string;
  file?: File;
};

export interface DanfeImportDialogProps {
  open: boolean;
  onClose: () => void;
  suppliers: Array<{
    _id: string;
    legalName: string;
    cnpj?: string | null;
  }>;
  onImport: (result: DanfeImportResult) => void;
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
type Phase = "select" | "processing" | "review" | "error";

const ENABLE_DEV_DIAGNOSTIC =
  typeof window !== "undefined" &&
  (window.localStorage?.getItem("danfeDevDiagnostic") ?? "1") === "1";

let diagLayerText: string = "";
let diagOcrText: string = "";
let diagRegionTexts: string[] = [];

export const EMPTY_RESULT: DanfeParseResult = {
  ok: true,
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

// ─── Canvas helpers ──────────────────────────────────────────────────────────

function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function ensureOcrWidth(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (canvas.width >= MIN_OCR_WIDTH) return canvas;
  const scale = MIN_OCR_WIDTH / Math.max(1, canvas.width);
  return scaleCanvas(canvas, scale);
}

async function loadImageCanvas(f: File): Promise<HTMLCanvasElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    i.src = URL.createObjectURL(f);
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Contexto de canvas indisponível.");
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(img.src);
  return canvas;
}

function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: number,
): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = Math.round(source.width * cos + source.height * sin);
  const h = Math.round(source.width * sin + source.height * cos);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function preprocessForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const threshold = 150;
    const v = gray > threshold ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const outCtx = out.getContext("2d");
  if (!outCtx) return canvas;
  outCtx.putImageData(new ImageData(data, width, height), 0, 0);
  return out;
}

// ─── Text layer extraction ──────────────────────────────────────────────────

async function readPdfTextLayer(data: ArrayBuffer): Promise<string> {
  try {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? `${item.str} ` : ""))
      .join("")
      .trim();
    await pdf.destroy();
    return text;
  } catch {
    return "";
  }
}

// ─── OCR por regiões clássicas da DANFE ────────────────────────────────────

async function ocrDanfeRegions(
  canvas: HTMLCanvasElement,
  regions: { key: string; box: { x: number; y: number; w: number; h: number } }[],
): Promise<Array<{ key: string; text: string }>> {
  const results = await Promise.all(
    regions.map(async (region) => {
      const { x, y, w, h } = region.box;
      const regionCanvas = document.createElement("canvas");
      regionCanvas.width = Math.max(1, Math.round(w));
      regionCanvas.height = Math.max(1, Math.round(h));
      const ctx = regionCanvas.getContext("2d");
      if (!ctx) return { key: region.key, text: "" };
      ctx.drawImage(
        canvas,
        Math.max(0, Math.round(x)),
        Math.max(0, Math.round(y)),
        Math.min(Math.round(canvas.width - x), Math.round(w)),
        Math.min(Math.round(canvas.height - y), Math.round(h)),
        0,
        0,
        regionCanvas.width,
        regionCanvas.height,
      );
      const sized = ensureOcrWidth(regionCanvas);
      const worker = await createWorker(OCR_LANG);
      const { data: { text } } = await worker.recognize(sized);
      await worker.terminate();
      return { key: region.key, text };
    }),
  );
  return results;
}

// ─── Componente ─────────────────────────────────────────────────────────────

export default function DanfeImportDialog({
  open,
  onClose,
  suppliers,
  onImport,
}: DanfeImportDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("select");
  const [step, setStep] = useState<string | null>(null);
  const [parsed, setParsed] = useState<DanfeParseResult | null>(null);
  const [fieldSummary, setFieldSummary] = useState<ReturnType<typeof danfeFieldSummary>>(
    danfeFieldSummary(EMPTY_RESULT),
  );
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [keyValid, setKeyValid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPhase("select");
    setStep(null);
    setParsed(null);
    setFieldSummary(danfeFieldSummary(EMPTY_RESULT));
    setSelectedSupplierId("");
    setErrorMessage(null);
    setKeyValid(false);
  }, [open]);

  const processFile = useCallback(
    async (f: File) => {
      setFile(f);
      setPhase("processing");
      setErrorMessage(null);

      try {
        let layerText = "";
        let ocrText = "";
        let regionTexts: string[] = [];

        if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
          setStep("Lendo camada de texto do PDF…");
          const arrayBuffer = await f.arrayBuffer();
          layerText = await readPdfTextLayer(arrayBuffer);

          if (!hasUsableTextLayer(layerText)) {
            setStep("Rasterizando página 1 para OCR…");
            const img = await loadImageCanvas(
              new File([arrayBuffer], "page-1.png", { type: "image/png" }),
            );
            const rotated = rotateCanvas(img, 0);
            const preprocessed = preprocessForOcr(rotated);
            const sized = ensureOcrWidth(preprocessed);

            setStep("Executando OCR da página inteira…");
            const worker = await createWorker(OCR_LANG);
            const { data: { text: fullText } } = await worker.recognize(sized);
            await worker.terminate();
            ocrText = fullText;

            setStep("Executando OCR por regiões da DANFE…");
            const regional = await ocrDanfeRegions(sized, DANFE_REGIONS.map(
              (region) => ({ key: region.key, box: { x: region.x, y: region.y, w: region.w, h: region.h } }),
            ));
            regionTexts = regional.map((r) => r.text);

            const mergedOcr = mergeDanfeTexts(ocrText, regionTexts);
            const parsedLayer = parseDanfeText(layerText);
            const parsedOcr = parseDanfeText(mergedOcr);

            diagLayerText = layerText;
            diagOcrText = ocrText;
            diagRegionTexts = regionTexts;
            buildOcrTrace(
              layerText ?? undefined,
              ocrText ?? undefined,
              regionTexts,
              mergedOcr,
              parsedLayer,
              parsedOcr,
              isDanfeParseBetter(parsedOcr, parsedLayer) ? parsedOcr : parsedLayer,
              isDanfeParseBetter(parsedOcr, parsedLayer) ? "ocr" : "merged",
              null,
            );

            const best = isDanfeParseBetter(parsedOcr, parsedLayer)
              ? parsedOcr
              : parsedLayer;

            if (!best.accessKey) {
              const keyPriority = [
                ...regionTexts.slice(0, 2),
                mergedOcr,
                ocrText,
                layerText,
              ].join("\n");
              const key = extractAccessKey44(keyPriority);
              if (key) {
                setParsed({
                  ...best,
                  accessKey: key,
                  file: f,
                } as DanfeParseResult & { file: File });
                setPhase("review");
                setFieldSummary(danfeFieldSummary({ ...best, accessKey: key }));
                setKeyValid(true);
                return;
              }
            }

            if (!best.ok) {
              setPhase("error");
              setErrorMessage(
                "Não foi possível ler dados do documento. Se o arquivo for apenas uma foto, tente outro ângulo ou use a entrada manual.",
              );
              return;
            }

            setParsed({ ...best, file: f } as DanfeParseResult & { file: File });
            setPhase("review");
            setFieldSummary(danfeFieldSummary(best));
            setKeyValid(!!best.accessKey);
            return;
          }
        } else {
          setStep("Lendo imagem para OCR…");
          const img = await loadImageCanvas(f);
          const rotated = rotateCanvas(img, 0);
          const preprocessed = preprocessForOcr(rotated);
          const sized = ensureOcrWidth(preprocessed);

          setStep("Executando OCR da página inteira…");
          const worker = await createWorker(OCR_LANG);
          const { data: { text: fullText } } = await worker.recognize(sized);
          await worker.terminate();
          ocrText = fullText;

          setStep("Executando OCR por regiões da DANFE…");
          const regional = await ocrDanfeRegions(sized, DANFE_REGIONS.map(
            (region) => ({ key: region.key, box: { x: region.x, y: region.y, w: region.w, h: region.h } }),
          ));
          regionTexts = regional.map((r) => r.text);

          const mergedOcr = mergeDanfeTexts(ocrText, regionTexts);
          const parsedOcr = parseDanfeText(mergedOcr);

          diagLayerText = "";
          diagOcrText = ocrText;
          diagRegionTexts = regionTexts;
          buildOcrTrace(
            undefined,
            ocrText ?? undefined,
            regionTexts,
            mergedOcr,
            EMPTY_RESULT,
            parsedOcr,
            parsedOcr,
            "merged",
            null,
          );

          const best = parsedOcr;

          if (!best.accessKey) {
            const keyPriority = [
              ...regionTexts.slice(0, 2),
              mergedOcr,
              ocrText,
            ].join("\n");
            const key = extractAccessKey44(keyPriority);
            if (key) {
              setParsed({
                ...best,
                accessKey: key,
                file: f,
              } as DanfeParseResult & { file: File });
              setPhase("review");
              setFieldSummary(danfeFieldSummary({ ...best, accessKey: key }));
              setKeyValid(true);
              return;
            }
          }

          if (!best.ok) {
            setPhase("error");
            setErrorMessage(
              "Não foi possível ler dados do documento. Se o arquivo for apenas uma foto, tente outro ângulo ou use a entrada manual.",
            );
            return;
          }

          setParsed({ ...best, file: f } as DanfeParseResult & { file: File });
          setPhase("review");
          setFieldSummary(danfeFieldSummary(best));
          setKeyValid(!!best.accessKey);
          return;
        }

        // Nunca chegamos aqui: os dois ramos acima retornam.
      } catch (err) {
        setPhase("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Falha inesperada ao processar o documento.",
        );
      }
    },
    [],
  );

  const handleImport = () => {
    if (!parsed || !file) return;
    onImport({ ...parsed, supplierId: selectedSupplierId || undefined });
  };

  const showNoData = phase === "review" && fieldSummary.found === 0;
  const showReview = phase === "review" && fieldSummary.found > 0;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent
        className="w-[calc(100vw-32px)] max-w-[960px] max-h-[85dvh] flex flex-col gap-0 overflow-hidden p-0 sm:p-0"
      >
        <DialogHeader className="min-w-0 max-w-full shrink-0 px-5 pt-4 pb-2 sm:px-6 sm:pt-5">
          <DialogTitle>Importar DANFE / PDF / Imagem</DialogTitle>
          <DialogDescription>
            O documento é lido localmente no navegador. Os dados entram na conferência da
            Entrada — nada é criado sem a sua confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 max-w-full flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-5 pb-3 sm:px-6 space-y-3">
          {phase === "select" && (
            <div className="space-y-3">
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,image/*"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-accent"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  event.target.value = "";
                  if (chosen) void processFile(chosen);
                }}
              />
              <p className="text-xs text-muted-foreground">
                PDF com camada de texto, PDF escaneado ou foto da DANFE (página 1). Se o OCR
                ficar incompleto, você pode informar os campos manualmente na conferência.
              </p>
            </div>
          )}

          {phase === "processing" && (
            <div className="flex items-center gap-3 rounded-lg border p-4 text-sm">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>{step || "Processando documento…"}</span>
            </div>
          )}

          {(phase === "error" || showNoData) && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">Nenhum campo identificado automaticamente.</p>
              <p>
                o arquivo não foi gravado em lugar nenhum — nada foi perdido. Se preferir,{" "}
                <strong>use a entrada manual</strong> para lançar esta NF-e ou volte e use
                “Importar NF-e XML” como caminho preferencial.
              </p>
              {phase === "error" && errorMessage && (
                <p className="text-xs text-amber-800">{errorMessage}</p>
              )}
            </div>
          )}

          {showReview && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-800">OCR concluído</Badge>
                <span className="text-sm font-medium">
                  Dados identificados: {fieldSummary.found} de {fieldSummary.total} campos
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Você pode informar ou corrigir qualquer campo antes de seguir para a
                conferência. Itens ausentes ficam pendentes — nenhum produto é inventado.
              </p>

              {!keyValid && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                  Chave de acesso não identificada automaticamente. Confira a DANFE e informe a
                  chave na etapa de conferência.
                </div>
              )}

              {fieldSummary.missing.length > 0 && (
                <div className="rounded-lg border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Pendências de conferência: </span>
                  {fieldSummary.missing.join(" · ")}
                </div>
              )}

              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Dados lidos da DANFE</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DataCell label="Número da NF-e" value={parsed?.nfeNumber ?? ""} />
                  <DataCell label="Série" value={parsed?.series ?? ""} />
                  <DataCell label="Data de emissão" value={parsed?.emissionDate ?? ""} />
                  <DataCell label="CNPJ do emitente" value={parsed?.emitterCnpj ?? ""} />
                  <DataCell label="Razão social do emitente" value={parsed?.emitterName ?? ""} />
                  <DataCell label="Cidade do emitente" value={parsed?.emitterCity ?? ""} />
                  <DataCell label="UF do emitente" value={parsed?.emitterState ?? ""} />
                  <DataCell label="CEP do emitente" value={parsed?.emitterPostalCode ?? ""} />
                  <DataCell
                    label="Chave de acesso"
                    value={parsed?.accessKey ? formatAccessKeyGrouped(parsed.accessKey) : ""}
                    wide
                    mono
                  />
                </div>
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Fornecedor</h4>
                <Select
                  value={selectedSupplierId || "none"}
                  onValueChange={(value) =>
                    setSelectedSupplierId(value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger className="h-9 w-full min-w-0">
                    <SelectValue placeholder="Selecionar fornecedor (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Detectar automaticamente</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem
                        key={supplier._id}
                        value={supplier._id}
                      >
                        {supplier.legalName}
                        {supplier.cnpj && (
                          <span className="block min-w-0 truncate text-[10px] text-muted-foreground">
                            CNPJ: {formatCnpj(supplier.cnpj)}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
            </>
          )}
        </div>

        <DialogFooter className="min-w-0 max-w-full shrink-0 border-t border-border px-5 pb-4 pt-3 sm:px-6">
          <div className="flex w-full items-center gap-3">
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button
              className="ml-auto"
              onClick={handleImport}
              disabled={!parsed || !file}
            >
              Usar na conferência
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DataCell({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  const display = value && mono ? formatAccessKeyGrouped(value) : value;
  return (
    <div className="min-w-0 overflow-hidden">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm text-foreground", wide && "col-span-1 sm:col-span-2", mono && "font-mono text-xs")}>
        {display}
      </dd>
    </div>
  );
}
