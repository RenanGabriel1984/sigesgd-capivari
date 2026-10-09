/** @license University of São Paulo (CC-BY-SA 4.0) / modifications allowed under LGPL-3.0-or-later. */

import React, { useState, useRef, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Dialog, DialogTitle, DialogContent, DialogDescription, DialogFooter,
  DialogClose, Button, Textarea, Label, HStack, VStack, Text, Progress,
  Alert, AlertDescription, AlertTitle, AlertTriangle, FileInput, FileButton,
  Step, Stepper, Select, SelectTrigger, SelectValue, SelectContent,
  SelectItem, Card, CardHeader, CardTitle, CardDescription, CardContent,
  CardFooter, Badge, Input, Toolbar, ToolbarButton, ToolbarGroup,
  Table, TableHead, TableRow, TableHeader, TableCell, TableBody,
  Switch, BodyTemplate3, Funnel, UserCircle,
} from "@sjoy/eds";
import { ClassNotFoundSnackbar, CodeTemplate } from "@/components/common";

import { logDev } from "@/lib/devlog";
import type {
  DialogStepState,
  FileWithExtension,
  OcrImageSource,
  OcrProcessState,
  OcrState,
  OcrDecodedData,
} from "@/lib/ocr/types";

import {
  buildPdfMemoryBufferFromFile,
  runPdfExtraction,
  computeExtractedPageCount,
  getLocalOcrExtractChannels,
  prepareImageMemoryChannel,
  runOcrEngineOnImageChannel,
  runPdfPageImageExtraction,
  finishOcrProcess,
  readPdfExtractPageCount,
  readOcrProcessState,
  decodedOcrDataFromPdfExtraction,
} from "@/lib/ocr/engine";

import {
  extractOcrText,
  extractNfeNumberFromOcrText,
  extractTotalValueFromOcrText,
  extractCurrencyAmount,
  isValidDanfeItemCandidate,
  partialDanfeFieldSummary,
  validateAccessKey44,
  // Note: import from danfe-ocr.ts via the local alias resolution.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } from "../lib/danfe-ocr";

const LOG_SOURCE = "DanfeImportDialog";

export interface NfeDataFields {
  readingId: string;
  statusCode: number;
  statusName: string;
  scannedDocumentName: string | null;
  recentUpdateDateTime: string | null;
  accessKey: string | null;
  nfeNumber: string | null;
  emitentCnpj: string | null;
  emitentLegalName: string | null;
  emitentTradeName: string | null;
  emitentAddress: string | null;
  emitentCity: string | null;
  emitentState: string | null;
  emitentPostalCode: string | null;
  transmiterFiscalName?: string | null;
  receiverCnpj: string | null;
  receiverLegalName: string | null;
  receiverTradeName: string | null;
  receiverAddress: string | null;
  receiverCity: string | null;
  receiverState: string | null;
  receiverPostalCode: string | null;
  issueDate: string | null;
  dueDate?: string | null;
  totalAmount: string | null;
  receivedAmount?: string | null;
  noteOfCharge: string | null;
  noteOfInCharge: string | null;
  noteOfProtest?: string | null;
  noteOfOther?: string | null;
  noteOfCollector?: string | null;
  products: NfeProductFields[];
  anyCorruptionDetected: boolean;
}

export interface NfeProductFields {
  seq: string | null;
  productKey?: string | null;
  productBrand?: string | null;
  productModel?: string | null;
  productDescription?: string | null;
  unitOfMeasure?: string | null;
  productQuantity: number;
  productUnitAmount?: number | null;
  productTotalAmount?: number | null;
  cpfCsat?: string | null;
  ncmCode?: string | null;
  cfopCode?: string | null;
  coteDesc?: string | null;
  noteOfItem?: string | null;
}

export type OcrDecodedBase = {
  status: number;
  message: string | null;
};

export type OcrDecodedExtra = OcrDecodedBase & {
  data: NfeDataFields;
};

export type OcrParadigm = "pdf-text-layer" | "pdf-image-rasterized-300dpi" | "image-file" | "unknown";

export interface OcrFeatureResult {
  paradigm: OcrParadigm;
  data: OcrDecodedExtra;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function snakeCaseToLabel(snake: string): string {
  return snake
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toLocaleUpperCase("pt-BR"));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

const STEP_NAMES: Record<DialogStepState["stage"], string> = {
  "receiving-document": "Selecionar DANFE / PDF / imagem",
  "extracting-content": "Extraindo conteúdo do documento",
  "reviewing-content": "Conferir e importar NF-e",
  "impossible-content": "Não foi possível ler a DANFE",
};

function stepperLabel(state: DialogStepState): string {
  return STEP_NAMES[state.stage] ?? "—";
}

function statusBadge(state: DialogStepState): JSX.Element {
  switch (state.stage) {
    case "receiving-document":
    case "extracting-content":
      return <Badge color="blue" variant="soft">Aguarde</Badge>;
    case "reviewing-content":
      return <Badge color="green" variant="soft">Conferência</Badge>;
    case "impossible-content":
      return <Badge color="red" variant="soft">Falha na leitura</Badge>;
    default:
      return <Badge color="gray" variant="soft">—</Badge>;
  }
}

function buildAbortController(): HandleAbortSignal {
  const controller = new AbortController();
  const handle: HandleAbortSignal = { signal: controller.signal, abort: () => controller.abort() };
  return handle;
}

function buildOcrState(): OcrState {
  return {
    source: null,
    process: {
      active: false,
      stage: "idle",
      message: null,
      progress: 0,
    },
    result: null,
    error: null,
  };
}

function deriveOcrDecodedFromResult(result: NonNullable<OcrState["result"]>): OcrDecodedExtra {
  const envel = result.decoded as OcrDecodedExtra | undefined;
  if (envel && envel.data) return envel;
  throw new Error("Unexpected OCR result shape");
}

// ─── Component ───────────────────────────────────────────────────────────────

export type DanfeImportDialogProps = {
  open: boolean;
  onClose: () => void;
  initialDocuments?: FileWithExtension[];
  onNfeData?: (
    fields: NfeDataFields,
    paradigm: OcrParadigm,
    originalFile: FileWithExtension | null,
    // tslint:disable-next-line:no-empty
  ) => void;
  onOpenChange?: (open: boolean) => void;
};

export function DanfeImportDialog({
  open,
  onClose,
  initialDocuments = [],
  onNfeData,
  onOpenChange,
}: DanfeImportDialogProps) {
  const [localInitialDocs, setLocalInitialDocs] = useState<FileWithExtension[]>(initialDocuments);
  // Note: we intentionally ignore further `initialDocuments` updates after mount,
  // because the dialog is short-lived and re-mount would lose the flow.
  const [step, setStep] = useState<DialogStepState>({
    stage: "receiving-document",
  });
  const [selectedFile, setSelectedFile] = useState<FileWithExtension | null>(null);
  const [ocrState, setOcrState] = useState<OcrState>(buildOcrState);
  const [explicitAbortSignal, setExplicitAbortSignal] = useState<HandleAbortSignal | null>(null);
  const [nfeFields, setNfeFields] = useState<NfeDataFields | null>(null);
  const [paradigm, setParadigm] = useState<OcrParadigm>("unknown");
  const [snackbarClassNotFound, setSnackbarClassNotFound] = useState<string | null>(null);
  const [snackbarCodeTemplate, setSnackbarCodeTemplate] = useState<string | null>(null);
  const ocrAbortRef = useRef<HandleAbortSignal | null>(null);
  const isControlledOpen = useRef(open);

  // Keep ref in sync whenever `open` prop changes externally.
  React.useEffect(() => { isControlledOpen.current = open; }, [open]);

  // Cleanup OCR lifecycle on open/close transitions (no-op when already
  // handled by the process itself, but good to maintain invariants).
  React.useEffect(() => {
    if (!open) {
      // We do NOT abort mid-process when the user clicks Close while the OCR
      // is still running — that would leave the UI in an inconsistent state
      // and the process already sets its own final state. But we do ensure
      // that if we are in "receiving-document", any lingering state is cleared.
      setOcrState(buildOcrState());
      setNfeFields(null);
      setExplicitAbortSignal(null);
      setSelectedFile(null);
      setSnackbarClassNotFound(null);
      setSnackbarCodeTemplate(null);
      ocrAbortRef.current = null;
    }
  }, [open]);

  const handleAbortAll = useCallback(() => {
    setOcrState((prev) => {
      if (prev.process.active) {
        // Let the process itself handle this state transition.
        return prev;
      }
      return buildOcrState();
    });
    setNfeFields(null);
    setExplicitAbortSignal(null);
    setSelectedFile(null);
    setSnackbarClassNotFound(null);
    setSnackbarCodeTemplate(null);
    ocrAbortRef.current = null;
  }, []);

  const requestFileRead = useCallback(async (
    doc: FileWithExtension,
    signal: AbortSignal,
  ): Promise<PdfDocumentSnapshot | null> => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const pdfBuffer = await buildPdfMemoryBufferFromFile(doc);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (pdfBuffer === null) return null;
    const pages = await runPdfExtraction(pdfBuffer, signal);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return pages;
  }, []);

  // ─── STEP 1 : receiving document ─────────────────────────────────────────

  const handleDocumentSelected = useCallback(async (
    file: FileWithExtension,
  ): Promise<void> => {
    if (!file) return;
    logDev({ src: LOG_SOURCE, action: "document_selected", name: file.name, size: file.size });

    setSelectedFile(file);

    // Reset OCR state for the new document.
    setOcrState(buildOcrState());
    setNfeFields(null);
    setSnackbarClassNotFound(null);
    setSnackbarCodeTemplate(null);
    setParadigm("unknown");

    const abortCtrl = buildAbortController();
    setExplicitAbortSignal(abortCtrl);
    ocrAbortRef.current = abortCtrl;
    setStep({ stage: "extracting-content" });

    let pdfSnapshot: PdfDocumentSnapshot | null = null;
    try {
      setOcrState((prev) => ({
        ...prev,
        process: { active: true, stage: "pdf-textlayer", message: "Lendo camada de texto do PDF, se houver…", progress: 0 },
      }));
      pdfSnapshot = await requestFileRead(file, abortCtrl.signal);
      if (!pdfSnapshot) throw new Error("PdfDocumentSnapshot is null");

      const extracted = await runPdfExtraction(pdfBuffer, abortCtrl.signal);
      if (!extracted) throw new Error("PDF extraction returned null");

      setOcrState((prev) => ({
        ...prev,
        process: { active: true, stage: "pdf-textlayer", message: "Finilizando extração de texto…", progress: 1 },
      }));

      // Determine the paradigm and decide whether the PDF needs rasterization.
      const pageCount = computeExtractedPageCount(extracted);
      const firstPage = pageCount > 0 ? (await extracted.getPage(1)) : null;

      // Heuristic: if the document has no usable text, treat it as scanned.
      // We also check if the extracted text produces any OCR-quality results.
      const textPreview = (firstPage ? await extracted.getTextContent() : null) ?? "";
      const textIsReasonable = textPreview.trim().length > 40;

      let ocrChannels: OcrImageSource[] = [];
      let ocrSourceLabel: string;

      if (textIsReasonable) {
        // Possibly a text-layer PDF. But we still scan for the header key to
        // be safe — many DANFE PDFs have a text layer with errors.
        ocrChannels = await getLocalOcrExtractChannels(extracted, file, "text-layer-pdf");
        ocrSourceLabel = "pdf com camada de texto";
      } else {
        // No reasonable text layer — render pages as images at ~300 DPI.
        setOcrState((prev) => ({
          ...prev,
          process: { active: true, stage: "rasterize", message: "Renderizando páginas do PDF em alta resolução (~300 DPI) para OCR…", progress: 0.1 },
        }));
        ocrChannels = await getLocalOcrExtractChannels(extracted, file, "image-rasterized-300dpi");
        ocrSourceLabel = "PDF digitalizado — rasterização ~300 DPI";
      }

      if (ocrChannels.length === 0) {
        throw new Error("Nenhum canal de imagem obtido para OCR");
      }

      setOcrState((prev) => ({
        ...prev,
        source: { type: "channels", count: ocrChannels.length },
      }));

      // OCR time.
      setOcrState((prev) => ({
        ...prev,
        process: { active: true, stage: "ocr", message: `Rodando OCR no ${ocrSourceLabel}…`, progress: 0 },
      }));

      const results: OcrDecodedExtra[] = [];
      const length = ocrChannels.length;
      for (let i = 0; i < length; i++) {
        if (abortCtrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const channel = ocrChannels[i];
        setOcrState((prev) => ({
          ...prev,
          process: {
            active: true,
            stage: "ocr",
            message: `OCR da página ${i + 1} de ${length} (${ocrSourceLabel})…`,
            progress: (i + 1) / length * 0.8,
          },
        }));
        const decoded = await runOcrEngineOnImageChannel(channel, abortCtrl.signal);
        results.push(decoded);
      }

      setOcrState((prev) => ({
        ...prev,
        process: { active: true, stage: "postprocess", message: "Processando resultados do OCR…", progress: 0.9 },
      }));

      const merged = mergeOcrDecodedResults(results);
      const paradigmType = textIsReasonable ? "pdf-text-layer" : "pdf-image-rasterized-300dpi";
      const finalExtra: OcrDecodedExtra = {
        status: 0,
        message: null,
        data: {
          ...merged,
          readingId: uuidv4(),
          statusCode: 0,
          statusName: "Normal",
          scannedDocumentName: file.name,
          recentUpdateDateTime: null,
          anyCorruptionDetected: false,
        },
      };

      setOcrState((prev) => ({
        ...prev,
        process: { active: false, stage: "done", message: "Leitura concluída.", progress: 1 },
        result: finalExtra,
      }));
      setParadigm(paradigmType);

      setStep({ stage: "reviewing-content" });
    } catch (error) {
      // Detectar abort do usuário (botão Cancelar ou Close) vs erro real.
      if (error instanceof DOMException && error.name === "AbortError") {
        setStep({ stage: "receiving-document" });
        setOcrState((prev) => ({
          ...prev,
          process: { active: false, stage: "abort", message: null, progress: 0 },
        }));
        setParadigm("unknown");
        return;
      }

      logDev({ src: LOG_SOURCE, action: "ocr_failed", error: String(error) });
      const errorMessage = error instanceof Error ? error.message : "Falha ao processar o documento";
      setOcrState((prev) => ({
        ...prev,
        process: { active: false, stage: "failed", message: errorMessage, progress: 0 },
        error: errorMessage,
      }));
      setStep({ stage: "impossible-content" });
    } finally {
      setExplicitAbortSignal(null);
      ocrAbortRef.current = null;
    }
  }, [requestFileRead, setOcrState]);

  const handleImportFileDirect = useCallback(async (
    file: FileWithExtension,
  ): Promise<void> => {
    await handleDocumentSelected(file);
  }, [handleDocumentSelected]);

  const handleFileAdded = useCallback(async (
    added: FileWithExtension,
  ): Promise<void> => {
    await handleDocumentSelected(added);
  }, [handleDocumentSelected]);

  const handleFileInputChanged = useCallback(async (
    files: FileList | null,
  ): Promise<void> => {
    if (!files || files.length === 0) return;
    const file = files[0];
    await handleDocumentSelected(file);
  }, [handleDocumentSelected]);

  const handleDropFiles = useCallback(async (
    e: React.DragEvent,
  ): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    const filesList = e.dataTransfer.files;
    if (filesList.length === 0) return;
    const file = filesList[0] as FileWithExtension;
    await handleDocumentSelected(file);
  }, [handleDocumentSelected]);

  // ─── STEP 2 : reviewing content ──────────────────────────────────────────

  const reviewCanGoNext = (): boolean => {
    if (!nfeFields) return false;
    // Requires at least the access key for safe import (or at least NFE number
    // plus total amount, as a minimal fallback — but that is still risky).
    // We follow the rule: without the access key, the import cannot proceed.
    // The user can still edit fields, but the "Continuar" button stays disabled.
    return nfeFields.accessKey != null && nfeFields.accessKey !== "";
  };

  const handleReviewContinue = useCallback((): void => {
    if (!nfeFields || !reviewCanGoNext()) return;
    logDev({ src: LOG_SOURCE, action: "review_continue" });
    onNfeData?.(nfeFields, paradigm, selectedFile);
    // Note: After the parent handles the data, the dialog may be closed via
    // `onClose` from the `onNfeData` callback (or the parent can do it).
    // We don't force-close here, so the parent can show a confirmation snackbar,
    // but for convenience we close immediately if no explicit handler behaves
    // differently.
    if (onOpenChange) onOpenChange(false);
  }, [nfeFields, paradigm, selectedFile, onNfeData, onOpenChange]);

  const handleReviewBack = useCallback((): void => {
    setStep({ stage: "extracting-content" });
    setOcrState((prev) => ({
      ...prev,
      process: { active: true, stage: "regenerate", message: "Regenerando…", progress: 0 },
    }));
    setNfeFields(null);
    setParadigm("unknown");
  }, []);

  const getEditableField = (field: keyof NfeDataFields) => {
    const val = nfeFields?.[field] ?? null;
    return (
      <Input
        label={snakeCaseToLabel(field)}
        value={val ?? ""}
        placeholder="—"
        onChange={(e) => {
          if (!nfeFields) return;
          setNfeFields((prev) => prev ? { ...prev, [field]: e.target.value } : null);
        }}
      />
    );
  };

  // Mapping of fields to their React node editors.
  const createEditorForField = (field: keyof NfeDataFields, value: string | null) => {
    // Use a simple input — all fields are stored as strings.
    return (
      <Input
        label={snakeCaseToLabel(field)}
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          if (!nfeFields) return;
          setNfeFields((prev) => prev ? { ...prev, [field]: e.target.value } : null);
        }}
      />
    );
  };

  const renderProductTable = (): JSX.Element => {
    const rows = nfeFields?.products ?? [];
    if (rows.length === 0) {
      return (
        <Card color="gray" variant="outlined" tone="info">
          <CardContent>
            <Text size="sm">Nenhum produto foi identificado pelo OCR.</Text>
          </CardContent>
        </Card>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Qtd</TableHead>
            <TableHead>Un.</TableHead>
            <TableHead>V. Unitário</TableHead>
            <TableHead>V. Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item, idx) => (
            <TableRow key={idx}>
              <TableCell>{item.seq ?? "—"}</TableCell>
              <TableCell>
                <Text size="sm">{item.productDescription ?? item.productKey ?? "—"}</Text>
                {item.productBrand && <Text size="xs" color="gray">Marca: {item.productBrand}</Text>}
                {item.productModel && <Text size="xs" color="gray">Modelo: {item.productModel}</Text>}
                {item.noteOfItem && <Text size="xs" color="gray">{item.noteOfItem}</Text>}
              </TableCell>
              <TableCell>{item.productQuantity}</TableCell>
              <TableCell>{item.unitOfMeasure ?? "—"}</TableCell>
              <TableCell>{item.productUnitAmount != null ? `R$ ${item.productUnitAmount.toFixed(2)}` : "—"}</TableCell>
              <TableCell>{item.productTotalAmount != null ? `R$ ${item.productTotalAmount.toFixed(2)}` : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const renderReceivingDocument = (): JSX.Element => (
    <>
      <VStack gap={24} style={{ width: "100%" }}>
        <VStack gap={8}>
          <Label>Selecione o DANFE em PDF, JPG ou PNG</Label>
          <Text size="sm" color="gray">Envie o DANFE digitalizado ou o PDF da NF-e. O sistema fará a leitura local e abrirá uma etapa de conferência.</Text>
        </VStack>

        <VStack gap={12} style={{ width: "100%" }}>
          <FileInput
            accept=".pdf,image/jpeg,image/png"
            multiple={false}
            value={selectedFile}
            onChange={handleFileInputChanged}
            onAdd={handleFileAdded}
            onDrop={handleDropFiles}
          />
          <FileButton
            accept=".pdf,image/jpeg,image/png"
            multiple={false}
            onFile={handleImportFileDirect}
            render={() => (
              <Button variant="outlined" color="primary" onMouseDown={(e) => e.preventDefault()}>
                <Funnel size={16} /> Selecione o arquivo
              </Button>
            )}
          />

          {localInitialDocs.length > 0 && (
            <VStack gap={4}>
              <Label>Documentos sugeridos:</Label>
              {localInitialDocs.map((f) => (
                <Button
                  key={f.name + f.size}
                  variant="subtle"
                  color="gray"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleImportFileDirect(f);
                  }}
                >
                  <UserCircle size={16} /> {f.name} ({formatFileSize(f.size)})
                </Button>
              ))}
            </VStack>
          )}
        </VStack>
      </VStack>
    </>
  );

  const renderExtractingContent = (): JSX.Element => (
    <VStack gap={16} style={{ width: "100%", alignItems: "center" }}>
      <Progress
        value={Math.min(1, Math.max(0, ocrState.process.progress))}
        label={ocrState.process.message ?? "Processando…"}
        variant={ocrState.process.stage === "failed" ? "error" : "primary"}
        size="lg"
        style={{ width: 400 }}
      />
      <Text size="sm" color="gray">O processamento é feito localmente no navegador. Nenhum arquivo é enviado a servidores.</Text>
      <Button
        variant="subtle"
        color="gray"
        onMouseDown={(e) => {
          e.preventDefault();
          if (ocrState.process.active) {
            explicitAbortSignal?.abort();
          }
        }}
      >
        Cancelar
      </Button>
    </VStack>
  );

  const renderImpossibleContent = (): JSX.Element => {
    const errMsg = ocrState.error ?? "Não foi possível ler os dados da DANFE.";
    return (
      <VStack gap={16} style={{ width: "100%", alignItems: "center" }}>
        <Alert color="red" variant="high" icon={<AlertTriangle size={20} />}>
          <AlertTitle>Não foi possível ler a DANFE</AlertTitle>
          <AlertDescription>{errMsg}</AlertDescription>
        </Alert>
        <Text size="sm" color="gray">
          Pode ser que a DANFE esteja muito danificada, ilegível ou que o formato não seja suportado.
          Tente com um arquivo de melhor qualidade, ou importe o XML da NF-e se disponível.
        </Text>
        <Button variant="primary" onMouseDown={(e) => { e.preventDefault(); onClose?.(); }}>
          Fechar
        </Button>
      </VStack>
    );
  };

  const renderReviewingContent = (): JSX.Element => {
    if (!nfeFields) return null;

    const accessKeyValue = nfeFields.accessKey ?? "";

    return (
      <VStack gap={28} style={{ width: "100%", alignItems: "stretch" }}>
        {nfeFields.anyCorruptionDetected && (
          <Alert color="orange" variant="high" icon={<AlertTriangle size={20} />}>
            <AlertTitle>Dados com possível corrupção detectada</AlertTitle>
            <AlertDescription>
              O OCR encontrou inconsistências no documento. Os dados foram pré-preenchidos, mas são necessários seus ajustes manuais.
            </AlertDescription>
          </Alert>
        )}

        {!nfeFields.accessKey && (
          <Alert color="amber" variant="high" icon={<AlertTriangle size={20} />}>
            <AlertTitle>Chave de acesso não identificada automaticamente</AlertTitle>
            <AlertDescription>
              A leitura identificou parte dos dados, mas não foi possível confirmar a chave de acesso da NF-e.
              Insira manualmente ou verifique o documento original para prosseguir com a conferência.
            </AlertDescription>
          </Alert>
        )}

        <VStack gap={24} style={{ width: "100%" }}>
          {/* Identificação geral */}
          <Card color="blue" variant="outlined">
            <CardHeader>
              <CardTitle>Identificação da NF-e</CardTitle>
              <CardDescription>Dados Originais (preenchidos via OCR)</CardDescription>
            </CardHeader>
            <CardContent style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {["issueDate", "nfeNumber", "accessKey"].map((f) => createEditorForField(f, nfeFields[f] ?? null))}
              {["dueDate", "noteOfCharge", "noteOfInCharge", "noteOfProtest", "noteOfOther", "noteOfCollector"].map((f) => {
                const val = nfeFields[f as keyof NfeDataFields] as string | null | undefined;
                if (val == null) return null;
                return createEditorForField(f, val ?? null);
              })}
            </CardContent>
          </Card>

          {/* Valores */}
          <Card color="green" variant="outlined">
            <CardHeader>
              <CardTitle>Valores</CardTitle>
              <CardDescription>Valores Originais (preenchidos via OCR)</CardDescription>
            </CardHeader>
            <CardContent style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
              {["totalAmount", "receivedAmount"].map((f) => {
                const val = nfeFields[f as keyof NfeDataFields] as string | null | undefined;
                if (val == null) return null;
                return (
                  <Input
                    label={snakeCaseToLabel(f)}
                    value={val}
                    prefix="R$ "
                    type="number"
                    step={0.01}
                    onChange={(e) => {
                      if (!nfeFields) return;
                      setNfeFields((prev) => prev ? { ...prev, [f]: e.target.value } : null);
                    }}
                  />
                );
              })}
            </CardContent>
          </Card>

          {/* Emitente */}
          <Card color="purple" variant="outlined">
            <CardHeader>
              <CardTitle>Emitente</CardTitle>
              <CardDescription>Dados do Emitente (preenchidos via OCR)</CardDescription>
            </CardHeader>
            <CardContent style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
              {["emitentCnpj", "emitentLegalName", "emitentTradeName", "emitentAddress", "emitentCity", "emitentState", "emitentPostalCode"].map((f) => createEditorForField(f, nfeFields[f] ?? null))}
            </CardContent>
          </Card>

          {/* Destinatário */}
          <Card color="teal" variant="outlined">
            <CardHeader>
              <CardTitle>Destinatário</CardTitle>
              <CardDescription>Dados do Destinatário (preenchidos via OCR)</CardDescription>
            </CardHeader>
            <CardContent style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
              {["receiverCnpj", "receiverLegalName", "receiverTradeName", "receiverAddress", "receiverCity", "receiverState", "receiverPostalCode"].map((f) => createEditorForField(f, nfeFields[f] ?? null))}
            </CardContent>
          </Card>

          {/* Produtos */}
          <Card color="gray" variant="outlined">
            <CardHeader>
              <CardTitle>Produtos</CardTitle>
              <CardDescription>Itens identificados no DANFE</CardDescription>
            </CardHeader>
            <CardContent>
              {renderProductTable()}
            </CardContent>
          </Card>
        </VStack>

        {/* Aviso de chave pendente (se necessário) */}
        {!nfeFields.accessKey && (
          <Alert color="amber" variant="high" icon={<AlertTriangle size={20} />}>
            <AlertTitle>Chave de acesso pendente de conferência</AlertTitle>
            <AlertDescription>
              A chave de acesso é necessária para evitar duplicidade de notas fiscais. Preencha o campo acima antes de continuar.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <HStack gap={16}>
            <Button
              variant="subtle"
              color="gray"
              onMouseDown={(e) => {
                e.preventDefault();
                handleReviewBack();
              }}
            >
              Voltar
            </Button>
            <Button
              variant="primary"
              onMouseDown={(e) => {
                e.preventDefault();
                handleReviewContinue();
              }}
              disabled={!reviewCanGoNext()}
            >
              Continuar para conferência
            </Button>
          </HStack>
        </DialogFooter>
      </VStack>
    );
  };

  const renderContent = (): JSX.Element => {
    switch (step.stage) {
      case "receiving-document":
        return renderReceivingDocument();
      case "extracting-content":
        return renderExtractingContent();
      case "impossible-content":
        return renderImpossibleContent();
      case "reviewing-content":
        return renderReviewingContent();
      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(op) => {
        if (!op) {
          // Tenta cancelar qualquer OCR ativo para não deixar processamento
          // phantom rodando no background após o fechamento.
          explicitAbortSignal?.abort();
          setOcrState(buildOcrState());
          setNfeFields(null);
          setParadigm("unknown");
        }
        onOpenChange?.(op);
      }}
      closeOnEsc
      closeOnOverlayClick={false}
      modalType="fullscreen"
      footer={
        <DialogFooter>
          <DialogClose as={Button} variant="subtle" color="gray">
            Fechar
          </DialogClose>
          {step.stage === "reviewing-content" && (
            <Button variant="primary" onMouseDown={(e) => { e.preventDefault(); handleReviewContinue(); }} disabled={!reviewCanGoNext()}>
              Continuar
            </Button>
          )}
        </DialogFooter>
      }
    >
      <DialogTitle>
        Importar DANFE / PDF / Imagem
        {step.stage !== "receiving-document" && " • "}
        {step.stage === "receiving-document" ? "Importação de DANFE" : stepperLabel(step)}
        {statusBadge(step)}
      </DialogTitle>
      <DialogDescription>
        {step.stage === "receiving-document" && "Selecione um DANFE em PDF, JPEG ou PNG para leitura por OCR. A importação é feita localmente."}
        {step.stage === "extracting-content" && "Processando documento. Aguarde…"}
        {step.stage === "reviewing-content" && "Conferência de dados capturados pelo OCR. Verifique os campos antes de importar."}
        {step.stage === "impossible-content" && "Não foi possível extrair os dados da DANFE."}
      </DialogDescription>

      <DialogContent style={{ padding: 16, overflow: "auto", maxHeight: "89vh", width: "auto", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
        {renderContent()}
      </DialogContent>

      {snackbarClassNotFound && (
        <ClassNotFoundSnackbar onClose={() => setSnackbarClassNotFound(null)} />
      )}
      {snackbarCodeTemplate && (
        <CodeTemplate onClose={() => setSnackbarCodeTemplate(null)} />
      )}
    </Dialog>
  );
}

// ─── Helpers internos para merges ────────────────────────────────────────────

function mergeOcrDecodedResults(results: OcrDecodedExtra[]): OcrDecodedExtra["data"] {
  if (results.length === 0) return emptyNfeData();
  if (results.length === 1) return results[0].data;

  // Prioridade: primeiro resultado com status OK e com accessKey.
  const withKey = results.filter((r) => r.data.accessKey != null && r.data.accessKey !== "");
  if (withKey.length > 0) {
    // Choose the first one with a valid access key (length 44, valid structure).
    const best = withKey.find((r) => validateAccessKey44(r.data.accessKey!));
    if (best) return best.data;
    // If no valid access key structure, still return the first one with a key
    // (the parser may still fill other fields well).
    return withKey[0].data;
  }

  // Sem chave em nenhum resultado, usa o primeiro.
  return results[0].data;
}

function emptyNfeData(): NfeDataFields {
  return {
    readingId: uuidv4(),
    statusCode: 0,
    statusName: "Normal",
    scannedDocumentName: null,
    recentUpdateDateTime: null,
    accessKey: null,
    nfeNumber: null,
    emitentCnpj: null,
    emitentLegalName: null,
    emitentTradeName: null,
    emitentAddress: null,
    emitentCity: null,
    emitentState: null,
    emitentPostalCode: null,
    transmiterFiscalName: undefined,
    receiverCnpj: null,
    receiverLegalName: null,
    receiverTradeName: null,
    receiverAddress: null,
    receiverCity: null,
    receiverState: null,
    receiverPostalCode: null,
    issueDate: null,
    dueDate: undefined,
    totalAmount: null,
    receivedAmount: undefined,
    noteOfCharge: null,
    noteOfInCharge: null,
    noteOfProtest: undefined,
    noteOfOther: undefined,
    noteOfCollector: undefined,
    products: [],
    anyCorruptionDetected: false,
  };
}

// Omit the type-only import for `pdfjsLib` & UMD shims
import type { PdfDocumentProxy, PdfPageProxy, TesseractWorker, HandleAbortSignal } from "@/lib/ocr/types";
