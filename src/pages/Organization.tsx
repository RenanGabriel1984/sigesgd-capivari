import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Building2, ChevronRight, ChevronDown, Package, X } from "lucide-react";
import { ORG_TYPE_LABELS, type OrgType } from "@/types/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function LoadingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-48" /></div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </AppShell>
  );
}

interface OrgForm { name: string; type: OrgType | ""; parentId: string; observation: string; startDate: string; endDate: string; }
const emptyForm: OrgForm = { name: "", type: "", parentId: "", observation: "", startDate: "", endDate: "" };

/** Indentação visual da hierarquia (px por nível) — todos alinhados à esquerda */
const TREE_INDENT = 20;

function OrgTreeNode({ org, allOrgs, onEdit, onSelect, isSelected, level = 0 }: {
  org: any; allOrgs: any[]; onEdit: (org: any) => void; onSelect: (org: any) => void; isSelected: boolean; level?: number;
}) {
  const [expanded, setExpanded] = useState(level < 1);
  const grandchildren = allOrgs.filter((o) => o.parentId === org._id);
  return (
    <div>
      <div
        className={`flex items-start gap-2 py-2 pr-2 rounded-lg transition-colors group cursor-pointer ${isSelected ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"}`}
        style={{ paddingLeft: `${level * TREE_INDENT + 12}px` }}
        onClick={() => onSelect(org)}
      >
        {grandchildren.length > 0 ? (
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 mt-0.5" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        ) : (<div className="w-6 shrink-0" />)}
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        {/* Nome: cresce verticalmente, nunca truncado, nunca sobrepõe o status */}
        <div className="flex-1 min-w-0 py-0.5">
          <span className="text-sm font-medium app-break leading-snug">{org.name}</span>
          <div className="mt-1">
            <Badge variant="secondary" className="text-[10px]">{ORG_TYPE_LABELS[org.type as OrgType]}</Badge>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 mt-0.5">
          <Badge variant={org.active ? "default" : "secondary"} className="text-[10px]">{org.active ? "Ativo" : "Inativo"}</Badge>
          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 max-sm:opacity-100" onClick={(e) => { e.stopPropagation(); onEdit(org); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {expanded && grandchildren.map((child) => (
        <OrgTreeNode key={child._id} org={child} allOrgs={allOrgs} onEdit={onEdit} onSelect={onSelect} isSelected={isSelected} level={level + 1} />
      ))}
    </div>
  );
}

export default function Organization() {
  const orgData = useQuery(api.organizations.list);
  const createOrg = useMutation(api.organizations.create);
  const updateOrg = useMutation(api.organizations.update);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OrgForm>(emptyForm);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);

  // Consumption history for selected org
  const orgHistory = useQuery(
    api.requests.listByOrganization,
    selectedOrg ? { organizationId: selectedOrg._id } : "skip"
  );

  // Enquanto a query não resolve (carregando ou erro), mostra skeleton em vez
  // de exibir indevidamente "Nenhuma unidade" — evita interpretação errada
  // de que a estrutura foi perdida.
  if (orgData === undefined) {
    return <LoadingSkeleton />;
  }

  const rootOrgs = orgData?.orgs.filter((o) => !o.parentId) ?? [];

  const openCreate = (parentId?: string) => { setForm({ ...emptyForm, parentId: parentId ?? "" }); setEditingId(null); setDialogOpen(true); };
  const openEdit = (org: any) => { setForm({ name: org.name, type: org.type, parentId: org.parentId ?? "", observation: org.observation ?? "", startDate: org.startDate ?? "", endDate: org.endDate ?? "" }); setEditingId(org._id); setDialogOpen(true); };
  const handleSave = async () => {
    if (!form.name.trim() || !form.type) { toast.error("Nome e tipo são obrigatórios"); return; }
    try {
      const data = { name: form.name, type: form.type as OrgType, parentId: (form.parentId || undefined) as any, observation: form.observation || undefined, startDate: form.startDate || undefined, endDate: form.endDate || undefined };
      if (editingId) { await updateOrg({ id: editingId as any, ...data }); toast.success("Unidade atualizada"); }
      else { await createOrg(data); toast.success("Unidade criada"); }
      setDialogOpen(false);
    } catch (e: any) { toast.error(e.message ?? "Erro ao salvar"); }
  };

  // Stats for selected org
  const totalDelivered = orgHistory?.length ?? 0;
  const totalItems = orgHistory?.reduce((sum: number, r: any) => sum + (r.items?.reduce((s: number, i: any) => s + (i.quantityDelivered ?? 0), 0) ?? 0), 0) ?? 0;

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><h1 className="text-2xl font-bold tracking-tight">Organização</h1><p className="text-sm text-muted-foreground">Estrutura organizacional hierárquica</p></div>
          <Button onClick={() => openCreate()} className="gap-2"><Plus className="h-4 w-4" /> Nova Unidade</Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Tree */}
          <div className={selectedOrg ? "lg:col-span-1" : "lg:col-span-3"}>
            <Card className="border-border/50"><CardContent className="p-2">
              {rootOrgs.length === 0 ? (
                <div className="text-center py-12"><Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" /><p className="text-muted-foreground">Nenhuma unidade organizacional cadastrada</p></div>
              ) : rootOrgs.map((org) => (
                <OrgTreeNode key={org._id} org={org} allOrgs={orgData?.orgs ?? []} onEdit={openEdit} onSelect={setSelectedOrg} isSelected={selectedOrg?._id === org._id} />
              ))}
            </CardContent></Card>
          </div>

          {/* Detail panel */}
          {selectedOrg && (
            <div className="lg:col-span-2">
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold">{selectedOrg.name}</h2>
                      <p className="text-xs text-muted-foreground">{ORG_TYPE_LABELS[selectedOrg.type as OrgType]}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedOrg(null)}><X className="h-4 w-4" /></Button>
                  </div>
                  <Tabs defaultValue="info">
                    <TabsList>
                      <TabsTrigger value="info">Informações</TabsTrigger>
                      <TabsTrigger value="history">Histórico de Consumo</TabsTrigger>
                    </TabsList>
                    <TabsContent value="info" className="space-y-2 mt-3 text-sm">
                      <p><span className="font-medium">Nome:</span> {selectedOrg.name}</p>
                      <p><span className="font-medium">Tipo:</span> {ORG_TYPE_LABELS[selectedOrg.type as OrgType]}</p>
                      {selectedOrg.startDate && <p><span className="font-medium">Data Início:</span> {selectedOrg.startDate}</p>}
                      {selectedOrg.endDate && <p><span className="font-medium">Data Término:</span> {selectedOrg.endDate}</p>}
                      {selectedOrg.observation && <p><span className="font-medium">Observação:</span> {selectedOrg.observation}</p>}
                      <p><span className="font-medium">Status:</span> <Badge variant={selectedOrg.active ? "default" : "secondary"}>{selectedOrg.active ? "Ativo" : "Inativo"}</Badge></p>
                    </TabsContent>
                    <TabsContent value="history" className="mt-3">
                      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 mb-4">
                        <div className="border rounded px-3 py-2 text-center">
                          <p className="text-2xl font-bold">{totalDelivered}</p>
                          <p className="text-xs text-muted-foreground">Pedidos Entregues</p>
                        </div>
                        <div className="border rounded px-3 py-2 text-center">
                          <p className="text-2xl font-bold">{totalItems}</p>
                          <p className="text-xs text-muted-foreground">Itens Recebidos</p>
                        </div>
                      </div>
                      {orgHistory === undefined ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
                      ) : orgHistory.length === 0 ? (
                        <div className="text-center py-8">
                          <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-sm text-muted-foreground">Nenhuma entrega registrada para esta unidade</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {orgHistory.map((r: any) => (
                            <div key={r._id} className="border rounded px-3 py-2 text-sm">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium">{r.requester?.name ?? "—"}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {r.deliveredAt ? new Date(r.deliveredAt).toLocaleDateString("pt-BR") : "—"}
                                    {r.secretaria && ` — ${r.secretaria.name}`}
                                  </p>
                                </div>
                                <Badge variant="secondary" className="text-[10px]">{r.items?.length ?? 0} item(ns)</Badge>
                              </div>
                              <div className="mt-1 space-y-0.5">
                                {r.items?.filter((i: any) => i.quantityDelivered > 0).map((item: any) => (
                                  <div key={item._id} className="flex justify-between text-xs text-muted-foreground">
                                    <span>{item.product?.name ?? "Item"}</span>
                                    <span className="font-mono">Qtd: {item.quantityDelivered}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-md max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingId ? "Editar Unidade" : "Nova Unidade"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Tipo *</Label><Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as OrgType })}><SelectTrigger><SelectValue placeholder="Selecionar tipo" /></SelectTrigger><SelectContent>{Object.entries(ORG_TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent></Select></div>
          <div><Label>Unidade Superior</Label><Select value={form.parentId} onValueChange={(v) => setForm({ ...form, parentId: v })}><SelectTrigger><SelectValue placeholder="Nenhuma (raiz)" /></SelectTrigger><SelectContent>{orgData?.orgs.filter((o) => o._id !== editingId).map((o) => (<SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>))}</SelectContent></Select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><Label>Data Início</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div><div><Label>Data Término</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div></div>
          <div><Label>Observações</Label><Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button onClick={handleSave}>{editingId ? "Salvar" : "Criar"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </AppShell>
  );
}
