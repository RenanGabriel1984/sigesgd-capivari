import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Monitor, Laptop, Server, Printer, Wifi, HardDrive, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";

const ASSET_TYPE_LABELS: Record<string, string> = {
  desktop: "Desktop", notebook: "Notebook", monitor: "Monitor",
  server: "Servidor", printer: "Impressora", switch: "Switch",
  router: "Roteador", access_point: "Access Point", ups: "UPS",
  storage: "Armazenamento", other: "Outro",
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  active: "Ativo", maintenance: "Manutenção", inactive: "Inativo",
  disposal_pending: "Descarte Pendente", disposed: "Descartado", lost: "Perdido",
};

const ASSET_STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-600 bg-emerald-50", maintenance: "text-amber-600 bg-amber-50",
  inactive: "text-gray-600 bg-gray-50", disposal_pending: "text-orange-600 bg-orange-50",
  disposed: "text-rose-600 bg-rose-50", lost: "text-rose-600 bg-rose-50",
};

function getTypeIcon(type: string) {
  switch (type) {
    case "desktop": return Monitor;
    case "notebook": return Laptop;
    case "server": return Server;
    case "printer": return Printer;
    case "switch": case "router": case "access_point": return Wifi;
    case "storage": return HardDrive;
    default: return HelpCircle;
  }
}

export default function AssetsPage() {
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
  const createAsset = useMutation(api.assets.create);
  const navigate = useNavigate();
  const orgs = useQuery(api.organizations.listActive);
  const users = useQuery(api.users.listUsers);

  const handleCreate = async () => {
    if (!form.assetType) { toast.error("Tipo é obrigatório"); return; }
    try {
      await createAsset({
        patrimonyNumber: form.patrimonyNumber || undefined,
        serialNumber: form.serialNumber || undefined,
        assetType: form.assetType,
        manufacturer: form.manufacturer || undefined,
        model: form.model || undefined,
        hostname: form.hostname || undefined,
        macAddress: form.macAddress || undefined,
        organizationId: (form.organizationId as any) || undefined,
        responsibleUserId: (form.responsibleUserId as any) || undefined,
        observation: form.observation || undefined,
      });
      toast.success("Equipamento criado com sucesso");
      setShowNew(false);
      setForm({ patrimonyNumber: "", serialNumber: "", assetType: "desktop", manufacturer: "", model: "", hostname: "", macAddress: "", organizationId: "", responsibleUserId: "", observation: "" });
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar equipamento"); }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl tracking-tight font-bold">Equipamentos / Patrimônio</h1>
            <p className="text-sm text-muted-foreground">Cadastro e controle de equipamentos de TI do Município</p>
          </div>
          <Button onClick={() => setShowNew(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Novo Equipamento
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="list">Equipamentos</TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Input placeholder="Buscar patrimônio, série, hostname..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                  <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                    <option value="">Todos os status</option>
                    {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.assetType} onChange={(e) => setFilters({ ...filters, assetType: e.target.value })}>
                    <option value="">Todos os tipos</option>
                    {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <Button variant="outline" onClick={() => setFilters({ status: "", assetType: "", search: "" })}>Limpar Filtros</Button>
                </div>

                {!assets ? <p className="text-muted-foreground">Carregando...</p> : assets.length === 0 ? (
                  <p className="text-muted-foreground">Nenhum equipamento encontrado</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead></TableHead>
                          <TableHead>Patrimônio</TableHead>
                          <TableHead>Série</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Fabricante / Modelo</TableHead>
                          <TableHead>Usuário</TableHead>
                          <TableHead>Secretaria</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assets.map((a: any) => {
                          const Icon = getTypeIcon(a.assetType);
                          return (
                            <TableRow key={a._id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/assets/${a._id}`)}>
                              <TableCell><Icon className="h-4 w-4 text-muted-foreground" /></TableCell>
                              <TableCell className="text-sm font-mono font-medium">{a.patrimonyNumber ?? "—"}</TableCell>
                              <TableCell className="text-xs">{a.serialNumber ?? "—"}</TableCell>
                              <TableCell className="text-sm">{ASSET_TYPE_LABELS[a.assetType] ?? a.assetType}</TableCell>
                              <TableCell className="text-sm">{[a.manufacturer, a.model].filter(Boolean).join(" ") || "—"}</TableCell>
                              <TableCell className="text-sm">{a.responsible?.name ?? "—"}</TableCell>
                              <TableCell className="text-sm">{a.organization?.name ?? "—"}</TableCell>
                              <TableCell><Badge className={ASSET_STATUS_COLORS[a.status] ?? ""} variant="outline">{ASSET_STATUS_LABELS[a.status] ?? a.status}</Badge></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Novo Equipamento</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Nº Patrimônio</Label><Input className="mt-1" value={form.patrimonyNumber} onChange={(e) => setForm({ ...form, patrimonyNumber: e.target.value })} /></div>
                <div><Label>Nº Série</Label><Input className="mt-1" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tipo *</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })}>
                    {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><Label>Fabricante</Label><Input className="mt-1" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Modelo</Label><Input className="mt-1" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
                <div><Label>Hostname</Label><Input className="mt-1" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} /></div>
              </div>
              <div>
                <Label>MAC Address</Label>
                <Input className="mt-1" value={form.macAddress} onChange={(e) => setForm({ ...form, macAddress: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Secretaria</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
                    <option value="">Nenhuma</option>
                    {(Array.isArray(orgs) ? orgs : []).map((o: any) => <option key={o._id} value={o._id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Responsável</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.responsibleUserId} onChange={(e) => setForm({ ...form, responsibleUserId: e.target.value })}>
                    <option value="">Nenhum</option>
                    {(users ?? []).filter((u: any) => u.active !== false).map((u: any) => <option key={u._id} value={u._id}>{u.name ?? u.email ?? "Usuário"}</option>)}
                  </select>
                </div>
              </div>
              <div><Label>Observação</Label><Textarea className="mt-1" value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
              <Button onClick={handleCreate}>Criar Equipamento</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
