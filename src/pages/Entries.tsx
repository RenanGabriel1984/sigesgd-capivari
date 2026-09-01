import { useState, useRef } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ShoppingCart, CheckCircle, RotateCcw, XCircle, Eye, Camera, Trash2, ExternalLink, MoreHorizontal } from "lucide-react";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";
import { toast } from "sonner";

const ORIGIN_LABELS: Record<string, string> = {
  purchase: "Compra",
  donation: "Doação",
  transfer: "Transferência",
  return: "Devolução",
  initial_inventory: "Inventário Inicial",
  other: "Outro",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  confirmed: "Confirmada",
  reversed: "Estornada",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "text-amber-600 bg-amber-50",
  confirmed: "text-emerald-600 bg-emerald-50",
  reversed: "text-red-600 bg-red-50",
};

type EntryItem = {
  productId: string;
  quantity: string;
  unitOfMeasure: string;
  unitCost: string;
  brand: string;
  model: string;
  specification: string;
  locationId: string;
  observation: string;
};

const EMPTY_ITEM: EntryItem = {
  productId: "",
  quantity: "1",
  unitOfMeasure: "un",
  unitCost: "",
  brand: "",
  model: "",
  specification: "",
  locationId: "",
  observation: "",
};

export default function Entries() {
  const entries = useQuery(api.entries.list);
  const products = useQuery(api.products.listActive);
  const suppliers = useQuery(api.suppliers.listActive);
  const locations = useQuery(api.storageLocations.listActive);
  const categories = useQuery(api.categories.listActive);
  const createEntry = useMutation(api.entries.create);
  const confirmEntry = useMutation(api.entries.confirm);
  const reverseEntry = useMutation(api.entries.reverse);

  const [tab, setTab] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  // New entry form state
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [originType, setOriginType] = useState("purchase");
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [purchaseAuthNumber, setPurchaseAuthNumber] = useState("");
  const [processNumber, setProcessNumber] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [entryObservation, setEntryObservation] = useState("");
  const [items, setItems] = useState<EntryItem[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Quick-create product
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductCategoryId, setNewProductCategoryId] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("un");
  const [newProductBrand, setNewProductBrand] = useState("");
  const [newProductModel, setNewProductModel] = useState("");
  const createProduct = useMutation(api.products.create);

  const viewEntry = entries?.find((e) => e._id === viewId);

  const filteredEntries = entries?.filter((e) => {
    if (tab === "all") return true;
    if (tab === "draft") return e.status === "draft";
    if (tab === "confirmed") return e.status === "confirmed";
    if (tab === "reversed") return e.status === "reversed";
    return true;
  });

  // ─── Item management ───
  const addItem = () => setItems([...items, { ...EMPTY_ITEM }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof EntryItem, value: string) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = value;
    // Auto-fill unit of measure from product
    if (field === "productId" && value) {
      const product = products?.find((p) => p._id === value);
      if (product) {
        newItems[idx].unitOfMeasure = product.unitOfMeasure;
        newItems[idx].brand = product.brand ?? "";
        newItems[idx].model = product.model ?? "";
      }
    }
    setItems(newItems);
  };

  const resetForm = () => {
    setReceivedAt(new Date().toISOString().slice(0, 10));
    setOriginType("purchase");
    setSupplierId("");
    setInvoiceNumber("");
    setInvoiceDate("");
    setPurchaseAuthNumber("");
    setProcessNumber("");
    setContractNumber("");
    setEntryObservation("");
    setItems([{ ...EMPTY_ITEM }]);
  };

  // ─── Create draft entry ───
  const handleCreate = async () => {
    const validItems = items.filter((i) => i.productId && Number(i.quantity) > 0);
    if (validItems.length === 0) {
      toast.error("Adicione pelo menos um item válido");
      return;
    }

    setSaving(true);
    try {
      const receivedAtMs = new Date(receivedAt + "T12:00:00").getTime();
      await createEntry({
        receivedAt: receivedAtMs,
        originType: originType as any,
        supplierId: supplierId ? (supplierId as any) : undefined,
        invoiceNumber: invoiceNumber || undefined,
        invoiceDate: invoiceDate || undefined,
        purchaseAuthorizationNumber: purchaseAuthNumber || undefined,
        processNumber: processNumber || undefined,
        contractNumber: contractNumber || undefined,
        observation: entryObservation || undefined,
        items: validItems.map((i) => ({
          productId: i.productId as any,
          quantity: Number(i.quantity),
          unitOfMeasure: i.unitOfMeasure,
          unitCost: i.unitCost ? Number(i.unitCost) : undefined,
          brand: i.brand || undefined,
          model: i.model || undefined,
          specification: i.specification || undefined,
          locationId: i.locationId ? (i.locationId as any) : undefined,
          observation: i.observation || undefined,
        })),
      });
      toast.success("Entrada criada como rascunho");
      setDialogOpen(false);
      resetForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar entrada");
    }
    setSaving(false);
  };

  // ─── Confirm entry ───
  const handleConfirm = async (entryId: string) => {
    setConfirming(true);
    try {
      await confirmEntry({ entryId: entryId as any });
      toast.success("Entrada confirmada — estoque atualizado");
      setViewId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao confirmar entrada");
    }
    setConfirming(false);
  };

  // ─── Reverse entry ───
  const handleReverse = async () => {
    if (!reverseId || !reverseReason.trim()) {
      toast.error("Motivo do estorno é obrigatório");
      return;
    }
    try {
      await reverseEntry({ entryId: reverseId as any, reason: reverseReason.trim() });
      toast.success("Entrada estornada com sucesso");
      setReverseModalOpen(false);
      setReverseId(null);
      setReverseReason("");
      setViewId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao estornar entrada");
    }
  };

  // ─── Quick create product ───
  const handleQuickCreateProduct = async () => {
    if (!newProductName.trim()) { toast.error("Nome é obrigatório"); return; }
    if (!newProductCategoryId) { toast.error("Selecione uma categoria"); return; }
    try {
      const newId = await createProduct({
        name: newProductName.trim(),
        categoryId: newProductCategoryId as any,
        unitOfMeasure: newProductUnit,
        brand: newProductBrand || undefined,
        model: newProductModel || undefined,
        minimumStock: 0, idealStock: 0, maximumStock: 0,
      });
      const newItems = [...items];
      newItems[items.length - 1].productId = newId as string;
      setItems(newItems);
      setProductModalOpen(false);
      setNewProductName(""); setNewProductCategoryId(""); setNewProductUnit("un");
      setNewProductBrand(""); setNewProductModel("");
      toast.success("Item criado e selecionado");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar item");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Entradas</h1>
            <p className="text-sm text-muted-foreground">
              Entradas de estoque com rastreabilidade por lote — {entries?.length ?? 0} entrada(s)
            </p>
          </div>
          <Button onClick={() => { resetForm(); setDialogOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> Nova Entrada
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">Todas</TabsTrigger>
            <TabsTrigger value="draft">Rascunho</TabsTrigger>
            <TabsTrigger value="confirmed">Confirmadas</TabsTrigger>
            <TabsTrigger value="reversed">Estornadas</TabsTrigger>
          </TabsList>
        </Tabs>

        {filteredEntries?.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <ShoppingCart className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {tab === "all" ? "Nenhuma entrada registrada" : "Nenhuma entrada neste status"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredEntries?.map((entry) => (
              <Card key={entry._id} className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">{entry.entryNumber}</h3>
                          <Badge className={`text-[10px] ${STATUS_COLORS[entry.status]}`}>
                            {STATUS_LABELS[entry.status]}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {entry.responsible?.name ?? "—"} • {new Date(entry.receivedAt).toLocaleDateString("pt-BR")} • {ORIGIN_LABELS[entry.originType]}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setViewId(entry._id)}>
                        <Eye className="h-3.5 w-3.5" /> Detalhes
                      </Button>
                      {entry.status === "draft" && (
                        <Button size="sm" className="gap-1" onClick={() => handleConfirm(entry._id)} disabled={confirming}>
                          <CheckCircle className="h-3.5 w-3.5" /> {confirming ? "Confirmando..." : "Confirmar"}
                        </Button>
                      )}
                      {entry.status === "confirmed" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          onClick={() => { setReverseId(entry._id); setReverseReason(""); setReverseModalOpen(true); }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Estornar
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Summary of items */}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {entry.items?.slice(0, 5).map((item: any) => (
                      <Badge key={item._id} variant="secondary" className="text-[10px]">
                        {item.product?.name ?? "Item"}: +{item.quantity}
                      </Badge>
                    ))}
                    {(entry.items?.length ?? 0) > 5 && (
                      <Badge variant="secondary" className="text-[10px]">+{(entry.items?.length ?? 0) - 5} mais</Badge>
                    )}
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

      {/* ═══ Detail Dialog ═══ */}
      <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewEntry?.entryNumber ?? "Entrada"}</DialogTitle>
          </DialogHeader>
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

              {viewEntry.observation && (
                <div className="text-sm"><span className="text-muted-foreground">Observação:</span> {viewEntry.observation}</div>
              )}

              <div>
                <h4 className="font-medium text-sm mb-2">Itens da Entrada</h4>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Produto</TableHead>
                        <TableHead className="text-xs text-center">Qtd</TableHead>
                        <TableHead className="text-xs">UM</TableHead>
                        <TableHead className="text-xs">Marca/Modelo</TableHead>
                        <TableHead className="text-xs">Custo Unit.</TableHead>
                        <TableHead className="text-xs">Local</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewEntry.items?.map((item: any) => (
                        <TableRow key={item._id}>
                          <TableCell className="text-sm font-medium">{item.product?.name ?? "—"}</TableCell>
                          <TableCell className="text-center font-mono">{item.quantity}</TableCell>
                          <TableCell className="text-xs">{item.unitOfMeasure}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.brand ?? "—"} {item.model ? `/ ${item.model}` : ""}</TableCell>
                          <TableCell className="text-xs">{item.unitCost != null ? `R$ ${item.unitCost.toFixed(2)}` : "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.location?.name ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {viewEntry.lots && viewEntry.lots.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2">Lotes Gerados</h4>
                  <div className="flex flex-wrap gap-2">
                    {viewEntry.lots?.map((lot: any) => (
                      <Badge key={lot._id} variant={lot.active ? "default" : "secondary"} className="text-[10px] font-mono">
                        {lot.lotNumber} — {lot.quantityAvailable}/{lot.quantityReceived} disp.
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ New Entry Dialog ═══ */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Entrada de Estoque</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data de Recebimento *</Label>
                <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Origem *</Label>
                <Select value={originType} onValueChange={setOriginType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ORIGIN_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fornecedor</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>
                    {suppliers?.map((s) => (
                      <SelectItem key={s._id} value={s._id}>{s.legalName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Nº Nota Fiscal</Label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Opcional" className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Data NF</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Nº Autorização de Fornecimento</Label>
                <Input value={purchaseAuthNumber} onChange={(e) => setPurchaseAuthNumber(e.target.value)} placeholder="Opcional" className="mt-1" />
              </div>
              <div>
                <Label>Nº Processo</Label>
                <Input value={processNumber} onChange={(e) => setProcessNumber(e.target.value)} placeholder="Opcional" className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Nº Contrato</Label>
              <Input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} placeholder="Opcional" className="mt-1" />
            </div>

            <div>
              <Label>Observação</Label>
              <Textarea value={entryObservation} onChange={(e) => setEntryObservation(e.target.value)} rows={2} placeholder="Opcional" className="mt-1" />
            </div>

            {/* Items */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Itens da Entrada *</Label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-1 text-primary" onClick={() => setProductModalOpen(true)}>
                    <ExternalLink className="h-3 w-3" /> Novo Item
                  </Button>
                </div>
              </div>

              {items.map((item, idx) => (
                <div key={idx} className="border rounded-lg p-3 mb-2 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                    {items.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-2">
                      <Label className="text-xs">Produto *</Label>
                      <Select value={item.productId} onValueChange={(v) => updateItem(idx, "productId", v)}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                        <SelectContent>
                          {products?.map((p) => (
                            <SelectItem key={p._id} value={p._id}>{p.name} {p.brand ? `(${p.brand})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Quantidade *</Label>
                      <Input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} className="mt-1 h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">Unidade</Label>
                      <Select value={item.unitOfMeasure} onValueChange={(v) => updateItem(idx, "unitOfMeasure", v)}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {UNITS_OF_MEASURE.map((u) => (
                            <SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <Label className="text-xs">Marca</Label>
                      <Input value={item.brand} onChange={(e) => updateItem(idx, "brand", e.target.value)} className="mt-1 h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">Modelo</Label>
                      <Input value={item.model} onChange={(e) => updateItem(idx, "model", e.target.value)} className="mt-1 h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">Custo Unitário</Label>
                      <Input type="number" step="0.01" min="0" value={item.unitCost} onChange={(e) => updateItem(idx, "unitCost", e.target.value)} placeholder="R$" className="mt-1 h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">Local</Label>
                      <Select value={item.locationId} onValueChange={(v) => updateItem(idx, "locationId", v)}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Opcional" /></SelectTrigger>
                        <SelectContent>
                          {locations?.map((l) => (
                            <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}

              <Button variant="outline" size="sm" className="gap-1 mt-2" onClick={addItem}>
                <Plus className="h-3 w-3" /> Adicionar Item
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Criando..." : "Criar Entrada (Rascunho)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Reverse Modal ═══ */}
      <Dialog open={reverseModalOpen} onOpenChange={setReverseModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Estornar Entrada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              O estorno irá deduzir a quantidade desta entrada do saldo atual do produto.
              Esta ação não pode ser desfeita.
            </p>
            <div>
              <Label>Motivo do Estorno *</Label>
              <Textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={3}
                placeholder="Informe o motivo do estorno..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseModalOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReverse}>
              Confirmar Estorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Quick Create Product ═══ */}
      <Dialog open={productModalOpen} onOpenChange={setProductModalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4" /> Criar Item Rápido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nome *</Label><Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="Ex: SSD 480 GB SATA" /></div>
            <div><Label>Categoria *</Label>
              <Select value={newProductCategoryId} onValueChange={setNewProductCategoryId}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{categories?.map((c) => (<SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div><Label>Unidade de Medida</Label>
              <Select value={newProductUnit} onValueChange={setNewProductUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS_OF_MEASURE.map((u) => (<SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Marca</Label><Input value={newProductBrand} onChange={(e) => setNewProductBrand(e.target.value)} placeholder="Opcional" /></div>
              <div><Label>Modelo</Label><Input value={newProductModel} onChange={(e) => setNewProductModel(e.target.value)} placeholder="Opcional" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleQuickCreateProduct}>Criar e Selecionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
