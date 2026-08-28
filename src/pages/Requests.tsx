import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
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
import { Plus, ClipboardList, Check, X, Truck } from "lucide-react";
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_COLORS, getPermissions, type UserRole } from "@/types/constants";
import { toast } from "sonner";

interface RequestItemForm {
  productId: string;
  quantity: number;
}

const REASON_OPTIONS = [
  "Substituição de peça com defeito",
  "Instalação em equipamento novo",
  "Manutenção preventiva",
  "Expansão de equipamento",
  "Manutenção de infraestrutura",
  "Outro",
];

export default function Requests() {
  const { user } = useAuth();
  const requests = useQuery(api.requests.list);
  const products = useQuery(api.products.listActive);
  const organizations = useQuery(api.organizations.list);
  const createRequest = useMutation(api.requests.create);
  const approveRequest = useMutation(api.requests.approve);
  const rejectRequest = useMutation(api.requests.reject);
  const deliverRequest = useMutation(api.requests.deliver);
  const cancelRequest = useMutation(api.requests.cancel);

  const [createDialog, setCreateDialog] = useState(false);
  const [approveDialog, setApproveDialog] = useState<any>(null);
  const [items, setItems] = useState<RequestItemForm[]>([{ productId: "", quantity: 1 }]);
  const [observation, setObservation] = useState("");
  const [approveObservation, setApproveObservation] = useState("");
  const [secretariaId, setSecretariaId] = useState("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [reason, setReason] = useState("");
  const [reasonSelect, setReasonSelect] = useState("");
  const [osNumber, setOsNumber] = useState("");
  const [patrimony, setPatrimony] = useState("");

  const role = (user?.role ?? "technician") as UserRole;
  const permissions = getPermissions(role);

  const myRequests = requests?.filter((r) => r.requesterId === user?._id) ?? [];
  const pendingForApproval = requests?.filter((r) => r.status === "pending" && r.requesterId !== user?._id) ?? [];

  // Cascading org selects
  const orgList = organizations?.orgs ?? [];
  const secretarias = useMemo(() =>
    orgList.filter((o) => o.type === "secretaria" && o.active),
    [orgList]
  );
  const departamentos = useMemo(() =>
    orgList.filter((o) => o.type === "departamento" && o.active && o.parentId === secretariaId),
    [orgList, secretariaId]
  );
  const unidades = useMemo(() => {
    if (departamentoId) {
      return orgList.filter((o) => o.type === "unidade" && o.active && o.parentId === departamentoId);
    }
    return orgList.filter((o) => o.type === "unidade" && o.active && o.parentId === secretariaId);
  }, [orgList, secretariaId, departamentoId]);

  const availableProducts = useMemo(() =>
    products?.filter((p) => p.active) ?? [],
    [products]
  );

  const addItem = () => setItems([...items, { productId: "", quantity: 1 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof RequestItemForm, value: any) => {
    const newItems = [...items];
    (newItems[i] as any)[field] = value;
    setItems(newItems);
  };

  const resetForm = () => {
    setItems([{ productId: "", quantity: 1 }]);
    setObservation("");
    setSecretariaId("");
    setDepartamentoId("");
    setUnidadeId("");
    setReason("");
    setReasonSelect("");
    setOsNumber("");
    setPatrimony("");
  };

  const handleCreate = async () => {
    if (!secretariaId) { toast.error("Selecione a secretaria de destino"); return; }
    if (departamentos.length > 0 && !departamentoId) { toast.error("Selecione o departamento"); return; }
    if (!reason.trim()) { toast.error("O motivo da solicitação é obrigatório"); return; }
    const validItems = items.filter((i) => i.productId && i.quantity > 0);
    if (validItems.length === 0) { toast.error("Adicione pelo menos um item do estoque válido"); return; }
    for (const item of validItems) {
      const product = availableProducts.find((p) => p._id === item.productId);
      if (!product) { toast.error("Item do estoque não encontrado"); return; }
      if (product.active === false) { toast.error(`"${product.name}" não está disponível`); return; }
      const available = (product.stock?.physicalQuantity ?? 0) - (product.stock?.reservedQuantity ?? 0);
      if (item.quantity > available) {
        toast.error(`Estoque insuficiente para "${product.name}". Disponível: ${available}`);
        return;
      }
    }
    try {
      await createRequest({
        secretariaId: secretariaId as any,
        departamentoId: departamentoId ? (departamentoId as any) : undefined,
        unidadeId: unidadeId ? (unidadeId as any) : undefined,
        reason: reason.trim(),
        osNumber: osNumber.trim() || undefined,
        patrimony: patrimony.trim() || undefined,
        observation: observation.trim() || undefined,
        items: validItems.map((i) => ({ productId: i.productId as any, quantityRequested: i.quantity })),
      });
      toast.success("Solicitação criada com sucesso");
      setCreateDialog(false);
      resetForm();
    } catch (e: any) {
      console.error("Erro ao criar solicitação:", e);
      toast.error(e.message ?? "Erro ao criar solicitação");
    }
  };

  const handleApprove = async () => {
    if (!approveDialog) return;
    try {
      await approveRequest({
        requestId: approveDialog._id,
        items: approveDialog.items.map((item: any) => ({
          itemId: item._id,
          quantityApproved: item.quantityRequested,
        })),
        observation: approveObservation || undefined,
      });
      toast.success("Solicitação aprovada");
      setApproveDialog(null);
      setApproveObservation("");
    } catch (e: any) {
      console.error("Erro ao aprovar:", e);
      toast.error(e.message ?? "Erro ao aprovar");
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await rejectRequest({ requestId: requestId as any });
      toast.success("Solicitação rejeitada");
    } catch (e: any) {
      console.error("Erro ao rejeitar:", e);
      toast.error(e.message ?? "Erro ao rejeitar");
    }
  };

  const handleDeliver = async (requestId: string) => {
    try {
      await deliverRequest({ requestId: requestId as any });
      toast.success("Entrega registrada");
    } catch (e: any) {
      console.error("Erro ao entregar:", e);
      toast.error(e.message ?? "Erro ao registrar entrega");
    }
  };

  const handleCancel = async (requestId: string) => {
    try {
      await cancelRequest({ requestId: requestId as any });
      toast.success("Solicitação cancelada");
    } catch (e: any) {
      console.error("Erro ao cancelar:", e);
      toast.error(e.message ?? "Erro ao cancelar");
    }
  };

  const renderRequest = (r: any, showActions = false) => (
    <Card key={r._id} className="border-border/50 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-medium text-sm">{r.requester?.name ?? "Usuário"}</p>
            <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("pt-BR")}</p>
          </div>
          <Badge className={REQUEST_STATUS_COLORS[r.status as keyof typeof REQUEST_STATUS_COLORS]}>
            {REQUEST_STATUS_LABELS[r.status as keyof typeof REQUEST_STATUS_LABELS]}
          </Badge>
        </div>
        {(r.secretaria || r.departamento || r.unidade) && (
          <div className="mb-2 text-xs text-muted-foreground space-y-0.5">
            {r.secretaria && <p><span className="font-medium">Secretaria:</span> {r.secretaria.name}</p>}
            {r.departamento && <p><span className="font-medium">Depto:</span> {r.departamento.name}</p>}
            {r.unidade && <p><span className="font-medium">Unidade:</span> {r.unidade.name}</p>}
          </div>
        )}
        {r.reason && <div className="mb-2 text-xs"><span className="font-medium text-muted-foreground">Motivo:</span> {r.reason}</div>}
        {r.osNumber && <div className="mb-2 text-xs"><span className="font-medium text-muted-foreground">O.S.:</span> {r.osNumber}</div>}
        {r.patrimony && <div className="mb-2 text-xs"><span className="font-medium text-muted-foreground">Patrimônio:</span> {r.patrimony}</div>}
        <div className="space-y-1.5 mb-3">
          {r.items?.map((item: any) => (
            <div key={item._id} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
              <span>{item.product?.name ?? "Item"}</span>
              <span className="font-mono text-xs">
                Sol: {item.quantityRequested}
                {item.quantityApproved > 0 && ` | Apr: ${item.quantityApproved}`}
                {item.quantityDelivered > 0 && ` | Ent: ${item.quantityDelivered}`}
              </span>
            </div>
          ))}
        </div>
        {r.observation && <p className="text-xs text-muted-foreground italic">{r.observation}</p>}
        {showActions && r.status === "pending" && (
          <div className="flex gap-2 mt-3">
            <Button size="sm" className="gap-1" onClick={() => { setApproveDialog(r); setApproveObservation(""); }}>
              <Check className="h-3.5 w-3.5" /> Aprovar
            </Button>
            <Button size="sm" variant="destructive" className="gap-1" onClick={() => handleReject(r._id)}>
              <X className="h-3.5 w-3.5" /> Rejeitar
            </Button>
          </div>
        )}
        {showActions && r.status === "approved" && permissions.canDeliver && (
          <Button size="sm" className="gap-1 mt-3" onClick={() => handleDeliver(r._id)}>
            <Truck className="h-3.5 w-3.5" /> Entregar
          </Button>
        )}
        {!showActions && r.status === "pending" && r.requesterId === user?._id && (
          <Button size="sm" variant="outline" className="gap-1 mt-3" onClick={() => handleCancel(r._id)}>
            Cancelar
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Solicitações</h1>
            <p className="text-sm text-muted-foreground">Gerenciar solicitações de itens do estoque</p>
          </div>
          {permissions.canCreateRequests && (
            <Button onClick={() => setCreateDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Nova Solicitação
            </Button>
          )}
        </div>
        <Tabs defaultValue="my">
          <TabsList>
            <TabsTrigger value="my">Minhas</TabsTrigger>
            {permissions.canApproveRequests && (
              <TabsTrigger value="pending">Pendentes ({pendingForApproval.length})</TabsTrigger>
            )}
            <TabsTrigger value="all">Todas</TabsTrigger>
          </TabsList>
          <TabsContent value="my" className="space-y-3 mt-4">
            {myRequests.length === 0 ? (
              <Card className="border-border/50"><CardContent className="py-12 text-center">
                <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Nenhuma solicitação</p>
              </CardContent></Card>
            ) : myRequests.map((r) => renderRequest(r))}
          </TabsContent>
          <TabsContent value="pending" className="space-y-3 mt-4">
            {pendingForApproval.length === 0 ? (
              <Card className="border-border/50"><CardContent className="py-12 text-center">
                <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Nenhuma pendente</p>
              </CardContent></Card>
            ) : pendingForApproval.map((r) => renderRequest(r, true))}
          </TabsContent>
          <TabsContent value="all" className="space-y-3 mt-4">
            {requests?.map((r) => renderRequest(r, r.status === "pending" && r.requesterId !== user?._id))}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Criar Solicitação ── */}
      <Dialog open={createDialog} onOpenChange={(open) => { setCreateDialog(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova Solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Técnico solicitante</Label>
              <Input value={user?.name ?? "Carregando..."} disabled className="mt-1" />
            </div>
            <div>
              <Label>Secretaria <span className="text-destructive">*</span></Label>
              <Select value={secretariaId} onValueChange={(v) => { setSecretariaId(v); setDepartamentoId(""); setUnidadeId(""); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a secretaria" /></SelectTrigger>
                <SelectContent>
                  {secretarias.length === 0
                    ? <SelectItem value="__none" disabled>Nenhuma secretaria cadastrada</SelectItem>
                    : secretarias.map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {secretariaId && departamentos.length > 0 && (
              <div>
                <Label>Departamento <span className="text-destructive">*</span></Label>
                <Select value={departamentoId} onValueChange={(v) => { setDepartamentoId(v); setUnidadeId(""); }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o departamento" /></SelectTrigger>
                  <SelectContent>
                    {departamentos.map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {secretariaId && unidades.length > 0 && (
              <div>
                <Label>Unidade</Label>
                <Select value={unidadeId} onValueChange={setUnidadeId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>
                    {unidades.map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Nº da O.S.</Label>
              <Input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} placeholder="Opcional" className="mt-1" />
            </div>
            <div>
              <Label>Patrimônio</Label>
              <Input value={patrimony} onChange={(e) => setPatrimony(e.target.value)} placeholder="Opcional" className="mt-1" />
            </div>
            <div className="border-t pt-4">
              <Label className="text-sm font-medium">Itens do estoque <span className="text-destructive">*</span></Label>
              {availableProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Nenhum item disponível. O responsável pelo estoque precisa cadastrar os itens antes da solicitação.
                </p>
              ) : (
                <div className="space-y-2 mt-2">
                  {items.map((item, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Select value={item.productId} onValueChange={(v) => updateItem(i, "productId", v)}>
                          <SelectTrigger><SelectValue placeholder="Selecione uma peça ou insumo..." /></SelectTrigger>
                          <SelectContent>
                            {availableProducts.map((p) => {
                              const av = (p.stock?.physicalQuantity ?? 0) - (p.stock?.reservedQuantity ?? 0);
                              return <SelectItem key={p._id} value={p._id}>{p.name} ({p.manufacturer ?? "-"}) — {av} disp.</SelectItem>;
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-20">
                        <Input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} />
                      </div>
                      {items.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeItem(i)} className="shrink-0 mb-0.5"><X className="h-4 w-4" /></Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addItem} className="gap-1"><Plus className="h-3.5 w-3.5" /> Adicionar item</Button>
                </div>
              )}
            </div>
            <div>
              <Label>Motivo da solicitação <span className="text-destructive">*</span></Label>
              <Select value={reasonSelect} onValueChange={(v) => { setReasonSelect(v); if (v !== "Outro") setReason(v); else setReason(""); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              {reasonSelect === "Outro" && (
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Descreva o motivo..." rows={2} className="mt-2" />
              )}
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={observation} onChange={(e) => setObservation(e.target.value)} rows={2} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Enviar Solicitação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Aprovar ── */}
      <Dialog open={!!approveDialog} onOpenChange={() => setApproveDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Aprovar Solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {approveDialog?.items?.map((item: any) => (
              <div key={item._id} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-2">
                <span>{item.product?.name}</span>
                <span className="font-mono">Solicitado: {item.quantityRequested}</span>
              </div>
            ))}
            <div>
              <Label>Observação</Label>
              <Textarea value={approveObservation} onChange={(e) => setApproveObservation(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialog(null)}>Cancelar</Button>
            <Button onClick={handleApprove}>Aprovar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
