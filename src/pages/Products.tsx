import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
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
import { Plus, Pencil, Search, Package, ArrowUpRight, Boxes } from "lucide-react";
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
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);

  const filtered = products?.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.internalCode?.toLowerCase().includes(search.toLowerCase()) ||
      p.manufacturer?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || p.categoryId === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (e: React.MouseEvent, p: any) => {
    e.preventDefault();
    e.stopPropagation();
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
      toast.error("Name and category are required");
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
        toast.success("Product updated");
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
        toast.success("Product created");
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save product");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Product Catalog</h1>
            <p className="text-sm text-muted-foreground">
              {filtered?.length ?? 0} product{(filtered?.length ?? 0) !== 1 ? "s" : ""} in catalog
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Product
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, code, or manufacturer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories?.map((c) => (
                <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Catalog Grid */}
        {filtered?.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {search || categoryFilter !== "all"
                  ? "No products match your filters"
                  : "No products in the catalog yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered?.map((p) => {
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
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => openEdit(e, p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <h3 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors">
                        {p.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-1">
                        {p.manufacturer} {p.model}
                      </p>

                      <div className="flex items-center gap-2 mb-3">
                        {p.category && (
                          <Badge variant="secondary" className="text-[10px]">
                            {p.category.name}
                          </Badge>
                        )}
                        <Badge
                          variant={isLow ? "destructive" : "outline"}
                          className="text-[10px]"
                        >
                          {stock} {p.unitOfMeasure}
                        </Badge>
                      </div>

                      {/* Mini stock bar */}
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isLow ? "bg-rose-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${stockPct}%` }}
                          />
                        </div>
                        <span>{available} avail.</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Product" : "New Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Product name" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category *</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories?.map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unit</Label>
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
                <Label>Internal Code</Label>
                <Input value={form.internalCode} onChange={(e) => setForm({ ...form, internalCode: e.target.value })} />
              </div>
              <div>
                <Label>Manufacturer</Label>
                <Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Model</Label>
              <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Minimum</Label>
                <Input type="number" min="0" value={form.minimumStock} onChange={(e) => setForm({ ...form, minimumStock: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Ideal</Label>
                <Input type="number" min="0" value={form.idealStock} onChange={(e) => setForm({ ...form, idealStock: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Maximum</Label>
                <Input type="number" min="0" value={form.maximumStock} onChange={(e) => setForm({ ...form, maximumStock: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingId ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
