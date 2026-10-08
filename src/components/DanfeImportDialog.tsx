import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SupplierForm } from "@/components/SupplierForm";
import type { SupplierPreFill } from "@/lib/supplier-form";
import { MapPin, Phone, Mail, Copy } from "lucide-react";
import { parseDanfeText, DANFE_REGIONS, danfeFieldSummary, hasUsableTextLayer, mergeDanfeTexts, type DanfeRegion, type DanfeParsed } from "@/lib/danfe-ocr";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileText, Loader2, Upload, Eye, Key, DollarSign, Calendar, Building, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  formatAccessKeyGrouped,
  formatCnpj,
  formatPhone,
  formatCep,
  formatCurrency,
  isValidAccessKey,
  digitsOnly,
} from "@/lib/br-validators";

/** Resolução alvo da rasterização de PDF escaneado (≈300 DPI). */
const TARGET_DPI = 300;
/** Abaixo desta largura o OCR degrada — a imagem é reamostrada para cima. */
const MIN_OCR_WIDTH = 1100;

export type DanfeImportField = {
  field: string;
  label: string;
  value: string;
  icon?: React.ElementType;
};

export type DanfeParsedItem = {
  code?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitValue?: number;
  totalValue?: number;
};

export interface DanfeParsedData {
  nfeNumber?: string;
  series?: string;
  emissionDate?: string;
  accessKey?: string;
  emitterCnpj?: string;
  emitterName?: string;
  emitterPhone?: string;
  emitterEmail?: string;
  emitterAddress?: string;
  emitterCity?: string;
  emitterState?: string;
  emitterPostalCode?: string;
  receiverCnpj?: string;
  receiverName?: string;
  totalValue?: number;
  /**
   * Identificadores de compras públicas detectados pelo OCR — campos
   * DISTINTOS (AF, Processo Administrativo, Empenho), todos opcionais.
   * Servem apenas de sugestão: o usuário confere/edita na tela de revisão.
   */
  afNumber?: string;
  processNumber?: string;
  empenhoNumber?: string;
  items: DanfeParsedItem[];
  /** Arquivo original (DANFE PDF/imagem) — preservado junto à entrada. */
  rawFile?: File | null;
  /** Fornecedor escolhido/identificado na tela de conferência da DANFE. */
  supplierId?: string;
}

interface DanfeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entrega os dados lidos para a tela de conferência da Entrada. NUNCA cria estoque. */
  onImport: (data: DanfeParsedData) => void;
  onClose: () => void;
}

// ─── Leitura do documento (PDF → texto; PDF digitalizado/imagem → OCR) ──────
//
// OCR local no navegador (tesseract.js) + extração de texto com pdfjs-dist.
// Sem API paga, sem credenciais e sem chaves no frontend: os modelos de OCR
// são baixados de CDN pública na primeira utilização e cacheados. Se a leitura
// falhar, o usuário recebe a mensagem e pode seguir com a entrada manual.

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/** Extrai a camada de texto do PDF (DANFEs digitais têm texto selecionável). */
async function extractPdfText(file: File, onProgress?: (p: number) => void): Promise<string> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages = Math.min(doc.numPages, 5);
    let text = "";
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text +=
        content.items
          .map((it: any) => (typeof it.str === "string" ? it.str + (it.hasEOL ? "\n" : " ") : ""))
          .join("") + "\n";
      onProgress?.(Math.round((i / pages) * 60));
    }
    return text;
  } finally {
    await doc.destroy();
  }
}

/**
 * Renderiza páginas do PDF em canvas a ~300 DPI (resolução adequada para OCR).
 * Um PDF escaneado rasterizado pequeno degrada o Tesseract — por isso a escala
 * é calculada a partir do DPI alvo, e não de um multiplicador fixo.
 */
async function renderPdfPages(file: File, maxPages = 2): Promise<HTMLCanvasElement[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages = Math.min(doc.numPages, maxPages);
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: TARGET_DPI / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponível para ler o PDF.");
      // Fundo branco: páginas com transparência ficariam pretas no OCR.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    await doc.destroy();
  }
}

/** Carrega imagem (JPG/PNG) em canvas, garantindo resolução mínima para OCR. */
async function loadImageCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, MIN_OCR_WIDTH / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível para ler a imagem.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

/**
 * Pré-processamento para OCR: escala de cinza + estiramento de contraste.
 * NÃO binariza nem satura a imagem: o Tesseract já aplica Otsu internamente e
 * uma limiarização agressiva degrada textos com impressão fraca (o cenário
 * exato do DANFE escaneado que falhou). Ruído e nitidez são tratados pelo
 * próprio motor; aqui só corrigimos o que melhora o resultado.
 */
function preprocessForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = source;
  if (!width || !height) return source;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  // 1) Escala de cinza
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  // 2) Estiramento de contraste (fundo de papel vira branco, texto ganha corpo)
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = Math.min(255, Math.max(0, Math.round(((data[i] - min) * 255) / range)));
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }

  ctx.putImageData(image, 0, 0);
  return out;
}

/** Rotaciona um canvas (90°/180°/270°) — usado só quando a 1ª tentativa sai vazia. */
function rotateCanvas(source: HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const swap = degrees === 90 || degrees === 270;
  out.width = swap ? source.height : source.width;
  out.height = swap ? source.width : source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

/** Recorta uma região da página (coordenadas relativas 0–1) para OCR por área. */
function cropRegion(source: HTMLCanvasElement, region: DanfeRegion): HTMLCanvasElement | null {
  const sx = Math.max(0, Math.round(region.x * source.width));
  const sy = Math.max(0, Math.round(region.y * source.height));
  const sw = Math.min(source.width - sx, Math.round(region.w * source.width));
  const sh = Math.min(source.height - sy, Math.round(region.h * source.height));
  if (sw < 80 || sh < 40) return null;
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Não foi possível preparar a imagem para o OCR."));
        return;
      }
      resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });
}

/**
 * OCR local (tesseract.js) — eng+por, sem chave de API. Um único worker é
 * reutilizado para a página inteira e para todas as regiões da DANFE.
 */
async function createOcrWorker(onProgress?: (p: number) => void): Promise<any> {
  const { createWorker } = await import("tesseract.js");
  return createWorker("eng+por", undefined, {
    logger: (m: any) => {
      if (m?.status === "recognizing text") {
        onProgress?.(Math.round((m.progress ?? 0) * 100));
      }
    },
  });
}

async function ocrImageWithWorker(
  worker: any,
  file: File,
  options?: { region?: boolean },
): Promise<string> {
  // PSM 6 (bloco único) para os recortes; PSM 3 (automático) para a página.
  await worker.setParameters({
    tessedit_pageseg_mode: options?.region ? "6" : "3",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(file);
  return result?.data?.text ?? "";
}

/**
 * Pipeline de um canvas → texto: pré-processa, OCR a página inteira e, quando o
 * reconhecimento veio pobre, tenta outras rotações antes de desistir.
 */
async function ocrCanvas(
  worker: any,
  canvas: HTMLCanvasElement,
  onStatus?: (s: string) => void,
): Promise<string> {
  const processed = preprocessForOcr(canvas);
  let text = await ocrImageWithWorker(worker, await canvasToFile(processed, "danfe.png"));
  if (text.replace(/\s/g, "").length < 40) {
    for (const degrees of [90, 180, 270] as const) {
      onStatus?.(`Primeira leitura vazia — corrigindo rotação (${degrees}°)...`);
      const rotated = rotateCanvas(processed, degrees);
      const retry = await ocrImageWithWorker(worker, await canvasToFile(rotated, `danfe-${degrees}.png`));
      if (retry.replace(/\s/g, "").length > text.replace(/\s/g, "").length) text = retry;
      if (text.replace(/\s/g, "").length >= 40) break;
    }
  }
  return text;
}

/**
 * OCR por REGIÕES da DANFE (cabeçalho, emitente, chave, destinatário,
 * produtos, totais, dados adicionais). Roda em ADDIÇÃO à página inteira: o
 * Tesseract lê muito melhor um bloco pequeno do que a página toda.
 */
async function ocrDanfeRegions(
  worker: any,
  canvas: HTMLCanvasElement,
  onStatus?: (s: string) => void,
): Promise<string[]> {
  const texts: string[] = [];
  for (const region of DANFE_REGIONS) {
    const crop = cropRegion(canvas, region);
    if (!crop) continue;
    onStatus?.(`Lendo região: ${region.label}...`);
    try {
      const text = await ocrImageWithWorker(
        worker,
        await canvasToFile(crop, `danfe-${region.key}.png`),
        { region: true },
      );
      if (text.trim()) texts.push(text);
    } catch {
      // Região opcional: falha aqui não invalida o resto da leitura.
    }
  }
  return texts;
}

export function DanfeImportDialog({ open, onOpenChange, onImport, onClose }: DanfeImportDialogProps) {
  const [step, setStep] = useState<"upload" | "ocr" | "review">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [parsed, setParsed] = useState<DanfeParsedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fornecedores reativos (o cadastro inline aparece aqui sem recarregar a tela)
  const suppliers = useQuery(api.suppliers.listActive) ?? [];

  // Reinicia o fluxo ao fechar (reabrir sempre começa do upload)
  useEffect(() => {
    if (open) return;
    setStep("upload");
    setFile(null);
    setParsed(null);
    setError(null);
    setOcrProgress(0);
    setOcrStatus(null);
    setSelectedSupplierId("");
    setCreateSupplierOpen(false);
  }, [open]);

  // §12 — matching de fornecedor por CNPJ: normaliza e seleciona o existente.
  // Só automático enquanto o usuário não escolheu outro fornecedor.
  useEffect(() => {
    if (!parsed || selectedSupplierId) return;
    const cnpj = digitsOnly(parsed.emitterCnpj ?? "");
    if (cnpj.length !== 14) return;
    const hit = suppliers.find((s: any) => s.cnpj && digitsOnly(s.cnpj) === cnpj);
    if (hit) setSelectedSupplierId(hit._id);
  }, [parsed, suppliers, selectedSupplierId]);

  const handleFile = async (f: File) => {
    if (/\.xml$/i.test(f.name) || (f.type.includes("xml") && !f.type.includes("html"))) {
      setError('Este fluxo é para DANFE em PDF ou imagem. Para XML, use "Importar NF-e XML".');
      return;
    }
    setFile(f);
    setError(null);
    setStep("ocr");
    setOcrProgress(0);
    setOcrStatus("Preparando a leitura do documento...");
    let worker: any = null;
    try {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      let text = "";
      const canvases: HTMLCanvasElement[] = [];

      if (isPdf) {
        setOcrStatus("Lendo o texto do PDF...");
        text = await extractPdfText(f, setOcrProgress);
        // PDF sem camada de texto (digitalizado) → rasteriza a ~300 DPI e faz OCR.
        if (!hasUsableTextLayer(text)) {
          setOcrStatus("PDF digitalizado — rasterizando as páginas em ~300 DPI...");
          canvases.push(...(await renderPdfPages(f)));
          worker = await createOcrWorker(setOcrProgress);
          const pageTexts: string[] = [];
          for (const canvas of canvases) {
            pageTexts.push(await ocrCanvas(worker, canvas, setOcrStatus));
          }
          text = pageTexts.join("\n");
        }
      } else {
        setOcrStatus("Preparando a imagem para o OCR (mínimo de resolução)...");
        canvases.push(await loadImageCanvas(f));
        worker = await createOcrWorker(setOcrProgress);
        text = await ocrCanvas(worker, canvases[0], setOcrStatus);
      }

      let result = parseDanfeText(text);
      let summary = result.ok
        ? danfeFieldSummary(result)
        : { found: 0, total: 10, missing: [] as string[] };

      // OCR por REGIÕES (§8): quando a página inteira não bastou, os blocos da
      // DANFE são lidos individualmente — o Tesseract acerta muito mais em
      // blocos pequenos (chave de acesso, emitente, itens, dados adicionais).
      const canvas = canvases[0];
      if (canvas && (!result.ok || summary.found < summary.total)) {
        if (!worker) worker = await createOcrWorker(setOcrProgress);
        const regionTexts = await ocrDanfeRegions(worker, canvas, setOcrStatus);
        if (regionTexts.length > 0) {
          const merged = mergeDanfeTexts(text, regionTexts);
          const retry = parseDanfeText(merged);
          if (retry.ok) {
            const retrySummary = danfeFieldSummary(retry);
            // Só adota se não piorar o conjunto de campos identificados.
            if (!result.ok || retrySummary.found >= summary.found) {
              result = retry;
              summary = retrySummary;
              text = merged;
            }
          }
        }
      }

      setOcrProgress(100);
      setOcrStatus("Analisando os dados da NF-e...");
      // §10 — falha total APENAS quando nada relevante foi identificado.
      // OCR parcial (ex.: 7 de 10 campos) segue para conferência: o usuário
      // corrige e confirma. O OCR é um assistente, nunca o fim do processo.
      if (!result.ok || summary.found === 0) {
        setError(
          "Não foi possível identificar nenhum dado da NF-e nesta DANFE. Verifique se o documento é legível, importe o XML da NF-e ou use a entrada manual — nada foi perdido.",
        );
        setStep("upload");
        return;
      }
      const { ok: _ok, ...data } = result;
      setParsed({ ...data, rawFile: f });
      setStep("review");
    } catch (err: any) {
      setError(
        err?.message ??
          "Não foi possível ler o arquivo. Verifique se ele é um PDF ou imagem válido e tente novamente.",
      );
      setStep("upload");
    } finally {
      try {
        await worker?.terminate?.();
      } catch {
        // worker já finalizado — nada a fazer
      }
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (!f) return;
      void handleFile(f);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    void handleFile(f);
    e.target.value = "";
  };

  const retriggerFileInput = () => fileInputRef.current?.click();

  // Pré-preenchimento do cadastro inline com os dados da DANFE (§12).
  // Memoizado: identidade estável enquanto o modal está aberto, para não
  // sobrescrever o que o usuário digitar a cada re-render.
  const danfePreFill = useMemo<SupplierPreFill | null>(() => {
    if (!createSupplierOpen || !parsed) return null;
    return {
      legalName: parsed.emitterName,
      cnpj: parsed.emitterCnpj,
      phone: parsed.emitterPhone,
      email: parsed.emitterEmail,
      postalCode: parsed.emitterPostalCode,
      city: parsed.emitterCity,
      state: parsed.emitterState,
      fullAddress: parsed.emitterAddress,
    };
  }, [createSupplierOpen, parsed]);

  // §10 — conferência parcial: quantos campos centrais o OCR identificou.
  // OCR parcial NÃO é falha: o usuário corrige o que faltou e confirma.
  const fieldSummary = useMemo(
    () => (parsed ? danfeFieldSummary({ ok: true, ...parsed } as DanfeParsed) : null),
    [parsed],
  );

  const confirmImport = () => {
    if (!parsed) return;
    // Apenas entrega os dados à tela de conferência — nada de estoque aqui.
    onImport({ ...parsed, supplierId: selectedSupplierId || undefined });
    onClose();
  };

  const fields: DanfeImportField[] = parsed
    ? [
        { field: "nfeNumber", label: "Número da NF-e", value: parsed.nfeNumber ?? "—", icon: FileText },
        { field: "series", label: "Série", value: parsed.series ?? "—", icon: FileText },
        { field: "emissionDate", label: "Data de emissão", value: parsed.emissionDate ?? "—", icon: Calendar },
        { field: "accessKey", label: "Chave de acesso", value: parsed.accessKey ? formatAccessKeyGrouped(parsed.accessKey) : "—", icon: Key },
        { field: "emitterCnpj", label: "CNPJ do emitente", value: parsed.emitterCnpj ? formatCnpj(parsed.emitterCnpj) : "—", icon: Building },
        { field: "emitterName", label: "Razão social do emitente", value: parsed.emitterName ?? "—", icon: Building },
        { field: "emitterPhone", label: "Telefone do emitente", value: parsed.emitterPhone ? formatPhone(parsed.emitterPhone) : "—", icon: Phone },
        { field: "emitterEmail", label: "E-mail do emitente", value: parsed.emitterEmail ?? "—", icon: Mail },
        { field: "emitterAddress", label: "Endereço do emitente", value: parsed.emitterAddress ?? "—", icon: MapPin },
        { field: "emitterCity", label: "Cidade do emitente", value: parsed.emitterCity ?? "—", icon: MapPin },
        { field: "emitterState", label: "UF do emitente", value: parsed.emitterState ?? "—", icon: MapPin },
        { field: "emitterPostalCode", label: "CEP do emitente", value: parsed.emitterPostalCode ? formatCep(parsed.emitterPostalCode) : "—", icon: MapPin },
        { field: "receiverCnpj", label: "CNPJ do destinatário", value: parsed.receiverCnpj ? formatCnpj(parsed.receiverCnpj) : "—", icon: Building },
        { field: "receiverName", label: "Razão social do destinatário", value: parsed.receiverName ?? "—", icon: Building },        {field: "totalValue", label: "Valor total", value: parsed.totalValue != null ? formatCurrency(parsed.totalValue) : "—", icon: DollarSign },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar DANFE / PDF / Imagem</DialogTitle>
          <DialogDescription>
            Envie o DANFE em PDF, uma imagem (JPG/PNG) ou foto da nota. O sistema lê os dados e abre a
            conferência — a entrada só é criada após a sua confirmação.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="mt-0.5 shrink-0 h-4 w-4" />
            {error}
          </div>
        )}

        {step === "upload" && (
          <div className="flex flex-col items-center justify-center py-8">
            <div
              className="relative w-full max-w-sm rounded-lg border-2 border-dashed border-border/50 p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={retriggerFileInput}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handleFileInput}
                className="hidden"
              />
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Arraste o DANFE (PDF ou imagem) aqui</p>
              <p className="text-xs text-muted-foreground mt-1">ou clique para selecionar</p>
              <div className="flex justify-center gap-2 mt-2">
                <Badge variant="outline" className="text-xs">PDF</Badge>
                <Badge variant="outline" className="text-xs">JPG</Badge>
                <Badge variant="outline" className="text-xs">PNG</Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center max-w-sm">
              O XML continua sendo o caminho preferencial quando estiver disponível — use
              &quot;Importar NF-e XML&quot;.
            </p>
          </div>
        )}

        {step === "ocr" && (
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">{ocrStatus ?? "Processando..."}</span>
            </div>
            <Progress value={ocrProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Leitura local no navegador — nenhum dado é enviado a serviços externos.
            </p>
          </div>
        )}

        {step === "review" && parsed && (
          <div className="px-2 py-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">OCR</Badge>
              <Badge variant="outline" className="text-xs">{parsed.items.length} itens</Badge>
              <Badge variant="outline" className="text-xs">
                {parsed.accessKey
                  ? "Chave de acesso identificada"
                  : "Chave de acesso não identificada"}
              </Badge>
            </div>

            {/* §10 — conferência parcial: "Dados identificados: X de 10 campos".
                O que faltou é apenas um campo a preender na conferência, nunca
                um motivo para descartar a DANFE inteira. */}
            {fieldSummary && (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  fieldSummary.missing.length === 0
                    ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
                    : "border-amber-200 bg-amber-50/60 text-amber-800"
                }`}
              >
                <p className="font-medium">
                  Dados identificados: {fieldSummary.found} de {fieldSummary.total} campos
                </p>
                {fieldSummary.missing.length > 0 && (
                  <p className="mt-1">
                    Não reconhecido(s): {fieldSummary.missing.join(", ")}. Você pode informar ou corrigir
                    esses dados na conferência — nada é criado sem a sua confirmação.
                  </p>
                )}
              </div>
            )}

            {!parsed.accessKey && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="mt-0.5 shrink-0 h-3.5 w-3.5" />
                <span>
                  Não foi possível identificar automaticamente a chave de acesso. Confira a DANFE ou
                  informe manualmente.
                </span>
              </div>
            )}

            {/* Resumo dos campos lidos */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Dados lidos da DANFE</CardTitle>
                <CardDescription>Confira antes de continuar — você pode corrigir na próxima etapa</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {fields.map((f) => (
                    <div key={f.field}>
                      <Label className="text-xs">{f.label}</Label>
                      <p className="text-sm font-mono break-words">{f.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Emitente + fornecedor */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Fornecedor</CardTitle>
                <CardDescription>Identificado pelo CNPJ do emitente</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">CNPJ</Label>
                    <p className="text-sm font-mono">{parsed.emitterCnpj ? formatCnpj(parsed.emitterCnpj) : "—"}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Razão Social</Label>
                    <p className="text-sm font-medium">{parsed.emitterName ?? "—"}</p>
                  </div>
                  {parsed.emitterCity && (
                    <div>
                      <Label className="text-xs">Cidade</Label>
                      <p className="text-sm">
                        {parsed.emitterCity}
                        {parsed.emitterState ? ` — ${parsed.emitterState}` : ""}
                      </p>
                    </div>
                  )}
                  {parsed.emitterPostalCode && (
                    <div>
                      <Label className="text-xs">CEP</Label>
                      <p className="text-sm font-mono">{formatCep(parsed.emitterPostalCode)}</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  {!selectedSupplierId && (
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => setCreateSupplierOpen(true)}>
                      <Building className="h-3.5 w-3.5" /> + Cadastrar fornecedor
                    </Button>
                  )}
                  <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue
                        placeholder={
                          selectedSupplierId ? "Fornecedor selecionado" : "Fornecedor não cadastrado"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s._id} value={s._id}>
                          {s.cnpj ? `${s.legalName} — ${formatCnpj(s.cnpj)}` : s.legalName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedSupplierId && <span className="text-xs text-emerald-700">✓ Vinculado à NF</span>}
                </div>
              </CardContent>
            </Card>

            {/* Destinatário */}
            {(parsed.receiverName || parsed.receiverCnpj) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Destinatário</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <Label className="text-xs">CNPJ</Label>
                      <p className="text-sm font-mono">{parsed.receiverCnpj ? formatCnpj(parsed.receiverCnpj) : "—"}</p>
                    </div>
                    <div>
                      <Label className="text-xs">Razão Social</Label>
                      <p className="text-sm font-medium">{parsed.receiverName ?? "—"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Itens */}
            {parsed.items.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Itens da NF-e</CardTitle>
                  <CardDescription>Produtos identificados na DANFE — a associação acontece na conferência</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[30%]">Produto</TableHead>
                          <TableHead className="text-right">Quantidade</TableHead>
                          <TableHead className="text-right">Valor Unit.</TableHead>
                          <TableHead className="text-right">Valor Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsed.items.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-sm">
                              <div className="font-medium">{item.description}</div>
                              {item.code && <div className="text-xs text-muted-foreground font-mono">Cód. {item.code}</div>}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.quantity}
                              {item.unit ? ` ${item.unit}` : ""}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.unitValue != null ? formatCurrency(item.unitValue) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.totalValue != null ? formatCurrency(item.totalValue) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total geral:</span>
                    <span className="font-medium font-mono">
                      {parsed.totalValue != null ? formatCurrency(parsed.totalValue) : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Chave de acesso — normalizada com 44 dígitos, exibição agrupada */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Chave de acesso</CardTitle>
                <CardDescription>44 dígitos — usada para prevenir duplicidade da NF-e</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    value={
                      parsed.accessKey
                        ? parsed.accessKey.length === 44
                          ? formatAccessKeyGrouped(parsed.accessKey)
                          : parsed.accessKey
                        : ""
                    }
                    onChange={(e) => {
                      const digits = digitsOnly(e.target.value).slice(0, 44);
                      setParsed((p) => (p ? { ...p, accessKey: digits } : p));
                    }}
                    inputMode="numeric"
                    placeholder="Informe manualmente se o OCR não identificou"
                    className="flex-1 font-mono text-xs tracking-wider"
                  />
                  {parsed.accessKey && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        navigator.clipboard.writeText(parsed.accessKey ?? "");
                        toast.success("Chave copiada para a área de transferência.");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copiar
                    </Button>
                  )}
                </div>
                <p className={`text-[10px] mt-1 ${isValidAccessKey(parsed.accessKey ?? "") ? "text-muted-foreground" : "text-amber-700"}`}>
                  {isValidAccessKey(parsed.accessKey ?? "")
                    ? "44 dígitos conferidos — estrutura válida, valor normalizado no banco"
                    : `${digitsOnly(parsed.accessKey ?? "").length} de 44 dígitos — confira a chave com o documento`}
                </p>
              </CardContent>
            </Card>

            {/* Arquivo original — preservado junto à entrada */}
            {parsed.rawFile && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Documento original</CardTitle>
                  <CardDescription>DANFE utilizado nesta leitura — segue anexada à entrada</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm truncate">{parsed.rawFile.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({(parsed.rawFile.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                    <Button variant="outline" size="sm" className="ml-auto gap-1" asChild>
                      <a href={URL.createObjectURL(parsed.rawFile)} target="_blank" rel="noopener noreferrer">
                        <Eye className="h-3.5 w-3.5" /> Visualizar
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ações */}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setParsed(null);
                  setError(null);
                }}
              >
                Voltar
              </Button>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={confirmImport}>
                Conferir na Entrada
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Cadastro de fornecedor inline (§12) — reutiliza o formulário padrão */}
        <SupplierForm
          open={createSupplierOpen}
          onOpenChange={setCreateSupplierOpen}
          mode="create"
          supplierId={null}
          preFilled={danfePreFill}
          onCreated={(id) => {
            setSelectedSupplierId(id);
            toast.success("Fornecedor criado e selecionado para esta NF-e.");
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
