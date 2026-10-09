/**
 * Gestão de Estoque SGGD — Telas de Entradas.
 *
 * Fluxos atendidos:
 *  • XML (preferencial): upload do XML original + parse + conferência;
 *  • DANFE/PDF/imagem: OCR local no navegador → conferência;
 *  • Entrada manual: formulário completo, sem nenhum documento.
 *
 * Dados de produção (estoque, lotes, movimentos, NF-e, entradas, fornecedores,
 * organizações, usuários, permissões e RBAC) são editados apenas na tela de
 * conferência — a efetivação de entrada é sempre um comando explícito do
 * usuário após conferência (entries.create + entries.confirm).
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchInput } from "@/components/SearchInput";
import { NewEntryItemsEditor } from "@/components/NewEntryItemsEditor";
import { EntryDetailsDialog } from "@/components/EntryDetailsDialog";
import { NfeDestinationDialog } from "@/components/NfeDestinationDialog";
import { SupplierForm } from "@/components/SupplierForm";
import { DanfeImportDialog } from "@/components/DanfeImportDialog";
import { NfeReviewTable, type NfeReviewRow } from "@/components/NfeReviewTable";
import {
  canContinueNfeReview,
  findDuplicateEntry,
  findSupplierMatch,
  mapNfeUnit,
  parseNfeXml,
  reconcileNfeReviewMatches,
  type NfeData,
  type NfeItem,
  type ProductAliasForMatch,
  type SupplierForMatch,
} from "@/lib/nfe";
import {
  digitsOnly,
  formatCnpj,
  formatCurrency,
  formatAccessKeyGrouped,
  isValidAccessKey,
} from "@/lib/br-validators";
import { resolveNfeDestination, toEntryDestinationPayload, type NfeDestination } from "@/lib/nfe-destination";
import { validateAccessKey44 } from "@/lib/danfe-ocr";
import { IMPLEMENTATION_STOCK_DATE } from "@/convex/stockHelpers";
import type { SupplierPreFill } from "@/lib/supplier-form";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { HelpCircle } from "lucide-react";
import type { MaterialType } from "@/lib/material-types";

// ─── Constantes de interface ─────────────────────────────────────────────────

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  confirmed: "Confirmada",
  reversed: "Estornada",
};

const statusColors: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  reversed: "bg-red-100 text-red-800",
};

const originLabels: Record<string, string> = {
  purchase: "Compra",
  donation: "Doação",
  transfer: "Transferência",
  return: "Devolução",
  initial_inventory: "Estoque inicial",
  other: "Outra",
};

const IMPLEMENTATION_STOCK_OBSERVATION =
  "ESTOQUE DE IMPLANTAÇÃO DO SIGESGD — data de implantação " + IMPLEMENTATION_STOCK_DATE;

// ─── Componentes auxiliares da página ────────────────────────────────────────

/** Exibe o fornecedor selecionado em duas linhas (razão social + CNPJ). */
function SupplierSelectValue({
  supplier,
}: {
  supplier: { legalName: string; cnpj?: string | null } | null;
}) {
  if (!supplier) {
    return <span className="min-w-0 truncate text-muted-foreground">Selecionar fornecedor</span>;
  }
  return (
    <span className="flex min-w-0 flex-col overflow-hidden items-start leading-tight">
      <span className="min-w-0 truncate">{supplier.legalName}</span>
      <span className="min-w-0 truncate text-[10px] text-muted-foreground">
        CNPJ {formatCnpj(supplier.cnpj)}
      </span>
    </span>
  );
}

// ─── Página principal (fluxo de importação + conferência) ────────────────────

export default function Entries() {
  const entries = useQuery(api.entries.list);
  const suppliers = useQuery(api.suppliers.listActive);
  const products = useQuery(api.products.listActive);
  const locations = useQuery(api.storageLocations.listActive);
  const areas = useQuery(api.stockAreas.listActive);
  const nfeAliases = useQuery(api.nfeProductAliases.list);

  const createEntry = useMutation(api.entries.create);
  const confirmEntry = useMutation(api.entries.confirm);
  const reverseEntry = useMutation(api.entries.reverse);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  // ── Estado do fluxo manual ────────────────────────────────────────────────

  const [showCreate, setShowCreate] = useState(false);
  const [cSupplierId, setcSupplierId] = useState("");
  const [cInvoiceNumber, setcInvoiceNumber] = useState("");
  const [cInvoiceDate, setcInvoiceDate] = useState("");
  const [cSeries, setcSeries] = useState("");
  const [cAccessKey, setcAccessKey] = useState("");
  const [cObservation, setcObservation] = useState("");
  const [cAfNumber, setcAfNumber] = useState("");
  const [cProcessNumber, setcProcessNumber] = useState("");
  const [cEmpenhoNumber, setcEmpenhoNumber] = useState("");
  const [cItems, setcItems] = useState<Array<{
    productId: string;
    quantity: string;
    unitOfMeasure: string;
    brand: string;
    model: string;
    unitCost: string;
    locationId: string;
    supplierLotNumber: string;
    specification: string;
    photoStorageId: string;
  }>>([
    {
      productId: "",
      quantity: "",
      unitOfMeasure: "un",
      brand: "",
      model: "",
      unitCost: "",
      locationId: "",
      supplierLotNumber: "",
      specification: "",
      photoStorageId: "",
    },
  ]);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierPrefill, setSupplierPrefill] = useState<SupplierPreFill | null>(null);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierCnpj, setNewSupplierCnpj] = useState("");

  // ── Estado do fluxo de conferência (XML/DANFE) ─────────────────────────────

  const [nfe, setNfe] = useState<NfeData | null>(null);
  const [nfeSource, setNfeSource] = useState<"xml" | "danfe" | null>(null);
  const [nfeItems, setNfeItems] = useState<NfeReviewRow[]>([]);
  const [nfeAccessKey, setNfeAccessKey] = useState("");
  const [nfeAfNumber, setNfeAfNumber] = useState("");
  const [nfeProcessNumber, setNfeProcessNumber] = useState("");
  const [nfeEmpenhoNumber, setNfeEmpenhoNumber] = useState("");
  const [nfeDocumentStorageId, setNfeDocumentStorageId] = useState<string | null>(null);
  const [nfeXmlStorageId, setNfeXmlStorageId] = useState<string | null>(null);

  // ── Estado dos diálogos ────────────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [reverseTarget, setReverseTarget] = useState<any>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [destOpen, setDestOpen] = useState(false);
  const [danfeDialogOpen, setDanfeDialogOpen] = useState(false);

  const nfeSupplier = useMemo(() => {
    if (!cSupplierId) return null;
    return (suppliers ?? []).find((s: any) => s._id === cSupplierId) ?? null;
  }, [suppliers, cSupplierId]);

  // ── Matching de produtos na tela de conferência ────────────────────────────

  useEffect(() => {
    if (!nfe || !products) return;
    setNfeItems((prev) =>
      reconcileNfeReviewMatches(prev, (products ?? []) as unknown as [], {
        supplierId: cSupplierId || null,
        aliases: nfeAliases ?? [],
      }),
    );
  }, [nfe, products, cSupplierId, nfeAliases]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Fluxo manual
  // ═══════════════════════════════════════════════════════════════════════════

  const handleCreateManual = async () => {
    const productId = cItems.find((item) => item.productId)?.productId;
    if (!productId) {
      toast.error("Selecione um produto para o item da entrada.");
      return;
    }
    if (!cInvoiceNumber) {
      toast.error("Informe o número da NF-e.");
      return;
    }
    if (!cItems.every((item) => Number(item.quantity) > 0)) {
      toast.error("Informe a quantidade de todos os itens.");
      return;
    }
    try {
      await createEntry({
        receivedAt: Date.now(),
        originType: "purchase",
        supplierId: cSupplierId ? (cSupplierId as Id<"suppliers">) : undefined,
        invoiceNumber: cInvoiceNumber,
        invoiceDate: cInvoiceDate || undefined,
        purchaseAuthorizationNumber: cAfNumber || undefined,
        processNumber: cProcessNumber || undefined,
        empenhoNumber: cEmpenhoNumber || undefined,
        contractNumber: "",
        observation: cObservation || undefined,
        accessKey: digitsOnly(cAccessKey) || undefined,
        series: cSeries || undefined,
        totalValue: Number(cItems.reduce((sum, item) => sum + Number(item.quantity), 0)) || undefined,
        materialType: "consumption",
        items: cItems
          .filter((item) => item.productId)
          .map((item) => ({
            productId: item.productId as Id<"products">,
            quantity: Number(item.quantity),
            unitOfMeasure: item.unitOfMeasure || "un",
            unitCost: item.unitCost ? Number(item.unitCost) : undefined,
            brand: item.brand || undefined,
            model: item.model || undefined,
            specification: item.specification || undefined,
            locationId: item.locationId ? (item.locationId as Id<"storageLocations">) : undefined,
            supplierLotNumber: item.supplierLotNumber || undefined,
            supplierCode: "",
            ncm: "",
            cfop: "",
            ean: "",
            matchSource: "manual",
            associationType: "manual",
          })),
      });
      toast.success("Rascunho da entrada criado — confira e confirme para lançar o estoque.");
      resetCreateForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar o rascunho.");
    }
  };

  const resetCreateForm = () => {
    setcInvoiceNumber("");
    setcInvoiceDate("");
    setcSeries("");
    setcAccessKey("");
    setcObservation("");
    setcAfNumber("");
    setcProcessNumber("");
    setcEmpenhoNumber("");
    setcItems([{ productId: "", quantity: "", unitOfMeasure: "un", brand: "", model: "", unitCost: "", locationId: "", supplierLotNumber: "", specification: "", photoStorageId: "" }]);
    setcAccessKey("");
    setcSupplierId("");
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Fluxo XML
  // ═══════════════════════════════════════════════════════════════════════════

  const handleNfeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const nfeXmlFile = file;
    let parsedXml: NfeData;
    try {
      parsedXml = parseNfeXml(await nfeXmlFile.text());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "XML inválido — não foi possível ler a NF-e.");
      return;
    }

    // Duplicidade: mesma chave ou (fornecedor + número + série).
    const duplicate = findDuplicateEntry(entries ?? [], {
      accessKey: parsedXml.accessKey || undefined,
      number: parsedXml.number,
      series: parsedXml.series,
      supplierId: cSupplierId || undefined,
    });
    if (duplicate) {
      toast.error(`Esta NF-e já está cadastrada no SIGESGD (${duplicate.entryNumber}). Verifique antes de importar.`);
      return;
    }

    let xmlStorageId: string | undefined;
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": nfeXmlFile.type || "application/xml" },
        body: nfeXmlFile,
      });
      const json = await response.json();
      xmlStorageId = json.storageId;
    } catch {
      toast.error("Falha ao salvar o XML da NF-e — a entrada pode ser conferida sem o documento original.");
    }

    const converted: NfeData = {
      accessKey: parsedXml.accessKey,
      number: parsedXml.number,
      series: parsedXml.series,
      emissionDate: parsedXml.emissionDate,
      emitterCnpj: parsedXml.emitterCnpj,
      emitterName: parsedXml.emitterName,
      natureOperation: parsedXml.natureOperation,
      totalValue: parsedXml.totalValue,
      additionalInfo: parsedXml.additionalInfo,
      orderReference: parsedXml.orderReference,
      afNumber: parsedXml.afNumber,
      processNumber: parsedXml.processNumber,
      empenhoNumber: parsedXml.empenhoNumber,
      items: parsedXml.items.map((item) => ({
        lineNumber: item.lineNumber,
        code: item.code,
        description: item.description,
        ncm: item.ncm,
        cfop: item.cfop,
        unit: item.unit,
        quantity: item.quantity,
        unitValue: item.unitValue,
        totalValue: item.totalValue,
        ean: item.ean,
      })),
    };

    const match = findSupplierMatch(converted, (suppliers ?? []) as unknown as SupplierForMatch[]);
    setcSupplierId(match.found && match.supplierId ? match.supplierId : "");
    setNfe(converted);
    setNfeSource("xml");
    setNfeItems(
      converted.items.map((item) => ({
        item,
        productId: "",
        matchStatus: "not_found",
        matchScore: 0,
        associationType: "automatic",
        locationId: "",
        supplierLot: "",
      })),
    );
    setNfeAccessKey(digitsOnly(converted.accessKey ?? ""));
    setNfeAfNumber(converted.afNumber ?? "");
    setNfeProcessNumber(converted.processNumber ?? "");
    setNfeEmpenhoNumber(converted.empenhoNumber ?? "");
    setNfeDocumentStorageId(xmlStorageId ?? null);
    setNfeXmlStorageId(xmlStorageId ?? null);
    setShowCreate(false);
    toast.success("NF-e importada — confira os dados antes de confirmar.");
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Fluxo DANFE/OCR
  // ═══════════════════════════════════════════════════════════════════════════

  const handleDanfeImport = async (result: any, file: File) => {
    setDanfeDialogOpen(false);
    const duplicate = findDuplicateEntry(entries ?? [], {
      accessKey: result.accessKey || undefined,
      number: result.nfeNumber,
      series: result.series,
      supplierId: cSupplierId || undefined,
    });
    if (duplicate) {
      toast.error(`Esta NF-e já está cadastrada no SIGESGD (${duplicate.entryNumber}). Verifique antes de importar.`);
      return;
    }

    // Documento original preservado no storage (falha não derruba o fluxo).
    let documentStorageId: string | undefined;
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      const json = await response.json();
      documentStorageId = json.storageId;
    } catch {
      toast.error("Falha ao salvar o DANFE original — o restante da conferência continua disponível.");
    }

    const converted: NfeData = {
      accessKey: result.accessKey,
      number: result.nfeNumber,
      series: result.series,
      emissionDate: result.emissionDate,
      emitterCnpj: result.emitterCnpj,
      emitterName: result.emitterName,
      natureOperation: undefined,
      totalValue: result.totalValue,
      additionalInfo: undefined,
      orderReference: undefined,
      afNumber: result.afNumber,
      processNumber: result.processNumber,
      empenhoNumber: result.empenhoNumber,
      items: (result.items ?? []).map((item: any) => ({
        lineNumber: item.lineNumber ?? 0,
        code: item.code ?? "",
        description: item.description,
        ncm: "",
        cfop: "",
        unit: item.unit ?? "",
        quantity: item.quantity ?? 0,
        unitValue: item.unitValue,
        totalValue: item.totalValue,
        ean: "",
      })),
    };

    const match = findSupplierMatch(converted, (suppliers ?? []) as unknown as SupplierForMatch[]);
    const supplierId = result.supplierId || (match.found && match.supplierId ? match.supplierId : "");
    setcSupplierId(supplierId);
    setNfe(converted);
    setNfeSource("danfe");
    setNfeItems(
      converted.items.map((item: any) => ({
        item,
        productId: "",
        matchStatus: "not_found",
        matchScore: 0,
        associationType: "automatic",
        locationId: "",
        supplierLot: "",
      })),
    );
    setNfeAccessKey(digitsOnly(converted.accessKey ?? ""));
    setNfeAfNumber(converted.afNumber ?? "");
    setNfeProcessNumber(converted.processNumber ?? "");
    setNfeEmpenhoNumber(converted.empenhoNumber ?? "");
    setNfeDocumentStorageId(documentStorageId ?? null);
    setNfeXmlStorageId(null);
    setShowCreate(false);
    toast.success("DANFE lida — confira os dados antes de confirmar.");
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Confirmação da entrada importada (destino escolhido pelo usuário)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleConfirmImport = async (materialType: MaterialType, areaId: string) => {
    if (!nfe || !products) return;

    if (!canContinueNfeReview(nfeItems)) {
      toast.error("Associe um produto a todos os itens da NF-e antes de confirmar.");
      return;
    }

    // Regra de negócio: NF-e sem chave válida NÃO pode ser finalizada (usa
    // a chave para impedir duplicidade). A mensagem orienta para conferência.
    const keyDigits = digitsOnly(nfeAccessKey);
    if (!validateAccessKey44(keyDigits)) {
      toast.error("Chave de acesso inválida. Informe a chave da DANFE (44 dígitos com dígito verificador) para finalizar a conferência.");
      return;
    }

    if (nfeItems.some((row) => !(Number(row.item.quantity) > 0))) {
      toast.error("Informe a quantidade real de todos os itens antes de confirmar.");
      return;
    }

    const duplicate = findDuplicateEntry(entries ?? [], {
      accessKey: keyDigits,
      number: nfe.number,
      series: nfe.series,
      supplierId: cSupplierId || undefined,
    });
    if (duplicate) {
      toast.error(`Esta NF-e já está cadastrada no SIGESGD (${duplicate.entryNumber}).`);
      return;
    }

    try {
      const destination = resolveNfeDestination({ override: { materialType, areaId } });
      const payload = toEntryDestinationPayload(destination);
      const entryId = await createEntry({
        receivedAt: Date.now(),
        originType: "purchase",
        supplierId: cSupplierId ? (cSupplierId as Id<"suppliers">) : undefined,
        invoiceNumber: nfe.number || undefined,
        invoiceDate: nfe.emissionDate || undefined,
        purchaseAuthorizationNumber: nfeAfNumber || undefined,
        processNumber: nfeProcessNumber || undefined,
        empenhoNumber: nfeEmpenhoNumber || undefined,
        contractNumber: "",
        observation: nfeSource === "danfe"
          ? "Dados extraídos por OCR de DANFE/PDF/imagem — conferir antes de confirmar."
          : "Importado a partir do XML da NF-e.",
        documentStorageId: nfeDocumentStorageId || undefined,
        xmlStorageId: nfeXmlStorageId || undefined,
        importedFromXml: nfeSource === "xml" ? true : undefined,
        accessKey: keyDigits,
        series: nfe.series || undefined,
        totalValue: nfe.totalValue,
        materialType: payload.materialType,
        areaId: payload.areaId as Id<"stockAreas"> | undefined,
        items: nfeItems.map((row: NfeReviewRow) => ({
          productId: row.productId as Id<"products">,
          quantity: Number(row.item.quantity),
          unitOfMeasure: mapNfeUnit(row.item.unit || "un"),
          unitCost: row.item.unitValue,
          totalCost: row.item.totalValue,
          locationId: row.locationId ? (row.locationId as Id<"storageLocations">) : undefined,
          supplierLotNumber: row.supplierLot || undefined,
          supplierCode: row.item.code || undefined,
          ncm: row.item.ncm || undefined,
          cfop: row.item.cfop || undefined,
          ean: row.item.ean || undefined,
          matchSource: row.matchSource,
          matchScore: row.matchScore,
          associationType: row.associationType,
        })),
      });
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada confirmada — estoque atualizado.");
      resetConference();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao confirmar a entrada.");
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Cadastro inline de fornecedor
  // ═══════════════════════════════════════════════════════════════════════════

  const openSupplierRegistration = () => {
    // Dados fiscais extraídos do documento: o formulário padrão é o único
    // usado para cadastro — não existem dois formulários de fornecedor.
    if (!nfe || !nfe.emitterName || !nfe.emitterCnpj) return;
    setNewSupplierName(nfe.emitterName);
    setNewSupplierCnpj(nfe.emitterCnpj);
    setSupplierPrefill({
      legalName: nfe.emitterName,
      cnpj: digitsOnly(nfe.emitterCnpj),
    });
    setShowSupplierForm(true);
  };

  const handleSupplierCreated = (newId: string) => {
    setcSupplierId(newId);
    setShowSupplierForm(false);
    toast.success("Fornecedor criado e selecionado");
  };

  const resetConference = () => {
    setNfe(null);
    setNfeSource(null);
    setNfeItems([]);
    setNfeAccessKey("");
    setNfeAfNumber("");
    setNfeProcessNumber("");
    setNfeEmpenhoNumber("");
    setNfeDocumentStorageId(null);
    setNfeXmlStorageId(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════════════════

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries ?? [];
    return (entries ?? []).filter((entry: any) => {
      const haystack = [
        entry.entryNumber,
        entry.invoiceNumber,
        entry.series,
        entry.supplier?.legalName ?? "",
        entry.supplier?.cnpj ?? "",
        entry.accessKey ?? "",
        entry.purchaseAuthorizationNumber ?? "",
        entry.processNumber ?? "",
        entry.empenhoNumber ?? "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [entries, search]);

  const isImplementationStock = (entry: any) =>
    entry.observation === IMPLEMENTATION_STOCK_OBSERVATION;

  return (
    <>
      <div className="space-y-6">
        {/* Cabeçalho */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Entradas</h1>
            <p className="text-sm text-muted-foreground">
              XML, DANFE/OCR e entrada manual — com conferência obrigatória antes do estoque.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
              Importar NF-e XML
              <input
                type="file"
                accept=".xml,application/xml,text/xml"
                className="sr-only"
                onChange={handleNfeFile}
              />
            </label>
            <Button variant="outline" onClick={() => setDanfeDialogOpen(true)}>
              Importar DANFE / PDF / Imagem
            </Button>
            <Button
              variant="default"
              onClick={() => {
                resetCreateForm();
                setShowCreate((v) => !v);
              }}
            >
              Nova Entrada
            </Button>
          </div>
        </header>

        {showCreate ? (
          <Card className="min-w-0 max-w-full overflow-x-hidden">
            <CardHeader>
              <CardTitle>Nova Entrada</CardTitle>
              <CardDescription>
                Dados da NF-e manual: fornecedor, número, série, data de emissão, chave de
                acesso e itens. A confirmação do destino da NF-e é exigida para registrar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 min-w-0 max-w-full overflow-x-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0 flex-1">
                  <Label>Fornecedor</Label>
                  <Select
                    value={cSupplierId || "none"}
                    onValueChange={(value) => setcSupplierId(value === "none" ? "" : value)}
                  >
                    <SelectTrigger className="h-10 w-full min-w-0">
                      <SelectValue placeholder="Selecionar fornecedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Selecionar um fornecedor —</SelectItem>
                      {(suppliers ?? []).map((supplier: any) => (
                        <SelectItem key={supplier._id} value={supplier._id} textValue={supplier.legalName}>
                          <span className="min-w-0 truncate">{supplier.legalName}</span>
                          <span className="block min-w-0 truncate text-[10px] text-muted-foreground">
                            {`CNPJ: ${formatCnpj(supplier.cnpj)}`}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="cInvoiceNumber">Nº Nota Fiscal</Label>
                  <Input
                    id="cInvoiceNumber"
                    value={cInvoiceNumber}
                    onChange={(e) => setcInvoiceNumber(e.target.value)}
                    placeholder="372043"
                    className="max-w-xs font-mono"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <Label htmlFor="cSeries">Série</Label>
                  <Input
                    id="cSeries"
                    value={cSeries}
                    onChange={(e) => setcSeries(e.target.value)}
                    placeholder="001"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <Label htmlFor="cInvoiceDate">Data de emissão da NF-e</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Input
                          id="cInvoiceDate"
                          type="date"
                          value={cInvoiceDate}
                          onChange={(e) => setcInvoiceDate(e.target.value)}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        Data em que a NF-e foi emitida pelo fornecedor.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="min-w-0 flex-1">
                  <Label htmlFor="cAcessKey">Chave de acesso (44 dígitos)</Label>
                  <Input
                    id="cAcessKey"
                    value={cAccessKey}
                    onChange={(e) => setcAccessKey(e.target.value)}
                    placeholder="35260961457941000143550010003720431466669127"
                    className="max-w-xs font-mono text-xs"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <Label htmlFor="cAfNumber">Número da AF</Label>
                  <Input
                    id="cAfNumber"
                    value={cAfNumber}
                    onChange={(e) => setcAfNumber(e.target.value)}
                    placeholder="2223/2026"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <Label htmlFor="cProcessNumber">Número do Processo Administrativo</Label>
                  <Input
                    id="cProcessNumber"
                    value={cProcessNumber}
                    onChange={(e) => setcProcessNumber(e.target.value)}
                    placeholder="4220260000000000000"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <Label htmlFor="cEmpenhoNumber">Número do Empenho</Label>
                  <Input
                    id="cEmpenhoNumber"
                    value={cEmpenhoNumber}
                    onChange={(e) => setcEmpenhoNumber(e.target.value)}
                    placeholder="778/2026"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observação</Label>
                <Input
                  value={cObservation}
                  onChange={(e) => setcObservation(e.target.value)}
                  placeholder="Pedido, contrato ou observação relevante"
                />
              </div>

              <NewEntryItemsEditor
                items={cItems}
                products={(products ?? []) as any}
                locations={(locations ?? []) as any}
                onUpdateItem={(index, field, value) =>
                  setcItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
                }
                onAddItem={() => setcItems((prev) => [...prev, { productId: "", quantity: "", unitOfMeasure: "un", brand: "", model: "", unitCost: "", locationId: "", supplierLotNumber: "", specification: "", photoStorageId: "" }])}
                onRemoveItem={(index) => setcItems((prev) => prev.filter((_, i) => i !== index))}
                onNewProduct={() => setcItems((prev) => [...prev, { productId: "", quantity: "", unitOfMeasure: "un", brand: "", model: "", unitCost: "", locationId: "", supplierLotNumber: "", specification: "", photoStorageId: "" }])}
              />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={resetCreateForm}>
                  Limpar
                </Button>
                <Button variant="secondary" onClick={handleCreateManual}>
                  Salvar rascunho
                </Button>
                <Button onClick={() => setDestOpen(true)}>
                  Salvar e confirmar
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Janela de diálogo: confirmar destino da NF-e (recebida de OCR/XML). */}
        <NfeDestinationDialog
          open={destOpen}
          onOpenChange={setDestOpen}
          areas={(areas ?? []).map((area: any) => ({ id: area._id, name: area.name }))}
          supplierName={nfeSupplier?.legalName ?? null}
          supplierCnpj={nfeSupplier?.cnpj ?? null}
          invoiceNumber={nfe?.number ?? null}
          invoiceDate={nfe?.emissionDate ?? null}
          itemCount={nfeItems.length}
          initialMaterialType={destOpen ? undefined : "consumption"}
          initialAreaId={destOpen ? undefined : ""}
          onConfirm={(materialType: MaterialType, areaId: string) => {
            setDestOpen(false);
            handleConfirmImport(materialType, areaId);
          }}
        />

        {/* Diálogo: OCR de DANFE/PDF/imagem. */}
        <DanfeImportDialog
          open={danfeDialogOpen}
          onClose={() => setDanfeDialogOpen(false)}
          suppliers={(suppliers ?? []).map((supplier: any) => ({
            _id: supplier._id,
            legalName: supplier.legalName,
            cnpj: supplier.cnpj,
          }))}
          onImport={handleDanfeImport}
        />

        {/* Diálogo: detalhe da entrada. */}
        <EntryDetailsDialog
          entry={selectedEntry}
          statusLabels={statusLabels}
          statusColors={statusColors}
          originLabels={originLabels}
          onClose={() => setSelectedEntry(null)}
        />

        {/* Diálogo: cadastro de fornecedor (mesmo formulário de toda a aplicação). */}
        <SupplierForm
          open={showSupplierForm}
          onOpenChange={setShowSupplierForm}
          mode="create"
          supplierId={null}
          preFilled={supplierPrefill}
          onCreated={handleSupplierCreated}
        />

        {/* Banco de entradas — lista reativa. */}
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Entradas disponíveis</CardTitle>
              <CardDescription>
                Busca por número, NF, fornecedor, chave, AF, processo ou empenho.
              </CardDescription>
            </div>
            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <SearchInput
                className="w-full pl-9"
                placeholder="Buscar entrada..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {entries === undefined ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                Carregando entradas…
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nenhuma entrada encontrada.</div>
            ) : (
              <div className="space-y-2">
                {filteredEntries.map((entry: any) => {
                  const isImpl = isImplementationStock(entry);
                  return (
                    <div
                      key={entry._id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 transition hover:bg-muted/30"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">
                            {entry.entryNumber}
                          </span>
                          <Badge className={statusColors[entry.status]}>
                            {statusLabels[entry.status] ?? entry.status}
                          </Badge>
                          {entry.originType && (
                            <Badge variant="outline" className="text-[10px]">
                              {originLabels[entry.originType] ?? entry.originType}
                            </Badge>
                          )}
                          {isImpl && (
                            <Badge className="bg-indigo-100 text-indigo-700 text-[10px]">
                              Estoque de implantação
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {entry.supplier?.legalName ?? "Sem fornecedor identificado"}
                          {entry.supplier && (
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              ({formatCnpj(entry.supplier.cnpj)})
                            </span>
                          )}
                          {entry.invoiceNumber && (
                            <span className="ml-2 font-mono text-xs">NF {entry.invoiceNumber} · série {entry.series}</span>
                          )}
                          {entry.purchaseAuthorizationNumber && (
                            <span className="ml-2 text-xs">AF {entry.purchaseAuthorizationNumber}</span>
                          )}
                          {entry.processNumber && (
                            <span className="ml-2 text-xs">Processo {entry.processNumber}</span>
                          )}
                          {entry.empenhoNumber && (
                            <span className="ml-2 text-xs">Empenho {entry.empenhoNumber}</span>
                          )}
                          {entry.accessKey && (
                            <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                              chave {entry.accessKey.slice(0, 8)}…
                            </span>
                          )}
                          {entry.totalValue != null && (
                            <span className="ml-auto text-xs font-mono">
                              {formatCurrency(entry.totalValue)}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.items?.length ?? 0} item(ns) · recebido em{" "}
                          {new Date(entry.receivedAt).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedEntry(entry)}
                        >
                          Detalhes
                        </Button>
                        {entry.status === "draft" && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => {
                              if (!entry._id) return;
                              confirmEntry({ entryId: entry._id as any });
                            }}
                          >
                            Confirmar
                          </Button>
                        )}
                        {entry.status === "confirmed" && (
                          <Button variant="outline" size="sm" onClick={() => setReverseTarget(entry)}>
                            Estornar
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Diálogo de confirmação de estorno — motivo obrigatório. */}
      {reverseTarget && (
        <Dialog open={!!reverseTarget} onOpenChange={(open) => { if (!open) setReverseTarget(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Estornar entrada</DialogTitle>
              <DialogDescription>
                A entrada <strong>{reverseTarget.entryNumber}</strong> está confirmada. O estorno
                devolve o estoque — não é possível reverter material já consumido.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Motivo do estorno (obrigatório)"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <DialogClose>
                  <Button variant="ghost">Cancelar</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (!reverseTarget._id || !reverseReason.trim()) return;
                    try {
                      await reverseEntry({ entryId: reverseTarget._id as any, reason: reverseReason });
                      toast.success("Entrada estornada.");
                      setReverseTarget(null);
                      setReverseReason("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Erro ao estornar.");
                    }
                  }}
                >
                  Estornar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
