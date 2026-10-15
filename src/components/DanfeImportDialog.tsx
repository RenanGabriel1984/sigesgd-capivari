/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  formatCnpj,
  formatCurrency,
  formatAccessKeyGrouped,
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
  buildOcrTrace,
} from "@/lib/danfe-ocr";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Resolução alvo da rasterização (PDF 72pt → 300 DPI). */
const TARGET_DPI = 300;
/** Nunca roda OCR em imagem pequena demais — abaixo disso é upscale. */
const MIN_OCR_WIDTH = 1100;
const OCR_LANG = "por";

export type DanfeImportResult = DanfeParseResult & {
  supplierId?: string;
  file?: File;
};

export interface DanfeImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fornecedores ativos — o usuário pode escolher qual a NF pertence. */
  suppliers: Array<{
    _id: string;
    legalName: string;
    cnpj?: string | null;
  }>;
  /**
   * Entrega os dados LIDOS à conferência da Entrada. O diálogo não grava
   * nada: a efetivação acontece somente após confirmação humana.
   */
  onImport: (result: DanfeImportResult) => void;
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
type Phase = "select" | "processing" | "review" | "error";

// Diagnóstico de desenvolvimento (Rodada 15) — valor somente no dev; no build
// final pode ser ajustado para desabilitar o relatório sem mexer no pipeline.
const ENABLE_DEV_DIAGNOSTIC =
  typeof window !== "undefined" &&
  (window.localStorage?.getItem("danfeDevDiagnostic") ?? "1") === "1";

// Rastreio dos vetores reais do pipeline para o relatório de diagnóstico.
let layerTextForDiag = "";
let ocrTextForDiag = "";
let regionTextsForDiag: string[] = [];
let parsedLayerForDiag: DanfeParseResult | null = null;
let parsedOcrForDiag: DanfeParseResult | null = null;

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
  outCtx.putImageData(
    new ImageData(data, width, height),
    0,
    0,
  );
  return out;
}

// ─── Extração da camada textual do PDF ──────────────────────────────────────

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

// ─── Célula de dado da conferência ───────────────────────────────────────────

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
  const display =
    value && mono ? formatAccessKeyGrouped(value) : value;
  return (
    <div className="min-w-0 overflow-hidden">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm text-foreground", wide && "col-span-1 sm:col-span-2", mono && "font-mono text-xs")}>
        {display}
      </dd>
    </div>
  );
}

// ── Diagnóstico de desenvolvimento (Rodada 15) ──────────────────────────

function OcrDiagnosticCard({ trace }: { trace: NonNullable<typeof diagnostic> }) {
  const json = useMemo(
    () =>
      JSON.stringify(
        {
          ...trace,
          rawText: trace.rawText ?? "",
          pageOcrText: trace.pageOcrText ?? "",
          mergedOcr: trace.mergedOcr ?? "",
        },
        null,
        2,
      ),
    [trace],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const area = document.createElement("textarea");
      area.value = json;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
  }, [json]);

  const jsonDps = /^data:/.test(json);

  return (
    <div className="rounded-xl border border-muted bg-muted/40 p-4 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          Diagnóstico de desenvolvimento — relatório do OCR
        </span>
        <div className="flex gap-2">
          <Button
            className="h-7 text-xs"
            variant="outline"
            onClick={copy}
          >
            Copiar JSON
          </Button>
        </div>
      </div>
      <div className="break-words whitespace-pre-wrap">{json}</div>
    </div>
  );
}

// ─── Diálogo ─────────────────────────────────────────────────────────────────

export default function DanfeImportDialog({
  open,
  onClose,
  suppliers,
  onImport,
}: DanfeImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [inputRef, setInputRef] = useState<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>("select");
  const [step, setStep] = useState<string | null>(null);
  const [parsed, setParsed] = useState<DanfeParseResult | null>(null);
  const [fieldSummary, setFieldSummary] = useState(danfeFieldSummary({ ok: true }));
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [keyValid, setKeyValid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPhase("select");
    setStep(null);
    setParsed(null);
    setFieldSummary(danfeFieldSummary({ ok: true }));
    setSelectedSupplierId("");
    setErrorMessage(null);
    setKeyValid(false);
  }, [open]);

  const startFileRef = useRef<File | null>(null);

  const processFile = useCallback(
    async (f: File) => {
      startFileRef.current = f;
      setFile(f);
      setPhase("processing");
      setErrorMessage(null);

      try {
        let layerText = "";
        let ocrText = "";
        let regionTexts: string[] = [];
        let ocrEndPath: "text-layer" | "ocr" | "merged" = "merged";

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
            const {
              data: { text: fullText },
            } = await worker.recognize(sized);
            await worker.terminate();
            ocrText = fullText;

            setStep("Executando OCR por regiões da DANFE…");
            const regional = await ocrDanfeRegions(sized, DANFE_REGIONS);
            regionTexts = regional.map((r) => r.text);

            const mergedOcr = mergeDanfeTexts(ocrText, regionTexts);
            const parsedLayer = parseDanfeText(layerText);
            const parsedOcr = parseDanfeText(mergedOcr);

            // Diagnóstico de desenvolvimento (Rodada 15): rastreia os vetores reais
            // do pipeline. Não interfere na escolha nem no comportamento do parser.
            layerTextForDiag = layerText;
            ocrTextForDiag = ocrText;
            regionTextsForDiag = regionTexts;
            parsedLayerForDiag = parsedLayer;
            parsedOcrForDiag = parsedOcr;

            // Determina qual caminho de fato venceu na escolha semântica do diálogo.
            const chosenPath = isDanfeParseBetter(parsedOcr, parsedLayer)
              ? "ocr"
              : "merged";
            ocrEndPath = chosenPath;

            // Comparação SEMÂNTICA: ganha quem tem MAIS campos estruturados
            // válidos. Nunca usamos só a quantidade de caracteres — um texto maior
            // não é automaticamente melhor.
            let best = isDanfeParseBetter(parsedOcr, parsedLayer)
              ? parsedOcr
              : parsedLayer;

            if (!best.accessKey) {
              // Tentativa ESPECÍFICA da chave: prioriza cabeçalho + região da chave,
              // depois página inteira e regiões alternativas (normalização de
              // glifos/remoção de espaços acontece dentro de extractAccessKey44).
              const keyPriority = [
                ...regionTexts.slice(0, 2),
                mergedOcr,
                ocrText,
                layerText,
              ]
                .join("\n");
              const key = extractAccessKey44(keyPriority);
              if (key) best = { ...best, accessKey: key };
            }

            if (!best.ok) {
              setPhase("error");
              setErrorMessage(
                "Não foi possível ler dados do documento. Se o arquivo for apenas uma foto, tente outro ângulo ou use a entrada manual.",
              );
              return;
            }

            setParsed({ ...best, file: f });
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
          const {
            data: { text: fullText },
          } = await worker.recognize(sized);
          await worker.terminate();
          ocrText = fullText;

          setStep("Executando OCR por regiões da DANFE…");
          const regional = await ocrDanfeRegions(sized, DANFE_REGIONS);
          regionTexts = regional.map((r) => r.text);

          const mergedOcr = mergeDanfeTexts(ocrText, regionTexts);
          const parsedOcr = parseDanfeText(mergedOcr);

          // Diagnóstico de desenvolvimento (Rodada 15): rastreia os vetores reais
          // do pipeline. Não interfere na escolha nem no comportamento do parser.
          layerTextForDiag = "";
          ocrTextForDiag = ocrText;
          regionTextsForDiag = regionTexts;
          parsedLayerForDiag = null;
          parsedOcrForDiag = parsedOcr;

          ocrEndPath = "merged";

          let best = parsedOcr;

          if (!best.accessKey) {
            const keyPriority = [
              ...regionTexts.slice(0, 2),
              mergedOcr,
              ocrText,
            ]
              .join("\n");
            const key = extractAccessKey44(keyPriority);
            if (key) best = { ...best, accessKey: key };
          }

          if (!best.ok) {
            setPhase("error");
            setErrorMessage(
              "Não foi possível ler dados do documento. Se o arquivo for apenas uma foto, tente outro ângulo ou use a entrada manual.",
            );
            return;
          }

          setParsed({ ...best, file: f });
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

  // Diagnóstico de desenvolvimento: rastreia vetores reais do pipeline para o relatório.
  const offDiag = ENABLE_DEV_DIAGNOSTIC
    ? {
        layerText: layerTextForDiag,
        ocrText: ocrTextForDiag,
        regionTexts: regionTextsForDiag,
        parsedLayer: parsedLayerForDiag ?? { ok: false, items: [] },
        parsedOcr: parsedOcrForDiag ?? { ok: false, items: [] },
      }
    : null;

  const diagnosticMemo = ENABLE_DEV_DIAGNOSTIC
    ? (() => {
        if (phase !== "review" || !parsed || !offDiag) return null;
        return buildOcrTrace(
          offDiag.layerText ?? "",
          offDiag.ocrText ?? "",
          offDiag.regionTexts,
        );
      })()
    : null;

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
          {/* ── Seleção de arquivo ── */}
          {phase === "select" && (
            <div className="space-y-3">
              <input
                ref={setInputRef}
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

          {/* ── Processando ── */}
          {phase === "processing" && (
            <div className="flex items-center gap-3 rounded-lg border p-4 text-sm">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>{step || "Processando documento…"}</span>
            </div>
          )}

          {/* ── Falha total (só quando NADA foi lido) ── */}
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

          {/* ── Resumo OCR (hierarquia: concluído → X de 10 → pendências) ── */}
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

              {/* ── Dados lidos (grid responsivo, sem overflow) ── */}
              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Dados lidos da DANFE</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DataCell label="Número da NF-e" value={parsed?.nfeNumber ?? ""} />
                  <DataCell label="Série" value={parsed?.series ?? ""} />
                  <DataCell label="Data de emissão" value={parsed?.emissionDate ?? ""} />
                  <DataCell label="CNPJ do emissor" value={formatCnpj(parsed?.emitterCnpj)} />
                  <DataCell label="Razão social do emissor" value={parsed?.emitterName ?? ""} />
                  <DataCell label="Cidade do emissor" value={parsed?.emitterCity ?? ""} />
                  <DataCell label="UF do emissor" value={parsed?.emitterState ?? ""} />
                  <DataCell label="CEP do emissor" value={parsed?.emitterPostalCode ?? ""} />
                  <DataCell
                    label="Chave de acesso"
                    value={parsed?.accessKey ? formatAccessKeyGrouped(parsed.accessKey) : ""}
                    wide
                    mono
                  />
                </div>
              </section>

              {/* ── Fornecedor ── */}
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
                        textValue={supplier.legalName}
                      >
                        <span className="min-w-0 truncate">{supplier.legalName}</span>
                        <span className="block min-w-0 truncate text-[10px] text-muted-foreground">
                          {`CNPJ: ${formatCnpj(supplier.cnpj)}`}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* ── Destinatário ── */}
              {(parsed?.receiverCnpj || parsed?.receiverName) && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Destinatário</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DataCell
                      label="CNPJ do destinatário"
                      value={formatCnpj(parsed?.receiverCnpj)}
                    />
                    <DataCell
                      label="Razão social do destinatário"
                      value={parsed?.receiverName ?? ""}
                    />
                  </div>
                </section>
              )}

              {/* ── Transportador ── */}
              {parsed?.transporterCnpj && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Transportador</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DataCell
                      label="CNPJ do transportador"
                      value={formatCnpj(parsed?.transporterCnpj)}
                    />
                    <DataCell label="RAZÃO SOCIAL" value={parsed?.transporterName ?? ""} />
                  </div>
                </section>
              )}

              {/* ── Itens ── */}
              {parsed?.items && parsed.items.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Itens identificados</h4>
                  <div className="max-h-60 overflow-auto rounded-md border">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-muted/60">
                          <th className="border-b px-2 py-1 text-left font-medium">Item</th>
                          <th className="border-b px-2 py-1 text-left font-medium">Código</th>
                          <th className="border-b px-2 py-1 text-left font-medium">Descrição</th>
                          <th className="border-b px-2 py-1 text-right font-medium">Qtd</th>
                          <th className="border-b px-2 py-1 text-right font-medium">Un</th>
                          <th className="border-b px-2 py-1 text-right font-medium">Valor unit.</th>
                          <th className="border-b px-2 py-1 text-right font-medium">Valor total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.items.map((item, index) => (
                          <tr key={index} className="border-t">
                            <td className="border-b px-2 py-1">{item.lineNumber ?? index + 1}</td>
                            <td className="border-b px-2 py-1 font-mono">{item.code ?? "—"}</td>
                            <td className="border-b px-2 py-1 truncate max-w-[220px]">
                              {item.description}
                            </td>
                            <td className="border-b px-2 py-1 text-right">
                              {item.quantity ?? "—"}
                            </td>
                            <td className="border-b px-2 py-1 text-right">
                              {item.unit ?? "—"}
                            </td>
                            <td className="border-b px-2 py-1 text-right">
                              {item.unitValue != null
                                ? formatCurrency(item.unitValue)
                                : "—"}
                            </td>
                            <td className="border-b px-2 py-1 text-right font-mono">
                              {item.totalValue != null ? formatCurrency(item.totalValue) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* ── Totais ── */}
              {(parsed?.totalValue != null || parsed?.afNumber || parsed?.empenhoNumber) && (
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Totais e dados adicionais</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DataCell
                      label="Valor total da NF-e"
                      value={parsed?.totalValue != null ? formatCurrency(parsed.totalValue) : ""}
                      mono
                    />
                    <DataCell
                      label="Número da AF"
                      value={parsed?.afNumber ?? ""}
                    />
                    <DataCell
                      label="Número do empenho"
                      value={parsed?.empenhoNumber ?? ""}
                    />
                  </div>
                </section>
              )}
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

// ─── OCR por regiões clássicas da DANFE ──────────────────────────────────────

async function ocrDanfeRegions(
  canvas: HTMLCanvasElement,
  regions: Array<{ key: string; box: { x: number; y: number; w: number; h: number } }>,
): Promise<Array<{ key: string; text: string }>> {
  const results = await Promise.all(
    regions.map(async (region) => {
      const { x, y, w, h } = region.box;
      const regionCanvas = document.createElement("canvas");
      regionCanvas.width = Math.max(1, w);
      regionCanvas.height = Math.max(1, h);
      const ctx = regionCanvas.getContext("2d");
      if (!ctx) return { key: region.key, text: "" };
      ctx.drawImage(
        canvas,
        Math.max(0, x),
        Math.max(0, y),
        Math.min(canvas.width - x, w),
        Math.min(canvas.height - y, h),
        0,
        0,
        w,
        h,
      );
      const sized = ensureOcrWidth(regionCanvas);
      const worker = await createWorker(OCR_LANG);
      const {
        data: { text },
      } = await worker.recognize(sized);
      await worker.terminate();
      return { key: region.key, text };
    }),
  );
  return results;
}
