import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { SearchInput } from "@/components/SearchInput";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Pencil,
  Search,
  Printer,
  Building2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface PrinterForm {
  name: string;
  brand: string;
  model: string;
  organizationId: string;
  patrimony: string;
  observation: string;
}

const emptyForm: PrinterForm = {
  name: "",
  brand: "",
  model: "",
  organizationId: "",
  patrimony: "",
  observation: "",
};

export default function PrintersPage() {
  const printers = useQuery(api.printers.list);
  const organizations = useQuery(api.organizations.list);
  const createPrinter = useMutation(api.printers.create);
  const updatePrinter = useMutation(api.printers.update);

  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PrinterForm>(emptyForm);

  const orgList = useMemo(() => organizations?.orgs ?? [], [organizations]);
  const secretarias = useMemo(
    () => orgList.filter((o) => o.type === "secretaria" && o.active),
    [orgList]
  );
  const allOrgs = useMemo(
    () => orgList.filter((o) => o.active),
    [orgList]
  );

  const filtered = useMemo(() => {
    if (!printers) return [];
    return printers.filter((p: any) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.patrimony?.toLowerCase().includes(q);
      const matchesOrg =
        orgFilter === "all" || p.organizationId === orgFilter;
      const matchesActive = showInactive || p.active;
      return matchesSearch && matchesOrg && matchesActive;
    });
  }, [printers, search, orgFilter, showInactive]);

  const activeCount = printers?.filter((p: any) => p.active).length ?? 0;
  const inactiveCount = printers?.filter((p: any) => !p.active).length ?? 0;

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (p: any) => {
    setForm({
      name: p.name,
      brand: p.brand,
      model: p.model,
      organizationId: p.organizationId ?? "",
      patrimony: p.patrimony ?? "",
      observation: p.observation ?? "",
    });
    setEditingId(p._id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Nome da impressora é obrigatório");
      return;
    }
    if (!form.brand.trim()) {
      toast.error("Marca é obrigatória");
      return;
    }
    if (!form.model.trim()) {
      toast.error("Modelo é obrigatório");
      return;
    }
    try {
      const data = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        model: form.model.trim(),
        organizationId: form.organizationId
          ? (form.organizationId as any)
          : undefined,
        patrimony: form.patrimony.trim() || undefined,
        observation: form.observation.trim() || undefined,
      };
      if (editingId) {
        await updatePrinter({ id: editingId as any, ...data });
        toast.success("Impressora atualizada");
      } else {
        await createPrinter(data);
        toast.success("Impressora cadastrada");
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar impressora");
    }
  };

  const handleToggleActive = async (p: any) => {
    try {
      await updatePrinter({ id: p._id, active: !p.active });
      toast.success(p.active ? "Impressora desativada" : "Impressora ativada");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao alterar status");
    }
  };

  const getOrgName = (orgId: string | undefined) => {
    if (!orgId) return "—";
    const org = allOrgs.find((o) => o._id === orgId);
    return org?.name ?? "—";
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Impressoras</h1>
            <p className="text-sm text-muted-foreground">
              {activeCount} ativa(s)
              {inactiveCount > 0 && `, ${inactiveCount} inativa(s)`}
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Nova Impressora
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0 max-w-md">
            <SearchInput
              placeholder="Buscar por nome, marca, modelo ou patrimônio..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={orgFilter} onValueChange={setOrgFilter}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Todas as secretarias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as secretarias</SelectItem>
              {secretarias.map((o: any) => (
                <SelectItem key={o._id} value={o._id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch
              id="showInactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor="showInactive" className="text-sm whitespace-nowrap">
              Inativas
            </Label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <Printer className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {search || orgFilter !== "all" || showInactive
                  ? "Nenhuma impressora corresponde aos filtros"
                  : "Nenhuma impressora cadastrada"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p: any) => (
              <Card
                key={p._id}
                className={`border-border/50 shadow-sm hover:shadow-md transition-all duration-200 ${
                  !p.active ? "opacity-60" : ""
                }`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary/70">
                      <Printer className="h-5 w-5" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge
                        variant={p.active ? "outline" : "secondary"}
                        className="text-[10px]"
                      >
                        {p.active ? "Ativa" : "Inativa"}
                      </Badge>
                    </div>
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{p.name}</h3>
                  <p className="text-xs text-muted-foreground mb-1">
                    {p.brand} — {p.model}
                  </p>
                  {p.patrimony && (
                    <p className="text-xs text-muted-foreground mb-1">
                      <span className="font-medium">Patrimônio:</span>{" "}
                      {p.patrimony}
                    </p>
                  )}
                  {p.organization && (
                    <div className="flex items-center gap-1 mb-2">
                      <Building2 className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {p.organization.name}
                      </span>
                    </div>
                  )}
                  {p.observation && (
                    <p className="text-[10px] text-muted-foreground italic mb-2 truncate">
                      {p.observation}
                    </p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 flex-1"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button
                      variant={p.active ? "destructive" : "outline"}
                      size="sm"
                      className="gap-1"
                      onClick={() => handleToggleActive(p)}
                    >
                      {p.active ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar Impressora" : "Nova Impressora"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>
                Nome <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Impressora do Gabinete"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>
                  Marca <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  placeholder="Ex: HP, Canon, Epson"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>
                  Modelo <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="Ex: LaserJet Pro M404dn"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label>Secretaria / Unidade</Label>
              <Select
                value={form.organizationId}
                onValueChange={(v) =>
                  setForm({ ...form, organizationId: v === "__none" ? "" : v })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Não atribuída</SelectItem>
                  {allOrgs.map((o: any) => (
                    <SelectItem key={o._id} value={o._id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nº de Patrimônio</Label>
              <Input
                value={form.patrimony}
                onChange={(e) =>
                  setForm({ ...form, patrimony: e.target.value })
                }
                placeholder="Ex: PAT-2026-001"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                value={form.observation}
                onChange={(e) =>
                  setForm({ ...form, observation: e.target.value })
                }
                rows={2}
                placeholder="Opcional"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>{editingId ? "Salvar" : "Cadastrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
