import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Plus, Pencil, Search, Package } from "lucide-react";
import { UNITS_OF_MEASURE } from "@/types/constants";
import { toast } from "sonner";

interface ProductForm {
  name: string;
  description: string;
  categoryId: string;
  unitOfMeasure: string;
  internalCode: string;
  manufacturer: string;
  model: string;
  minimumStock: number;
  idealStock: number;
  maximumStock: number;
  observation: string;
}

const emptyForm: ProductForm = {
  name: "",
  description: "",
  categoryId: "",
  unitOfMeasure: "un",
  internalCode: "",
  manufacturer: "",
  model: "",
  minimumStock: 0,
  idealStock: 0,
  maximumStock: 0,
  observation: "",
};

export default function Products() {
  const products = useQuery(api.products.list);
  const categories = useQuery(api.categories.listActive);
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);

  const filtered = products?.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.internalCode?.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (p: typeof products extends undefined | (infer U)[] ? U : never) => {
    setForm({
      name: p.name,
      description: p.description ?? "",
      categoryId: p.categoryId,
      unitOfMeasure: p.unitOfMeasure,
      internalCode: p.internalCode ?? "",
      manufacturer: p.manufacturer ?? "",
      model: p.model ?? "",
      minimumStock: p.minimumStock,
      idealStock: p.idealStock,
      maximumStock: p.maximumStock,
      observation: p.observation ?? "",
    });
    setEditingId(p._id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.categoryId) {
      toast.error("Nome e categoria são obrigatórios");
      return;
    }
    try {
      if (editingId) {
        await updateProduct({
          id: editingId as any,
          name: form.name,
          description: form.description || undefined,
          categoryId: form.categoryId as any,
          unitOfMeasure: form.unitOfMeasure,
          internalCode: form.internalCode || undefined,
          manufacturer: form.manufacturer || undefined,
          model: form.model || undefined,
          minimumStock: form.minimumStock,
          idealStock: form.idealStock,
          maximumStock: form.maximumStock,
          observation: form.observation || undefined,
        });
        toast.success("Produto atualizado");
      } else {
        await createProduct({
          name: form.name,
          description: form.description || undefined,
          categoryId: form.categoryId as any,
          unitOfMeasure: form.unitOfMeasure,
          internalCode: form.internalCode || undefined,
          manufacturer: form.manufacturer || undefined,
          model: form.model || undefined,
          minimumStock: form.minimumStock,
          idealStock: form.idealStock,
          maximumStock: form.maximumStock,
          observation: form.observation || undefined,
        });
        toast.success("Produto criado");
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar produto");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
            <p className="text-sm text-muted-foreground">Gerenciar produtos e materiais</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Produto
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 max-w-md"
          />
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Mín.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered?.map((p) => {
                    const stock = p.stock?.physicalQuantity ?? 0;
                    const isLow = stock < p.minimumStock;
                    return (
                      <TableRow key={p._id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.manufacturer} {p.model}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {p.internalCode ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {p.category?.name ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={isLow ? "text-rose-600 font-semibold" : ""}>
                            {stock}
                          </span>
                          <span className="text-muted-foreground"> {p.unitOfMeasure}</span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {p.minimumStock}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.active ? "default" : "secondary"} className="text-[10px]">
                            {p.active ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">Nenhum produto encontrado</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Produto" : "Novo Produto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do produto" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Categoria *</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories?.map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unidade</Label>
                <Select value={form.unitOfMeasure} onValueChange={(v) => setForm({ ...form, unitOfMeasure: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS_OF_MEASURE.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Código Interno</Label>
                <Input value={form.internalCode} onChange={(e) => setForm({ ...form, internalCode: e.target.value })} />
              </div>
              <div>
                <Label>Fabricante</Label>
                <Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Modelo</Label>
              <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Estoque Mínimo</Label>
                <Input type="number" min="0" value={form.minimumStock} onChange={(e) => setForm({ ...form, minimumStock: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Estoque Ideal</Label>
                <Input type="number" min="0" value={form.idealStock} onChange={(e) => setForm({ ...form, idealStock: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Estoque Máximo</Label>
                <Input type="number" min="0" value={form.maximumStock} onChange={(e) => setForm({ ...form, maximumStock: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} />
            </div>
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
