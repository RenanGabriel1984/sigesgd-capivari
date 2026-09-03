import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ArrowLeft, Wrench, Package, Key, History, Settings, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router";
import type { Id } from "@/convex/_generated/dataModel";

const ASSET_STATUS_LABELS: Record<string, string> = {
  active: "Ativo", maintenance: "Manutenção", inactive: "Inativo",
  disposal_pending: "Descarte Pendente", disposed: "Descartado", lost: "Perdido",
};
const ASSET_STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-600 bg-emerald-50", maintenance: "text-amber-600 bg-amber-50",
  inactive: "text-gray-600 bg-gray-50", disposal_pending: "text-orange-600 bg-orange-50",
  disposed: "text-rose-600 bg-rose-50", lost: "text-rose-600 bg-rose-50",
};
const ASSET_TYPE_LABELS: Record<string, string> = {
  desktop: "Desktop", notebook: "Notebook", monitor: "Monitor",
  server: "Servidor", printer: "Impressora", switch: "Switch",
  router: "Roteador", access_point: "Access Point", ups: "UPS",
  storage: "Armazenamento", other: "Outro",
};
const HISTORY_LABELS: Record<string, string> = {
  created: "Criado", assigned: "Atribuído", relocated: "Transferido",
  maintenance: "Manutenção", returned: "Retornado", status_changed: "Status Alterado",
  part_installed: "Peça Instalada", part_removed: "Peça Removida", disposed: "Descartado",
};

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const asset = useQuery(api.assets.get, id ? { assetId: id as Id<"assets"> } : "skip");
  const changeStatus = useMutation(api.assets.changeStatus);
  const assign = useMutation(api.assets.assign);

  const [tab, setTab] = useState("data");
  const [showStatus, setShowStatus] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusObs, setStatusObs] = useState("");
  const [showAssign, setShowAssign] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignOrgId, setAssignOrgId] = useState("");
  const [assignObs, setAssignObs] = useState("");

  const users = useQuery(api.users.listUsers);
  const orgs = useQuery(api.organizations.listActive);

  if (!asset) return <AppShell><div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Carregando...</p></div></AppShell>;

  const handleStatusChange = async () => {
    if (!newStatus) { toast.error("Selecione um status"); return; }
    try {
      await changeStatus({ assetId: asset._id as Id<"assets">, newStatus, observation: statusObs || undefined });
      toast.success("Status atualizado");
      setShowStatus(false); setNewStatus(""); setStatusObs("");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleAssign = async () => {
    try {
      await assign({
        assetId: asset._id as Id<"assets">,
        responsibleUserId: (assignUserId as Id<"users">) || undefined,
        organizationId: (assignOrgId as Id<"organizations">) || undefined,
        observation: assignObs || undefined,
      });
      toast.success("Atribuição atualizada");
      setShowAssign(false); setAssignUserId(""); setAssignOrgId(""); setAssignObs("");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/assets")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-2xl tracking-tight font-bold">
              {asset.patrimonyNumber ?? asset.serialNumber ?? "Equipamento"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {asset.manufacturer} {asset.model} — {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setShowAssign(true)} className="gap-2"><ArrowRightLeft className="h-4 w-4" /> Atribuir</Button>
            <Button variant="outline" onClick={() => setShowStatus(true)} className="gap-2"><Settings className="h-4 w-4" /> Status</Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="data">Dados</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
            <TabsTrigger value="maintenance">Manutenções</TabsTrigger>
            <TabsTrigger value="parts">Peças</TabsTrigger>
            <TabsTrigger value="licenses">Licenças</TabsTrigger>
          </TabsList>

          <TabsContent value="data">
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div><p className="text-xs text-muted-foreground">Patrimônio</p><p className="text-sm font-medium">{asset.patrimonyNumber ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Série</p><p className="text-sm font-medium">{asset.serialNumber ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Tipo</p><p className="text-sm font-medium">{ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}</p></div>
                  <div><p className="text-xs text-muted-foreground">Fabricante</p><p className="text-sm">{asset.manufacturer ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Modelo</p><p className="text-sm">{asset.model ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Hostname</p><p className="text-sm">{asset.hostname ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">MAC</p><p className="text-sm font-mono">{asset.macAddress ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Status</p><Badge className={ASSET_STATUS_COLORS[asset.status] ?? ""} variant="outline">{ASSET_STATUS_LABELS[asset.status] ?? asset.status}</Badge></div>
                  <div><p className="text-xs text-muted-foreground">Responsável</p><p className="text-sm">{asset.responsible?.name ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Secretaria</p><p className="text-sm">{asset.organization?.name ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Localização</p><p className="text-sm">{asset.location?.name ?? "—"}</p></div>
                  {asset.observation && <div className="md:col-span-3"><p className="text-xs text-muted-foreground">Observação</p><p className="text-sm">{asset.observation}</p></div>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-4 w-4" /> Histórico</CardTitle></CardHeader>
              <CardContent>
                {!asset.history?.length ? <p className="text-muted-foreground">Nenhum registro</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Evento</TableHead><TableHead>Usuário</TableHead><TableHead>Detalhes</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {asset.history.map((h: any) => (
                        <TableRow key={h._id}>
                          <TableCell className="text-sm">{new Date(h.timestamp).toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell><Badge variant="outline">{HISTORY_LABELS[h.eventType] ?? h.eventType}</Badge></TableCell>
                          <TableCell className="text-sm">{h.user?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{h.observation ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="maintenance">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Wrench className="h-4 w-4" /> Manutenções</CardTitle></CardHeader>
              <CardContent>
                {!asset.maintenances?.length ? <p className="text-muted-foreground">Nenhuma manutenção registrada</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Motivo</TableHead><TableHead>Descrição</TableHead><TableHead>Técnico</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {asset.maintenances.map((m: any) => (
                        <TableRow key={m._id}>
                          <TableCell className="text-sm">{new Date(m.date).toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell className="text-sm">{m.reason}</TableCell>
                          <TableCell className="text-sm">{m.serviceDescription}</TableCell>
                          <TableCell className="text-sm">{m.technician?.name ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline">{m.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="parts">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Package className="h-4 w-4" /> Peças Instaladas</CardTitle></CardHeader>
              <CardContent>
                {!asset.parts?.length ? <p className="text-muted-foreground">Nenhuma peça instalada</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Qtd</TableHead><TableHead>Instalado em</TableHead><TableHead>Por</TableHead><TableHead>Removido</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {asset.parts.map((p: any) => (
                        <TableRow key={p._id}>
                          <TableCell className="text-sm font-medium">{p.product?.name ?? "—"}</TableCell>
                          <TableCell>{p.quantity}</TableCell>
                          <TableCell className="text-sm">{new Date(p.installedAt).toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell className="text-sm">{p.installedBy?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm">{p.removedAt ? new Date(p.removedAt).toLocaleDateString("pt-BR") : <Badge variant="outline" className="text-emerald-600">Ativa</Badge>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="licenses">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Key className="h-4 w-4" /> Licenças</CardTitle></CardHeader>
              <CardContent>
                {!asset.licenses?.length ? <p className="text-muted-foreground">Nenhuma licença vinculada</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Edição</TableHead><TableHead>Tipo</TableHead><TableHead>Vinculada em</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {asset.licenses.map((l: any) => (
                        <TableRow key={l._id}>
                          <TableCell className="text-sm font-medium">{l.license?.productName ?? "—"}</TableCell>
                          <TableCell className="text-sm">{l.license?.edition ?? "—"}</TableCell>
                          <TableCell className="text-sm">{l.license?.licenseType ?? "—"}</TableCell>
                          <TableCell className="text-sm">{new Date(l.assignedAt).toLocaleDateString("pt-BR")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Status Dialog */}
        <Dialog open={showStatus} onOpenChange={setShowStatus}>
          <DialogContent>
            <DialogHeader><DialogTitle>Alterar Status</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Novo Status</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                  <option value="">Selecione...</option>
                  {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><Label>Observação</Label><Textarea className="mt-1" value={statusObs} onChange={(e) => setStatusObs(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowStatus(false)}>Cancelar</Button>
              <Button onClick={handleStatusChange}>Confirmar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign Dialog */}
        <Dialog open={showAssign} onOpenChange={setShowAssign}>
          <DialogContent>
            <DialogHeader><DialogTitle>Atribuir Equipamento</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Responsável</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                  <option value="">Nenhum</option>
                  {(users ?? []).filter((u: any) => u.active !== false).map((u: any) => <option key={u._id} value={u._id}>{u.name ?? u.email}</option>)}
                </select>
              </div>
              <div>
                <Label>Secretaria</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={assignOrgId} onChange={(e) => setAssignOrgId(e.target.value)}>
                  <option value="">Nenhuma</option>
                  {(Array.isArray(orgs) ? orgs : []).map((o: any) => <option key={o._id} value={o._id}>{o.name}</option>)}
                </select>
              </div>
              <div><Label>Observação</Label><Textarea className="mt-1" value={assignObs} onChange={(e) => setAssignObs(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAssign(false)}>Cancelar</Button>
              <Button onClick={handleAssign}>Confirmar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
