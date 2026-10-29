import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Copy, Plus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

import {
  DanfeImportDialog,
  type DanfeImportResult,
} from "@/components/DanfeImportDialog";
import { NewEntryItemsEditor } from "@/components/NewEntryItemsEditor";
import {
  NfeReviewTable,
  type NfeReviewProduct,
  type NfeReviewRow,
} from "@/components/NfeReviewTable";
import { QuickProductForm } from "@/components/QuickProductForm";
import { SupplierForm } from "@/components/SupplierForm";

import {
  digitsOnly,
  formatAccessKeyPrint,
  formatCnpj,
  formatCurrency,
  formatIsoDateBrazilian,
} from "@/lib/br-validators";
import { validateAccessKey44 } from "@/lib/danfe-ocr";
import {
  buildEntryDraftFromNfe,
  canContinueNfeReview,
  findDuplicateEntry,
  findSupplierMatch,
  parseNfeXml,
  reconcileNfeReviewMatches,
  type Category,
  type NfeData,
  type NfeItem,
  type ProductForMatch,
} from "@/lib/nfe";
import {
  associateQuickProduct,
  emptyQuickProductForm,
  quickProductPrefill,
  shouldUpsertNfeAlias,
  snapshotReviewRows,
  validateQuickProductForm,
  type QuickProductFormState,
} from "@/lib/quickProduct";
import { useAuth } from "@/hooks/use-auth";

/** Origem DANFE/OCR registrada na entrada confirmada (§15). */
const DANFE_SOURCE_OBSERVATION =
  "Dados extraídos por OCR de DANFE/PDF/imagem — conferir antes de confirmar.";

/** Data-limite da carga inicial de implantação (badge "Estoque de implantação"). */
const IMPLEMENTATION_STOCK_DATE = "2026-09-01";

const EMPTY_NFE: NfeData = {
  accessKey: "",
  number: "",
  series: "",
  emissionDate: "",
  items: [],
};

type SupplierOption = {
  _id: string;
  legalName: string;
  cnpj?: string | null;
};

type ManualEntryItem = {
  productId: string;
  quantity: number;
  unitOfMeasure: string;
  unitCost: string;
  brand: string;
  model: string;
  specification: string;
  locationId: string;
  photoStorageId: string;
  supplierLotNumber: string;
};

const emptyEntryItem = (): ManualEntryItem => ({
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

/** Linhas pendentes de conferência — nenhuma associação inventada. */
const initialReviewRows = (items: NfeItem[]): NfeReviewRow[] =>
  items.map((item) => ({
    item,
    productId: "",
    matchStatus: "not_found" as const,
    matchScore: 0,
    associationType: "automatic" as const,
  }));

function isImplementationStockDate(receivedAt: number): boolean {
  if (typeof receivedAt !== "number" || !isFinite(receivedAt)) return false;
  return (
    new Date(receivedAt).toISOString().slice(0, 10) <= IMPLEMENTATION_STOCK_DATE
  );
}

/** Upload do documento original pelo MESMO mecanismo do XML (storage). */
async function uploadFile(
  generateUploadUrl: () => Promise<string>,
  file: File,
  contentType?: string,
): Promise<string> {
  const url = await generateUploadUrl();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType ?? file.type ?? "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) throw new Error("Falha no upload");
  const payload = (await response.json()) as { storageId: string };
  return payload.storageId;
}

/** Valor selecionado: razão social com truncate + CNPJ no próprio componente. */
function SupplierSelectValue({ supplier }: { supplier: SupplierOption }) {
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="min-w-0 truncate">{supplier.legalName}</span>
      {supplier.cnpj ? (
        <span className="text-xs text-muted-foreground">
          CNPJ {formatCnpj(supplier.cnpj)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          CNPJ pendente de conferência
        </span>
      )}
    </span>
  );
}

function SupplierSelect({
  value,
  onChange,
  suppliers,
}: {
  value: string | null;
  onChange: (supplierId: string | null) => void;
  suppliers: SupplierOption[];
}) {
  const selected = suppliers.find((supplier) => supplier._id === value) ?? null;
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
              <span className="text-xs text-muted-foreground">
                {`CNPJ: ${formatCnpj(s.cnpj)}`}
              </span>
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
  children: ReactNode;
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

function EntriesPageSkeleton() {
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
        <Skeleton className="h-64 w-full" />
      </div>
    </AppShell>
  );
}

function EntriesPage() {
  useAuth();

  const entries = useQuery(api.entries.list);
  const suppliers = useQuery(api.suppliers.list);
  const locations = useQuery(api.storageLocations.listActive);
  const areas = useQuery(api.stockAreas.listActive);
  const nfeAliases = useQuery(api.nfeProductAliases.list);
  const products = useQuery(api.products.listActive) as
    | ProductForMatch[]
    | undefined;
  const categories = useQuery(api.categories.listActive);

  const createProduct = useMutation(api.products.create);
  const createCategory = useMutation(api.categories.create);
  const upsertNfeProductAlias = useMutation(api.nfeProductAliases.upsert);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const createEntry = useMutation(api.entries.create);
  const confirmEntry = useMutation(api.entries.confirm);

  // ── Cadastro rápido de produto (R31 §1) ──
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProductItemIndex, setQuickProductItemIndex] = useState<
    number | null
  >(null);
  const [quickProductForm, setQuickProductForm] =
    useState<QuickProductFormState>(emptyQuickProductForm());
  const [quickProductLoading, setQuickProductLoading] = useState(false);
  const [quickProductSnapshot, setQuickProductSnapshot] = useState<
    NfeReviewRow[]
  >([]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // ── Listagem / diálogos ──
  const [search, setSearch] = useState("");
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [xmlOpen, setXmlOpen] = useState(false);
  const [danfeOpen, setDanfeOpen] = useState(false);
  const [nfeOpen, setNfeOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  // ── Entrada manual ──
  const [nfNumber, setNfNumber] = useState("");
  const [series, setSeries] = useState("001");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [cSupplierId, setcSupplierId] = useState<string | null>(null);
  const [areaId, setAreaId] = useState("");
  const [observation, setObservation] = useState("");
  const [cAfNumber, setCAfNumber] = useState("");
  const [cProcessNumber, setCProcessNumber] = useState("");
  const [cEmpenhoNumber, setCEmpenhoNumber] = useState("");
  const [items, setItems] = useState<ManualEntryItem[]>([emptyEntryItem()]);

  // ── Cadastro inline de fornecedor ──
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierCnpj, setNewSupplierCnpj] = useState("");

  // ── Conferência da NF-e ──
  const [nfe, setNfe] = useState<NfeData>(EMPTY_NFE);
  const [sourceLabel, setSourceLabel] = useState("NF-e");
  const [nfeSupplierId, setNfeSupplierId] = useState<string | null>(null);
  const [nfeAccessKey, setNfeAccessKey] = useState("");
  const [nfeAfNumber, setNfeAfNumber] = useState("");
  const [nfeProcessNumber, setNfeProcessNumber] = useState("");
  const [nfeEmpenhoNumber, setNfeEmpenhoNumber] = useState("");
  const [nfeObservation, setNfeObservation] = useState("");
  const [nfeItems, setNfeItems] = useState<NfeReviewRow[]>([]);
  const [danfeFile, setDanfeFile] = useState<File | null>(null);
  const [nfeXmlFile, setNfeXmlFile] = useState<File | null>(null);

  const supplierList = suppliers ?? [];
  const locationList = locations ?? [];
  const nfeAccessKeyDigits = digitsOnly(nfeAccessKey);
  const nfeAccessKeyValid = validateAccessKey44(nfeAccessKey);
  const nfeSupplier =
    supplierList.find((supplier) => supplier._id === nfeSupplierId) ?? null;

  const productOptions = useMemo(
    () => (products ?? []) as NfeReviewProduct[],
    [products],
  );

  // Rematch reage a DADOS (catálogo/aliases/fornecedor), nunca a renders.
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
    setNfNumber("");
    setSeries("001");
    setInvoiceDate("");
    setcSupplierId(null);
    setAreaId("");
    setObservation("");
    setCAfNumber("");
    setCProcessNumber("");
    setCEmpenhoNumber("");
    setItems([emptyEntryItem()]);
  }, []);

  const handleSupplierCreated = useCallback((newId: string) => {
    setcSupplierId(newId);
    setNfeSupplierId(newId);
    setSupplierOpen(false);
    setNewSupplierName("");
    setNewSupplierCnpj("");
    toast.success("Fornecedor criado e selecionado");
  }, []);

  const handleStartSupplierCreate = () => {
    setNewSupplierName(nfe.emitterName ?? "");
    setNewSupplierCnpj(nfe.emitterCnpj ?? "");
    setSupplierOpen(true);
  };

  const interpretNfeXml = async (file: File) => {
    try {
      const parsed = parseNfeXml(await file.text());
      setNfe(parsed);
      setSourceLabel("XML");
      setNfeAccessKey(digitsOnly(parsed.accessKey ?? ""));
      setNfeAfNumber(parsed.afNumber ?? "");
      setNfeProcessNumber(parsed.processNumber ?? "");
      setNfeEmpenhoNumber(parsed.empenhoNumber ?? "");
      setNfeObservation("");
      setNfeItems(initialReviewRows(parsed.items));
      setNfeXmlFile(file);
      setDanfeFile(null);
      const duplicate = findDuplicateEntry(entries ?? [], {
        accessKey: digitsOnly(parsed.accessKey ?? ""),
      });
      if (duplicate) {
        toast.error(
          `Esta NF-e já está cadastrada no SIGESGD (entrada ${duplicate.entryNumber}). Confira antes de seguir.`,
        );
      }
      const match = findSupplierMatch(parsed, supplierList);
      setNfeSupplierId(match.found && match.supplierId ? match.supplierId : null);
      setXmlOpen(false);
      setNfeOpen(true);
    } catch {
      toast.error("Não foi possível interpretar o XML da NF-e.");
    }
  };

  const handleNfeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void interpretNfeXml(file);
  };

  const handleDanfeImport = (result: DanfeImportResult) => {
    const parsedNfe: NfeData = {
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
    setNfe(parsedNfe);
    setSourceLabel("DANFE/OCR");
    setNfeAccessKey(parsedNfe.accessKey);
    setNfeAfNumber(parsedNfe.afNumber ?? "");
    setNfeProcessNumber(parsedNfe.processNumber ?? "");
    setNfeEmpenhoNumber(parsedNfe.empenhoNumber ?? "");
    setNfeObservation(DANFE_SOURCE_OBSERVATION);
    setNfeItems(initialReviewRows(parsedNfe.items));
    setNfeXmlFile(null);
    const duplicate = findDuplicateEntry(entries ?? [], {
      accessKey: parsedNfe.accessKey,
    });
    if (duplicate) {
      toast.error(
        `Esta NF-e já está cadastrada no SIGESGD (entrada ${duplicate.entryNumber}).`,
      );
    }
    const match = findSupplierMatch(parsedNfe, supplierList);
    setNfeSupplierId(
      result.supplierId
        ? result.supplierId
        : match.found && match.supplierId
          ? match.supplierId
          : null,
    );
    setDanfeOpen(false);
    setNfeOpen(true);
  };

  const handleCopyAccessKey = async () => {
    if (!nfeAccessKeyDigits) {
      toast.error(
        "Não há chave de acesso para copiar — informe os 44 dígitos lidos na DANFE.",
      );
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

  const handleReviewAssociations = () => {
    if (!canContinueNfeReview(nfeItems)) {
      toast.error(
        "Itens sem produto associado ficam pendentes — associe todos os itens antes de confirmar.",
      );
      return;
    }
    toast.info(
      "Associações conferidas — revise os identificadores fiscais e confirme a entrada.",
    );
  };

  const openQuickProductForRow = (index: number) => {
    const row = nfeItems[index];
    if (!row) return;
    setQuickProductSnapshot(snapshotReviewRows(nfeItems));
    setQuickProductItemIndex(index);
    setQuickProductForm(quickProductPrefill(row.item));
    setQuickProductOpen(true);
  };

  const cancelQuickProduct = () => {
    setQuickProductOpen(false);
    setQuickProductItemIndex(null);
    setQuickProductForm(emptyQuickProductForm());
    if (quickProductSnapshot) setNfeItems(quickProductSnapshot);
    setQuickProductSnapshot([]);
  };

  /**
   * Salva o cadastro rápido: cria SOMENTE o registro de catálogo (estoque
   * inicial zero) e associa o id retornado à linha que originou o formulário.
   * Nenhuma entrada, movimentação ou saldo é alterado aqui.
   */
  const handleQuickProductSave = async () => {
    const itemIndex = quickProductItemIndex;
    if (itemIndex == null) {
      toast.error("Sem linha de produto selecionada para salvar.");
      return;
    }
    const validation = validateQuickProductForm(quickProductForm);
    if (!validation.ok) {
      toast.error(validation.error);
      return;
    }
    setQuickProductLoading(true);
    try {
      const productId = await createProduct({
        name: validation.name,
        description: validation.description || undefined,
        categoryId: validation.categoryId as any,
        unitOfMeasure: quickProductForm.unitOfMeasure,
        brand: quickProductForm.brand || undefined,
        model: quickProductForm.model || undefined,
        specification: quickProductForm.specification || undefined,
        minimumStock: 0,
        idealStock: 0,
        maximumStock: 0,
      });

      setNfeItems((current) => associateQuickProduct(current, itemIndex, productId));

      const createdRow = nfeItems[itemIndex];
      if (shouldUpsertNfeAlias(createdRow, nfeSupplierId)) {
        try {
          await upsertNfeProductAlias({
            supplierId: nfeSupplierId as any,
            supplierCode: createdRow?.item.code || undefined,
            description: createdRow?.item.description.trim() ?? "",
            productId: productId as any,
          });
        } catch {
          // Alias é opcional: a falha não desfaz o produto nem a associação.
        }
      }

      toast.success("Produto cadastrado e associado à linha desta NF-e.");
      setQuickProductOpen(false);
      setQuickProductItemIndex(null);
      setQuickProductForm(emptyQuickProductForm());
      setQuickProductSnapshot([]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível cadastrar o produto.",
      );
    } finally {
      setQuickProductLoading(false);
    }
  };

  /** Cria a categoria sem fechar a conferência nem perder o formulário. */
  const handleQuickProductCategorySave = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      toast.error("Informe o nome da categoria.");
      return;
    }
    setQuickProductLoading(true);
    try {
      const categoryId = await createCategory({ name });
      setQuickProductForm((previous) => ({
        ...previous,
        categoryId: categoryId as string,
      }));
      setCategoryOpen(false);
      setNewCategoryName("");
      toast.success(
        "Categoria criada. Use-a para finalizar o cadastro do produto.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível criar a categoria.",
      );
    } finally {
      setQuickProductLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (nfe.items.length === 0) {
      toast.error("A entrada precisa de pelo menos um item identificado.");
      return;
    }
    if (!canContinueNfeReview(nfeItems)) {
      toast.error(
        "Itens sem produto associado ficam pendentes — associe todos os itens.",
      );
      return;
    }
    try {
      let documentStorageId: string | undefined;
      if (danfeFile) {
        try {
          documentStorageId = await uploadFile(
            generateUploadUrl,
            danfeFile,
            danfeFile.type || "application/pdf",
          );
        } catch {
          toast.error("Falha ao salvar o DANFE original — a entrada segue sem o anexo.");
        }
      }
      let xmlStorageId: string | undefined;
      if (nfeXmlFile) {
        try {
          xmlStorageId = await uploadFile(
            generateUploadUrl,
            nfeXmlFile,
            nfeXmlFile.type || "application/xml",
          );
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
        supplierId: (nfeSupplierId || undefined) as any,
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
        importedFromXml: sourceLabel === "XML",
        observation: draft.observation,
        items: draft.items.map((item) => ({
          ...item,
          productId: item.productId as any,
          locationId: item.locationId as any,
        })),
      });
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada confirmada: estoque e lotes atualizados.");
      setNfeOpen(false);
      setNfe(EMPTY_NFE);
      setNfeItems([]);
      setDanfeFile(null);
      setNfeXmlFile(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao registrar a entrada.",
      );
    }
  };

  const handleCreateDraft = async () => {
    const withProduct = items.filter((item) => item.productId);
    if (withProduct.length === 0) {
      toast.error("Adicione pelo menos um item à entrada.");
      return;
    }
    try {
      const entryId = await createEntry({
        receivedAt:
          (invoiceDate && new Date(`${invoiceDate}T12:00:00`).getTime()) ||
          Date.now(),
        originType: "purchase",
        supplierId: (cSupplierId || undefined) as any,
        invoiceNumber: nfNumber || undefined,
        invoiceDate: invoiceDate || undefined,
        series,
        purchaseAuthorizationNumber: cAfNumber || undefined,
        processNumber: cProcessNumber || undefined,
        empenhoNumber: cEmpenhoNumber || undefined,
        areaId: (areaId || undefined) as any,
        observation: observation || undefined,
        items: withProduct.map((item) => ({
          productId: item.productId as any,
          quantity: Number(item.quantity) || 0,
          unitOfMeasure: item.unitOfMeasure,
          unitCost: Number(item.unitCost) || undefined,
          brand: item.brand || undefined,
          model: item.model || undefined,
          specification: item.specification || undefined,
          locationId: (item.locationId || undefined) as any,
          photoStorageId: item.photoStorageId || undefined,
          supplierLotNumber: item.supplierLotNumber || undefined,
        })),
      });
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada registrada e estoque atualizado.");
      resetCreateForm();
      setNewEntryOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao registrar a entrada.",
      );
    }
  };

  const handleConfirmEntry = async (entryId: string) => {
    try {
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada confirmada: estoque e lotes atualizados.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Falha ao confirmar a entrada.",
      );
    }
  };

  const handleManualItemUpdate = (
    index: number,
    field: string,
    value: string,
  ) => {
    setItems((current) =>
      current.map((item, position) =>
        position === index
          ? {
              ...item,
              [field]: field === "quantity" ? Number(value) || 0 : value,
            }
          : item,
      ),
    );
  };

  if (entries === undefined) return <EntriesPageSkeleton />;

  const searchTerm = search.trim().toLowerCase();
  const filteredEntries = (entries ?? []).filter((entry) => {
    if (!searchTerm) return true;
    const supplierName = entry.supplier?.legalName?.toLowerCase() ?? "";
    return (
      entry.entryNumber.toLowerCase().includes(searchTerm) ||
      supplierName.includes(searchTerm) ||
      (entry.invoiceNumber ?? "").toLowerCase().includes(searchTerm) ||
      (entry.accessKey ?? "").includes(searchTerm)
    );
  });

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Entradas</h1>
            <p className="text-sm text-muted-foreground">
              {entries.length} entrada(s) — XML, DANFE/OCR ou manual, sempre com
              conferência antes de afetar o estoque
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setXmlOpen(true)}>
              Importar NF-e XML
            </Button>
            <Button variant="outline" onClick={() => setDanfeOpen(true)}>
              Importar DANFE / PDF / Imagem
            </Button>
            <Button onClick={() => setNewEntryOpen(true)}>Nova Entrada</Button>
          </div>
        </header>

        <div className="relative">
          <Input
            placeholder="Buscar por entrada, fornecedor, NF-e ou chave de acesso..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-md"
          />
        </div>

        <Table className="border-border/50">
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
                    <span className="text-xs text-muted-foreground">
                      {`CNPJ: ${formatCnpj(entry.supplier.cnpj)}`}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {entry.invoiceNumber ?? "—"}
                  {entry.series ? ` / ${entry.series}` : ""}
                </TableCell>
                <TableCell>
                  {new Date(entry.receivedAt).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell className="text-right">
                  {entry.items?.length ?? 0}
                </TableCell>
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
                    {isImplementationStockDate(entry.receivedAt) ? (
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
                      onClick={() => void handleConfirmEntry(entry._id as any)}
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

      {/* ── Entrada manual ── */}
      <Dialog
        open={newEntryOpen}
        onOpenChange={(value) => {
          setNewEntryOpen(value);
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
                value={nfNumber}
                onChange={(event) => setNfNumber(event.target.value)}
                placeholder="000002967"
              />
            </FieldRow>
            <FieldRow label="Série">
              <Input
                className="min-w-0 flex-1"
                value={series}
                onChange={(event) => setSeries(event.target.value)}
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
                value={invoiceDate}
                onChange={(event) => setInvoiceDate(event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Fornecedor">
              <SupplierSelect
                value={cSupplierId}
                onChange={setcSupplierId}
                suppliers={supplierList}
              />
            </FieldRow>
            <FieldRow label="Área de destino">
              <Select value={areaId || "none"} onValueChange={(value) => setAreaId(value === "none" ? "" : value)}>
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
                value={observation}
                onChange={(event) => setObservation(event.target.value)}
              />
            </FieldRow>

            <NewEntryItemsEditor
              items={items}
              products={productOptions}
              locations={locationList}
              onUpdateItem={handleManualItemUpdate}
              onAddItem={() => setItems((current) => [...current, emptyEntryItem()])}
              onRemoveItem={(index) =>
                setItems((current) => current.filter((_, position) => position !== index))
              }
              onNewProduct={() =>
                toast.info("Cadastre o produto em Produtos e retome esta entrada.")
              }
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setNewEntryOpen(false);
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
              O XML é o caminho preferencial: campos e itens vêm estruturados no
              arquivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              ref={xmlInputRef}
              type="file"
              accept="application/xml,.xml"
              className="hidden"
              onChange={handleNfeFile}
            />
            <Button variant="outline" onClick={() => xmlInputRef.current?.click()}>
              Selecionar XML da NF-e
            </Button>
            <p className="text-xs text-muted-foreground">
              O arquivo é interpretado localmente e os dados entram na conferência —
              nada é criado sem a sua confirmação.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setXmlOpen(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Leitura de DANFE/PDF/imagem ── */}
      <DanfeImportDialog
        open={danfeOpen}
        onClose={() => setDanfeOpen(false)}
        suppliers={supplierList}
        onImport={handleDanfeImport}
        onFile={setDanfeFile}
      />

      {/* ── Conferência da NF-e ── */}
      {nfeOpen ? (
        <Dialog
          open={nfeOpen}
          onOpenChange={(value) => {
            if (value) setNfeOpen(true);
            else setNfeOpen(false);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                Conferir NF-e{nfe.number ? ` ${nfe.number}` : ""}
              </DialogTitle>
              <DialogDescription>
                {nfeObservation ||
                  "Revise os dados e associe os itens a produtos antes de confirmar."}
              </DialogDescription>
            </DialogHeader>

            {nfe.items.length > 0 &&
            (nfe.items[0].ncm !== undefined || nfe.items[0].cst != null) ? (
              <div className="flex flex-wrap gap-2">
                {nfe.items[0].ncm !== undefined ? (
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    NCM {nfe.items[0].ncm}
                  </Badge>
                ) : null}
                {nfe.items[0].cst != null ? (
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    CST {nfe.items[0].cst}
                  </Badge>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Origem: {sourceLabel}. Nada é criado sem a sua confirmação.
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
                  <Label className="text-muted-foreground">
                    Data de emissão da NF-e
                  </Label>
                  <p className="mt-1 text-sm min-w-0 max-w-full overflow-hidden break-words">
                    {formatIsoDateBrazilian(nfe.emissionDate)}
                  </p>
                </div>

                <div className="col-span-1 sm:col-span-3">
                  <Label className="text-muted-foreground">
                    Identificadores fiscais
                  </Label>
                  <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 max-w-full overflow-hidden">
                      <span className="text-xs text-muted-foreground">
                        Itens da nota:
                      </span>
                      <p className="font-mono font-medium">{nfe.items.length}</p>
                    </div>
                    <div className="min-w-0 max-w-full overflow-hidden">
                      <span className="text-xs text-muted-foreground">
                        Código do item (fornecedor):
                      </span>
                      <p className="font-mono font-medium break-all">
                        {nfe.items[0]?.code || "—"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 max-w-full overflow-hidden">
                  <Label className="text-muted-foreground">Número da AF</Label>
                  <Input
                    className="mt-1 h-10 w-full min-w-0 max-w-full"
                    value={nfeAfNumber}
                    onChange={(event) => setNfeAfNumber(event.target.value)}
                  />
                </div>
                <div className="min-w-0 max-w-full overflow-hidden">
                  <Label className="text-muted-foreground">
                    Número do Processo Administrativo
                  </Label>
                  <Input
                    className="mt-1 h-10 w-full min-w-0 max-w-full"
                    value={nfeProcessNumber}
                    onChange={(event) => setNfeProcessNumber(event.target.value)}
                  />
                </div>
                <div className="min-w-0 max-w-full overflow-hidden">
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
                  <SupplierSelect
                    value={nfeSupplierId}
                    onChange={setNfeSupplierId}
                    suppliers={supplierList}
                  />
                  {nfeSupplier ? (
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
                      <span className="text-sm text-amber-700">
                        Fornecedor não cadastrado
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleStartSupplierCreate}
                      >
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
                    onChange={(event) =>
                      setNfeAccessKey(digitsOnly(event.target.value).slice(0, 44))
                    }
                    inputMode="numeric"
                    placeholder="Chave pendente de conferência"
                  />
                  {nfeAccessKeyDigits ? (
                    <p
                      className="mt-1 font-mono text-xs break-all text-muted-foreground"
                      aria-label="Chave de acesso no formato impresso na DANFE"
                    >
                      {nfeAccessKeyDigits.length === 44
                        ? formatAccessKeyPrint(nfeAccessKeyDigits)
                        : nfeAccessKeyDigits}
                    </p>
                  ) : null}
                  <p
                    className={`mt-1 text-xs break-words ${
                      nfeAccessKeyValid
                        ? "text-emerald-700"
                        : nfeAccessKeyDigits
                          ? "text-amber-700"
                          : "text-muted-foreground"
                    }`}
                  >
                    {nfeAccessKeyDigits
                      ? nfeAccessKeyDigits.length !== 44
                        ? `${nfeAccessKeyDigits.length} de 44 dígitos — informe a chave completa lida na DANFE.`
                        : nfeAccessKeyValid
                          ? "44 dígitos e dígito verificador VÁLIDOS — confira o valor impresso na DANFE antes de confirmar."
                          : "44 dígitos informados, mas o dígito verificador NÃO confere — confira a chave impressa na DANFE."
                      : "Chave pendente de conferência — informe os 44 dígitos lidos na DANFE."}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => void handleCopyAccessKey()}
                    >
                      <Copy className="h-3 w-3" /> Copiar chave (44 dígitos)
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

                <div className="min-w-0 max-w-full overflow-hidden">
                  <Label className="text-muted-foreground">Observação</Label>
                  <Input
                    className="mt-1 h-10 w-full min-w-0 max-w-full"
                    value={nfeObservation}
                    onChange={(event) => setNfeObservation(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">
                  Itens da NF-e ({nfeItems.length})
                </h4>
                <NfeReviewTable
                  items={nfeItems}
                  products={productOptions}
                  locations={locationList}
                  onUpdate={(index, patch) =>
                    setNfeItems((current) =>
                      current.map((row, position) =>
                        position === index ? { ...row, ...patch } : row,
                      ),
                    )
                  }
                  onNewProduct={openQuickProductForRow}
                  onContinue={handleReviewAssociations}
                  sourceLabel={sourceLabel}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-8"
                  onClick={() => {
                    const firstPending = nfeItems.findIndex(
                      (row) => row.matchStatus !== "found",
                    );
                    openQuickProductForRow(firstPending >= 0 ? firstPending : 0);
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Cadastrar novo produto
                </Button>

                {quickProductOpen && quickProductItemIndex != null ? (
                  <QuickProductForm
                    open={quickProductOpen}
                    onClose={cancelQuickProduct}
                    onOpenChange={(value) => {
                      if (value) {
                        setQuickProductOpen(true);
                      } else cancelQuickProduct();
                    }}
                    targetIndex={quickProductItemIndex}
                    form={quickProductForm}
                    onFormChange={(patch) =>
                      setQuickProductForm((previous) => ({ ...previous, ...patch }))
                    }
                    loading={quickProductLoading}
                    categories={categories ?? []}
                    onSave={handleQuickProductSave}
                    onCancel={cancelQuickProduct}
                    onCreateCategory={handleQuickProductCategorySave}
                    newCategoryName={newCategoryName}
                    onNewCategoryNameChange={setNewCategoryName}
                    categoryOpen={categoryOpen}
                    onCategoryOpenChange={(value) => {
                      setCategoryOpen(value);
                      if (!value) setNewCategoryName("");
                    }}
                  />
                ) : null}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-3">
              <Button variant="outline" onClick={() => setNfeOpen(false)}>
                Cancelar
              </Button>
              <Button variant="outline" onClick={handleReviewAssociations}>
                Revisar associações
              </Button>
              <Button onClick={() => void handleConfirmImport()}>
                Confirmar entrada
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* ── Cadastro inline de fornecedor (mesmo formulário completo) ── */}
      <SupplierForm
        open={supplierOpen}
        onOpenChange={setSupplierOpen}
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
