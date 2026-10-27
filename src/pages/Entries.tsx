"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ClipboardCopy } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { SearchInput } from "@/components/SearchInput";
import { FileUpload } from "@/components/FileUpload";
import { SupplierForm } from "@/components/SupplierForm";
import { NewEntryItemsEditor } from "@/components/NewEntryItemsEditor";
import { NfeReviewTable, type NfeReviewProduct, type NfeReviewRow } from "@/components/NfeReviewTable";
import {
  DanfeImportDialog,
  type DanfeImportResult,
} from "@/components/DanfeImportDialog";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import {
  digitsOnly,
  formatAccessKeyGrouped,
  formatAccessKeyPrint,
  formatCnpj,
  formatCurrency,
  formatIsoDateBrazilian,
} from "@/lib/br-validators";
import { validateAccessKey44 } from "@/lib/danfe-ocr";
import type { NfeData, NfeItem, SupplierForMatch } from "@/lib/nfe";
import {
  buildEntryDraftFromNfe,
  canContinueNfeReview,
  findDuplicateEntry,
  findSupplierMatch,
  parseNfeXml,
  reconcileNfeReviewMatches,
} from "@/lib/nfe";

/** Data do estoque de implantação (carga inicial do SIGESGD). */
const IMPLEMENTATION_STOCK_DATE = "2026-09-01";

const EMPTY_NFE: NfeData = {
  accessKey: "",
  number: "",
  series: "",
  emissionDate: "",
  items: [],
};

type FileId = { name: string; storageId: string };

const emptyDraftItem = () => ({
  productId: "",
  quantity: 1,
  unitOfMeasure: "un",
  unitCost: "",
  brand: "",
  model: "",
  specification: "",
  locationId: "",
  photoStorageId: "",
  supplierLotNumber: "",
});

type DraftItem = ReturnType<typeof emptyDraftItem>;

/**
 * Upload do documento original pelo MESMO mecanismo já usado pelo XML da NF-e
 * (generateUploadUrl() do Convex Storage) — sem mecanismo paralelo.
 */
async function uploadToStorage(
  generateUploadUrl: () => Promise<string>,
  file: File,
  contentType?: string,
): Promise<string> {
  const url = await generateUploadUrl();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType ?? file.type ?? "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw new Error("Falha no upload");
  const payload = (await response.json()) as { storageId: string };
  return payload.storageId;
}

function isImplementationStock(receivedAt?: number | null): boolean {
  if (typeof receivedAt !== "number" || !isFinite(receivedAt)) return false;
  return new Date(receivedAt).toISOString().slice(0, 10) <= IMPLEMENTATION_STOCK_DATE;
}

function SupplierSelectValue({
  supplier,
}: {
  supplier: { legalName: string; cnpj?: string | null };
}) {
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="min-w-0 truncate">{supplier.legalName}</span>
      <span className="text-xs text-muted-foreground">CNPJ {formatCnpj(supplier.cnpj)}</span>
    </span>
  );
}

function SupplierPicker({
  value,
  onChange,
  suppliers,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  suppliers: Array<{ _id: string; legalName: string; cnpj?: string | null }>;
}) {
  const selected = suppliers.find((s) => s._id === value) ?? null;
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(next) => onChange(next === "none" ? null : next)}
    >
      <SelectTrigger className="mt-1 h-10 w-full min-w-0 max-w-full">
        <SelectValue placeholder="Selecionar fornecedor">
          {selected ? <SupplierSelectValue supplier={selected} /> : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Selecionar fornecedor</SelectItem>
        {suppliers.map((s) => (
          <SelectItem key={s._id} value={s._id} textValue={s.legalName}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{s.legalName}</span>
              <span className="text-xs text-muted-foreground">{`CNPJ: ${formatCnpj(s.cnpj)}`}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FieldRow({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
      <Label className="text-muted-foreground flex items-center gap-1">
        {label}
        {tooltip ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="cursor-help rounded-full px-1 text-[10px] text-muted-foreground"
                  aria-label={tooltip}
                >
                  ?
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </Label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-36 mb-2" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-64" />
        </div>
        <Skeleton className="h-10 max-w-md" />
        <Card className="border-border/50">
          <CardContent className="p-0">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-4 p-4 border-b border-border/30 last:border-b-0"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

const OCR_ORIGIN_NOTE = "Dados extraídos por OCR de DANFE/PDF/imagem — conferir antes de confirmar.";

export function EntriesPage({ className }: { className?: string }) {
  const entries = useQuery(api.entries.list);
  const suppliers = useQuery(api.suppliers.list);
  const products = useQuery(api.products.listActive);
  const locations = useQuery(api.storageLocations.listActive);
  const areas = useQuery(api.stockAreas.listActive);
  const nfeAliases = useQuery(api.nfeProductAliases.list);

  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const createEntry = useMutation(api.entries.create);
  const confirmEntry = useMutation(api.entries.confirm);

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [xmlOpen, setXmlOpen] = useState(false);
  const [danfeOpen, setDanfeOpen] = useState(false);
  const [nfeOpen, setNfeOpen] = useState(false);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  // ── formulário manual (rascunho) ──
  const [cInvoiceNumber, setCInvoiceNumber] = useState("");
  const [cSeries, setCSeries] = useState("001");
  const [cInvoiceDate, setCInvoiceDate] = useState("");
  const [cSupplierId, setcSupplierId] = useState<string | null>(null);
  const [cAreaId, setCAreaId] = useState("");
  const [cObservation, setCObservation] = useState("");
  const [cAfNumber, setCAfNumber] = useState("");
  const [cProcessNumber, setCProcessNumber] = useState("");
  const [cEmpenhoNumber, setCEmpenhoNumber] = useState("");
  const [cItems, setCItems] = useState<DraftItem[]>([emptyDraftItem()]);

  // ── cadastro inline de fornecedor (formulário único) ──
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierCnpj, setNewSupplierCnpj] = useState("");

  // ── conferência da NF-e (XML ou DANFE/OCR) ──
  const [nfe, setNfe] = useState<NfeData>(EMPTY_NFE);
  const [nfeSourceLabel, setNfeSourceLabel] = useState("NF-e");
  const [nfeSupplierId, setNfeSupplierId] = useState<string | null>(null);
  const [nfeAccessKey, setNfeAccessKey] = useState("");
  const [nfeAfNumber, setNfeAfNumber] = useState("");
  const [nfeProcessNumber, setNfeProcessNumber] = useState("");
  const [nfeEmpenhoNumber, setNfeEmpenhoNumber] = useState("");
  const [nfeObservation, setNfeObservation] = useState("");
  const [nfeItems, setNfeItems] = useState<NfeReviewRow[]>([]);
  const [nfeDocumentFile, setNfeDocumentFile] = useState<File | null>(null);
  const [nfeXmlFile, setNfeXmlFile] = useState<File | null>(null);

  const supplierOptions = suppliers ?? [];
  const productOptions = (products ?? []) as NfeReviewProduct[];
  const locationOptions = locations ?? [];
  const nfeSupplier = supplierOptions.find((s) => s._id === nfeSupplierId) ?? null;

  // ── Conferência da chave de acesso (44 dígitos + dígito verificador) ─────
  const nfeAccessKeyDigits = digitsOnly(nfeAccessKey);
  const nfeAccessKeyValid = validateAccessKey44(nfeAccessKey);
  const buildReviewRows = (items: NfeItem[]): NfeReviewRow[] =>
    items.map((item) => ({
      item,
      productId: "",
      matchStatus: "not_found" as const,
      matchScore: 0,
      associationType: "automatic" as const,
    }));

  // Reaplica o matching sempre que catálogo/aliases/fornecedor mudam.
  useEffect(() => {
    if (!nfe || !products) return;
    setNfeItems((current) =>
      reconcileNfeReviewMatches(current, productOptions, {
        supplierId: nfeSupplierId,
        aliases: nfeAliases ?? [],
      }),
    );
  }, [nfe, products, nfeAliases, nfeSupplierId, productOptions]);

  const resetCreateForm = useCallback(() => {
    setCInvoiceNumber("");
    setCSeries("001");
    setCInvoiceDate("");
    setcSupplierId(null);
    setCAreaId("");
    setCObservation("");
    setCAfNumber("");
    setCProcessNumber("");
    setCEmpenhoNumber("");
    setCItems([emptyDraftItem()]);
  }, []);

  const handleSupplierCreated = useCallback((newId: string) => {
    setcSupplierId(newId);
    setNfeSupplierId(newId);
    setSupplierFormOpen(false);
    setNewSupplierName("");
    setNewSupplierCnpj("");
    toast.success("Fornecedor criado e selecionado");
  }, []);

  const openSupplierCreateFromNfe = () => {
    setNewSupplierName(nfe.emitterName ?? "");
    setNewSupplierCnpj(nfe.emitterCnpj ?? "");
    setSupplierFormOpen(true);
  };

  const handleUpdateDraftItem = (index: number, field: string, value: string) => {
    setCItems((current) =>
      current.map((item, position) =>
        position === index
          ? { ...item, [field]: field === "quantity" ? Number(value) || 0 : value }
          : item,
      ),
    );
  };

  const handleXmlInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void handleNfeFile(file);
  };

  const handleNfeFile = async (file: File) => {
    try {
      const parsed = parseNfeXml(await file.text());
      setNfe(parsed);
      setNfeSourceLabel("XML");
      setNfeAccessKey(parsed.accessKey ?? "");
      setNfeAfNumber(parsed.afNumber ?? "");
      setNfeProcessNumber(parsed.processNumber ?? "");
      setNfeEmpenhoNumber(parsed.empenhoNumber ?? "");
      setNfeObservation("");
      setNfeItems(buildReviewRows(parsed.items));
      setNfeXmlFile(file);
      setNfeDocumentFile(null);

      const duplicate = findDuplicateEntry(entries ?? [], {
        accessKey: digitsOnly(parsed.accessKey ?? ""),
      });
      if (duplicate) {
        toast.error(
          `Esta NF-e já está cadastrada no SIGESGD (entrada ${duplicate.entryNumber}). Confira antes de seguir.`,
        );
      }

      const match = findSupplierMatch(parsed, supplierOptions as SupplierForMatch[]);
      setNfeSupplierId(match.found && match.supplierId ? match.supplierId : null);
      setXmlOpen(false);
      setNfeOpen(true);
    } catch {
      toast.error("Não foi possível interpretar o XML da NF-e.");
    }
  };

  const handleDanfeImport = (result: DanfeImportResult) => {
    const imported: NfeData = {
      accessKey: digitsOnly(result.accessKey ?? ""),
      number: result.nfeNumber ?? "",
      series: result.series ?? "",
      emissionDate: result.emissionDate ?? "",
      emitterCnpj: result.emitterCnpj,
      emitterName: result.emitterName,
      totalValue: result.totalValue,
      afNumber: result.afNumber,
      processNumber: result.processNumber,
      empenhoNumber: result.empenhoNumber,
      items: (result.items ?? []).map((item, index) => ({
        lineNumber: item.index ?? index + 1,
        code: item.code,
        description: item.description,
        ncm: item.ncm,
        cst: item.cst,
        unit: item.unit,
        quantity: item.quantity,
        unitValue: item.unitValue,
        totalValue: item.totalValue,
      })),
    };

    setNfe(imported);
    setNfeSourceLabel("DANFE/OCR");
    setNfeAccessKey(imported.accessKey);
    setNfeAfNumber(imported.afNumber ?? "");
    setNfeProcessNumber(imported.processNumber ?? "");
    setNfeEmpenhoNumber(imported.empenhoNumber ?? "");
    setNfeObservation(OCR_ORIGIN_NOTE);
    setNfeItems(buildReviewRows(imported.items));
    // O arquivo original (PDF/imagen) já chegou via onFile durante a leitura
    // no diálogo — aqui só trocamos a origem (DANFE/OCR no lugar do XML).
    setNfeXmlFile(null);

    const duplicate = findDuplicateEntry(entries ?? [], {
      accessKey: imported.accessKey,
    });
    if (duplicate) {
      toast.error(`Esta NF-e já está cadastrada no SIGESGD (entrada ${duplicate.entryNumber}).`);
    }

    const match = findSupplierMatch(imported, supplierOptions as SupplierForMatch[]);
    if (result.supplierId) setNfeSupplierId(result.supplierId);
    else setNfeSupplierId(match.found && match.supplierId ? match.supplierId : null);

    setDanfeOpen(false);
    setNfeOpen(true);
  };

  /** Copia a chave COMPLETA: 44 dígitos crus, sem agrupamento e sem reticências. */
  const handleCopyAccessKey = async () => {
    if (!nfeAccessKeyDigits) {
      toast.error("Não há chave de acesso para copiar — informe os 44 dígitos lidos na DANFE.");
      return;
    }
    try {
      await navigator.clipboard.writeText(nfeAccessKeyDigits);
      toast.success(
        `Chave de acesso copiada (${nfeAccessKeyDigits.length} dígitos, sem formatação).`,
      );
    } catch {
      toast.error("Não foi possível copiar. Selecione o valor manualmente.");
    }
  };

  const handleReviewContinue = () => {
    if (!canContinueNfeReview(nfeItems)) {
      toast.error(
        "Itens sem produto associado ficam pendentes — associe todos os itens antes de confirmar.",
      );
      return;
    }
    toast.info("Associações conferidas — revise os identificadores fiscais e confirme a entrada.");
  };

  const handleConfirmImport = async () => {
    if (nfe.items.length === 0) {
      toast.error("A entrada precisa de pelo menos um item identificado.");
      return;
    }
    if (!canContinueNfeReview(nfeItems)) {
      toast.error("Itens sem produto associado ficam pendentes — associe todos os itens.");
      return;
    }

    try {
      let documentStorageId: string | undefined;
      if (nfeDocumentFile) {
        try {
          documentStorageId = await uploadToStorage(
            generateUploadUrl,
            nfeDocumentFile,
            nfeDocumentFile.type || "application/pdf",
          );
        } catch {
          toast.error("Falha ao salvar o DANFE original — a entrada segue sem o anexo.");
        }
      }

      let xmlStorageId: string | undefined;
      if (nfeXmlFile) {
        try {
          const contentType = nfeXmlFile.type || "application/xml";
          xmlStorageId = await uploadToStorage(generateUploadUrl, nfeXmlFile, contentType);
        } catch {
          toast.error("Falha ao salvar o XML original — a entrada segue sem o anexo.");
        }
      }

      const draft = buildEntryDraftFromNfe(
        nfe,
        nfeItems.map((row) => ({
          productId: row.productId,
          locationId: row.locationId,
          supplierLotNumber: row.supplierLot,
          matchSource: row.matchSource,
          matchScore: row.matchScore,
          associationType: row.associationType,
        })),
        {
          supplierId: nfeSupplierId ?? undefined,
          observation: nfeObservation || undefined,
          documentStorageId,
          xmlStorageId,
        },
      );

      const entryId = await createEntry({
        receivedAt: Date.now(),
        originType: "purchase",
        supplierId: nfeSupplierId ? (nfeSupplierId as Id<"suppliers">) : undefined,
        invoiceNumber: draft.invoiceNumber || undefined,
        invoiceDate: draft.invoiceDate,
        purchaseAuthorizationNumber: nfeAfNumber || undefined,
        processNumber: nfeProcessNumber || undefined,
        empenhoNumber: nfeEmpenhoNumber || undefined,
        accessKey: draft.accessKey,
        series: draft.series,
        totalValue: draft.totalValue,
        documentStorageId: draft.documentStorageId,
        xmlStorageId: draft.xmlStorageId,
        importedFromXml: nfeSourceLabel === "XML",
        observation: draft.observation,
        items: draft.items.map((item) => ({
          ...item,
          productId: item.productId as Id<"products">,
          locationId: item.locationId as Id<"storageLocations"> | undefined,
        })),
      });

      // Efetivação: a entrada só vira estoque/lotes após confirmação explícita.
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada confirmada: estoque e lotes atualizados.");
      setNfeOpen(false);
      setNfe(EMPTY_NFE);
      setNfeItems([]);
      setNfeDocumentFile(null);
      setNfeXmlFile(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao registrar a entrada.");
    }
  };

  const handleCreateDraft = async () => {
    const items = cItems.filter((item) => item.productId);
    if (items.length === 0) {
      toast.error("Adicione pelo menos um item à entrada.");
      return;
    }

    try {
      const entryId = await createEntry({
        receivedAt: cInvoiceDate
          ? new Date(`${cInvoiceDate}T12:00:00`).getTime() || Date.now()
          : Date.now(),
        originType: "purchase",
        supplierId: cSupplierId ? (cSupplierId as Id<"suppliers">) : undefined,
        invoiceNumber: cInvoiceNumber || undefined,
        invoiceDate: cInvoiceDate || undefined,
        series: cSeries || undefined,
        purchaseAuthorizationNumber: cAfNumber || undefined,
        processNumber: cProcessNumber || undefined,
        empenhoNumber: cEmpenhoNumber || undefined,
        areaId: cAreaId ? (cAreaId as Id<"stockAreas">) : undefined,
        observation: cObservation || undefined,
        items: items.map((item) => ({
          productId: item.productId as Id<"products">,
          quantity: Number(item.quantity) || 0,
          unitOfMeasure: item.unitOfMeasure,
          unitCost: Number(item.unitCost) || undefined,
          brand: item.brand || undefined,
          model: item.model || undefined,
          specification: item.specification || undefined,
          locationId: item.locationId ? (item.locationId as Id<"storageLocations">) : undefined,
          photoStorageId: item.photoStorageId || undefined,
          supplierLotNumber: item.supplierLotNumber || undefined,
        })),
      });
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada registrada e estoque atualizado.");
      resetCreateForm();
      setCreateOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao registrar a entrada.");
    }
  };

  const confirmDraft = async (entryId: Id<"entries">) => {
    try {
      await confirmEntry({ entryId });
      toast.success("Entrada confirmada: estoque e lotes atualizados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao confirmar a entrada.");
    }
  };

  if (entries === undefined) return <LoadingSkeleton />;

  const term = search.trim().toLowerCase();
  const filteredEntries = (entries ?? []).filter((entry) => {
    if (!term) return true;
    const supplierName = entry.supplier?.legalName?.toLowerCase() ?? "";
    return (
      entry.entryNumber.toLowerCase().includes(term) ||
      supplierName.includes(term) ||
      (entry.invoiceNumber ?? "").toLowerCase().includes(term) ||
      (entry.accessKey ?? "").includes(term)
    );
  });

  return (
    <AppShell>
      <div className={cn("space-y-6 max-w-7xl mx-auto", className)}>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Entradas</h1>
            <p className="text-sm text-muted-foreground">
              {entries.length} entrada(s) — XML, DANFE/OCR ou manual, sempre com conferência antes
              de afetar o estoque
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setXmlOpen(true)}>
              Importar NF-e XML
            </Button>
            <Button variant="outline" onClick={() => setDanfeOpen(true)}>
              Importar DANFE / PDF / Imagem
            </Button>
            <Button onClick={() => setCreateOpen(true)}>Nova Entrada</Button>
          </div>
        </header>

        <div className="relative">
          <SearchInput
            placeholder="Buscar por entrada, fornecedor, NF-e ou chave de acesso..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-md"
          />
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entrada</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>NF-e / Série</TableHead>
                    <TableHead>Recebida em</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry._id}>
                      <TableCell className="font-medium">{entry.entryNumber}</TableCell>
                      <TableCell className="min-w-0 max-w-full overflow-hidden">
                        <span className="block min-w-0 truncate">
                          {entry.supplier?.legalName ?? "—"}
                        </span>
                        {entry.supplier?.cnpj ? (
                          <span className="text-xs text-muted-foreground">{`CNPJ: ${formatCnpj(entry.supplier.cnpj)}`}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {entry.invoiceNumber ?? "—"}
                        {entry.series ? ` / ${entry.series}` : ""}
                      </TableCell>
                      <TableCell>{new Date(entry.receivedAt).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-right">{entry.items?.length ?? 0}</TableCell>
                      <TableCell className="text-right">
                        {entry.totalValue ? formatCurrency(entry.totalValue) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge
                            variant={entry.status === "confirmed" ? "default" : "secondary"}
                            className="text-[10px]"
                          >
                            {entry.status === "confirmed" ? "Confirmada" : "Rascunho"}
                          </Badge>
                          {isImplementationStock(entry.receivedAt) ? (
                            <Badge variant="outline" className="text-[10px]">
                              Estoque de implantação
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {entry.status === "draft" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => void confirmDraft(entry._id)}
                          >
                            Confirmar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <div className="py-10 text-center text-sm text-muted-foreground">
                          Nenhuma entrada encontrada.
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Entrada manual ── */}
      <Dialog
        open={createOpen}
        onOpenChange={(value) => {
          setCreateOpen(value);
          if (!value) resetCreateForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova Entrada</DialogTitle>
            <DialogDescription>
              Registro manual com conferência dos itens antes de afetar o estoque.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FieldRow label="Nº Nota Fiscal">
              <Input
                className="min-w-0 flex-1"
                value={cInvoiceNumber}
                onChange={(event) => setCInvoiceNumber(event.target.value)}
                placeholder="000002967"
              />
            </FieldRow>
            <FieldRow label="Série">
              <Input
                className="min-w-0 flex-1"
                value={cSeries}
                onChange={(event) => setCSeries(event.target.value)}
                placeholder="001"
              />
            </FieldRow>
            <FieldRow
              label="Data de emissão da NF-e"
              tooltip="Data em que a NF-e foi emitida pelo fornecedor."
            >
              <Input
                type="date"
                className="min-w-0 flex-1"
                value={cInvoiceDate}
                onChange={(event) => setCInvoiceDate(event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Fornecedor">
              <SupplierPicker
                value={cSupplierId}
                onChange={setcSupplierId}
                suppliers={supplierOptions}
              />
            </FieldRow>
            <FieldRow label="Área de destino">
              <Select value={cAreaId || "none"} onValueChange={(value) => setCAreaId(value === "none" ? "" : value)}>
                <SelectTrigger className="mt-1 h-10 w-full min-w-0 max-w-full">
                  <SelectValue placeholder="Selecionar área" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem área definida</SelectItem>
                  {(areas ?? []).map((area) => (
                    <SelectItem key={area._id} value={area._id}>
                      {area.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Número da AF">
              <Input
                className="min-w-0 flex-1"
                value={cAfNumber}
                onChange={(event) => setCAfNumber(event.target.value)}
                placeholder="2223/2026"
              />
            </FieldRow>
            <FieldRow label="Número do Processo Administrativo">
              <Input
                className="min-w-0 flex-1"
                value={cProcessNumber}
                onChange={(event) => setCProcessNumber(event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Número do Empenho">
              <Input
                className="min-w-0 flex-1"
                value={cEmpenhoNumber}
                onChange={(event) => setCEmpenhoNumber(event.target.value)}
                placeholder="778/2026"
              />
            </FieldRow>
            <FieldRow label="Observação">
              <Input
                className="min-w-0 flex-1"
                value={cObservation}
                onChange={(event) => setCObservation(event.target.value)}
              />
            </FieldRow>

            <NewEntryItemsEditor
              items={cItems}
              products={productOptions}
              locations={locationOptions}
              onUpdateItem={handleUpdateDraftItem}
              onAddItem={() => setCItems((current) => [...current, emptyDraftItem()])}
              onRemoveItem={(index) =>
                setCItems((current) => current.filter((_, position) => position !== index))
              }
              onNewProduct={() =>
                toast.info("Cadastre o produto em Produtos e retome esta entrada.")
              }
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleCreateDraft()}>Criar entrada</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Importação de XML ── */}
      <Dialog open={xmlOpen} onOpenChange={setXmlOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar NF-e XML</DialogTitle>
            <DialogDescription>
              O XML é o caminho preferencial: campos e itens vêm estruturados no arquivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              ref={xmlInputRef}
              type="file"
              accept="application/xml,.xml"
              className="hidden"
              onChange={handleXmlInputChange}
            />
            <Button variant="outline" onClick={() => xmlInputRef.current?.click()}>
              Selecionar XML da NF-e
            </Button>
            <p className="text-xs text-muted-foreground">
              O arquivo é interpretado localmente e os dados entram na conferência — nada é criado
              sem a sua confirmação.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setXmlOpen(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Leitura de DANFE/PDF/imagem (OCR) — sem nenhuma mutation aqui ── */}
      <DanfeImportDialog
        open={danfeOpen}
        onClose={() => setDanfeOpen(false)}
        suppliers={supplierOptions}
        onImport={handleDanfeImport}
        onFile={(file) => setNfeDocumentFile(file)}
      />

      {/* ── Conferência da NF-e (XML ou DANFE/OCR) ── */}
      <Dialog open={nfeOpen} onOpenChange={setNfeOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Conferir NF-e{nfe.number ? ` ${nfe.number}` : ""}</DialogTitle>
            <DialogDescription>
              {nfeObservation || "Revise os dados e associe os itens a produtos antes de confirmar."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Origem: {nfeSourceLabel}. Nada é criado sem a sua confirmação.
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="min-w-0 max-w-full overflow-hidden">
                <Label className="text-muted-foreground">Número da NF-e</Label>
                <p className="mt-1 text-sm min-w-0 max-w-full overflow-hidden break-words">
                  {nfe.number || "—"}
                </p>
              </div>
              <div className="min-w-0 max-w-full overflow-hidden">
                <Label className="text-muted-foreground">Série</Label>
                <p className="mt-1 text-sm min-w-0 max-w-full overflow-hidden break-words">
                  {nfe.series || "—"}
                </p>
              </div>
              <div className="min-w-0 max-w-full overflow-hidden">
                <Label className="text-muted-foreground">Data de emissão da NF-e</Label>
                <p className="mt-1 text-sm min-w-0 max-w-full overflow-hidden break-words">
                  {nfe.emissionDate
                    ? formatIsoDateBrazilian(nfe.emissionDate)
                    : "—"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Número da AF</Label>
                <Input
                  className="mt-1 h-10 w-full min-w-0 max-w-full"
                  value={nfeAfNumber}
                  onChange={(event) => setNfeAfNumber(event.target.value)}
                />
              </div>
              <div>
                <Label className="text-muted-foreground">Número do Processo Administrativo</Label>
                <Input
                  className="mt-1 h-10 w-full min-w-0 max-w-full"
                  value={nfeProcessNumber}
                  onChange={(event) => setNfeProcessNumber(event.target.value)}
                />
              </div>
              <div>
                <Label className="text-muted-foreground">Número do Empenho</Label>
                <Input
                  className="mt-1 h-10 w-full min-w-0 max-w-full"
                  value={nfeEmpenhoNumber}
                  onChange={(event) => setNfeEmpenhoNumber(event.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-muted-foreground">Fornecedor</Label>
                <SupplierPicker
                  value={nfeSupplierId}
                  onChange={setNfeSupplierId}
                  suppliers={supplierOptions}
                />
                {nfeSupplier ? (
                  // Nome e CNPJ em LINHAS separadas: o CNPJ nunca fica colado
                  // ao nome do fornecedor na conferência (defeito real da
                  // importação DANFE — texto concatenado sem separação visual).
                  <div className="flex min-w-0 flex-col leading-tight">
                    <p className="text-sm min-w-0 max-w-full break-words">
                      Fornecedor identificado: {nfeSupplier.legalName}
                    </p>
                    {nfeSupplier.cnpj ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        CNPJ {formatCnpj(nfeSupplier.cnpj)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        CNPJ pendente de conferência
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-amber-700">Fornecedor não cadastrado</span>
                    <Button type="button" variant="outline" size="sm" onClick={openSupplierCreateFromNfe}>
                      Cadastrar fornecedor
                    </Button>
                  </div>
                )}
              </div>

              <div className="min-w-0 max-w-full overflow-hidden">
                <Label className="text-muted-foreground">Chave de acesso</Label>
                <Input
                  className="mt-1 h-10 w-full min-w-0 max-w-full font-mono"
                  value={nfeAccessKey}
                  onChange={(event) => setNfeAccessKey(digitsOnly(event.target.value).slice(0, 44))}
                  inputMode="numeric"
                  placeholder="Chave pendente de conferência"
                />
                {nfeAccessKeyDigits ? (
                  <>
                    <p
                      className="mt-1 font-mono text-xs break-all text-muted-foreground"
                      aria-label="Chave de acesso completa (44 dígitos)"
                    >
                      {formatAccessKeyGrouped(nfeAccessKeyDigits)}
                    </p>
                    <p
                      className="mt-1 font-mono text-xs break-all text-muted-foreground"
                      aria-label="Chave de acesso no formato impresso na DANFE"
                    >
                      {formatAccessKeyPrint(nfeAccessKeyDigits)}
                    </p>
                  </>
                ) : null}
                <p
                  className={cn(
                    "mt-1 text-xs break-words",
                    nfeAccessKeyValid
                      ? "text-emerald-700"
                      : nfeAccessKeyDigits
                        ? "text-amber-700"
                        : "text-muted-foreground",
                  )}
                >
                  {!nfeAccessKeyDigits
                    ? "Chave pendente de conferência — informe os 44 dígitos lidos na DANFE."
                    : nfeAccessKeyDigits.length !== 44
                      ? `${nfeAccessKeyDigits.length} de 44 dígitos — informe a chave completa lida na DANFE (sem reticências).`
                      : nfeAccessKeyValid
                        ? "44 dígitos e dígito verificador VÁLIDOS — confira o valor impresso na DANFE antes de confirmar."
                        : "44 dígitos informados, mas o dígito verificador NÃO confere — confira a chave impressa na DANFE."}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => void handleCopyAccessKey()}
                  >
                    <ClipboardCopy className="h-3 w-3" /> Copiar chave (44 dígitos)
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {nfeAccessKeyDigits.length} de 44 dígitos
                    {nfeAccessKeyDigits.length === 44
                      ? nfeAccessKeyValid
                        ? " · DV válido"
                        : " · DV inválido"
                      : ""}
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Observação</Label>
                <Input
                  className="mt-1 h-10 w-full min-w-0 max-w-full"
                  value={nfeObservation}
                  onChange={(event) => setNfeObservation(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Itens da NF-e ({nfeItems.length})</h4>
              <NfeReviewTable
                items={nfeItems}
                products={productOptions}
                locations={locationOptions}
                onUpdate={(index, patch) =>
                  setNfeItems((current) =>
                    current.map((row, position) =>
                      position === index ? { ...row, ...patch } : row,
                    ),
                  )
                }
                onNewProduct={() =>
                  toast.info("Cadastre o produto em Produtos e retome esta conferência.")
                }
                onContinue={handleReviewContinue}
                sourceLabel={nfeSourceLabel}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNfeOpen(false)}>
              Cancelar
            </Button>
            <Button variant="outline" onClick={handleReviewContinue}>
              Revisar associações
            </Button>
            <Button onClick={() => void handleConfirmImport()}>Confirmar entrada</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SupplierForm
        open={supplierFormOpen}
        onOpenChange={(value) => {
          setSupplierFormOpen(value);
          if (!value) {
            setNewSupplierName("");
            setNewSupplierCnpj("");
          }
        }}
        mode="create"
        supplierId={null}
        preFilled={
          newSupplierName || newSupplierCnpj
            ? { legalName: newSupplierName, cnpj: newSupplierCnpj }
            : null
        }
        onCreated={handleSupplierCreated}
      />
    </AppShell>
  );
}

export default EntriesPage;
