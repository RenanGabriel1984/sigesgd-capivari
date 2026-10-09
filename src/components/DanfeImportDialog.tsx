/**
 * Importador de DANFE / PDF / Imagem (OCR) — RODADA 10.
 *
 * ─── O QUE ESTE DIÁLOGO FAZ ─────────────────────────────────────────────────
 * Apenas LÊ o documento e entrega os dados à tela de conferência da Entrada.
 * Ele NÃO tem nenhuma mutation: nada é criado sem a sua confirmação.
 *
 * ─── PIPELINE ───────────────────────────────────────────────────────────────
 *  1. tenta a camada de texto do PDF (hasUsableTextLayer);
 *  2. rasteriza a 1.ª página a ~300 DPI e pré-processa (cinza + contraste);
 *  3. executa OCR da página inteira + OCR por regiões clássicas da DANFE
 *     (ocrDanfeRegions) e combina com mergeDanfeTexts;
 *  4. busca a chave de acesso com tentativa ESPECÍFICA (cabeçalho, região da
 *     chave, glifos normalizados, validação estrutural + dígito verificador);
 *  5. compara camada de texto × OCR de forma SEMÂNTICA (campos válidos),
 *     nunca apenas por quantidade de caracteres;
 *  6. apresenta "OCR concluído · X de 10 campos identificados" e qualquer
 *     campo ausente como PENDÊNCIA de conferência — nunca como falha total.
 *
 * ─── LAYOUT (RODADA 10) ─────────────────────────────────────────────────────
 * Modal largo (max-w-6xl, calc(100vw - 2rem)), sem overflow horizontal, grid
 * de dados em grid-cols-1 sm:grid-cols-2 com células min-w-0/max-w-full/
 * overflow-hidden; a chave de acesso ocupa col-span-1 sm:col-span-2.
 */
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
import { formatCnpj, formatCurrency, formatAccessKeyGrouped } from "@/lib/br-validators";
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

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Resolução alvo da rasterização (PDF 72pt → 300 DPI). */
const TARGET_DPI = 300;
/** Nunca roda OCR em imagem pequena demais — abaixo disso é upscale. */
const MIN_OCR_WIDTH = 1100;
const OCR_LANG = "por";

export type DanfeImportResult = DanfeParseResult & { supplierId?: string };

export interface DanfeImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fornecedores ativos — o usuário pode escolher qual a NF pertence. */
  suppliers: Array<{ _id: string; legalName: string; cnpj?: string | null }>;
  /**
   * Entrega os dados LIDOS à conferência da Entrada. O diálogo não grava
   * nada: a efetivação acontece somente após confirmação humana.
   */
  onImport: (result: DanfeImportResult, file: File) => void;
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
type Phase = "select" | "processing" | "review" | "error";

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

/** Garante largura mínima para o OCR (MIN_OCR_WIDTH). */
function ensureOcrWidth(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (canvas.width >= MIN_OCR_WIDTH) return canvas;
  return scaleCanvas(canvas, MIN_OCR_WIDTH / Math.max(1, canvas.width));
}

async function loadImageCanvas(f: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(f);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") bitmap.close();
  return ensureOcrWidth(canvas);
}

function rotateCanvas(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
  }
  return canvas;
}

/**
 * Pré-processamento para OCR: escala de cinza ponderada + normalização de
 * contraste (stretch min→max). Melhora bastante DANFE escaneada com ruído.
 */
function preprocessForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  // escala de cinza (luma ITU-R 601)
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  // contraste: encontra min/max e estica a faixa para 0..255
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = Math.min(255, Math.max(0, Math.round(((data[i] - min) * 255) / range)));
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * OCR das regiões clássicas da DANFE (cabeçalho, chave, emitente,
 * destinatário, produtos, totais, dados adicionais) EM ADDIÇÃO à página
 * inteira — a chave de acesso ganha tratamento específico com isso.
 */
async function ocrDanfeRegions(
  canvas: HTMLCanvasElement,
  worker: OcrWorker,
): Promise<string[]> {
  const texts: string[] = [];
  for (const region of DANFE_REGIONS) {
    const sx = Math.floor(region.x * canvas.width);
    const sy = Math.floor(region.y * canvas.height);
    const sw = Math.max(1, Math.floor(region.w * canvas.width));
    const sh = Math.max(1, Math.floor(region.h * canvas.height));
    const crop = document.createElement("canvas");
    crop.width = sw;
    crop.height = sh;
    const ctx = crop.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const processed = preprocessForOcr(crop);
    try {
      const { data } = await worker.recognize(processed);
      if (data.text && data.text.trim()) texts.push(data.text);
    } catch {
      // região ilegível não derruba o fluxo — a página inteira já foi lida
    }
  }
  return texts;
}

async function rasterizePdfFirstPage(data: ArrayBuffer): Promise<HTMLCanvasElement> {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  // 300 DPI: escala = DPI / 72 (unidade padrão do PDF em pontos)
  const viewport = page.getViewport({ scale: TARGET_DPI / 72 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para rasterizar o PDF.");
  await page.render({ canvasContext: ctx, viewport }).promise;
  await pdf.destroy();
  return ensureOcrWidth(canvas);
}

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
  wide,
  mono,
}: {
  label: string;
  value: string;
  wide?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className={cn("min-w-0 max-w-full overflow-hidden", wide && "col-span-1 sm:col-span-2")}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      <p
        className={cn(
          "text-sm min-w-0 max-w-full overflow-hidden break-words",
          mono && "break-all font-mono text-xs",
        )}
      >
        {value || "—"}
      </p>
    </div>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function DanfeImportDialog({
  open,
  onClose,
  suppliers,
  onImport,
}: DanfeImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("select");
  const [step, setStep] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [parsed, setParsed] = useState<DanfeParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const fieldSummary = useMemo(
    () => danfeFieldSummary(parsed ?? { ok: false, items: [] }),
    [parsed],
  );
  const summary = fieldSummary;
  const keyValid = Boolean(parsed?.accessKey) && validateAccessKey44(parsed?.accessKey ?? "");

  // Reinicia a cada abertura para não reaproveitar leituras antigas.
  useEffect(() => {
    if (!open) {
      setPhase("select");
      setStep("");
      setErrorMessage("");
      setParsed(null);
      setFile(null);
      setFileName("");
      setSelectedSupplierId("");
    }
  }, [open]);

  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setFileName(f.name);
    setPhase("processing");
    setStep("Lendo documento…");
    setErrorMessage("");
    try {
      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

      let layerText = "";
      let canvas: HTMLCanvasElement;

      if (isPdf) {
        const buffer = await f.arrayBuffer();
        setStep("Lendo a camada de texto do PDF…");
        const text = await readPdfTextLayer(buffer.slice(0));
        layerText = text;
        if (hasUsableTextLayer(text)) {
          setStep("Camada de texto encontrada — rasterizando mesmo assim para comparação…");
        }
        setStep("Renderizando a 1.ª página a 300 DPI…");
        canvas = await rasterizePdfFirstPage(buffer);
      } else {
        setStep("Carregando imagem…");
        canvas = await loadImageCanvas(f);
      }

      setStep("Pré-processando (contraste)…");
      const processed = preprocessForOcr(ensureOcrWidth(canvas));

      setStep("OCR da página inteira…");
      const worker = await createWorker(OCR_LANG);
      let ocrText = "";
      let regionTexts: string[] = [];
      try {
        const first = await worker.recognize(processed);
        ocrText = first.data.text ?? "";
        if (!ocrText || ocrText.trim().length < 20) {
          setStep("corrigindo rotação da página e tentando novamente…");
          const rotated = rotateCanvas(processed, 180);
          const retry = await worker.recognize(rotated);
          ocrText = retry.data.text ?? ocrText;
        }
        setStep("OCR por regiões da DANFE (cabeçalho, chave, emitente…)…");
        regionTexts = await ocrDanfeRegions(processed, worker);
      } finally {
        await worker.terminate().catch(() => undefined);
      }

      const mergedOcr = mergeDanfeTexts(ocrText, regionTexts);
      const parsedLayer = parseDanfeText(layerText);
      const parsedOcr = parseDanfeText(mergedOcr);

      // Comparação SEMÂNTICA: ganha quem tem MAIS campos estruturados
      // válidos. Nunca usamos só a quantidade de caracteres — um texto maior
      // não é automaticamente melhor.
      let best = isDanfeParseBetter(parsedOcr, parsedLayer) ? parsedOcr : parsedLayer;

      if (!best.accessKey) {
        // Tentativa ESPECÍFICA da chave: prioriza cabeçalho + região da chave,
        // depois página inteira e regiões alternativas (normalização de
        // glifos/remoção de espaços acontece dentro de extractAccessKey44).
        const keyPriority = [
          ...regionTexts.slice(0, 2),
          mergedOcr,
          ocrText,
          layerText,
        ].join("\n");
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

      setParsed(best);
      setPhase("review");
    } catch (err) {
      setPhase("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Falha inesperada ao processar o documento.",
      );
    }
  }, []);

  const handleImport = () => {
    if (!parsed || !file) return;
    onImport({ ...parsed, supplierId: selectedSupplierId || undefined }, file);
  };

  const showNoData = phase === "review" && summary.found === 0;
  const showReview = phase === "review" && summary.found > 0;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent
        className="max-w-6xl gap-0 overflow-x-hidden p-0"
        style={{ width: "calc(100vw - 2rem)", maxWidth: "calc(100vw - 2rem)" }}
      >
        <DialogHeader className="min-w-0 max-w-full px-6 pt-6 pb-2">
          <DialogTitle>Importar DANFE / PDF / Imagem</DialogTitle>
          <DialogDescription>
            O documento é lido localmente no navegador. Os dados entram na conferência da
            Entrada — nada é criado sem a sua confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 max-w-full overflow-x-hidden px-6 pb-2 max-h-[calc(100vh-11rem)] overflow-y-auto space-y-4">
          {/* ── Seleção de arquivo ── */}
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
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Chave de acesso não identificada automaticamente. Confira a DANFE e informe a
                  chave na etapa de conferência.
                </div>
              )}

              {fieldSummary.missing.length > 0 && (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
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
                    label="Valor total da NF"
                    value={parsed?.totalValue != null ? formatCurrency(parsed.totalValue) : ""}
                  />
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
                <Select value={selectedSupplierId || "none"} onValueChange={(value) => setSelectedSupplierId(value === "none" ? "" : value)}>
                  <SelectTrigger className="h-9 w-full min-w-0">
                    <SelectValue placeholder="Selecionar fornecedor (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Detectar automaticamente na conferência</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier._id} value={supplier._id} textValue={supplier.legalName}>
                        <span className="min-w-0 truncate">{supplier.legalName}</span>
                        <span className="block min-w-0 truncate text-[10px] text-muted-foreground">
                          {`CNPJ: ${formatCnpj(supplier.cnpj)}`}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* ── Itens ── */}
              <section className="space-y-2">
                <h4 className="text-sm font-semibold">
                  Itens ({parsed?.items.length ?? 0})
                </h4>
                {(parsed?.items.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Produto não identificado automaticamente. Faça a associação manual na
                    conferência.
                  </div>
                ) : (
                  <div className="min-w-0 max-w-full overflow-x-hidden space-y-2">
                    {parsed?.items.map((item, index) => (
                      <div
                        key={`${item.lineNumber ?? index}`}
                        className="min-w-0 max-w-full overflow-hidden rounded-lg border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">Item {item.lineNumber ?? index + 1}</span>
                          {item.code && <span className="font-mono">cód. {item.code}</span>}
                          {item.unit && <span>{item.unit}</span>}
                        </div>
                        <p className="text-sm font-medium break-words min-w-0 max-w-full overflow-hidden">
                          {item.description}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {item.quantity ?? "—"} × {item.unitValue != null ? formatCurrency(item.unitValue) : "—"}
                          {item.totalValue != null && <> · total {formatCurrency(item.totalValue)}</>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Total + documento original ── */}
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DataCell
                  label="Valor total da NF"
                  value={parsed?.totalValue != null ? formatCurrency(parsed.totalValue) : ""}
                />
                <DataCell label="Documento original" value={fileName} />
              </section>
            </>
          )}
        </div>

        <DialogFooter className="min-w-0 max-w-full overflow-x-hidden px-6 pb-6 pt-2">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 max-w-full text-xs text-muted-foreground">
              Etapa de leitura: nada é criado sem a sua confirmação — a efetivação acontece na
              conferência da Entrada.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                }}
              >
                Importar NF-e XML
              </Button>
              {phase === "select" && (
                <Button onClick={() => inputRef.current?.click()}>Escolher arquivo</Button>
              )}
              {showReview && (
                <Button onClick={handleImport}>Conferir na Entrada</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reexporta o tipo do resultado para a página da Entrada. */
export type { DanfeParseResult, DanfeImportResult as DanfeImportPayload };
