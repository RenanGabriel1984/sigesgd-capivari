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
import { parseDanfeText } from "@/lib/danfe-ocr";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileText, Loader2, Upload, Eye, Key, DollarSign, Calendar, Building, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  formatAccessKeyGrouped,
  formatCnpj,
  formatPhone,
  formatCep,
  digitsOnly,
} from "@/lib/br-validators";

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

/** Renderiza uma página do PDF em imagem (fallback para PDF escaneado). */
async function renderPdfPageImage(file: File, pageNumber = 1): Promise<File> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível para ler o PDF.");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Não foi possível renderizar a página do PDF.");
    return new File([blob], "danfe-render.png", { type: "image/png" });
  } finally {
    await doc.destroy();
  }
}

/** OCR local (tesseract.js) — eng+por, sem chave de API. */
async function ocrImage(
  file: File,
  onStatus?: (s: string) => void,
  onProgress?: (p: number) => void,
): Promise<string> {
  onStatus?.("Reconhecendo o texto da imagem (OCR)... ");
  const { recognize } = await import("tesseract.js");
  const result = await recognize(file, "eng+por", {
    logger: (m: any) => {
      if (m?.status === "recognizing text") {
        onProgress?.(Math.round((m.progress ?? 0) * 100));
      }
    },
  });
  return result?.data?.text ?? "";
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
    try {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      let text = "";

      if (isPdf) {
        setOcrStatus("Lendo o texto do PDF...");
        text = await extractPdfText(f, setOcrProgress);
        // PDF sem camada de texto (digitalizado) → renderiza e faz OCR.
        if (text.replace(/\s/g, "").length < 80) {
          setOcrStatus("PDF digitalizado — convertendo página em imagem...");
          const image = await renderPdfPageImage(f);
          text = await ocrImage(image, setOcrStatus, setOcrProgress);
        }
      } else {
        text = await ocrImage(f, setOcrStatus, setOcrProgress);
      }

      setOcrProgress(100);
      setOcrStatus("Analisando os dados da NF-e...");
      const result = parseDanfeText(text);
      if (!result.ok || (!result.accessKey && !result.nfeNumber)) {
        setError(
          "Não foi possível identificar os dados da NF-e nesta DANFE. Verifique se o documento é legível ou importe o XML da NF-e.",
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
        { field: "receiverName", label: "Razão social do destinatário", value: parsed.receiverName ?? "—", icon: Building },
        { field: "totalValue", label: "Valor total", value: parsed.totalValue ? `R$ ${parsed.totalValue.toFixed(2).replace(".", ",")}` : "—", icon: DollarSign },
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
                              {item.unitValue != null ? `R$ ${item.unitValue.toFixed(2).replace(".", ",")}` : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.totalValue != null ? `R$ ${item.totalValue.toFixed(2).replace(".", ",")}` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total geral:</span>
                    <span className="font-medium font-mono">
                      {parsed.totalValue != null ? `R$ ${parsed.totalValue.toFixed(2).replace(".", ",")}` : "—"}
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
                <p className="text-[10px] text-muted-foreground mt-1">
                  {digitsOnly(parsed.accessKey ?? "").length === 44
                    ? "44 dígitos conferidos — valor normalizado no banco"
                    : `${digitsOnly(parsed.accessKey ?? "").length} de 44 dígitos`}
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
