import { useState, useCallback } from "react";
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
import { Plus, ShoppingCart, CheckCircle, RotateCcw, Eye, Trash2, ExternalLink, Save, Pencil } from "lucide-react";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";
import { FileUpload } from "@/components/FileUpload";
import { toast } from "sonner";

const ORIGIN_LABELS: Record<string, string> = {
  purchase: "Compra", donation: "Doação", transfer: "Transferência",
  return: "Devolução", initial_inventory: "Inventário Inicial", other: "Outro",
};
const STATUS_LABELS: Record<string, string> = { draft: "Rascunho", confirmed: "Confirmada", reversed: "Estornada" };
const STATUS_COLORS: Record<string, string> = { draft: "text-amber-600 bg-amber-50", confirmed: "text-emerald-600 bg-emerald-50", reversed: "text-red-600 bg-red-50" };

type EntryItemDraft = {
  productId: string; quantity: string; unitOfMeasure: string; unitCost: string;
  brand: string; model: string; specification: string; locationId: string; observation: string;
  photoStorageId: string;
};
const EMPTY_ITEM: EntryItemDraft = { productId: "", quantity: "1", unitOfMeasure: "un", unitCost: "", brand: "", model: "", specification: "", locationId: "", observation: "", photoStorageId: "" };

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
  const createProduct = useMutation(api.products.create);

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

  // ─── Quick create product ───
  const handleQuickCreateProduct = async () => {
    if (!npName.trim()) { toast.error("Nome é obrigatório"); return; }
    if (!npCatId) { toast.error("Selecione categoria"); return; }
    try {
      const newId = await createProduct({ name: npName.trim(), categoryId: npCatId as any, unitOfMeasure: npUnit, brand: npBrand || undefined, model: npModel || undefined, minimumStock: 0, idealStock: 0, maximumStock: 0 });
      const n = [...cItems]; n[cItems.length - 1].productId = newId as string; setCItems(n);
      setProductModalOpen(false); setNpName(""); setNpCatId(""); setNpUnit("un"); setNpBrand(""); setNpModel("");
      toast.success("Item criado e selecionado");
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar item"); }
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
          <div><h1 className="text-2xl font-bold tracking-tight">Entradas</h1><p className="text-sm text-muted-foreground">Entradas de estoque com rastreabilidade por lote — {entries?.length ?? 0} entrada(s)</p></div>
          <Button onClick={() => { resetCreateForm(); setCreateDialogOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> Nova Entrada</Button>
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
                        {entry.documentStorageId && <Badge variant="secondary" className="text-[10px]">📄 NF anexada</Badge>}
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
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status:</span> <Badge className={`text-[10px] ${STATUS_COLORS[viewEntry.status]}`}>{STATUS_LABELS[viewEntry.status]}</Badge></div>
                <div><span className="text-muted-foreground">Origem:</span> {ORIGIN_LABELS[viewEntry.originType]}</div>
                <div><span className="text-muted-foreground">Recebido:</span> {new Date(viewEntry.receivedAt).toLocaleDateString("pt-BR")}</div>
                <div><span className="text-muted-foreground">Responsável:</span> {viewEntry.responsible?.name ?? "—"}</div>
                {viewEntry.supplier && <div><span className="text-muted-foreground">Fornecedor:</span> {viewEntry.supplier.legalName}</div>}
                {viewEntry.invoiceNumber && <div><span className="text-muted-foreground">NF:</span> {viewEntry.invoiceNumber}</div>}
                {viewEntry.invoiceDate && <div><span className="text-muted-foreground">Data NF:</span> {viewEntry.invoiceDate}</div>}
                {viewEntry.purchaseAuthorizationNumber && <div><span className="text-muted-foreground">AF:</span> {viewEntry.purchaseAuthorizationNumber}</div>}
                {viewEntry.processNumber && <div><span className="text-muted-foreground">Processo:</span> {viewEntry.processNumber}</div>}
                {viewEntry.contractNumber && <div><span className="text-muted-foreground">Contrato:</span> {viewEntry.contractNumber}</div>}
              </div>
              {viewEntry.observation && <div className="text-sm"><span className="text-muted-foreground">Observação:</span> {viewEntry.observation}</div>}
              {viewEntry.documentStorageId && <div className="text-sm"><FileUpload storageId={viewEntry.documentStorageId} onUpload={() => {}} size="sm" label="Documento da entrada" disabled /></div>}
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
              <div><Label>Fornecedor</Label><Select value={cSupplierId} onValueChange={setcSupplierId}><SelectTrigger className="mt-1"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{suppliers?.map((s) => (<SelectItem key={s._id} value={s._id}>{s.legalName}</SelectItem>))}</SelectContent></Select></div>
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
            <div><Label>Categoria *</Label><Select value={npCatId} onValueChange={setNpCatId}><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{categories?.map((c) => (<SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>))}</SelectContent></Select></div>
            <div><Label>Unidade</Label><Select value={npUnit} onValueChange={setNpUnit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UNITS_OF_MEASURE.map((u) => (<SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>))}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Marca</Label><Input value={npBrand} onChange={(e) => setNpBrand(e.target.value)} placeholder="Opcional" /></div><div><Label>Modelo</Label><Input value={npModel} onChange={(e) => setNpModel(e.target.value)} placeholder="Opcional" /></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setProductModalOpen(false)}>Cancelar</Button><Button onClick={handleQuickCreateProduct}>Criar e Selecionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
