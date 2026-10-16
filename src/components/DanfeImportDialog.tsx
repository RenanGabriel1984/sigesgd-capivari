"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, ClipboardCopy, FileText, Loader2, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  digitsOnly,
  formatAccessKeyGrouped,
  formatCnpj,
} from "@/lib/br-validators";

import type { DanfeParseResult, OcrTrace } from "@/lib/danfe-ocr";
import {
  DANFE_REGIONS,
  buildOcrTrace,
  danfeFieldSummary,
  hasUsableTextLayer,
  isDanfeParseBetter,
  mergeDanfeTexts,
  parseDanfeText,
  validateAccessKey44,
} from "@/lib/danfe-ocr";

export type DanfeImportResult = DanfeParseResult & {
  supplierId?: string;
  file?: { name: string; storageId: string };
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
  /** Arquivo original (PDF/imagen) anexado — salvo pela Entrada, nunca aqui. */
  onFile?: (file: File | null) => void;
}

// ─── Referências de conferência (NUNCA preenchem campo do OCR) ───────────────
const INCOTECH_TEST_ACCESS_KEY =
  "42260922816315000144550010000029671515440064";
const INCOTECH_TEST_CNPJ = "22816315000144";

// ─── Pipeline de leitura (camada textual do PDF + OCR de imagem/escaneado) ──
const TARGET_DPI = 300;
const MIN_OCR_WIDTH = 1200;
const MAX_PDF_PAGES = 3;

function readDiagnosticFlag(): boolean {
  try {
    return window.localStorage.getItem("danfeDevDiagnostic") === "1";
  } catch {
    return false;
  }
}

function isDevEnvironment(): boolean {
  return Boolean(import.meta.env?.DEV);
}

/**
 * Captura direta pela câmera: oferecida em DISPOSITIVOS MÓVEIS (telefone/tablet)
 * e em viewports estreitos. No desktop nada é alterado — o anexo de arquivo
 * (PDF/imagem) continua sendo o caminho padrão.
 *
 * O input usa `capture="environment"`: quando o navegador móvel suporta, abre a
 * câmera traseira; quando não suporta, cai automaticamente no seletor de
 * imagens existentes — ou seja, nunca bloqueia o operador.
 */
function supportsCameraCapture(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  const mobileDevice = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua);
  const narrowViewport =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 640px)").matches;
  return mobileDevice || narrowViewport;
}

/**
 * Diagnóstico acessível da importação DANFE:
 *   • em DESENVOLVIMENTO o botão aparece sempre, sem depender de nenhuma
 *     condição que impeça a visualização (a dupla checagem
 *     `DEV && flag` escondia o botão mesmo com a flag ativa);
 *   • no build publicado (`import.meta.env.DEV === false`) ele só aparece
 *     mediante opt-in explícito do operador
 *     (localStorage.setItem("danfeDevDiagnostic", "1")) — sem a flag,
 *     produção NUNCA exibe dados de diagnóstico.
 */
function isDiagnosticEnabled(): boolean {
  return isDevEnvironment() || readDiagnosticFlag();
}

async function loadImageCanvas(f: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Imagem inválida"));
      element.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível");
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Cinza + estiramento de contraste antes do OCR (melhora a leitura da DANFE). */
function preprocessForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] =
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = Math.max(1, max - min);

  for (let i = 0; i < data.length; i += 4) {
    const value = Math.min(255, Math.max(0, Math.round(((data[i] - min) * 255) / range)));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function upscaleCanvas(canvas: HTMLCanvasElement, targetWidth: number): HTMLCanvasElement {
  const scale = Math.min(3, targetWidth / Math.max(1, canvas.width));
  if (scale <= 1) return canvas;
  const upscaled = document.createElement("canvas");
  upscaled.width = Math.floor(canvas.width * scale);
  upscaled.height = Math.floor(canvas.height * scale);
  const ctx = upscaled.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, upscaled.width, upscaled.height);
  return upscaled;
}

function rotateCanvas(canvas: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const rotated = document.createElement("canvas");
  const swap = angle === 90 || angle === 270;
  rotated.width = swap ? canvas.height : canvas.width;
  rotated.height = swap ? canvas.width : canvas.height;
  const ctx = rotated.getContext("2d");
  if (!ctx) return canvas;
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return rotated;
}

async function runTesseractOcr(canvas: HTMLCanvasElement): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por");
  try {
    const prepared =
      canvas.width < MIN_OCR_WIDTH ? upscaleCanvas(canvas, MIN_OCR_WIDTH) : preprocessForOcr(canvas);
    const result = await worker.recognize(prepared);
    return result.data?.text ?? "";
  } finally {
    await worker.terminate();
  }
}

async function ocrPageWithRotationRetry(
  canvas: HTMLCanvasElement,
  onStatus: (status: string) => void,
): Promise<string> {
  let text = await runTesseractOcr(preprocessForOcr(canvas));
  if (text.trim()) return text;

  // DANFE fotografada de lado: a primeira leitura sai vazia — corrigindo rotação.
  onStatus("Primeira leitura vazia — corrigindo rotação…");
  for (const angle of [90, 180, 270]) {
    const rotated = preprocessForOcr(rotateCanvas(canvas, angle));
    text = await runTesseractOcr(rotated);
    if (text.trim()) return text;
  }
  return "";
}

async function ocrDanfeRegions(
  canvas: HTMLCanvasElement,
  onStatus: (status: string) => void,
): Promise<string[]> {
  onStatus("OCR por regiões da DANFE…");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const texts: string[] = [];

  for (const region of DANFE_REGIONS) {
    const x = Math.max(0, Math.floor(canvas.width * region.x));
    const y = Math.max(0, Math.floor(canvas.height * region.y));
    const width = Math.min(canvas.width - x, Math.floor(canvas.width * region.w));
    const height = Math.min(canvas.height - y, Math.floor(canvas.height * region.h));
    if (width <= 0 || height <= 0) continue;
    const crop = document.createElement("canvas");
    crop.width = width;
    crop.height = height;
    const cropCtx = crop.getContext("2d");
    if (!cropCtx) continue;
    cropCtx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
    const text = await runTesseractOcr(crop);
    if (text.trim()) texts.push(text.trim());
  }

  return texts;
}

async function extractPdfTextLayer(f: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    // worker configurado pelo bundler — segue para a leitura
  }

  const data = await f.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" "),
    );
  }
  const text = pages.join("\n");
  if (!hasUsableTextLayer(text)) return "";
  return text;
}

async function rasterizePdfPages(f: File): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    // worker configurado pelo bundler
  }

  const data = await f.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const canvases: HTMLCanvasElement[] = [];
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);

  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: TARGET_DPI / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }

  return canvases;
}

type DanfeReadResult = { parsed: DanfeParseResult; trace: OcrTrace };

async function readDanfeFile(
  f: File,
  onStatus: (status: string) => void,
): Promise<DanfeReadResult> {
  const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  let rawText = "";
  let pageOcrText = "";
  const regionTexts: string[] = [];

  if (isPdf) {
    onStatus("Lendo a camada de texto do PDF…");
    try {
      rawText = await extractPdfTextLayer(f);
    } catch {
      rawText = "";
    }
  }

  const hasLayer = hasUsableTextLayer(rawText);
  if (!hasLayer) {
    onStatus(
      isPdf
        ? "PDF escaneado — rasterizando a 300 DPI e executando OCR (tesseract.js)…"
        : "Imagem da DANFE — executando OCR (tesseract.js)…",
    );
    const canvases = isPdf
      ? await rasterizePdfPages(f)
      : [preprocessForOcr(await loadImageCanvas(f))];
    for (const canvas of canvases) {
      pageOcrText += `\n${await ocrPageWithRotationRetry(canvas, onStatus)}`;
      regionTexts.push(...(await ocrDanfeRegions(canvas, onStatus)));
    }
  }

  const mergedOcr = mergeDanfeTexts(hasLayer ? rawText : pageOcrText, regionTexts);
  const parsedLayer = parseDanfeText(rawText || "");
  const parsedOcr = parseDanfeText(mergedOcr);
  const best = isDanfeParseBetter(parsedOcr, parsedLayer) ? parsedOcr : parsedLayer;
  const trace = buildOcrTrace(
    rawText || undefined,
    pageOcrText || undefined,
    regionTexts,
    mergedOcr,
    parsedLayer,
    parsedOcr,
    best,
    hasLayer ? "camada-texto" : "ocr",
    null,
  );

  return { parsed: best, trace };
}

const EMPTY_PARSED: DanfeParseResult = { ok: false, items: [] };

function formatCurrencyStable(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function DataCell({
  label,
  children,
  mono,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0 max-w-full overflow-hidden", wide && "col-span-1 sm:col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 min-w-0 max-w-full overflow-hidden break-words text-foreground",
          mono && "font-mono",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function DanfeImportDialog({
  open,
  onClose,
  suppliers,
  onImport,
  onFile,
}: DanfeImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [parsed, setParsed] = useState<DanfeParseResult>(EMPTY_PARSED);
  const [trace, setTrace] = useState<OcrTrace | null>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [diagnosticEnabled, setDiagnosticEnabled] = useState(false);

  // Resumo SEMPRE recalculado do parse atual (nunca de um estado obsoleto).
  const fieldSummary = useMemo(() => danfeFieldSummary(parsed), [parsed]);
  const summary = fieldSummary;
  const accessKeyDigits = digitsOnly(parsed.accessKey ?? "");
  const keyValid = validateAccessKey44(parsed.accessKey ?? "");

  /** Divergência entre a chave RECONHECIDA e a esperada na DANFE de teste Incotech. */
  const incotechCheck = useMemo<boolean | null>(() => {
    if (!accessKeyDigits) return null;
    const isIncotechDocument =
      digitsOnly(parsed.emitterCnpj ?? "") === INCOTECH_TEST_CNPJ ||
      /incotech/i.test(fileName);
    if (!isIncotechDocument) return null;
    return accessKeyDigits === INCOTECH_TEST_ACCESS_KEY;
  }, [accessKeyDigits, parsed.emitterCnpj, fileName]);

  useEffect(() => {
    if (!open) {
      setDiagnosticEnabled(false);
      return;
    }
    setSelectedSupplierId("");
    setShowReview(false);
    setParsed(EMPTY_PARSED);
    setTrace(null);
    setFileName("");
    setStatus("");
    setReading(false);
    setError("");
    onFile?.(null);

    // Diagnóstico de desenvolvimento: flag lida continuamente para reagir a
    // localStorage.setItem("danfeDevDiagnostic", "1") feito depois da abertura.
    const refreshDiagnostic = () => setDiagnosticEnabled(isDiagnosticEnabled());
    refreshDiagnostic();
    const intervalId = window.setInterval(refreshDiagnostic, 1000);
    window.addEventListener("storage", refreshDiagnostic);

    // Câmera do aparelho: reavaliada a cada abertura e quando o viewport muda
    // (celular deitado/em pé, rotação).
    const refreshCamera = () => setCameraAvailable(supportsCameraCapture());
    refreshCamera();
    const mediaQuery =
      typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 640px)") : null;
    mediaQuery?.addEventListener("change", refreshCamera);
    window.addEventListener("orientationchange", refreshCamera);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("storage", refreshDiagnostic);
      mediaQuery?.removeEventListener("change", refreshCamera);
      window.removeEventListener("orientationchange", refreshCamera);
    };
  }, [open]);

  const startRead = async (file: File) => {
    setReading(true);
    setError("");
    setStatus("Preparando a leitura da DANFE…");
    setFileName(file.name);
    onFile?.(file);
    try {
      const { parsed: result, trace: ocrTrace } = await readDanfeFile(file, setStatus);
      setParsed(result);
      setTrace(ocrTrace);
      setShowReview(true);
      if (danfeFieldSummary(result).found === 0) {
        setError(
          "Nada foi identificado nesta leitura — nada foi perdido: os campos continuam pendentes. " +
            "use a entrada manual ou volte e importe o XML (Importar NF-e XML).",
        );
      }
    } catch {
      setError(
        "Não foi possível ler o arquivo selecionado — nada foi perdido: use a entrada manual ou " +
          "importe o XML (Importar NF-e XML) e confira os campos manualmente.",
      );
    } finally {
      setReading(false);
      setStatus("");
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void startRead(file);
  };

  const copyToClipboard = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error("Não foi possível copiar. Selecione o valor manualmente.");
    }
  };

  const copyDiagnosticReport = async () => {
    const report = {
      geradoEm: new Date().toISOString(),
      arquivo: fileName || null,
      resumo: fieldSummary,
      chave: {
        valor: parsed.accessKey ?? null,
        digitos: accessKeyDigits.length,
        digitoVerificadorValido: keyValid,
        referenciaIncotech: INCOTECH_TEST_ACCESS_KEY,
        confereComReferencia: incotechCheck,
      },
      campos: parsed,
      rastreio: trace,
    };
    await copyToClipboard(JSON.stringify(report, null, 2), "Relatório JSON copiado");
  };

  const handleImport = () => {
    if (!parsed.ok) return;
    onImport({ ...parsed, supplierId: selectedSupplierId || undefined });
  };

  const canImport = parsed.ok && showReview;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="w-[calc(100vw-32px)] max-w-[960px] max-h-[85dvh] flex flex-col gap-0 overflow-hidden p-0 sm:p-0">
        <div className="min-w-0 max-w-full shrink-0 border-b px-5 pt-4 pb-3 sm:px-6">
          <DialogTitle className="text-lg font-semibold">
            Importar DANFE / PDF / Imagem
          </DialogTitle>
          <DialogDescription>
            Fotografe a DANFE com a câmera do aparelho (celular) ou anexe um PDF/imagem.
            Os campos lidos entram em uma etapa de conferência — nada é criado sem a sua confirmação.
          </DialogDescription>
        </div>

        <div className="min-w-0 max-w-full overflow-x-hidden">
          <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-5 pb-3 sm:px-6 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={handleFileInput}
            />
            {/** Câmera do aparelho (mobile): mesmo fluxo de leitura da DANFE. Se o
             * navegador não permitir captura direta, o input abre o seletor de
             * imagens — a alternativa de escolher uma imagem existente segue
             * disponível no botão de anexo. */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileInput}
            />

            {!showReview && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {cameraAvailable && (
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      disabled={reading}
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="h-4 w-4" />
                      Tirar foto da DANFE
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    disabled={reading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {reading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ScanLine className="h-4 w-4" />
                    )}
                    Anexar DANFE (PDF ou imagem)
                  </Button>
                </div>
                {reading && (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {status || "Lendo o documento…"}
                  </p>
                )}
                {error && !reading && (
                  <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {error}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  O arquivo é lido localmente: camada textual do PDF (pdfjs-dist) ou OCR
                  (tesseract.js) quando o PDF é escaneado ou o arquivo é uma imagem. Se a câmera
                  não abrir no aparelho, use "Anexar DANFE" para escolher uma foto da galeria. Se
                  a leitura não identificar os campos, use a entrada manual ou importe o XML —
                  Importar NF-e XML.
                </p>
                {cameraAvailable && (
                  <p className="text-xs text-muted-foreground">
                    No celular, a câmera traseira é aberta direto para capturar a DANFE. Anexar
                    continua aceitando PDF, foto da galeria e imagem já salva no aparelho.
                  </p>
                )}
              </div>
            )}

            {showReview && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-emerald-100 text-emerald-800">OCR concluído</Badge>
                  <span className="text-sm">
                    Dados identificados: {fieldSummary.found} de {fieldSummary.total} campos
                  </span>
                  {diagnosticEnabled && trace && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="ml-auto gap-2"
                      onClick={() => void copyDiagnosticReport()}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" /> Copiar relatório JSON
                    </Button>
                  )}
                </div>

                {summary.found === 0 && (
                  <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Nada foi identificado nesta leitura — nada foi perdido: os campos ficam
                    pendentes e você pode informar tudo manualmente, ou voltar e usar a entrada
                    manual / Importar NF-e XML.
                  </div>
                )}

                {summary.found > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {"Você pode informar ou corrigir qualquer campo antes de seguir para a conferência. " +
                      "Itens não associados ficam pendentes para você coordenar a associação manual na conferência — nenhum produto é inventado."}
                  </p>
                )}

                {!keyValid && (
                  <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Chave de acesso não identificada automaticamente. Confira a DANFE e informe a chave na etapa de conferência.
                  </div>
                )}

                {error && (
                  <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {error}
                  </div>
                )}

                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase">Dados lidos da DANFE</h4>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <DataCell label="Número da NF-e">{parsed.nfeNumber ?? "—"}</DataCell>
                    <DataCell label="Série">{parsed.series ?? "—"}</DataCell>
                    <DataCell label="Data de emissão">{parsed.emissionDate ?? "—"}</DataCell>
                    <DataCell label="CNPJ do emitente" mono>
                      {parsed.emitterCnpj ?? "—"}
                    </DataCell>
                    <DataCell label="Razão social do emitente">
                      {parsed.emitterName ?? "—"}
                    </DataCell>
                    <DataCell label="Cidade do emitente">{parsed.emitterCity ?? "—"}</DataCell>
                    <DataCell label="UF do emitente">{parsed.emitterState ?? "—"}</DataCell>
                    <DataCell label="CEP do emitente">{parsed.emitterPostalCode ?? "—"}</DataCell>
                    <DataCell label="Chave de acesso" mono wide>
                      {parsed.accessKey ? (
                        <div className="space-y-1">
                          <p className="text-sm min-w-0 max-w-full overflow-hidden break-words">
                            {formatAccessKeyGrouped(parsed.accessKey)}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() =>
                                void copyToClipboard(
                                  accessKeyDigits,
                                  "Chave de acesso copiada (44 dígitos, sem formatação)",
                                )
                              }
                            >
                              <ClipboardCopy className="h-3 w-3" /> Copiar chave (44 dígitos)
                            </Button>
                            <span
                              className={cn(
                                "text-xs",
                                keyValid ? "text-emerald-700" : "text-amber-700",
                              )}
                            >
                              {accessKeyDigits.length} dígitos — dígito verificador{" "}
                              {keyValid ? "válido" : "INVÁLIDO"}
                            </span>
                          </div>
                          {incotechCheck === true && (
                            <p className="text-xs text-emerald-700">
                              Chave reconhecida confere integralmente com a chave esperada da DANFE
                              de teste Incotech.
                            </p>
                          )}
                          {incotechCheck === false && (
                            <p className="rounded-md border bg-amber-50 px-2 py-1 text-xs text-amber-800">
                              Divergência: a chave reconhecida não coincide com a chave esperada da
                              DANFE de teste Incotech ({formatAccessKeyGrouped(INCOTECH_TEST_ACCESS_KEY)}).
                              O valor reconhecido foi preservado para conferência manual.
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Chave pendente de conferência</span>
                      )}
                    </DataCell>
                  </dl>
                </section>

                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase">Destinatário</h4>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <DataCell label="Razão social">{parsed.receiverName ?? "—"}</DataCell>
                    <DataCell label="CNPJ" mono>
                      {parsed.receiverCnpj ?? "—"}
                    </DataCell>
                  </dl>
                </section>

                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase">Itens ({parsed.items.length})</h4>
                  {parsed.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhum item identificado automaticamente — informe os itens na conferência.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {parsed.items.map((item, index) => (
                        <li
                          key={index}
                          className="text-sm min-w-0 max-w-full overflow-hidden break-words"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {item.code}
                          </span>{" "}
                          {item.description}
                          <span className="text-muted-foreground">
                            {" — "}
                            {item.quantity} {item.unit} × {formatCurrencyStable(item.unitValue)} ={" "}
                            {formatCurrencyStable(item.totalValue)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <DataCell label="Itens identificados" mono>
                      {String(parsed.items.length)}
                    </DataCell>
                    <DataCell label="Valor total da NF" mono>
                      {parsed.totalValue ? formatCurrencyStable(parsed.totalValue) : "—"}
                    </DataCell>
                  </dl>
                </section>

                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase">Fornecedor</h4>
                  <Select
                    value={selectedSupplierId || "none"}
                    onValueChange={(value) => setSelectedSupplierId(value === "none" ? "" : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o fornecedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Detectar automaticamente</SelectItem>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier._id} value={supplier._id}>
                          {supplier.legalName}
                          {supplier.cnpj ? (
                            <span className="float-right text-xs text-muted-foreground">
                              {formatCnpj(supplier.cnpj)}
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </section>

                <section className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase">Documento original</h4>
                  <p className="flex items-center gap-2 text-sm min-w-0 max-w-full overflow-hidden break-words">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 max-w-full overflow-hidden break-words">
                      {fileName || "—"}
                    </span>
                  </p>
                </section>
              </>
            )}
          </div>
        </div>

        <div className="min-w-0 max-w-full shrink-0 overflow-x-hidden border-t bg-background px-5 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button type="button" onClick={handleImport} disabled={!canImport}>
              Conferir na Entrada
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DanfeImportDialog;
