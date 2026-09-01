import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Search, Package, ArrowUpRight, AlertTriangle } from "lucide-react";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";
import { toast } from "sonner";

interface ProductForm {
  name: string;
  description: string;
  categoryId: string;
  unitOfMeasure: string;
  internalCode: string;
  manufacturer: string;
  model: string;
  brand: string;
  specification: string;
  minimumStock: number;
  idealStock: number;
  maximumStock: number;
  observation: string;
  hasSerial: boolean;
}

const emptyForm: ProductForm = {
  name: "", description: "", categoryId: "", unitOfMeasure: "un",
  internalCode: "", manufacturer: "", model: "", brand: "", specification: "",
  minimumStock: 0, idealStock: 0, maximumStock: 0, observation: "", hasSerial: false,
};

export default function Products() {
  const products = useQuery(api.products.list);
  const categories = useQuery(api.categories.listActive);
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [onlyBelowMin, setOnlyBelowMin] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);

  const filtered = products?.filter((p: any) => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      p.name.toLowerCase().includes(q) ||
      p.internalCode?.toLowerCase().includes(q) ||
      p.model?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === "all" || p.categoryId === categoryFilter;
    const stock = p.stock?.physicalQuantity ?? 0;
    const matchesBelowMin = !onlyBelowMin || stock <= p.minimumStock;
    return matchesSearch && matchesCategory && matchesBelowMin;
  });

  const belowMinCount = products?.filter((p: any) => (p.stock?.physicalQuantity ?? 0) <= p.minimumStock).length ?? 0;

  const openCreate = () => { setForm(emptyForm); setEditingId(null); setDialogOpen(true); };
  const openEdit = (e: React.MouseEvent, p: any) => {
    e.preventDefault(); e.stopPropagation();
    setForm({
      name: p.name, description: p.description ?? "", categoryId: p.categoryId,
      unitOfMeasure: p.unitOfMeasure, internalCode: p.internalCode ?? "",
      manufacturer: p.manufacturer ?? "", model: p.model ?? "",
      brand: p.brand ?? "", specification: p.specification ?? "",
      minimumStock: p.minimumStock, idealStock: p.idealStock, maximumStock: p.maximumStock,
      observation: p.observation ?? "", hasSerial: p.hasSerial ?? false,
    });
    setEditingId(p._id); setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.categoryId) { toast.error("Nome e categoria são obrigatórios"); return; }
    try {
      const data = {
        name: form.name, description: form.description || undefined,
        categoryId: form.categoryId as any, unitOfMeasure: form.unitOfMeasure,
        internalCode: form.internalCode || undefined,
        manufacturer: form.manufacturer || undefined,
        model: form.model || undefined, brand: form.brand || undefined,
        specification: form.specification || undefined,
        minimumStock: form.minimumStock, idealStock: form.idealStock, maximumStock: form.maximumStock,
        observation: form.observation || undefined, hasSerial: form.hasSerial || undefined,
      };
      if (editingId) {
        await updateProduct({ id: editingId as any, ...data });
        toast.success("Item atualizado");
      } else {
        await createProduct(data);
        toast.success("Item criado");
      }
      setDialogOpen(false);
    } catch (e: any) { toast.error(e.message ?? "Erro ao salvar item"); }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Itens do Estoque</h1>
            <p className="text-sm text-muted-foreground">
              {filtered?.length ?? 0} item{(filtered?.length ?? 0) !== 1 ? "s" : ""} cadastrado{(filtered?.length ?? 0) !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Novo Item</Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, código, marca ou modelo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Todas as categorias" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {categories?.map((c: any) => (<SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>))}
            </SelectContent>
          </Select>
          <Button
            variant={onlyBelowMin ? "destructive" : "outline"}
            className="gap-1.5"
            onClick={() => setOnlyBelowMin(!onlyBelowMin)}
          >
            <AlertTriangle className="h-4 w-4" />
            Abaixo do Mínimo
            {belowMinCount > 0 && (
              <Badge variant={onlyBelowMin ? "secondary" : "destructive"} className="ml-1 text-[10px] h-5 min-w-5 px-1.5">
                {belowMinCount}
              </Badge>
            )}
          </Button>
        </div>

        {filtered?.length === 0 ? (
          <Card className="border-border/50"><CardContent className="py-16 text-center">
            <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              {search || categoryFilter !== "all" || onlyBelowMin ? "Nenhum item corresponde aos filtros" : "Nenhum item cadastrado"}
            </p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered?.map((p: any) => {
              const stock = p.stock?.physicalQuantity ?? 0;
              const reserved = p.stock?.reservedQuantity ?? 0;
              const available = stock - reserved;
              const isLow = stock < p.minimumStock;
              const stockPct = p.maximumStock > 0 ? Math.min(100, (stock / p.maximumStock) * 100) : 0;
              return (
                <Link key={p._id} to={`/products/${p._id}`} className="group">
                  <Card className="h-full border-border/50 shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-200">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/70 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                          <Package className="h-5 w-5" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => openEdit(e, p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <h3 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors">{p.name}</h3>
                      <p className="text-xs text-muted-foreground mb-1">
                        {p.brand && <span>{p.brand}</span>}
                        {p.brand && p.model && <span> — </span>}
                        {p.model && <span>{p.model}</span>}
                        {!p.brand && !p.model && p.internalCode && (
                          <span>{p.internalCode}</span>
                        )}
                      </p>
                      {p.specification && <p className="text-[10px] text-muted-foreground mb-2 truncate">{p.specification}</p>}
                      <div className="flex items-center gap-2 mb-3">
                        {p.category && <Badge variant="secondary" className="text-[10px]">{p.category.name}</Badge>}
                        <Badge variant={isLow ? "destructive" : "outline"} className="text-[10px]">{stock} {UNIT_LABELS[p.unitOfMeasure] ?? p.unitOfMeasure}</Badge>
                        {p.hasSerial && <Badge variant="outline" className="text-[10px]">S/N</Badge>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${isLow ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${stockPct}%` }} />
                        </div>
                        <span>{available} disp.</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Editar Item" : "Novo Item do Estoque"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Category warning when none exist */}
            {!editingId && categories?.length === 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200">Nenhuma categoria cadastrada</p>
                  <p className="text-amber-700 dark:text-amber-300 mt-0.5">
                    Cadastre uma categoria antes de criar itens.{" "}
                    <Link to="/categories" onClick={() => setDialogOpen(false)} className="underline font-medium hover:text-amber-900 dark:hover:text-amber-100">
                      Cadastrar Categoria Primeiro →
                    </Link>
                  </p>
                </div>
              </div>
            )}
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: SSD 480 GB SATA" /></div>
            <div><Label>Descrição</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Descrição detalhada do item" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Categoria *</Label><Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{categories?.map((c: any) => (<SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>))}</SelectContent></Select></div>
              <div><Label>Unidade de Medida</Label><Select value={form.unitOfMeasure} onValueChange={(v) => setForm({ ...form, unitOfMeasure: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UNITS_OF_MEASURE.map((u) => (<SelectItem key={u} value={u}>{UNIT_LABELS[u] ?? u}</SelectItem>))}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Marca</Label><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Ex: Kingston, SanDisk" /></div>
              <div><Label>Modelo</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Ex: A400, SSD Plus" /></div>
            </div>
            <div><Label>Especificação</Label><Input value={form.specification} onChange={(e) => setForm({ ...form, specification: e.target.value })} placeholder="Ex: 480 GB, SATA III, Leitura 500MB/s" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Código Interno</Label><Input value={form.internalCode} onChange={(e) => setForm({ ...form, internalCode: e.target.value })} placeholder="Opcional — gerado automaticamente" /></div>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2">
                  <Checkbox id="hasSerial" checked={form.hasSerial} onCheckedChange={(checked) => setForm({ ...form, hasSerial: checked === true })} />
                  <Label htmlFor="hasSerial" className="text-sm font-normal">Possui número de série / patrimônio</Label>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Estoque Mínimo</Label><Input type="number" min="0" value={form.minimumStock || ""} onChange={(e) => setForm({ ...form, minimumStock: e.target.value === "" ? 0 : Number(e.target.value) })} /></div>
              <div><Label>Estoque Ideal</Label><Input type="number" min="0" value={form.idealStock || ""} onChange={(e) => setForm({ ...form, idealStock: e.target.value === "" ? 0 : Number(e.target.value) })} /></div>
              <div><Label>Estoque Máximo</Label><Input type="number" min="0" value={form.maximumStock || ""} onChange={(e) => setForm({ ...form, maximumStock: e.target.value === "" ? 0 : Number(e.target.value) })} /></div>
            </div>
            <div><Label>Observações</Label><Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editingId ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
