/** @license University of São Paulo (CC-BY-SA 4.0) / modifications allowed under LGPL-3.0-or-later. */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import type { DialogStepState, FileWithExtension, OcrParadigm, NfeDataFields } from "@/components/DanfeImportDialog";

import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Progress,
  Text,
  VStack,
  HStack,
  Badge,
  Switch,
  Label,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableCell,
  TableBody,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  BodyTemplate3,
  Funnel,
  UserCircle,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@sjoy/eds";

import { toast } from "@/components/notifier";
import { ClassNotFoundSnackbar, CodeTemplate } from "@/components/common";

import { DanfeImportDialog, type DanfeImportDialogProps } from "@/components/DanfeImportDialog";
import { NfeReviewTable, type NfeReviewTableProps } from "@/components/NfeReviewTable";

import { logDev } from "@/lib/devlog";

import { useNfeService, type NfeDownload } from "@/hooks/useNfeService";
import { useConfirmedEntries, type ConfirmedEntry } from "@/hooks/useConfirmedEntries";

import { uploadOrFetchRemoteDocumentUrl, type UploadedFile } from "@/lib/cloud/storage";
import { getStoredOcrCachePath, clearStoredOcrCachePath, setStoredOcrCachePath } from "@/lib/settings/ocr-cache";

import { ButtonSignWithCredentials } from "@/components/authenticated/ButtonSignWithCredentials";
import { UserAvatar } from "@/components/authenticated/UserAvatar";
import { PageHeader, PageTitle, PageBreadcrumbs } from "@/components/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonText } from "@/components/ui/SkeletonText";

import { formatFileSize } from "@/lib/utils/format-file-size";
import { formatDate } from "@/lib/utils/format-date";
import { formatCurrencyBRL } from "@/lib/utils/format-currency-brl";
import { cn } from "@/lib/utils/cn";

import { NfeRemoveButton } from "./nfe/NfeRemoveButton";

import type { SkeletonVariants } from "@/components/ui/Skeleton";

const PAGE_TITLE = "Entradas de NF-e";
const PAGE_DESCRIPTION = "Controle e conferência de notas fiscais de entrada (DANFE via OCR + XML)";

// ─── Hooks / services ────────────────────────────────────────────────────────

function EntriesPage() {
  const { downloadNfeXml, downloadNfePdf, isLoading: isNfeServiceLoading } = useNfeService();
  const { entries, refreshEntries, isLoading: isEntriesLoading } = useConfirmedEntries();
  const [searchText, setSearchText] = useState("");
  const [showEntriesWithSearch, setShowEntriesWithSearch] = useState(false);
  const [recentScannedDocumentNames, setRecentScannedDocumentNames] = useState<string[]>([]);

  const [openDialog, setOpenDialog] = useState(false);

  // ── State used by DanfeImportDialog ──────────────────────────────────────
  const [step, setStep] = useState<DialogStepState>({ stage: "receiving-document" });
  const [selectedFile, setSelectedFile] = useState<FileWithExtension | null>(null);
  const [ocrState, setOcrState] = useState<DanfeImportDialogProps["ocrState"]>({
    source: null,
    process: { active: false, stage: "idle", message: null, progress: 0 },
    result: null,
    error: null,
  });
  const [nfeFields, setNfeFields] = useState<NfeDataFields | null>(null);
  const [paradigm, setParadigm] = useState<OcrParadigm>("unknown");
  const [snackClassNotFound, setSnackClassNotFound] = useState<string | null>(null);
  const [snackCodeTemplate, setSnackCodeTemplate] = useState<string | null>(null);

  // ── Entries list state ────────────────────────────────────────────────────
  const [entriesSnapshot, setEntriesSnapshot] = useState<ConfirmedEntry[]>([]);
  const [initialEntriesSnapshot, setInitialEntriesSnapshot] = useState<ConfirmedEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  // ── Selected entry to remove ─────────────────────────────────────────────
  const [selectedEntryToRemove, setSelectedEntryToRemove] = useState<ConfirmedEntry | null>(null);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const initialEntriesRef = useRef<ConfirmedEntry[]>([]);
  const ocrCachePathRef = useRef<string | null>(null);

  // ── Initial load of OCR cache path ────────────────────────────────────────
  useEffect(() => {
    const path = getStoredOcrCachePath();
    ocrCachePathRef.current = path;
  }, []);

  // ── Observe entries and refresh on mount/interval ─────────────────────────
  const loadEntries = useCallback(async () => {
    setIsSyncing(true);
    setEntriesError(null);
    try {
      const fresh = await refreshEntries();
      setEntriesSnapshot(fresh ?? []);
      if (initialEntriesRef.current.length === 0) {
        initialEntriesRef.current = fresh ?? [];
        setInitialEntriesSnapshot(fresh ?? []);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível carregar as entradas.";
      setEntriesError(msg);
    } finally {
      setIsSyncing(false);
    }
  }, [refreshEntries]);

  useEffect(() => {
    loadEntries();
    const interval = setInterval(loadEntries, 15_000);
    return () => clearInterval(interval);
  }, [loadEntries]);

  // ── Search / filter ───────────────────────────────────────────────────────
  const filteredEntries = useMemoWithSearch(entriesSnapshot, searchText);

  function useMemoWithSearch(entries: ConfirmedEntry[], text: string): ConfirmedEntry[] {
    if (!text.trim()) return entries;
    const q = text.trim().toLowerCase();
    return entries.filter((e) =>
      e.accessKey.toLowerCase().includes(q) ||
      e.nfeNumber?.toLowerCase().includes(q) ||
      e.emitentLegalName?.toLowerCase().includes(q) ||
      e.emitentCnpj?.includes(q) ||
      e.receiverLegalName?.toLowerCase().includes(q) ||
      e.receiverCnpj?.includes(q) ||
      e.noteOfCharge?.toLowerCase().includes(q)
    );
  }

  const toggleShowEntriesWithSearch = useCallback(() => {
    setShowEntriesWithSearch((v) => !v);
  }, []);

  // ── DanfeImportDialog props ───────────────────────────────────────────────

  const dialogProps: DanfeImportDialogProps = {
    open: openDialog,
    onClose: () => setOpenDialog(false),
    initialDocuments: [],
    onNfeData: handleNfeData,
    onOpenChange: (open) => {
      setOpenDialog(open);
      if (!open) {
        // Reset OCR state on close.
        setOcrState({
          source: null,
          process: { active: false, stage: "idle", message: null, progress: 0 },
          result: null,
          error: null,
        });
        setNfeFields(null);
        setParadigm("unknown");
        setSnackClassNotFound(null);
        setSnackCodeTemplate(null);
      }
    },
  };

  // ── Handlers: NfeData ─────────────────────────────────────────────────────

  function handleNfeData(
    fields: NfeDataFields,
    paradigm: OcrParadigm,
    originalFile: FileWithExtension | null,
  ) {
    logDev({ src: "EntriesPage", action: "onNfeData", accessKey: fields.accessKey });
    // Copy to state for the review table.
    setNfeFields(fields);
    setParadigm(paradigm);

    // Move step to reviewing-content.
    setStep({ stage: "reviewing-content" });

    // Provide filename for the review table.
    setRecentScannedDocumentNames((prev) => [fields.scannedDocumentName ?? "arquivo.pdf", ...prev].slice(0, 5));

    // Optional: persist the cached OCR data if a cache path is available.
    if (ocrCachePathRef.current && fields.scannedDocumentName) {
      setStoredOcrCachePath(ocrCachePathRef.current);
    }
  }

  const handleReviewContinue = useCallback(() => {
    if (!nfeFields) return;
    // In a more complete version we would persist to backend here.
    // For now we just go back to the receiving-document step.
    toast.success("Dados da NF-e conferidos e prontos para conferência.");
    setOpenDialog(false);
  }, [nfeFields]);

  const handleReviewBack = useCallback(() => {
    setStep({ stage: "receiving-document" });
    setNfeFields(null);
    setParadigm("unknown");
  }, []);

  const handleSnackClassNotFound = useCallback((className: string, error?: Error) => {
    toast.error(error?.message ?? "Falha na validação do formulário.");
    setSnackClassNotFound(className);
  }, []);

  const handleSnackCodeTemplate = useCallback((className: string) => {
    toast.info(`Código template: ${className}`);
    setSnackCodeTemplate(className);
  }, []);

  const reviewProps: NfeReviewTableProps = {
    nfeFields,
    paradigm,
    originalFileName: nfeFields?.scannedDocumentName ?? null,
    onGoNext: handleReviewContinue,
    onGoBack: handleReviewBack,
    onSnackClassNotFound: handleSnackClassNotFound,
    onSnackCodeTemplate: handleSnackCodeTemplate,
    onProductCodeError: (productKey) => {
      toast.error(`Código do produto não encontrado: ${productKey}`);
    },
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderEntriesList = (items: ConfirmedEntry[]) => {
    if (items.length === 0) {
      return (
        <Card variant="outlined" tone="info" style={{ padding: 40 }}>
          <CardContent style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Text>
              {showEntriesWithSearch
                ? "Nenhuma entrada relacionada à busca."
                : "Nenhuma entrada de NF-e encontrada."}
            </Text>
          </CardContent>
        </Card>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº NF-e</TableHead>
            <TableHead>Emitente</TableHead>
            <TableHead>CNPJ Emitente</TableHead>
            <TableHead>Destinatário</TableHead>
            <TableHead>CNPJ Destinatário</TableHead>
            <TableHead>Data de emissão</TableHead>
            <TableHead>Valor total</TableHead>
            <TableHead>Nota de Emissão</TableHead>
            <TableHead>Importado por</TableHead>
            <TableHead style={{ width: 100 }}>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((entry) => (
            <TableRow key={entry.accessKey}>
              <TableCell style={{ fontWeight: 600 }}>
                {entry.nfeNumber ?? "—"}
              </TableCell>
              <TableCell>
                <Text size="sm">{entry.emitentLegalName ?? "—"}</Text>
              </TableCell>
              <TableCell>
                <Text size="sm">{entry.emitentCnpj ?? "—"}</Text>
              </TableCell>
              <TableCell>
                <Text size="sm">{entry.receiverLegalName ?? "—"}</Text>
              </TableCell>
              <TableCell>
                <Text size="sm">{entry.receiverCnpj ?? "—"}</Text>
              </TableCell>
              <TableCell>
                <Text size="sm">
                  {entry.issueDate ? formatDate(entry.issueDate, { timeZone: undefined }) : "—"}
                </Text>
              </TableCell>
              <TableCell>
                <Text size="sm">
                  {entry.totalAmount != null
                    ? formatCurrencyBRL(parseFloat(entry.totalAmount))
                    : "—"}
                </Text>
              </TableCell>
              <TableCell>
                <Text size="sm">{entry.noteOfCharge ?? "—"}</Text>
              </TableCell>
              <TableCell>
                <Text size="sm" muted>
                  {entry.importedBy ?? "—"}
                </Text>
              </TableCell>
              <TableCell>
                <HStack gap={8}>
                  <Button
                    variant="subtle"
                    color="blue"
                    size="sm"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const pdfUrl = entry.pdfStorageUrl;
                      if (pdfUrl) {
                        window.open(pdfUrl, "_blank", "noopener,noreferrer");
                      } else {
                        toast.info("DANFE não disponível.");
                      }
                    }}
                  >
                    <Funnel size={14} />
                  </Button>
                  <NfeRemoveButton
                    entry={entry}
                    onConfirmRemove={(e) => {
                      setSelectedEntryToRemove(e);
                      setShowConfirmRemove(true);
                    }}
                  />
                </HStack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const renderRecentDocuments = () => {
    if (!ocrCachePathRef.current) return null;
    const files = recentScannedDocumentNames.slice(0, 5);
    if (files.length === 0) return null;

    return (
      <Card variant="outlined" tone="gray" style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Documentos recentes</CardTitle>
          <CardDescription>DANFES pré-selecionados para importação rápida</CardDescription>
        </CardHeader>
        <CardContent>
          <VStack gap={8} align="stretch">
            {files.map((name) => (
              <Button
                key={name}
                variant="subtle"
                color="gray"
                onMouseDown={(e) => {
                  e.preventDefault();
                  // Simulate a file selection that triggers import.
                  const file = new File([new ArrayBuffer(0)], name, { type: "application/pdf" }) as FileWithExtension;
                  setSelectedFile(file);
                }}
              >
                <UserCircle size={14} /> {name}
              </Button>
            ))}
          </VStack>
        </CardContent>
      </Card>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const renderContent = () => {
    if (isEntriesLoading) {
      return (
        <VStack gap={16} style={{ width: "100%", alignItems: "center" }}>
          <Skeleton variant={SkeletonVariants.text} width={300} height={24} />
          <Skeleton variant={SkeletonVariants.text} width={500} height={16} />
        </VStack>
      );
    }

    if (entriesError) {
      return (
        <Card variant="outlined" tone="error" style={{ padding: 24 }}>
          <CardContent>
            <Text>{entriesError}</Text>
          </CardContent>
        </Card>
      );
    }

    return (
      <VStack gap={16} style={{ width: "100%", alignItems: "stretch" }}>
        {/* Header */}
        <PageHeader style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <HStack gap={16}>
            <PageTitle>{PAGE_TITLE}</PageTitle>
            <Badge variant="secondary">{entriesSnapshot.length}</Badge>
          </HStack>
          <HStack gap={12}>
            <Button variant="primary" onMouseDown={(e) => { e.preventDefault(); setOpenDialog(true); }}>
              <Funnel size={16} /> Importar DANFE / PDF
            </Button>
          </HStack>
        </PageHeader>

        {/* Search */}
        <HStack gap={12} style={{ marginBottom: 16 }}>
          <SearchInput
            value={searchText}
            placeholder="Buscar por Nº NF-e, emitente, destinatário…"
            onChange={(e) => setSearchText(e.target.value)}
            onClear={() => setSearchText("")}
            aria-label="Buscar entradas"
          />
          <Button variant="subtle" color={showEntriesWithSearch ? "blue" : "gray"} onMouseDown={(e) => { e.preventDefault(); toggleShowEntriesWithSearch(); }}>
            {showEntriesWithSearch ? "Limpar filtro" : "Filtro"}
          </Button>
        </HStack>

        {/* List */}
        {renderEntriesList(filteredEntries)}

        {/* Recent documents */}
        {renderRecentDocuments()}
      </VStack>
    );
  };

  return (
    <>
      <PageBreadcrumbs>
        <PageBreadcrumbs.Item>NF-e</PageBreadcrumbs.Item>
      </PageBreadcrumbs>

      <div style={{ padding: 24 }}>
        {renderContent()}
      </div>

      {/* ───────── DanfeImportDialog ───────── */}
      <DanfeImportDialog
        {...dialogProps}
        // Override the recipe's renderContent to wire the review table inside.
        // We can't easily inject because the recipe renders its own content, but
        // the recipe expects to be the sole renderer. We instead use a wrapper
        // pattern: a custom step renderer inside the recipe; however the recipe
        // as exported earlier does not expose step renderers externally.
        // So this file's usage of DanfeImportDialog alone is acceptable when
        // the recipe drives the whole flow. For extra control, see the
        // NfeReviewTable in the `onNfeData` completed path.
      />

      {/* ───────── Review step modal (custom wiring to mount after DanfeImportDialog) ───────── */}
      {openDialog && step.stage === "reviewing-content" && nfeFields && (
        <Dialog
          open={true}
          onOpenChange={(v) => { if (!v) { setOpenDialog(false); } }}
          closeOnEsc
          closeOnOverlayClick
        >
          <DialogTitle>Conferência de NF-e</DialogTitle>
          <DialogDescription>Revise os dados extraídos antes de confirmar.</DialogDescription>
          <DialogContent>
            <NfeReviewTable {...reviewProps} />
          </DialogContent>
          <DialogFooter>
            <DialogClose as={Button} variant="subtle" color="gray">
              Voltar
            </DialogClose>
            <Button
              variant="primary"
              onMouseDown={(e) => { e.preventDefault(); handleReviewContinue(); }}
              disabled={!nfeFields?.accessKey || !nfeFields?.nfeNumber}
            >
              Confirmar importação
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      {/* ───────── Remove entry confirm ───────── */}
      <Dialog
        open={showConfirmRemove}
        onOpenChange={(v) => { setShowConfirmRemove(v); if (!v) setSelectedEntryToRemove(null); }}
        closeOnEsc
        closeOnOverlayClick={false}
      >
        <DialogTitle>Confirmar exclusão</DialogTitle>
        <DialogDescription>
          Tem certeza que deseja excluir esta entrada? Esta ação não pode ser desfeita.
        </DialogDescription>
        <DialogContent>
          <VStack gap={12} align="stretch">
            <Text>Nº NF-e: {selectedEntryToRemove?.nfeNumber}</Text>
            <Text>Emitente: {selectedEntryToRemove?.emitentLegalName}</Text>
            <Text>CNPJ: {selectedEntryToRemove?.emitentCnpj}</Text>
          </VStack>
        </DialogContent>
        <DialogFooter>
          <DialogClose as={Button} variant="subtle" color="gray">Cancelar</DialogClose>
          <Button variant="primary" color="red" onMouseDown={(e) => {
            e.preventDefault();
            // In a full version we would delete via service.
            toast.success("Entrada removida (simulação).");
            setShowConfirmRemove(false);
            setSelectedEntryToRemove(null);
            loadEntries();
          }}>
            Excluir
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ───────── Snackbars ───────── */}
      <ClassNotFoundSnackbar
        className={snackClassNotFound ?? undefined}
        onClose={() => setSnackClassNotFound(null)}
      />
      <CodeTemplate
        className={snackCodeTemplate ?? undefined}
        onClose={() => setSnackCodeTemplate(null)}
      />
    </>
  );
}

export default EntriesPage;
