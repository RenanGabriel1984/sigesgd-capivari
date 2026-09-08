import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ClipboardCheck, Play, Eye, CheckCircle, XCircle, Package, PackagePlus, Info } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  counting: "Em Contagem",
  review: "Revisão",
  closed: "Fechado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "text-gray-600 bg-gray-50",
  counting: "text-amber-600 bg-amber-50",
  review: "text-blue-600 bg-blue-50",
  closed: "text-emerald-600 bg-emerald-50",
  cancelled: "text-red-600 bg-red-50",
};

// Formato retornado por api.inventory.list (inventário + contagens + joins)
type InventoryCountView = Doc<"inventoryCounts"> & {
  product: Doc<"products"> | null;
};

type InventoryView = Doc<"inventories"> & {
  responsible: Doc<"users"> | null;
  closedBy: Doc<"users"> | null;
  location: Doc<"storageLocations"> | null;
  category: Doc<"categories"> | null;
  counts: InventoryCountView[];
};

export default function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const inventories = useQuery(api.inventory.list) as InventoryView[] | undefined;
  const locations = useQuery(api.storageLocations.listActive);
  const products = useQuery(api.products.listActive);
  const categories = useQuery(api.categories.listActive);
  const initialStatus = useQuery(api.stockSetup.getInitialLoadStatus, isAdmin ? {} : "skip");

  const createInventory = useMutation(api.inventory.create);
  const startCounting = useMutation(api.inventory.startCounting);
  const saveCount = useMutation(api.inventory.saveCount);
  const startReview = useMutation(api.inventory.startReview);
  const closeInventory = useMutation(api.inventory.close);
  const cancelInventory = useMutation(api.inventory.cancel);
  const initialStockLoad = useMutation(api.stockSetup.initialStockLoad);
  const createProduct = useMutation(api.products.create);
  const createCategory = useMutation(api.categories.create);

  const [mainTab, setMainTab] = useState("inventories");
  const [viewId, setViewId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("active");

  // Novo inventário com escopo (local/categoria/produtos)
  const [createOpen, setCreateOpen] = useState(false);
  const [invLocationId, setInvLocationId] = useState("");
  const [invCategoryId, setInvCategoryId] = useState("");
  const [invProductIds, setInvProductIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Implantação inicial
  const [initialLocationId, setInitialLocationId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  // Criação contextual de produto na implantação inicial
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [npName, setNpName] = useState("");
  const [npCatId, setNpCatId] = useState("");
  const [npUnit, setNpUnit] = useState("un");
  const [npBrand, setNpBrand] = useState("");
  const [npModel, setNpModel] = useState("");
  const [npSpec, setNpSpec] = useState("");
  const [npMin, setNpMin] = useState("0");
  const [npIdeal, setNpIdeal] = useState("0");
  const [npMax, setNpMax] = useState("0");

  // Criação contextual de categoria
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const [loadingInitial, setLoadingInitial] = useState(false);

  const viewInventory = inventories?.find((i) => i._id === viewId);
  const counts = viewInventory?.counts ?? [];

  // Count editing state
  const [countEdits, setCountEdits] = useState<Record<string, string>>({});

  if (inventories === undefined) {
    return (
      <AppShell>
        <div className="space-y-6 max-w-7xl mx-auto">
          <div>
            <Skeleton className="h-8 w-24 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  const filtered = inventories?.filter((i) => {
    if (filter === "active") return i.status !== "closed" && i.status !== "cancelled";
    if (filter === "closed") return i.status === "closed";
    if (filter === "cancelled") return i.status === "cancelled";
    return true;
  });

  const handleCreate = async () => {
    setCreating(true);
    try {
      const id = await createInventory({
        observation: "Inventário criado",
        locationId: invLocationId ? (invLocationId as any) : undefined,
        categoryId: invCategoryId ? (invCategoryId as any) : undefined,
        productIds: invProductIds.length > 0 ? (invProductIds as any) : undefined,
      });
      toast.success("Inventário criado com sucesso");
      setCreateOpen(false);
      setInvLocationId(""); setInvCategoryId(""); setInvProductIds([]);
      setViewId(id as string);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar inventário");
    }
    setCreating(false);
  };

  const handleStartCounting = async (id: string) => {
    try {
      await startCounting({ inventoryId: id as any });
      toast.success("Contagem iniciada");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao iniciar contagem");
    }
  };

  const handleSaveCount = async (countId: string) => {
    const val = countEdits[countId];
    if (val === undefined || val === "") {
      toast.error("Informe a quantidade contada");
      return;
    }
    const qty = Number(val);
    if (isNaN(qty) || qty < 0) {
      toast.error("Quantidade inválida");
      return;
    }
    try {
      await saveCount({ countId: countId as any, countedQuantity: qty });
      toast.success("Contagem salva");
      setCountEdits((prev) => {
        const next = { ...prev };
        delete next[countId];
        return next;
      });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar contagem");
    }
  };

  const handleStartReview = async (id: string) => {
    try {
      await startReview({ inventoryId: id as any });
      toast.success("Inventário em revisão");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao iniciar revisão");
    }
  };

  const handleClose = async (id: string) => {
    try {
      const result = await closeInventory({ inventoryId: id as any });
      const adj = (result as any)?.adjustments ?? 0;
      toast.success(`Inventário fechado. ${adj} ajuste(s) gerado(s).`);
      setViewId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao fechar inventário");
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelInventory({ inventoryId: id as any });
      toast.success("Inventário cancelado");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cancelar inventário");
    }
  };

  const getUncounted = (c: InventoryCountView[]) => c.filter((ct) => ct.countedQuantity === null || ct.countedQuantity === undefined);
  const getDiffs = (c: InventoryCountView[]) => c.filter((ct) => ct.difference !== null && ct.difference !== undefined && ct.difference !== 0);

  // ─── Implantação inicial ───
  const loadedByProduct = new Map(
    (initialStatus ?? []).map((s) => [s.productId as string, s.loaded])
  );

  const filledCount = Object.values(quantities).filter((q) => Number(q) > 0).length;
  const totalUnits = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

  const handleQuickCreateCategory = async () => {
    if (!newCatName.trim()) { toast.error("Informe o nome da categoria"); return; }
    try {
      const id = await createCategory({ name: newCatName.trim() });
      setNpCatId(id as string);
      setCatModalOpen(false);
      setNewCatName("");
      toast.success("Categoria criada");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar categoria");
    }
  };

  const handleQuickCreateProduct = async () => {
    if (!npName.trim()) { toast.error("Informe o nome do produto"); return; }
    if (!npCatId) { toast.error("Selecione ou crie uma categoria"); return; }
    try {
      const id = await createProduct({
        name: npName.trim(),
        categoryId: npCatId as any,
        unitOfMeasure: npUnit,
        brand: npBrand || undefined,
        model: npModel || undefined,
        specification: npSpec || undefined,
        minimumStock: Number(npMin) || 0,
        idealStock: Number(npIdeal) || 0,
        maximumStock: Number(npMax) || 0,
      });
      toast.success("Produto cadastrado. Estoque atual = 0 até registrar entrada ou inventário inicial.");
      setProductModalOpen(false);
      setNpName(""); setNpCatId(""); setNpUnit("un"); setNpBrand(""); setNpModel(""); setNpSpec("");
      setNpMin("0"); setNpIdeal("0"); setNpMax("0");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar produto");
    }
  };

  const handleConfirmInitialLoad = async () => {
    if (!initialLocationId) { toast.error("Selecione o local de armazenamento"); return; }
    const items = Object.entries(quantities)
      .filter(([, q]) => Number(q) > 0)
      .map(([productId, q]) => ({ productId: productId as any, locationId: initialLocationId as any, quantity: Number(q) }));
    if (items.length === 0) { toast.error("Informe ao menos uma quantidade"); return; }
    setLoadingInitial(true);
    try {
      const result = await initialStockLoad({ items, observation: "Implantação inicial do estoque físico" });
      toast.success(`${result.productsUpdated} produto(s) carregados — ${result.totalQuantity} unidade(s)`);
      setQuantities({});
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao confirmar carga inicial");
    }
    setLoadingInitial(false);
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inventário</h1>
            <p className="text-sm text-muted-foreground">
              Use o inventário para conferir o estoque físico e corrigir diferenças de forma auditada
            </p>
          </div>
          {mainTab === "inventories" && (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Novo Inventário
            </Button>
          )}
        </div>

        <Tabs value={mainTab} onValueChange={setMainTab}>
          <TabsList>
            <TabsTrigger value="inventories">Inventários</TabsTrigger>
            {isAdmin && <TabsTrigger value="initial">Implantação Inicial</TabsTrigger>}
          </TabsList>

          {/* ═══ Inventários ═══ */}
          <TabsContent value="inventories" className="space-y-4">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList>
                <TabsTrigger value="active">Ativos</TabsTrigger>
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value="closed">Fechados</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelados</TabsTrigger>
              </TabsList>
            </Tabs>

            {filtered?.length === 0 ? (
              <Card className="border-border/50">
                <CardContent className="py-16">
                  <div className="empty-state">
                    <ClipboardCheck className="empty-state-icon" />
                    <p className="empty-state-title">
                      {filter === "active" ? "Nenhum inventário ativo" : "Nenhum inventário encontrado"}
                    </p>
                    <p className="empty-state-desc">
                      {filter === "active" ? "Crie um inventário para iniciar a contagem física" : "Nenhum inventário encontrado com este filtro"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filtered?.map((inv) => {
                  const uncounted = getUncounted(inv.counts);
                  const diffs = getDiffs(inv.counts);
                  const isActive = viewId === inv._id;

                  return (
                    <Card key={inv._id} className={`border-border/50 ${isActive ? "ring-2 ring-primary/20" : ""}`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <CardTitle className="text-base">{inv.inventoryNumber}</CardTitle>
                            <Badge className={`text-[10px] ${STATUS_COLORS[inv.status]}`}>
                              {STATUS_LABELS[inv.status]}
                            </Badge>
                          </div>
                          <div className="flex gap-2">
                            {inv.status === "draft" && (
                              <>
                                <Button size="sm" variant="outline" className="gap-1" onClick={() => handleStartCounting(inv._id)}>
                                  <Play className="h-3 w-3" /> Iniciar Contagem
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleCancel(inv._id)}>
                                  <XCircle className="h-3 w-3" /> Cancelar
                                </Button>
                              </>
                            )}
                            {inv.status === "counting" && (
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => handleStartReview(inv._id)}>
                                <Eye className="h-3 w-3" /> Revisar
                              </Button>
                            )}
                            {inv.status === "review" && (
                              <Button size="sm" className="gap-1" onClick={() => handleClose(inv._id)}>
                                <CheckCircle className="h-3 w-3" /> Fechar e Ajustar
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setViewId(isActive ? null : inv._id)}>
                              {isActive ? "Ocultar" : "Detalhes"}
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
                          <span>Criado: {new Date(inv.createdAt).toLocaleDateString("pt-BR")}</span>
                          <span>Responsável: {inv.responsible?.name ?? "—"}</span>
                          {inv.location && <span>Local: {inv.location.name}</span>}
                          {inv.category && <span>Categoria: {inv.category.name}</span>}
                          <span>{inv.counts.length} itens</span>
                          {uncounted.length > 0 && (
                            <Badge variant="destructive" className="text-[10px]">{uncounted.length} não contado(s)</Badge>
                          )}
                          {diffs.length > 0 && (
                            <Badge variant="secondary" className="text-[10px]">{diffs.length} diferença(s)</Badge>
                          )}
                        </div>
                        {/* Progress indicator for counting/review */}
                        {(inv.status === "counting" || inv.status === "review") && inv.counts.length > 0 && (
                          <div className="mt-3 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {inv.counts.length - uncounted.length} de {inv.counts.length} produtos conferidos
                              </span>
                              <span className="font-medium">
                                {Math.round(((inv.counts.length - uncounted.length) / inv.counts.length) * 100)}%
                              </span>
                            </div>
                            <Progress
                              value={((inv.counts.length - uncounted.length) / inv.counts.length) * 100}
                              className="h-2"
                            />
                          </div>
                        )}
                      </CardHeader>

                      {isActive && (
                        <CardContent className="pt-0">
                          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Produto</TableHead>
                                  <TableHead className="text-xs text-center">Est. Sistema</TableHead>
                                  <TableHead className="text-xs text-center">Contado</TableHead>
                                  <TableHead className="text-xs text-center">Diferença</TableHead>
                                  <TableHead className="text-xs">Observação</TableHead>
                                  {(inv.status === "counting" || inv.status === "review") && (
                                    <TableHead className="text-xs">Ação</TableHead>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {counts.map((c) => {
                                  const isEditing = countEdits[c._id] !== undefined;
                                  const diff = c.difference;
                                  return (
                                    <TableRow key={c._id}>
                                      <TableCell>
                                        <p className="font-medium text-sm">{c.product?.name ?? "—"}</p>
                                        <p className="text-[10px] text-muted-foreground">{c.product?.internalCode ?? ""}</p>
                                      </TableCell>
                                      <TableCell className="text-center font-mono text-sm">{c.systemQuantity}</TableCell>
                                      <TableCell className="text-center">
                                        {c.countedQuantity !== null && c.countedQuantity !== undefined ? (
                                          <span className="font-mono text-sm">{c.countedQuantity}</span>
                                        ) : (
                                          <span className="text-muted-foreground text-xs">—</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {diff !== null && diff !== undefined ? (
                                          <span className={`font-mono text-sm font-semibold ${diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                            {diff > 0 ? "+" : ""}{diff}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground text-xs">—</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                                        {c.observation ?? "—"}
                                      </TableCell>
                                      {(inv.status === "counting" || inv.status === "review") && (
                                        <TableCell>
                                          <div className="flex items-center gap-1">
                                            <Input
                                              type="number"
                                              min="0"
                                              className="w-20 h-7 text-xs"
                                              placeholder={String(c.systemQuantity)}
                                              value={countEdits[c._id] ?? ""}
                                              onChange={(e) => setCountEdits((prev) => ({ ...prev, [c._id]: e.target.value }))}
                                            />
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="h-7 px-2"
                                              onClick={() => handleSaveCount(c._id)}
                                            >
                                              Salvar
                                            </Button>
                                          </div>
                                        </TableCell>
                                      )}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ═══ Implantação Inicial ═══ */}
          {isAdmin && (
            <TabsContent value="initial" className="space-y-4">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="py-4 flex gap-3 items-start">
                  <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1">
                    <p className="font-medium text-foreground">O que é a implantação inicial?</p>
                    <p className="text-muted-foreground">
                      Registra a quantidade física que <strong>já existe</strong> antes do SIGESGD começar a controlar o estoque.
                      Cada quantidade carregada gera lote rastreável, movimentação e auditoria — e não pode ser duplicada.
                      Depois da confirmação, o estoque só muda por <strong>entrada, saída, transferência ou inventário</strong>.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardContent className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                    <div className="w-full sm:max-w-xs">
                      <Label className="text-xs">Local de armazenamento *</Label>
                      <Select value={initialLocationId} onValueChange={setInitialLocationId}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o local" /></SelectTrigger>
                        <SelectContent>
                          {locations?.map((l) => (
                            <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="outline" className="gap-2" onClick={() => setProductModalOpen(true)}>
                      <PackagePlus className="h-4 w-4" /> Novo Produto
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-3 mt-4">
                    <Badge variant="secondary" className="text-xs px-3 py-1">
                      Produtos: {products?.length ?? 0}
                    </Badge>
                    <Badge variant="secondary" className="text-xs px-3 py-1">
                      Itens preenchidos: {filledCount}
                    </Badge>
                    <Badge variant="secondary" className="text-xs px-3 py-1">
                      Total de unidades: {totalUnits}
                    </Badge>
                  </div>

                  <div className="overflow-x-auto mt-4 max-h-[480px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-xs">Categoria</TableHead>
                          <TableHead className="text-xs">Unidade</TableHead>
                          <TableHead className="text-xs text-center">Quantidade encontrada</TableHead>
                          <TableHead className="text-xs">Situação da carga</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products?.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-10">
                              <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                              <p className="text-sm text-muted-foreground">Nenhum produto cadastrado</p>
                              <p className="text-xs text-muted-foreground mt-1">Cadastre produtos antes de iniciar a carga</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          products?.map((p) => {
                            const loaded = loadedByProduct.get(p._id as string) ?? false;
                            return (
                              <TableRow key={p._id}>
                                <TableCell>
                                  <p className="font-medium text-sm">{p.name}</p>
                                  <p className="text-[10px] text-muted-foreground">{p.internalCode ?? ""}</p>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{p.category?.name ?? "—"}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{UNIT_LABELS[p.unitOfMeasure] ?? p.unitOfMeasure}</TableCell>
                                <TableCell className="text-center">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="w-24 h-8 mx-auto text-sm"
                                    placeholder="0"
                                    disabled={loaded}
                                    value={quantities[p._id as string] ?? ""}
                                    onChange={(e) => setQuantities((prev) => ({ ...prev, [p._id as string]: e.target.value }))}
                                  />
                                </TableCell>
                                <TableCell>
                                  {loaded ? (
                                    <Badge variant="secondary" className="text-[10px]">Carga confirmada</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] text-muted-foreground">Pendente</Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex justify-end mt-4">
                    <Button onClick={handleConfirmInitialLoad} disabled={loadingInitial} className="gap-2">
                      <Package className="h-4 w-4" />
                      {loadingInitial ? "Confirmando..." : `Confirmar Carga Inicial${filledCount > 0 ? ` (${filledCount} item(ns), ${totalUnits} unidade(s))` : ""}`}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>

        {/* ═══ Novo Inventário (com escopo) ═══ */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Novo Inventário</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Escolha o escopo da contagem. Se nenhum filtro for informado, o inventário cobre todos os produtos.
              </p>
              <div>
                <Label>Local (opcional)</Label>
                <Select value={invLocationId} onValueChange={setInvLocationId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Todos os locais" /></SelectTrigger>
                  <SelectContent>
                    {locations?.map((l) => (
                      <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Categoria (opcional)</Label>
                <Select value={invCategoryId} onValueChange={setInvCategoryId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Todas as categorias" /></SelectTrigger>
                  <SelectContent>
                    {categories?.map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Produtos específicos (opcional)</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {products
                    ?.filter((p) => !invCategoryId || p.categoryId === invCategoryId)
                    .map((p) => {
                      const selected = invProductIds.includes(p._id as string);
                      return (
                        <Button
                          key={p._id}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() =>
                            setInvProductIds((prev) =>
                              selected ? prev.filter((id) => id !== p._id) : [...prev, p._id as string]
                            )
                          }
                        >
                          {p.name}
                        </Button>
                      );
                    })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={creating}>{creating ? "Criando..." : "Criar Inventário"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══ Novo Produto (contextual — implantação inicial) ═══ */}
        <Dialog open={productModalOpen} onOpenChange={setProductModalOpen}>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><PackagePlus className="h-4 w-4" /> Novo Produto</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Nome *</Label>
                <Input value={npName} onChange={(e) => setNpName(e.target.value)} placeholder="Ex: Cooler para processador" className="mt-1" />
              </div>
              <div>
                <Label>Categoria *</Label>
                {categories && categories.length === 0 ? (
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
                    <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setCatModalOpen(true)}>
                      + Criar categoria
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Select value={npCatId} onValueChange={setNpCatId}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>
                        {categories?.map((c) => (
                          <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setCatModalOpen(true)} title="Nova categoria">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <Label>Unidade</Label>
                <Select value={npUnit} onValueChange={setNpUnit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS_OF_MEASURE.map((u) => (
                      <SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Marca</Label><Input value={npBrand} onChange={(e) => setNpBrand(e.target.value)} placeholder="Opcional" /></div>
                <div><Label>Modelo</Label><Input value={npModel} onChange={(e) => setNpModel(e.target.value)} placeholder="Opcional" /></div>
              </div>
              <div>
                <Label>Especificação</Label>
                <Input value={npSpec} onChange={(e) => setNpSpec(e.target.value)} placeholder="Opcional" className="mt-1" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Est. mínimo</Label><Input type="number" min="0" value={npMin} onChange={(e) => setNpMin(e.target.value)} /></div>
                <div><Label>Est. ideal</Label><Input type="number" min="0" value={npIdeal} onChange={(e) => setNpIdeal(e.target.value)} /></div>
                <div><Label>Est. máximo</Label><Input type="number" min="0" value={npMax} onChange={(e) => setNpMax(e.target.value)} /></div>
              </div>
              <p className="text-xs text-muted-foreground">
                Mínimo, ideal e máximo são parâmetros de alerta e planejamento. O estoque atual começa em 0 e é calculado pelas movimentações.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProductModalOpen(false)}>Cancelar</Button>
              <Button onClick={handleQuickCreateProduct}>Criar Produto</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══ Nova Categoria (contextual) ═══ */}
        <Dialog open={catModalOpen} onOpenChange={setCatModalOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Nova Categoria</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Nome da Categoria *</Label>
                <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Ex: Toner, Cabo, Memória" className="mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCatModalOpen(false); setNewCatName(""); }}>Cancelar</Button>
              <Button onClick={handleQuickCreateCategory}>Criar e Selecionar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}