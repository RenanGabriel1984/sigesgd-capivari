import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, ShoppingCart, ExternalLink, MoreHorizontal, Edit2, RotateCcw, XCircle } from "lucide-react";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";
import { toast } from "sonner";

export default function Entries() {
  const products = useQuery(api.products.listActive);
  const suppliers = useQuery(api.suppliers.listActive);
  const categories = useQuery(api.categories.listActive);
  const movements = useQuery(api.stockMovements.list);
  const createEntry = useMutation(api.stockMovements.createEntry);
  const editEntry = useMutation(api.stockMovements.editEntry);
  const reverseEntry = useMutation(api.stockMovements.reverseEntry);
  const createProduct = useMutation(api.products.create);
  const createSupplier = useMutation(api.suppliers.create);

  // ─── New Entry dialog ───
  const [dialogOpen, setDialogOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState<string>("1");
  const [supplierId, setSupplierId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [observation, setObservation] = useState("");

  // ─── Quick-create product modal ───
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductCategoryId, setNewProductCategoryId] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("un");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [newProductBrand, setNewProductBrand] = useState("");
  const [newProductModel, setNewProductModel] = useState("");
  const [newProductSpec, setNewProductSpec] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);

  // ─── Quick-create supplier modal ───
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierTrade, setNewSupplierTrade] = useState("");
  const [newSupplierCnpj, setNewSupplierCnpj] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);

  // ─── Edit entry modal ───
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editMovementId, setEditMovementId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState<string>("");
  const [editDocumentNumber, setEditDocumentNumber] = useState("");
  const [editObservation, setEditObservation] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // ─── Reverse entry modal ───
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [reverseMovementId, setReverseMovementId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [savingReverse, setSavingReverse] = useState(false);

  const recentEntries = movements?.filter((m) => m.type === "entry").slice(0, 50) ?? [];

  // ─── Handlers ───

  const handleSave = async () => {
    const qty = Number(quantity);
    if (!productId || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
      toast.error("Selecione um item e informe uma quantidade válida (número inteiro maior que zero)");
      return;
    }
    try {
      await createEntry({
        productId: productId as any,
        quantity: qty,
        supplierId: supplierId ? (supplierId as any) : undefined,
        documentNumber: documentNumber || undefined,
        observation: observation || undefined,
      });
      toast.success("Entrada registrada com sucesso");
      setDialogOpen(false);
      setProductId(""); setQuantity("1"); setSupplierId(""); setDocumentNumber(""); setObservation("");
    } catch (e: any) { toast.error(e.message ?? "Erro ao registrar entrada"); }
  };

  const openEditModal = (m: any) => {
    setEditMovementId(m._id);
    setEditQuantity(String(m.quantity));
    setEditDocumentNumber(m.documentNumber ?? "");
    setEditObservation(m.observation ?? "");
    setEditModalOpen(true);
  };

  const handleEditSave = async () => {
    if (!editMovementId) return;
    const qty = Number(editQuantity);
    if (isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
      toast.error("A quantidade deve ser um número inteiro maior que zero");
      return;
    }
    setSavingEdit(true);
    try {
      await editEntry({
        movementId: editMovementId as any,
        quantity: qty,
        documentNumber: editDocumentNumber || undefined,
        observation: editObservation || undefined,
      });
      toast.success("Entrada atualizada com sucesso");
      setEditModalOpen(false);
      setEditMovementId(null);
    } catch (e: any) { toast.error(e.message ?? "Erro ao editar entrada"); }
    setSavingEdit(false);
  };

  const openReverseModal = (m: any) => {
    setReverseMovementId(m._id);
    setReverseReason("");
    setReverseModalOpen(true);
  };

  const handleReverseSave = async () => {
    if (!reverseMovementId) return;
    if (!reverseReason.trim()) {
      toast.error("O motivo do estorno é obrigatório");
      return;
    }
    setSavingReverse(true);
    try {
      await reverseEntry({
        movementId: reverseMovementId as any,
        reason: reverseReason.trim(),
      });
      toast.success("Entrada estornada com sucesso");
      setReverseModalOpen(false);
      setReverseMovementId(null);
      setReverseReason("");
    } catch (e: any) { toast.error(e.message ?? "Erro ao estornar entrada"); }
    setSavingReverse(false);
  };

  const handleQuickCreateProduct = async () => {
    if (!newProductName.trim()) { toast.error("Nome do item é obrigatório"); return; }
    if (!newProductCategoryId) { toast.error("Selecione uma categoria"); return; }
    setSavingProduct(true);
    try {
      const newId = await createProduct({
        name: newProductName.trim(),
        categoryId: newProductCategoryId as any,
        unitOfMeasure: newProductUnit,
        description: newProductDescription || undefined,
        brand: newProductBrand || undefined,
        model: newProductModel || undefined,
        specification: newProductSpec || undefined,
        minimumStock: 0, idealStock: 0, maximumStock: 0,
      });
      setProductId(newId as string);
      setProductModalOpen(false);
      setNewProductName(""); setNewProductCategoryId(""); setNewProductUnit("un");
      setNewProductDescription(""); setNewProductBrand(""); setNewProductModel(""); setNewProductSpec("");
      toast.success("Item criado e selecionado");
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar item"); }
    setSavingProduct(false);
  };

  const handleQuickCreateSupplier = async () => {
    if (!newSupplierName.trim()) { toast.error("Razão social é obrigatória"); return; }
    setSavingSupplier(true);
    try {
      const newId = await createSupplier({
        legalName: newSupplierName.trim(),
        tradeName: newSupplierTrade || undefined,
        cnpj: newSupplierCnpj || undefined,
        phone: newSupplierPhone || undefined,
        email: newSupplierEmail || undefined,
      });
      setSupplierId(newId as string);
      setSupplierModalOpen(false);
      setNewSupplierName(""); setNewSupplierTrade(""); setNewSupplierCnpj(""); setNewSupplierPhone(""); setNewSupplierEmail("");
      toast.success("Fornecedor criado e selecionado");
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar fornecedor"); }
    setSavingSupplier(false);
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><h1 className="text-2xl font-bold tracking-tight">Entradas</h1><p className="text-sm text-muted-foreground">Registrar entradas de estoque</p></div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Nova Entrada</Button>
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3"><CardTitle className="text-base">Últimas Entradas</CardTitle></CardHeader>
          <CardContent>
            {recentEntries.length === 0 ? (
              <div className="text-center py-8"><ShoppingCart className="h-8 w-8 mx-auto text-muted-foreground mb-2" /><p className="text-muted-foreground text-sm">Nenhuma entrada registrada</p></div>
            ) : (
              <div className="space-y-3">
                {recentEntries.map((m) => (
                  <div key={m._id} className={`flex items-center justify-between py-2 border-b border-border/30 last:border-0 ${m.canceled ? "opacity-50" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{m.product?.name ?? "Item"}</p>
                        {m.canceled && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 shrink-0">
                            <XCircle className="h-3 w-3" /> Estornada
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {m.user?.name ?? "Usuário"}{m.supplier ? ` • ${m.supplier.legalName}` : ""}{m.documentNumber ? ` • Doc: ${m.documentNumber}` : ""}
                      </p>
                      {m.observation && <p className="text-[10px] text-muted-foreground italic mt-0.5">"{m.observation}"</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className={`font-mono font-semibold ${m.canceled ? "text-muted-foreground line-through" : "text-emerald-600"}`}>{m.canceled ? "+" : "+"}{m.quantity}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(m.timestamp).toLocaleDateString("pt-BR")}</p>
                      </div>
                      {!m.canceled && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditModal(m)}>
                              <Edit2 className="mr-2 h-4 w-4" /> Editar Entrada
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openReverseModal(m)} className="text-destructive focus:text-destructive">
                              <RotateCcw className="mr-2 h-4 w-4" /> Estornar Entrada
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ Nova Entrada Dialog ═══ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Entrada</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label>Item do Estoque *</Label>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-1 text-primary" onClick={() => setProductModalOpen(true)}>
                  <Plus className="h-3 w-3" /> Criar Novo Item
                </Button>
              </div>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Selecionar item" /></SelectTrigger>
                <SelectContent>{products?.map((p) => (<SelectItem key={p._id} value={p._id}>{p.name}{p.brand ? ` — ${p.brand}` : ""}{p.internalCode ? ` (${p.internalCode})` : ""}</SelectItem>))}</SelectContent>
              </Select>
            </div>

            <div><Label>Quantidade *</Label><Input type="number" inputMode="numeric" min="1" step="1" placeholder="0" value={quantity} onChange={(e) => { const v = e.target.value.replace(/^0+(?=\d)/, ""); setQuantity(v); }} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (isNaN(n) || n < 1) setQuantity("1"); else setQuantity(String(n)); }} /></div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label>Fornecedor</Label>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-1 text-primary" onClick={() => setSupplierModalOpen(true)}>
                  <Plus className="h-3 w-3" /> Criar Novo Fornecedor
                </Button>
              </div>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Nenhum (doação, transferência interna, etc.)" /></SelectTrigger>
                <SelectContent>{suppliers?.map((s) => (<SelectItem key={s._id} value={s._id}>{s.legalName}</SelectItem>))}</SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Opcional — utilize para doações, transferências internas ou itens sem nota fiscal.</p>
            </div>

            <div><Label>Número do Documento</Label><Input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="NF, OS, etc." /></div>
            <div><Label>Observação</Label><Textarea value={observation} onChange={(e) => setObservation(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button onClick={handleSave}>Registrar Entrada</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Edit Entry Modal ═══ */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Entrada</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Quantidade *</Label><Input type="number" inputMode="numeric" min="1" step="1" placeholder="0" value={editQuantity} onChange={(e) => { const v = e.target.value.replace(/^0+(?=\d)/, ""); setEditQuantity(v); }} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (isNaN(n) || n < 1) setEditQuantity("1"); else setEditQuantity(String(n)); }} /></div>
            <div><Label>Número do Documento</Label><Input value={editDocumentNumber} onChange={(e) => setEditDocumentNumber(e.target.value)} placeholder="NF, OS, etc." /></div>
            <div><Label>Observação</Label><Textarea value={editObservation} onChange={(e) => setEditObservation(e.target.value)} rows={2} placeholder="Motivo da alteração (recomendado)" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditModalOpen(false)}>Cancelar</Button><Button onClick={handleEditSave} disabled={savingEdit}>{savingEdit ? "Salvando..." : "Salvar Alterações"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Reverse Entry Modal ═══ */}
      <Dialog open={reverseModalOpen} onOpenChange={setReverseModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Estornar Entrada</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">O estorno irá deduzir a quantidade integral desta entrada do saldo atual do produto. Esta ação não pode ser desfeita.</p>
            <div><Label>Motivo do Estorno *</Label><Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} rows={3} placeholder="Informe o motivo do cancelamento desta entrada..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseModalOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReverseSave} disabled={savingReverse}>{savingReverse ? "Estornando..." : "Confirmar Estorno"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Quick-Create Product Modal ═══ */}
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
                <SelectContent>{categories?.map((c: any) => (<SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>))}</SelectContent>
              </Select>
              {categories?.length === 0 && <p className="text-xs text-amber-600 mt-1">Nenhuma categoria cadastrada. Cadastre em Categorias primeiro.</p>}
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
            <div><Label>Especificação</Label><Input value={newProductSpec} onChange={(e) => setNewProductSpec(e.target.value)} placeholder="Opcional" /></div>
            <div><Label>Descrição</Label><Textarea value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} rows={2} placeholder="Opcional" /></div>
            <p className="text-[10px] text-muted-foreground">O código interno será gerado automaticamente. Estoque mínimo, ideal e máximo ficam zerados — ajuste depois no cadastro do item.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleQuickCreateProduct} disabled={savingProduct}>{savingProduct ? "Criando..." : "Criar e Selecionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Quick-Create Supplier Modal ═══ */}
      <Dialog open={supplierModalOpen} onOpenChange={setSupplierModalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4" /> Criar Fornecedor Rápido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Razão Social *</Label><Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="Nome completo do fornecedor" /></div>
            <div><Label>Nome Fantasia</Label><Input value={newSupplierTrade} onChange={(e) => setNewSupplierTrade(e.target.value)} placeholder="Opcional" /></div>
            <div><Label>CNPJ</Label><Input value={newSupplierCnpj} onChange={(e) => setNewSupplierCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Telefone</Label><Input value={newSupplierPhone} onChange={(e) => setNewSupplierPhone(e.target.value)} placeholder="(00) 0000-0000" /></div>
              <div><Label>E-mail</Label><Input value={newSupplierEmail} onChange={(e) => setNewSupplierEmail(e.target.value)} placeholder="contato@empresa.com" /></div>
            </div>
            <p className="text-[10px] text-muted-foreground">Apenas a razão social é obrigatória. Demais campos podem ser preenchidos depois.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleQuickCreateSupplier} disabled={savingSupplier}>{savingSupplier ? "Criando..." : "Criar e Selecionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
