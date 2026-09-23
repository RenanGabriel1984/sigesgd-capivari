import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { SearchInput } from "@/components/SearchInput";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Monitor, Laptop, Server, Printer, Wifi, HardDrive, HelpCircle, Search, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_TYPE_LABELS,
  findEquipmentCategory,
  matchesEquipmentCategory,
} from "@/lib/equipment-categories";

const ASSET_TYPE_LABELS: Record<string, string> = EQUIPMENT_TYPE_LABELS;

const ASSET_STATUS_LABELS: Record<string, string> = {
  active: "Ativo", maintenance: "Manutenção", inactive: "Inativo",
  disposal_pending: "Descarte Pendente", disposed: "Descartado", lost: "Perdido",
};

const ASSET_STATUS_COLORS: Record<string, string> = {
  active: "badge-success", maintenance: "badge-warning",
  inactive: "badge-neutral", disposal_pending: "badge-warning",
  disposed: "badge-danger", lost: "badge-danger",
};

function getTypeIcon(type: string) {
  switch (type) {
    case "desktop": return Monitor;
    case "notebook": return Laptop;
    case "server": return Server;
    case "printer": return Printer;
    case "switch": case "router": case "access_point": return Wifi;
    case "storage": return HardDrive;
    case "phone": return Phone;
    default: return HelpCircle;
  }
}

function AssetsSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 max-w-md" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

export default function AssetsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = findEquipmentCategory(searchParams.get("categoria"));
  const [tab, setTab] = useState("list");
  const [showNew, setShowNew] = useState(false);
  const [filters, setFilters] = useState({ status: "", assetType: "", search: "" });
  const [form, setForm] = useState({
    patrimonyNumber: "", serialNumber: "", assetType: "desktop",
    manufacturer: "", model: "", hostname: "", macAddress: "",
    organizationId: "", responsibleUserId: "", observation: "",
  });

  const assets = useQuery(api.assets.list, {
    status: filters.status || undefined,
    assetType: filters.assetType || undefined,
    search: filters.search || undefined,
  });
  const organizations = useQuery(api.organizations.list);
  const createAsset = useMutation(api.assets.create);
  const navigate = useNavigate();

  if (assets === undefined) return <AssetsSkeleton />;

  // A categoria de equipamento (Impressoras/Computadores/Redes/Telefonia) é
  // apenas um recorte da lista — nenhuma regra de fornecedor ou de destino de
  // estoque é derivada dela.
  const byCategory = category
    ? (assets ?? []).filter((a) => matchesEquipmentCategory(a.assetType, category))
    : (assets ?? []);

  const filteredAssets = byCategory.filter((a) =>
    !filters.search ||
    a.patrimonyNumber?.toLowerCase().includes(filters.search.toLowerCase()) ||
    a.serialNumber?.toLowerCase().includes(filters.search.toLowerCase()) ||
    a.manufacturer?.toLowerCase().includes(filters.search.toLowerCase()) ||
    a.model?.toLowerCase().includes(filters.search.toLowerCase())
  );

  const orgsList = organizations?.orgs ?? [];

  const handleCreate = async () => {
    if (!form.assetType) { toast.error("Selecione o tipo de equipamento"); return; }
    try {
      await createAsset({
        assetType: form.assetType as any,
        patrimonyNumber: form.patrimonyNumber || undefined,
        serialNumber: form.serialNumber || undefined,
        manufacturer: form.manufacturer || undefined,
        model: form.model || undefined,
        hostname: form.hostname || undefined,
        macAddress: form.macAddress || undefined,
        organizationId: form.organizationId as any || undefined,
        responsibleUserId: form.responsibleUserId as any || undefined,
        observation: form.observation || undefined,
      });
      toast.success("Equipamento cadastrado com sucesso");
      setShowNew(false);
      setForm({ patrimonyNumber: "", serialNumber: "", assetType: "desktop", manufacturer: "", model: "", hostname: "", macAddress: "", organizationId: "", responsibleUserId: "", observation: "" });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cadastrar equipamento");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {category ? category.label : "Equipamentos"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {category ? `${category.description} — ` : "Controle patrimonial e manutenção — "}
              {filteredAssets.length} equipamento(s)
            </p>
          </div>
          <Button onClick={() => setShowNew(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Novo Equipamento
          </Button>
        </div>

        {/* Categorias de equipamento — recorte da mesma lista, sem duplicar telas */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              !category
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            Todos
          </button>
          {EQUIPMENT_CATEGORIES.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => setSearchParams({ categoria: c.slug })}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                category?.slug === c.slug
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <SearchInput
              placeholder="Buscar por patrimônio, série, marca..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
          <select
            className="border rounded-md p-2 text-sm bg-background"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Todos os status</option>
            {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            className="border rounded-md p-2 text-sm bg-background"
            value={filters.assetType}
            onChange={(e) => setFilters({ ...filters, assetType: e.target.value })}
          >
            <option value="">Todos os tipos</option>
            {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* Empty State */}
        {filteredAssets.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16">
              <div className="empty-state">
                <Monitor className="empty-state-icon" />
                <p className="empty-state-title">
                  {filters.search || filters.status || filters.assetType || category
                    ? "Nenhum equipamento encontrado"
                    : "Nenhum equipamento cadastrado"}
                </p>
                <p className="empty-state-desc">
                  {filters.search
                    ? `Nenhum resultado para "${filters.search}"${category ? ` em ${category.label}` : ""}. Tente outro termo ou limpe a busca.`
                    : category
                      ? `Nenhum equipamento em ${category.label}${filters.status || filters.assetType ? " com os filtros atuais" : ""}.`
                      : filters.status || filters.assetType
                        ? "Tente alterar os filtros aplicados."
                        : "Cadastre o primeiro equipamento para iniciar o controle patrimonial."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Desktop Table */}
            <Card className="border-border/50 hidden sm:block">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs">Equipamento</TableHead>
                        <TableHead className="text-xs">Patrimônio / Série</TableHead>
                        <TableHead className="text-xs">Usuário</TableHead>
                        <TableHead className="text-xs">Secretaria</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAssets.map((a) => {
                        const TypeIcon = getTypeIcon(a.assetType);
                        return (
                          <TableRow
                            key={a._id}
                            className="cursor-pointer hover:bg-muted/30"
                            onClick={() => navigate(`/assets/${a._id}`)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <TypeIcon className="h-4 w-4 text-muted-foreground" />
                                <span className="text-xs">{ASSET_TYPE_LABELS[a.assetType] ?? a.assetType}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-sm">{a.manufacturer} {a.model}</p>
                              <p className="text-[10px] text-muted-foreground">{a.hostname ?? "—"}</p>
                            </TableCell>
                            <TableCell className="text-xs">
                              {a.patrimonyNumber ?? "—"} / {a.serialNumber ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">{a.responsible?.name ?? "—"}</TableCell>
                            <TableCell className="text-xs">{a.organization?.name ?? "—"}</TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] ${ASSET_STATUS_COLORS[a.status] ?? "badge-neutral"}`}>
                                {ASSET_STATUS_LABELS[a.status] ?? a.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Mobile Cards */}
            <div className="sm:hidden space-y-3">
              {filteredAssets.map((a) => {
                const TypeIcon = getTypeIcon(a.assetType);
                return (
                  <Card
                    key={a._id}
                    className="border-border/50 card-hover cursor-pointer"
                    onClick={() => navigate(`/assets/${a._id}`)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4 text-muted-foreground" />
                          <p className="font-medium text-sm">{a.manufacturer} {a.model}</p>
                        </div>
                        <Badge className={`text-[10px] ${ASSET_STATUS_COLORS[a.status] ?? "badge-neutral"}`}>
                          {ASSET_STATUS_LABELS[a.status] ?? a.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>Patrimônio: {a.patrimonyNumber ?? "—"}</span>
                        <span>Série: {a.serialNumber ?? "—"}</span>
                        <span>Usuário: {a.responsible?.name ?? "—"}</span>
                        <span>Local: {a.organization?.name ?? "—"}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {/* New Asset Dialog */}
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo Equipamento</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Tipo de Equipamento *</Label>
                <select className="w-full border rounded-md p-2 text-sm" value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })}>
                  {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nº Patrimônio</Label>
                  <Input value={form.patrimonyNumber} onChange={(e) => setForm({ ...form, patrimonyNumber: e.target.value })} />
                </div>
                <div>
                  <Label>Nº Série</Label>
                  <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Fabricante</Label>
                  <Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
                </div>
                <div>
                  <Label>Modelo</Label>
                  <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Hostname</Label>
                  <Input value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
                </div>
                <div>
                  <Label>MAC</Label>
                  <Input value={form.macAddress} onChange={(e) => setForm({ ...form, macAddress: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Secretaria</Label>
                <select className="w-full border rounded-md p-2 text-sm" value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
                  <option value="">Selecione...</option>
                  {orgsList.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Observação</Label>
                <Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
              <Button onClick={handleCreate}>Cadastrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
