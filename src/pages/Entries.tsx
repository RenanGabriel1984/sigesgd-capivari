import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ShoppingCart, CheckCircle, RotateCcw, Eye, Trash2, ExternalLink, Save, Pencil, FileUp, FileText, Loader2 } from "lucide-react";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";
import { IMPLEMENTATION_STOCK_DATE } from "@/convex/stockHelpers";
import { FileUpload } from "@/components/FileUpload";
import { toast } from "sonner";
import {
  parseNfeXml, findSupplierMatch, findEntryByAccessKey, matchNfeProduct,
  buildEntryDraftFromNfe, mapNfeUnit,
  type NfeData, type NfeItem, type ProductMatchStatus,
} from "@/lib/nfe";

const ORIGIN_LABELS: Record<string, string> = {
  purchase: "Compra", donation: "Doação", transfer: "Transferência",
  return: "Devolução",
  // A carga inicial representa o estoque físico existente na data de
  // implantação do SIGESGD (15/09/2026).
  initial_inventory: `Estoque de implantação (${IMPLEMENTATION_STOCK_DATE})`,
  other: "Outro",
};
const STATUS_LABELS: Record<string, string> = { draft: "Rascunho", confirmed: "Confirmada", reversed: "Estornada" };
const STATUS_COLORS: Record<string, string> = { draft: "text-amber-600 bg-amber-50", confirmed: "text-emerald-600 bg-emerald-50", reversed: "text-red-600 bg-red-50" };

type EntryItemDraft = {
  productId: string; quantity: string; unitOfMeasure: string; unitCost: string;
  brand: string; model: string; specification: string; locationId: string; observation: string;
  photoStorageId: string; supplierLotNumber: string;
};
const EMPTY_ITEM: EntryItemDraft = { productId: "", quantity: "1", unitOfMeasure: "un", unitCost: "", brand: "", model: "", specification: "", locationId: "", observation: "", photoStorageId: "", supplierLotNumber: "" };

export default function Entries() {
  const entries = useQuery(api.entries.list);
  const products = useQuery(api.products.listActive);
  const suppliers = useQuery(api.suppliers.listActive);
  const locations = useQuery(api.storageLocations.listActive);
  const categories = useQuery(api.categories.listActive);
  const createEntry = useMutation(api.entries.create);
  const confirmEntry = useMutation(api.entries.confirm);
  const reverseEntry = useMutation(api.entries.reverse);
  const addItemMutation = useMutation(api.entries.addItem);
  const updateItemMutation = useMutation(api.entries.updateItem);
  const removeItemMutation = useMutation(api.entries.removeItem);
  const editDraftMutation = useMutation(api.entries.editDraft);

  const [tab, setTab] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Create form state
  const [cReceivedAt, setCReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [cOriginType, setcOriginType] = useState("purchase");
  const [cSupplierId, setcSupplierId] = useState("");
  const [cInvoiceNumber, setcInvoiceNumber] = useState("");
  const [cInvoiceDate, setcInvoiceDate] = useState("");
  const [cPurchaseAuth, setcPurchaseAuth] = useState("");
  const [cProcessNumber, setcProcessNumber] = useState("");
  const [cContractNumber, setcContractNumber] = useState("");
  const [cObservation, setcObservation] = useState("");
  const [cDocStorageId, setcDocStorageId] = useState("");
  const [cItems, setCItems] = useState<EntryItemDraft[]>([{ ...EMPTY_ITEM }]);

  // Edit draft state
  const [eDocStorageId, seteDocStorageId] = useState("");
  const [eObservation, seteObservation] = useState("");
  const [eItems, seteItems] = useState<EntryItemDraft[]>([]);
  const [eItemIds, seteItemIds] = useState<string[]>([]);

  // Quick-create product
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [npName, setNpName] = useState("");
  const [npCatId, setNpCatId] = useState("");
  const [npUnit, setNpUnit] = useState("un");
  const [npBrand, setNpBrand] = useState("");
  const [npModel, setNpModel] = useState("");
  const [npInternalCode, setNpInternalCode] = useState("");
  // null = diálogo manual (preenche item do formulário); número = preenche item da NF importada
  const [productModalTarget, setProductModalTarget] = useState<number | null>(null);
  const createProduct = useMutation(api.products.create);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  // Contextual supplier creation
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierCnpj, setNewSupplierCnpj] = useState("");
  const createSupplier = useMutation(api.suppliers.create);

  // Contextual category creation
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const createCategory = useMutation(api.categories.create);

  // ─── Importação NF-e XML ───
  type NfeReviewItem = { item: NfeItem; productId: string; matchStatus: ProductMatchStatus; locationId: string; supplierLot: string };
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"file" | "review" | "location">("file");
  const [importLoading, setImportLoading] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState("");
  const [nfe, setNfe] = useState<NfeData | null>(null);
  const [nfeXmlFile, setNfeXmlFile] = useState<File | null>(null);
  const [nfeItems, setNfeItems] = useState<NfeReviewItem[]>([]);
  const [nfeSupplierId, setNfeSupplierId] = useState("");
  const [nfeSupplierFound, setNfeSupplierFound] = useState(true);
  const [nfeContract, setNfeContract] = useState("");
  const [importLocationId, setImportLocationId] = useState("");
  const [importDocStorageId, setImportDocStorageId] = useState("");
  const [importObservation, setImportObservation] = useState("");
  const nfeFileInputRef = useRef<HTMLInputElement>(null);

  const viewEntry = entries?.find((e) => e._id === viewId);
  const editEntryData = entries?.find((e) => e._id === editEntryId);
  const filteredEntries = entries?.filter((e) => {
    if (tab === "all") return true;
    if (tab === "draft") return e.status === "draft";
    if (tab === "confirmed") return e.status === "confirmed";
    if (tab === "reversed") return e.status === "reversed";
    return true;
  });

  // ─── Helpers ───
  const resetCreateForm = () => {
    setCReceivedAt(new Date().toISOString().slice(0, 10));
    setcOriginType("purchase"); setcSupplierId(""); setcInvoiceNumber(""); setcInvoiceDate("");
    setcPurchaseAuth(""); setcProcessNumber(""); setcContractNumber(""); setcObservation("");
    setcDocStorageId(""); setCItems([{ ...EMPTY_ITEM }]);
  };

  const openEditDialog = useCallback((entry: any) => {
    seteDocStorageId(entry.documentStorageId ?? "");
    seteObservation(entry.observation ?? "");
    const itemIds: string[] = [];
    const itemsDraft: EntryItemDraft[] = [];
    for (const item of entry.items ?? []) {
      itemIds.push(item._id);
      itemsDraft.push({
        productId: item.productId, quantity: String(item.quantity), unitOfMeasure: item.unitOfMeasure,
        unitCost: item.unitCost != null ? String(item.unitCost) : "",
        brand: item.brand ?? "", model: item.model ?? "", specification: item.specification ?? "",
        locationId: item.locationId ?? "", observation: item.observation ?? "", photoStorageId: item.photoStorageId ?? "",
        supplierLotNumber: item.supplierLotNumber ?? "",
      });
    }
    seteItemIds(itemIds);
    seteItems(itemsDraft);
    setEditEntryId(entry._id);
  }, []);

  const updateCItem = (idx: number, field: keyof EntryItemDraft, value: string) => {
    const n = [...cItems]; (n[idx] as any)[field] = value;
    if (field === "productId" && value) {
      const p = products?.find((x) => x._id === value);
      if (p) { n[idx].unitOfMeasure = p.unitOfMeasure; n[idx].brand = p.brand ?? ""; n[idx].model = p.model ?? ""; }
    }
    setCItems(n);
  };

  const updateEItem = (idx: number, field: keyof EntryItemDraft, value: string) => {
    const n = [...eItems]; (n[idx] as any)[field] = value;
    if (field === "productId" && value) {
      const p = products?.find((x) => x._id === value);
      if (p) { n[idx].unitOfMeasure = p.unitOfMeasure; n[idx].brand = p.brand ?? ""; n[idx].model = p.model ?? ""; }
    }
    seteItems(n);
  };

  // ─── Create entry ───
  const handleCreate = async () => {
    const validItems = cItems.filter((i) => i.productId && Number(i.quantity) > 0);
    if (validItems.length === 0) { toast.error("Adicione pelo menos um item válido"); return; }
    setSaving(true);
    try {
      await createEntry({
        receivedAt: new Date(cReceivedAt + "T12:00:00").getTime(),
        originType: cOriginType as any,
        supplierId: cSupplierId ? (cSupplierId as any) : undefined,
        invoiceNumber: cInvoiceNumber || undefined, invoiceDate: cInvoiceDate || undefined,
        purchaseAuthorizationNumber: cPurchaseAuth || undefined, processNumber: cProcessNumber || undefined,
        contractNumber: cContractNumber || undefined, observation: cObservation || undefined,
        documentStorageId: cDocStorageId || undefined,
        items: validItems.map((i) => ({
          productId: i.productId as any, quantity: Number(i.quantity), unitOfMeasure: i.unitOfMeasure,
          unitCost: i.unitCost ? Number(i.unitCost) : undefined, brand: i.brand || undefined,
          model: i.model || undefined, specification: i.specification || undefined,
          locationId: i.locationId ? (i.locationId as any) : undefined,
          photoStorageId: i.photoStorageId || undefined, observation: i.observation || undefined,
          supplierLotNumber: i.supplierLotNumber || undefined,
        })),
      });
      toast.success("Entrada criada como rascunho");
      setCreateDialogOpen(false); resetCreateForm();
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar entrada"); }
    setSaving(false);
  };

  // ─── Edit draft header ───
  const handleEditHeader = async () => {
    if (!editEntryId) return;
    setSaving(true);
    try {
      await editDraftMutation({
        entryId: editEntryId as any,
        documentStorageId: eDocStorageId || undefined,
        observation: eObservation || undefined,
      });
      toast.success("Dados gerais salvos");
    } catch (e: any) { toast.error(e.message ?? "Erro ao salvar"); }
    setSaving(false);
  };

  // ─── Add item to draft ───
  const handleAddItem = async () => {
    if (!editEntryId) return;
    setSaving(true);
    try {
      const idx = eItems.length;
      const newEntryItem: EntryItemDraft = { ...EMPTY_ITEM };
      // Optimistically add locally, then save
      const tempId = `temp_${Date.now()}`;
      seteItems([...eItems, newEntryItem]);
      seteItemIds([...eItemIds, tempId]);
      toast.info("Item adicionado. Preencha e salve.");
    } catch (e: any) { toast.error(e.message ?? "Erro ao adicionar item"); }
    setSaving(false);
  };

  // ─── Save all draft items (batch: remove all, re-add all) ───
  const handleSaveAllItems = async () => {
    if (!editEntryId) return;
    const validItems = eItems.filter((i) => i.productId && Number(i.quantity) > 0);
    if (validItems.length === 0) { toast.error("A entrada deve ter pelo menos um item válido"); return; }

    setSaving(true);
    try {
      // Remove all existing items
      for (const itemId of eItemIds) {
        try { await removeItemMutation({ itemId: itemId as any }); } catch { /* ignore if temp */ }
      }
      // Add all items fresh
      const newItemIds: string[] = [];
      for (const item of validItems) {
        const newId = await addItemMutation({
          entryId: editEntryId as any,
          productId: item.productId as any,
          quantity: Number(item.quantity),
          unitOfMeasure: item.unitOfMeasure,
          unitCost: item.unitCost ? Number(item.unitCost) : undefined,
          brand: item.brand || undefined, model: item.model || undefined,
          specification: item.specification || undefined,
          locationId: item.locationId ? (item.locationId as any) : undefined,
          photoStorageId: item.photoStorageId || undefined,
          supplierLotNumber: item.supplierLotNumber || undefined,
          observation: item.observation || undefined,
        });
        newItemIds.push(newId as string);
      }
      seteItemIds(newItemIds);
      toast.success("Itens salvos com sucesso");
    } catch (e: any) { toast.error(e.message ?? "Erro ao salvar itens"); }
    setSaving(false);
  };

  // ─── Confirm ───
  const handleConfirm = async (entryId: string) => {
    setConfirming(true);
    try {
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada confirmada — estoque atualizado");
      setViewId(null);    setEditEntryId(null);
    } catch (e: any) { toast.error(e.message ?? "Erro ao confirmar"); }
    setConfirming(false);
  };

  // ─── Reverse ───
  const handleReverse = async () => {
    if (!reverseId || !reverseReason.trim()) { toast.error("Motivo é obrigatório"); return; }
    try {
      await reverseEntry({ entryId: reverseId as any, reason: reverseReason.trim() });
      toast.success("Entrada estornada");
      setReverseModalOpen(false); setReverseId(null); setReverseReason(""); setViewId(null);
    } catch (e: any) { toast.error(e.message ?? "Erro ao estornar"); }
  };

  // ─── Quick create supplier ───
  const handleQuickCreateSupplier = async () => {
    if (!newSupplierName.trim()) { toast.error("Razão social é obrigatória"); return; }
    try {
      const newId = await createSupplier({ legalName: newSupplierName.trim(), cnpj: newSupplierCnpj.trim() || undefined });
      if (nfe) {
        // Fluxo de importação: associa à NF
        setNfeSupplierId(newId as string); setNfeSupplierFound(true);
      } else {
        setcSupplierId(newId as string);
      }
      setSupplierModalOpen(false); setNewSupplierName(""); setNewSupplierCnpj("");
      toast.success("Fornecedor criado e selecionado");
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar fornecedor"); }
  };

  // ─── Quick create category ───
  const handleQuickCreateCategory = async () => {
    if (!newCategoryName.trim()) { toast.error("Nome da categoria é obrigatório"); return; }
    try {
      const newId = await createCategory({ name: newCategoryName.trim() });
      setNpCatId(newId as string);
      setCategoryModalOpen(false); setNewCategoryName("");
      toast.success("Categoria criada e selecionada");
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar categoria"); }
  };

  // ─── Quick create product ───
  const handleQuickCreateProduct = async () => {
    if (!npName.trim()) { toast.error("Nome é obrigatório"); return; }
    if (!npCatId) { toast.error("Selecione categoria"); return; }
    try {
      const newId = await createProduct({
        name: npName.trim(), categoryId: npCatId as any, unitOfMeasure: npUnit,
        brand: npBrand || undefined, model: npModel || undefined,
        internalCode: npInternalCode.trim() || undefined,
        minimumStock: 0, idealStock: 0, maximumStock: 0,
      });
      if (productModalTarget !== null) {
        const n = [...nfeItems]; n[productModalTarget].productId = newId as string; n[productModalTarget].matchStatus = "found"; setNfeItems(n);
      } else {
        const n = [...cItems]; n[cItems.length - 1].productId = newId as string; setCItems(n);
      }
      setProductModalOpen(false); setNpName(""); setNpCatId(""); setNpUnit("un"); setNpBrand(""); setNpModel(""); setNpInternalCode(""); setProductModalTarget(null);
      toast.success("Item criado e selecionado");
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar item"); }
  };

  // ─── Importação NF-e XML ───
  const resetImport = () => {
    setImportStep("file"); setImportLoading(false); setImportSaving(false); setImportError("");
    setNfe(null); setNfeXmlFile(null); setNfeItems([]); setNfeSupplierId(""); setNfeSupplierFound(true);
    setNfeContract(""); setImportLocationId(""); setImportDocStorageId(""); setImportObservation("");
    setProductModalTarget(null);
  };

  const readXmlText = async (file: File): Promise<string> => {
    let text = await file.text();
    if (text.includes("\uFFFD")) {
      // XMLs emitidos pela SEFAZ costumam ser ISO-8859-1 — relê nesse charset
      text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Não foi possível ler o arquivo XML"));
        reader.readAsText(file, "iso-8859-1");
      });
    }
    return text;
  };

  const handleNfeFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xml")) { toast.error("Selecione um arquivo .xml de NF-e"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Arquivo muito grande (máx. 10MB)"); return; }
    setImportLoading(true); setImportError("");
    try {
      const text = await readXmlText(file);
      const parsed = parseNfeXml(text);
      if (!parsed.accessKey || !parsed.number) throw new Error("NF-e sem chave de acesso ou número — arquivo incompleto.");
      const dup = findEntryByAccessKey(entries ?? [], parsed.accessKey);
      if (dup) {
        setImportError(`Esta NF-e já foi registrada (entrada ${dup.entryNumber}). Não é possível duplicar o estoque.`);
        return;
      }
      const supplierMatch = findSupplierMatch(parsed, suppliers ?? []);
      setNfe(parsed); setNfeXmlFile(file);
      setNfeSupplierId(supplierMatch.supplierId ?? "");
      setNfeSupplierFound(supplierMatch.found);
      setNfeContract(parsed.orderReference ?? "");
      setNfeItems(parsed.items.map((item) => {
        const m = matchNfeProduct(item, products ?? []);
        return { item, productId: m.productId ?? "", matchStatus: m.status, locationId: "", supplierLot: "" };
      }));
      setImportStep("review");
      toast.success("NF-e lida com sucesso. Confira os itens antes de confirmar.");
    } catch (e: any) {
      setImportError(e.message ?? "Não foi possível ler a NF-e");
    } finally { setImportLoading(false); }
  };

  const handleConfirmImport = async () => {
    if (!nfe || !nfeXmlFile) return;
    if (nfeItems.some((r) => !r.productId)) {
      toast.error("Todos os itens precisam de um produto associado. Cadastre os itens 🔴 antes de confirmar.");
      return;
    }
    if (nfeItems.some((r) => !r.locationId)) {
      toast.error("Informe o local de armazenamento de cada item (o local padrão aplica a todos).");
      return;
    }
    const dup = findEntryByAccessKey(entries ?? [], nfe.accessKey);
    if (dup) { toast.error(`Esta NF-e já foi registrada (entrada ${dup.entryNumber}).`); return; }
    setImportSaving(true);
    try {
      // 1) Preserva o XML original no armazenamento
      const uploadUrl = await generateUploadUrl();
      const upRes = await fetch(uploadUrl, {
        method: "POST", headers: { "Content-Type": "application/xml" }, body: nfeXmlFile,
      });
      if (!upRes.ok) throw new Error("Falha ao salvar o XML original");
      const { storageId: xmlStorageId } = await upRes.json();

      // 2) Monta o rascunho (NÃO altera estoque — só rascunho)
      const draft = buildEntryDraftFromNfe(nfe, nfeItems.map((r) => ({
        productId: r.productId, locationId: r.locationId || undefined, supplierLotNumber: r.supplierLot || undefined,
      })), {
        supplierId: nfeSupplierId || undefined,
        contractNumber: nfeContract || undefined,
        observation: importObservation || undefined,
        documentStorageId: importDocStorageId || undefined,
        xmlStorageId: xmlStorageId as string,
      });

      const entryId = await createEntry({
        receivedAt: Date.now(),
        originType: "purchase" as any,
        supplierId: draft.supplierId ? (draft.supplierId as any) : undefined,
        invoiceNumber: draft.invoiceNumber, invoiceDate: draft.invoiceDate, series: draft.series,
        contractNumber: draft.contractNumber, observation: draft.observation,
        documentStorageId: draft.documentStorageId,
        accessKey: draft.accessKey, totalValue: draft.totalValue,
        xmlStorageId: draft.xmlStorageId, importedFromXml: true,
        items: draft.items.map((i) => ({
          productId: i.productId as any, quantity: i.quantity, unitOfMeasure: i.unitOfMeasure,
          unitCost: i.unitCost, totalCost: i.totalCost, specification: i.specification,
          locationId: i.locationId ? (i.locationId as any) : undefined,
          supplierLotNumber: i.supplierLotNumber,
          supplierCode: i.supplierCode, ncm: i.ncm, cfop: i.cfop, ean: i.ean,
        })),
      });

      // 3) Efetiva a entrada (estoque, lote, movimentação, auditoria)
      try {
        await confirmEntry({ entryId: entryId as any });
        toast.success("Entrada confirmada — estoque atualizado a partir da NF-e");
      } catch (e2: any) {
        toast.warning("Entrada criada como rascunho: " + (e2.message ?? "revise e confirme na lista de entradas"));
      }
      setImportOpen(false); resetImport();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar entrada");
    }
    setImportSaving(false);
  };

  const openProductModalForImport = (idx: number) => {
    const review = nfeItems[idx];
    if (!review) return;
    setNpName(review.item.description.slice(0, 90));
    setNpInternalCode(review.item.code);
    setNpBrand(""); setNpModel(""); setNpCatId(""); setNpUnit(mapNfeUnitSafe(review.item.unit));
    setProductModalTarget(idx);
    setProductModalOpen(true);
  };

  const mapNfeUnitSafe = (u: string): string => {
    const mapped = mapNfeUnit(u);
    return mapped === "outro" ? "un" : mapped;
  };

  // ─── Badge de situação de correspondência (NF-e) ───
  const renderMatchBadge = (s: ProductMatchStatus) => {
    if (s === "found") return <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">🟢 Produto encontrado</Badge>;
    if (s === "possible") return <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">🟡 Possível — confirmar</Badge>;
    return <Badge className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">🔴 Não encontrado</Badge>;
  };

  // ─── Item card for edit mode ───
  const EditItemCard = ({ idx }: { idx: number }) => {
    const item = eItems[idx];
    if (!item) return null;
    const handleRemove = async () => {
      if (eItems.length <= 1) { toast.error("A entrada deve ter pelo menos um item"); return; }
      const itemId = eItemIds[idx];
      if (itemId && !itemId.startsWith("temp_")) {
        try { await removeItemMutation({ itemId: itemId as any }); } catch (e: any) { toast.error(e.message); return; }
      }
      seteItems(eItems.filter((_, i) => i !== idx));
      seteItemIds(eItemIds.filter((_, i) => i !== idx));
      toast.success("Item removido");
    };
    return (
      <div className="border rounded-lg p-3 mb-2 space-y-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRemove}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">Produto *</Label>
            <Select value={item.productId} onValueChange={(v) => updateEItem(idx, "productId", v)}>
              <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Selecionar" /></SelectTrigger>
              <SelectContent>{products?.map((p) => (<SelectItem key={p._id} value={p._id}>{p.name} {p.brand ? `(${p.brand})` : ""}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Qtd *</Label><Input type="number" min="1" value={item.quantity} onChange={(e) => updateEItem(idx, "quantity", e.target.value)} className="mt-1 h-8" /></div>
          <div><Label className="text-xs">UM</Label><Select value={item.unitOfMeasure} onValueChange={(v) => updateEItem(idx, "unitOfMeasure", v)}><SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger><SelectContent>{UNITS_OF_MEASURE.map((u) => (<SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>))}</SelectContent></Select></div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div><Label className="text-xs">Marca</Label><Input value={item.brand} onChange={(e) => updateEItem(idx, "brand", e.target.value)} className="mt-1 h-8" /></div>
          <div><Label className="text-xs">Modelo</Label><Input value={item.model} onChange={(e) => updateEItem(idx, "model", e.target.value)} className="mt-1 h-8" /></div>
          <div><Label className="text-xs">Custo Unit.</Label><Input type="number" step="0.01" min="0" value={item.unitCost} onChange={(e) => updateEItem(idx, "unitCost", e.target.value)} placeholder="R$" className="mt-1 h-8" /></div>
          <div><Label className="text-xs">Local</Label><Select value={item.locationId} onValueChange={(v) => updateEItem(idx, "locationId", v)}><SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{locations?.map((l) => (<SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>))}</SelectContent></Select></div>
        </div>
        <div><Label className="text-xs">Especificação</Label><Input value={item.specification} onChange={(e) => updateEItem(idx, "specification", e.target.value)} className="mt-1 h-8" placeholder="Opcional" /></div>
        <div><Label className="text-xs">Observação</Label><Input value={item.observation} onChange={(e) => updateEItem(idx, "observation", e.target.value)} className="mt-1 h-8" placeholder="Opcional" /></div>
        <div><Label className="text-xs">Foto do Item</Label><FileUpload storageId={item.photoStorageId} onUpload={(sid) => updateEItem(idx, "photoStorageId", sid)} onRemove={() => updateEItem(idx, "photoStorageId", "")} size="sm" label="Foto do item recebido" /></div>
      </div>
    );
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><h1 className="text-2xl font-bold tracking-tight">Entrada de material</h1><p className="text-sm text-muted-foreground">Registre aqui materiais que chegaram fisicamente ao estoque — {entries?.length ?? 0} entrada(s)</p></div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { resetImport(); setImportOpen(true); }} className="gap-2"><FileUp className="h-4 w-4" /> Importar NF-e XML</Button>
            <Button onClick={() => { resetCreateForm(); setCreateDialogOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> Nova Entrada</Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="all">Todas</TabsTrigger><TabsTrigger value="draft">Rascunho</TabsTrigger><TabsTrigger value="confirmed">Confirmadas</TabsTrigger><TabsTrigger value="reversed">Estornadas</TabsTrigger></TabsList></Tabs>

        {filteredEntries?.length === 0 ? (
          <Card className="border-border/50"><CardContent className="py-16 text-center"><ShoppingCart className="h-10 w-10 mx-auto text-muted-foreground mb-3" /><p className="text-muted-foreground">{tab === "all" ? "Nenhuma entrada registrada" : "Nenhuma entrada neste status"}</p></CardContent></Card>
        ) : (
          <div className="space-y-3">
            {filteredEntries?.map((entry) => (
              <Card key={entry._id} className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm">{entry.entryNumber}</h3>
                        <Badge className={`text-[10px] ${STATUS_COLORS[entry.status]}`}>{STATUS_LABELS[entry.status]}</Badge>
                        {entry.importedFromXml && <Badge variant="secondary" className="text-[10px]">📄 NF-e XML</Badge>}
                        {entry.documentStorageId && !entry.importedFromXml && <Badge variant="secondary" className="text-[10px]">📄 NF anexada</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{entry.responsible?.name ?? "—"} • {new Date(entry.receivedAt).toLocaleDateString("pt-BR")} • {ORIGIN_LABELS[entry.originType]}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setViewId(entry._id)}><Eye className="h-3.5 w-3.5" /> Detalhes</Button>
                      {entry.status === "draft" && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => openEditDialog(entry)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
                          <Button size="sm" className="gap-1" onClick={() => handleConfirm(entry._id)} disabled={confirming}><CheckCircle className="h-3.5 w-3.5" /> {confirming ? "Confirmando..." : "Confirmar"}</Button>
                        </>
                      )}
                      {entry.status === "confirmed" && (
                        <Button size="sm" variant="destructive" className="gap-1" onClick={() => { setReverseId(entry._id); setReverseReason(""); setReverseModalOpen(true); }}><RotateCcw className="h-3.5 w-3.5" /> Estornar</Button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {entry.items?.slice(0, 5).map((item: any) => (<Badge key={item._id} variant="secondary" className="text-[10px]">{item.product?.name ?? "Item"}: +{item.quantity}</Badge>))}
                    {(entry.items?.length ?? 0) > 5 && <Badge variant="secondary" className="text-[10px]">+{(entry.items?.length ?? 0) - 5} mais</Badge>}
                  </div>
                  <div className="flex gap-4 text-[10px] text-muted-foreground">
                    {entry.supplier && <span>Fornecedor: {entry.supplier.legalName}</span>}
                    {entry.invoiceNumber && <span>NF: {entry.invoiceNumber}</span>}
                    {entry.purchaseAuthorizationNumber && <span>AF: {entry.purchaseAuthorizationNumber}</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ═══ View Detail Dialog ═══ */}
      <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewEntry?.entryNumber ?? "Entrada"}</DialogTitle></DialogHeader>
          {viewEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status:</span> <Badge className={`text-[10px] ${STATUS_COLORS[viewEntry.status]}`}>{STATUS_LABELS[viewEntry.status]}</Badge></div>
                <div><span className="text-muted-foreground">Origem:</span> {ORIGIN_LABELS[viewEntry.originType]}</div>
                <div><span className="text-muted-foreground">Recebido:</span> {new Date(viewEntry.receivedAt).toLocaleDateString("pt-BR")}</div>
                <div><span className="text-muted-foreground">Responsável:</span> {viewEntry.responsible?.name ?? "—"}</div>
                {viewEntry.supplier && <div><span className="text-muted-foreground">Fornecedor:</span> {viewEntry.supplier.legalName}</div>}
                {viewEntry.invoiceNumber && <div><span className="text-muted-foreground">NF:</span> {viewEntry.invoiceNumber}</div>}
                {viewEntry.invoiceDate && <div><span className="text-muted-foreground">Data NF:</span> {viewEntry.invoiceDate}</div>}
                {viewEntry.series && <div><span className="text-muted-foreground">Série:</span> {viewEntry.series}</div>}
                {viewEntry.totalValue != null && <div><span className="text-muted-foreground">Valor total NF:</span> R$ {viewEntry.totalValue.toFixed(2)}</div>}
                {viewEntry.accessKey && <div className="col-span-2"><span className="text-muted-foreground">Chave de acesso:</span> <span className="font-mono text-xs break-all">{viewEntry.accessKey}</span></div>}
                {viewEntry.purchaseAuthorizationNumber && <div><span className="text-muted-foreground">AF:</span> {viewEntry.purchaseAuthorizationNumber}</div>}
                {viewEntry.processNumber && <div><span className="text-muted-foreground">Processo:</span> {viewEntry.processNumber}</div>}
                {viewEntry.contractNumber && <div><span className="text-muted-foreground">Contrato:</span> {viewEntry.contractNumber}</div>}
              </div>
              {viewEntry.observation && <div className="text-sm"><span className="text-muted-foreground">Observação:</span> {viewEntry.observation}</div>}
              {viewEntry.documentStorageId && <div className="text-sm"><FileUpload storageId={viewEntry.documentStorageId} onUpload={() => {}} size="sm" label="Documento da entrada" disabled /></div>}
              {viewEntry.xmlStorageId && <div className="text-sm"><FileUpload storageId={viewEntry.xmlStorageId} onUpload={() => {}} size="sm" label="XML original da NF-e" disabled /></div>}
              <div>
                <h4 className="font-medium text-sm mb-2">Itens da Entrada</h4>
                <div className="border rounded-lg overflow-hidden">
                  <Table><TableHeader><TableRow><TableHead className="text-xs">Produto</TableHead><TableHead className="text-xs text-center">Qtd</TableHead><TableHead className="text-xs">UM</TableHead><TableHead className="text-xs">Marca/Modelo</TableHead><TableHead className="text-xs">Custo</TableHead><TableHead className="text-xs">Local</TableHead><TableHead className="text-xs">Foto</TableHead></TableRow></TableHeader>
                    <TableBody>{viewEntry.items?.map((item: any) => (
                      <TableRow key={item._id}><TableCell className="text-sm font-medium">{item.product?.name ?? "—"}</TableCell><TableCell className="text-center font-mono">{item.quantity}</TableCell><TableCell className="text-xs">{item.unitOfMeasure}</TableCell><TableCell className="text-xs text-muted-foreground">{item.brand ?? "—"} {item.model ? `/ ${item.model}` : ""}</TableCell><TableCell className="text-xs">{item.unitCost != null ? `R$ ${item.unitCost.toFixed(2)}` : "—"}</TableCell><TableCell className="text-xs text-muted-foreground">{item.location?.name ?? "—"}</TableCell><TableCell>{item.photoStorageId ? <FileUpload storageId={item.photoStorageId} onUpload={() => {}} size="sm" disabled /> : "—"}</TableCell></TableRow>
                    ))}</TableBody></Table>
                </div>
              </div>
              {viewEntry.lots && viewEntry.lots.length > 0 && <div><h4 className="font-medium text-sm mb-2">Lotes Gerados</h4><div className="flex flex-wrap gap-2">{viewEntry.lots?.map((lot: any) => (<Badge key={lot._id} variant={lot.active ? "default" : "secondary"} className="text-[10px] font-mono">{lot.lotNumber} — {lot.quantityAvailable}/{lot.quantityReceived} disp.</Badge>))}</div></div>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ Edit Draft Dialog ═══ */}
      <Dialog open={!!editEntryId} onOpenChange={(open) => { if (!open) setEditEntryId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Entrada — Rascunho</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="border rounded-lg p-3 bg-muted/30">
              <Label className="text-xs font-medium">Documento da Entrada (NF / Imagem)</Label>
              <FileUpload storageId={eDocStorageId} onUpload={seteDocStorageId} onRemove={() => seteDocStorageId("")} accept="image/*,.pdf" label="Anexar NF ou documento da entrada" />
            </div>
            <div>
              <Label className="text-xs">Observação</Label>
              <Textarea value={eObservation} onChange={(e) => seteObservation(e.target.value)} rows={2} placeholder="Observação da entrada" className="mt-1" />
            </div>
            <div className="flex items-center justify-between mt-2">
              <Label className="text-sm font-medium">Itens da Entrada *</Label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={handleAddItem}><Plus className="h-3 w-3" /> Adicionar Item</Button>
                <Button size="sm" className="gap-1" onClick={handleSaveAllItems} disabled={saving}><Save className="h-3 w-3" /> {saving ? "Salvando..." : "Salvar Todos os Itens"}</Button>
              </div>
            </div>
            {eItems.map((_, idx) => (<EditItemCard key={eItemIds[idx] ?? idx} idx={idx} />))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntryId(null)}>Fechar</Button>
            <Button onClick={() => editEntryId && handleConfirm(editEntryId)} disabled={confirming}><CheckCircle className="h-3.5 w-3.5 mr-1" /> {confirming ? "Confirmando..." : "Confirmar Entrada"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ New Entry Dialog ═══ */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) resetCreateForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova Entrada de Estoque</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data de Recebimento *</Label><Input type="date" value={cReceivedAt} onChange={(e) => setCReceivedAt(e.target.value)} className="mt-1" /></div>
              <div><Label>Origem *</Label><Select value={cOriginType} onValueChange={setcOriginType}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ORIGIN_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fornecedor</Label><div className="flex gap-1"><Select value={cSupplierId} onValueChange={setcSupplierId}><SelectTrigger className="mt-1 flex-1"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{suppliers?.map((s) => (<SelectItem key={s._id} value={s._id}>{s.legalName}</SelectItem>))}</SelectContent></Select><Button type="button" variant="outline" size="icon" className="mt-1 h-9 w-9 shrink-0" onClick={() => setSupplierModalOpen(true)} title="Novo fornecedor"><Plus className="h-4 w-4" /></Button></div></div>
              <div><Label>Nº Nota Fiscal</Label><Input value={cInvoiceNumber} onChange={(e) => setcInvoiceNumber(e.target.value)} placeholder="Opcional" className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Data NF</Label><Input type="date" value={cInvoiceDate} onChange={(e) => setcInvoiceDate(e.target.value)} className="mt-1" /></div>
              <div><Label>Nº AF</Label><Input value={cPurchaseAuth} onChange={(e) => setcPurchaseAuth(e.target.value)} placeholder="Opcional" className="mt-1" /></div>
              <div><Label>Nº Processo</Label><Input value={cProcessNumber} onChange={(e) => setcProcessNumber(e.target.value)} placeholder="Opcional" className="mt-1" /></div>
            </div>
            <div><Label>Nº Contrato</Label><Input value={cContractNumber} onChange={(e) => setcContractNumber(e.target.value)} placeholder="Opcional" className="mt-1" /></div>
            <div className="border rounded-lg p-3 bg-muted/30"><Label className="text-xs font-medium">Documento da Entrada (NF / Imagem)</Label><FileUpload storageId={cDocStorageId} onUpload={setcDocStorageId} onRemove={() => setcDocStorageId("")} accept="image/*,.pdf" label="Anexar NF ou documento" /></div>
            <div><Label>Observação</Label><Textarea value={cObservation} onChange={(e) => setcObservation(e.target.value)} rows={2} placeholder="Opcional" className="mt-1" /></div>
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2"><Label className="text-sm font-medium">Itens da Entrada *</Label><Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-1 text-primary" onClick={() => setProductModalOpen(true)}><ExternalLink className="h-3 w-3" /> Novo Item</Button></div>
              {cItems.map((item, idx) => (
                <div key={idx} className="border rounded-lg p-3 mb-2 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>{cItems.length > 1 && <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCItems(cItems.filter((_, i) => i !== idx))}><Trash2 className="h-3 w-3 text-destructive" /></Button>}</div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-2"><Label className="text-xs">Produto *</Label><Select value={item.productId} onValueChange={(v) => updateCItem(idx, "productId", v)}><SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{products?.map((p) => (<SelectItem key={p._id} value={p._id}>{p.name} {p.brand ? `(${p.brand})` : ""}</SelectItem>))}</SelectContent></Select></div>
                    <div><Label className="text-xs">Quantidade *</Label><Input type="number" min="1" value={item.quantity} onChange={(e) => updateCItem(idx, "quantity", e.target.value)} className="mt-1 h-8" /></div>
                    <div><Label className="text-xs">Unidade</Label><Select value={item.unitOfMeasure} onValueChange={(v) => updateCItem(idx, "unitOfMeasure", v)}><SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger><SelectContent>{UNITS_OF_MEASURE.map((u) => (<SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>))}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div><Label className="text-xs">Marca</Label><Input value={item.brand} onChange={(e) => updateCItem(idx, "brand", e.target.value)} className="mt-1 h-8" /></div>
                    <div><Label className="text-xs">Modelo</Label><Input value={item.model} onChange={(e) => updateCItem(idx, "model", e.target.value)} className="mt-1 h-8" /></div>
                    <div><Label className="text-xs">Custo Unit.</Label><Input type="number" step="0.01" min="0" value={item.unitCost} onChange={(e) => updateCItem(idx, "unitCost", e.target.value)} placeholder="R$" className="mt-1 h-8" /></div>
                    <div><Label className="text-xs">Local</Label><Select value={item.locationId} onValueChange={(v) => updateCItem(idx, "locationId", v)}><SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{locations?.map((l) => (<SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>))}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Lote do Fornecedor</Label><Input value={item.supplierLotNumber} onChange={(e) => updateCItem(idx, "supplierLotNumber", e.target.value)} placeholder="Lote impresso na embalagem (opcional)" className="mt-1 h-8" /></div>
                    <div><Label className="text-xs">Especificação</Label><Input value={item.specification} onChange={(e) => updateCItem(idx, "specification", e.target.value)} placeholder="Opcional" className="mt-1 h-8" /></div>
                  </div>
                  <div><Label className="text-xs">Foto do Item</Label><FileUpload storageId={item.photoStorageId} onUpload={(sid) => updateCItem(idx, "photoStorageId", sid)} onRemove={() => updateCItem(idx, "photoStorageId", "")} size="sm" label="Foto do item recebido" /></div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1 mt-2" onClick={() => setCItems([...cItems, { ...EMPTY_ITEM }])}><Plus className="h-3 w-3" /> Adicionar Item</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateDialogOpen(false); resetCreateForm(); }}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? "Criando..." : "Criar Entrada (Rascunho)"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Import NF-e XML Dialog ═══ */}
      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) resetImport(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Importar NF-e XML</DialogTitle></DialogHeader>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={importStep === "file" ? "font-semibold text-primary" : ""}>1. Arquivo</span><span>→</span>
            <span className={importStep === "review" ? "font-semibold text-primary" : ""}>2. Conferir itens</span><span>→</span>
            <span className={importStep === "location" ? "font-semibold text-primary" : ""}>3. Localização e confirmação</span>
          </div>

          {importStep === "file" && (
            <div className="space-y-4 py-3">
              <input
                ref={nfeFileInputRef}
                type="file"
                accept=".xml,application/xml,text/xml"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleNfeFile(f); e.target.value = ""; }}
              />
              <div
                className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => nfeFileInputRef.current?.click()}
              >
                {importLoading ? (
                  <><Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" /><p className="mt-3 text-sm text-muted-foreground">Lendo a NF-e...</p></>
                ) : (
                  <>
                    <FileUp className="h-8 w-8 mx-auto text-primary" />
                    <p className="mt-3 text-sm font-medium">Selecione o arquivo XML da NF-e</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">O sistema lê os dados da nota e monta uma entrada em modo de conferência. O estoque só é alterado após a sua confirmação.</p>
                  </>
                )}
              </div>
              {importError && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{importError}</div>}
            </div>
          )}

          {importStep === "review" && nfe && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-emerald-50/60 p-3 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                <p className="text-sm font-medium text-emerald-800">NF encontrada — confira os dados e a associação dos itens</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="col-span-2">
                  <span className="text-muted-foreground">Fornecedor: </span>
                  {nfeSupplierFound && nfeSupplierId ? (
                    <span className="font-medium">{suppliers?.find((s) => s._id === nfeSupplierId)?.legalName ?? nfe.emitterName}</span>
                  ) : (
                    <span className="text-amber-700 font-medium">Fornecedor não cadastrado ({nfe.emitterName})</span>
                  )}
                </div>
                <div><span className="text-muted-foreground">NF:</span> <span className="font-medium">{nfe.number}</span></div>
                <div><span className="text-muted-foreground">Série:</span> <span className="font-medium">{nfe.series || "—"}</span></div>
                <div><span className="text-muted-foreground">Data de emissão:</span> <span className="font-medium">{nfe.emissionDate ? new Date(nfe.emissionDate + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</span></div>
                <div><span className="text-muted-foreground">Valor total:</span> <span className="font-medium">{nfe.totalValue != null ? `R$ ${nfe.totalValue.toFixed(2)}` : "—"}</span></div>
                <div className="col-span-2 sm:col-span-3"><span className="text-muted-foreground">Chave de acesso:</span> <span className="font-mono text-[10px] break-all">{nfe.accessKey}</span></div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!nfeSupplierFound && (
                  <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => { setNewSupplierName(nfe.emitterName ?? ""); setNewSupplierCnpj(nfe.emitterCnpj ?? ""); setSupplierModalOpen(true); }}>
                    <Plus className="h-3 w-3" /> Cadastrar fornecedor
                  </Button>
                )}
                {!nfeSupplierFound && nfeSupplierId && <span className="text-xs text-emerald-700">✓ {suppliers?.find((s) => s._id === nfeSupplierId)?.legalName}</span>}
                <Select value={nfeSupplierId} onValueChange={(v) => { setNfeSupplierId(v); setNfeSupplierFound(true); }}>
                  <SelectTrigger className="h-7 w-52 text-xs"><SelectValue placeholder="Selecionar fornecedor" /></SelectTrigger>
                  <SelectContent>{suppliers?.map((s) => (<SelectItem key={s._id} value={s._id}>{s.legalName}</SelectItem>))}</SelectContent>
                </Select>
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[10px]">Pedido/contrato:</span>
                  <Input value={nfeContract} onChange={(e) => setNfeContract(e.target.value)} placeholder="Opcional" className="h-7 w-40 text-xs" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <Badge className="text-[10px] bg-emerald-50 text-emerald-700">🟢 {nfeItems.filter((r) => r.matchStatus === "found").length} encontrados</Badge>
                <Badge className="text-[10px] bg-amber-50 text-amber-700">🟡 {nfeItems.filter((r) => r.matchStatus === "possible").length} possíveis</Badge>
                <Badge className="text-[10px] bg-rose-50 text-rose-700">🔴 {nfeItems.filter((r) => r.matchStatus === "not_found").length} não encontrados</Badge>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table><TableHeader><TableRow><TableHead className="text-xs">#</TableHead><TableHead className="text-xs">Produto da NF</TableHead><TableHead className="text-xs text-center">Qtd</TableHead><TableHead className="text-xs">Unid.</TableHead><TableHead className="text-xs">Situação</TableHead><TableHead className="text-xs">Produto SIGESGD</TableHead></TableRow></TableHeader>
                  <TableBody>{nfeItems.map((r, idx) => (
                    <TableRow key={idx} className={!r.productId ? "bg-rose-50/40" : ""}>
                      <TableCell className="text-xs text-muted-foreground">{r.item.lineNumber}</TableCell>
                      <TableCell className="text-xs max-w-[220px]">
                        <p className="font-medium leading-tight">{r.item.description}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{r.item.code}{r.item.ncm ? ` · NCM ${r.item.ncm}` : ""}{r.item.cfop ? ` · CFOP ${r.item.cfop}` : ""}</p>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">{r.item.quantity}</TableCell>
                      <TableCell className="text-xs">{r.item.unit}</TableCell>
                      <TableCell>{renderMatchBadge(r.matchStatus)}</TableCell>
                      <TableCell className="min-w-[180px]">
                        <div className="flex items-center gap-1">
                          <Select value={r.productId} onValueChange={(v) => {
                            const n = [...nfeItems]; n[idx].productId = v; n[idx].matchStatus = "found"; setNfeItems(n);
                          }}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                            <SelectContent>{products?.map((p) => (<SelectItem key={p._id} value={p._id}>{p.name}{p.brand ? ` (${p.brand})` : ""}</SelectItem>))}</SelectContent>
                          </Select>
                          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Cadastrar produto" onClick={() => openProductModalForImport(idx)}><Plus className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}</TableBody></Table>
                </div>

                <div className="flex justify-between pt-2">
                  <Button variant="outline" onClick={() => { setImportStep("file"); setImportError(""); }}>Voltar</Button>
                  <Button onClick={() => {
                    if (nfeItems.some((r) => !r.productId)) { toast.error("Todos os itens precisam de um produto associado (🟡 confirme ou cadastre os 🔴)"); return; }
                    setImportStep("location");
                  }}>Continuar → Localização</Button>
                </div>
              </div>
          )}

          {importStep === "location" && nfe && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">Escolha onde os materiais serão guardados. O XML não pode definir isso — é uma informação interna da Secretaria.</p>

              <div>
                <Label className="text-xs">Local padrão (aplica a todos os itens) *</Label>
                <Select value={importLocationId} onValueChange={(v) => {
                  setImportLocationId(v);
                  setNfeItems(nfeItems.map((r) => ({ ...r, locationId: v })));
                }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Ex: Armário TI 02" /></SelectTrigger>
                  <SelectContent>{locations?.map((l) => (<SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>

              <div className="border rounded-lg divide-y">
                {nfeItems.map((r, idx) => (
                  <div key={idx} className="p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <div className="sm:col-span-5"><p className="text-xs font-medium leading-tight">{r.item.description}</p><p className="text-[10px] text-muted-foreground font-mono">{r.item.code} · {r.item.quantity} {r.item.unit}</p></div>
                    <div className="sm:col-span-4">
                      <Select value={r.locationId} onValueChange={(v) => { const n = [...nfeItems]; n[idx].locationId = v; setNfeItems(n); }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Local (opcional)" /></SelectTrigger>
                        <SelectContent>{locations?.map((l) => (<SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-3">
                      <Input value={r.supplierLot} onChange={(e) => { const n = [...nfeItems]; n[idx].supplierLot = e.target.value; setNfeItems(n); }} placeholder="Lote do fornecedor" className="h-8 text-xs" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="border rounded-lg p-3 bg-muted/30">
                <Label className="text-xs font-medium">Documentos da entrega (opcional)</Label>
                <FileUpload storageId={importDocStorageId} onUpload={setImportDocStorageId} onRemove={() => setImportDocStorageId("")} accept="image/*,.pdf" label="PDF/DANFE ou foto da entrega" />
              </div>
              <div><Label className="text-xs">Observação interna</Label><Textarea value={importObservation} onChange={(e) => setImportObservation(e.target.value)} rows={2} placeholder="Opcional" className="mt-1" /></div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setImportStep("review")} disabled={importSaving}>Voltar</Button>
                <Button onClick={handleConfirmImport} disabled={importSaving} className="gap-1.5">
                  {importSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Registrando...</> : <><CheckCircle className="h-4 w-4" /> Confirmar entrada</>}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">A confirmação efetiva a entrada: estoque, lote, movimentação e auditoria. Antes disso, nada é alterado.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ Reverse Modal ═══ */}
      <Dialog open={reverseModalOpen} onOpenChange={setReverseModalOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Estornar Entrada</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2"><p className="text-sm text-muted-foreground">O estorno irá deduzir a quantidade desta entrada do saldo. Esta ação não pode ser desfeita.</p>
            <div><Label>Motivo do Estorno *</Label><Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} rows={3} placeholder="Informe o motivo..." className="mt-1" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setReverseModalOpen(false)}>Cancelar</Button><Button variant="destructive" onClick={handleReverse}>Confirmar Estorno</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Quick Create Product ═══ */}
      <Dialog open={productModalOpen} onOpenChange={setProductModalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><ExternalLink className="h-4 w-4" /> Criar Item Rápido</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nome *</Label><Input value={npName} onChange={(e) => setNpName(e.target.value)} placeholder="Ex: SSD 480 GB SATA" /></div>
            <div><Label>Categoria *</Label>{categories && categories.length === 0 ? (<div className="flex items-center gap-2 mt-1"><p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p><Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setCategoryModalOpen(true)}>+ Criar categoria</Button></div>) : (<div className="flex gap-1"><Select value={npCatId} onValueChange={setNpCatId}><SelectTrigger className="flex-1"><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{categories?.map((c) => (<SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>))}</SelectContent></Select><Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setCategoryModalOpen(true)} title="Nova categoria"><Plus className="h-4 w-4" /></Button></div>)}</div>
            <div><Label>Código interno</Label><Input value={npInternalCode} onChange={(e) => setNpInternalCode(e.target.value)} placeholder="Código do fornecedor (permite reconhecer em próximas NFs)" /></div>
            <div><Label>Unidade</Label><Select value={npUnit} onValueChange={setNpUnit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UNITS_OF_MEASURE.map((u) => (<SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>))}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Marca</Label><Input value={npBrand} onChange={(e) => setNpBrand(e.target.value)} placeholder="Opcional" /></div><div><Label>Modelo</Label><Input value={npModel} onChange={(e) => setNpModel(e.target.value)} placeholder="Opcional" /></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setProductModalOpen(false)}>Cancelar</Button><Button onClick={handleQuickCreateProduct}>Criar e Selecionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ═══ Quick Create Supplier ═══ */}
      <Dialog open={supplierModalOpen} onOpenChange={setSupplierModalOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Novo Fornecedor</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Razão Social *</Label><Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="Nome do fornecedor" /></div>
            <div><Label>CNPJ</Label><Input value={newSupplierCnpj} onChange={(e) => setNewSupplierCnpj(e.target.value)} placeholder="Opcional" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setSupplierModalOpen(false); setNewSupplierName(""); setNewSupplierCnpj(""); }}>Cancelar</Button><Button onClick={handleQuickCreateSupplier}>Criar e Selecionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Quick Create Category ═══ */}
      <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
        <DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Nova Categoria</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nome da Categoria *</Label><Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Ex: Toner, Cabo, Memória" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setCategoryModalOpen(false); setNewCategoryName(""); }}>Cancelar</Button><Button onClick={handleQuickCreateCategory}>Criar e Selecionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
