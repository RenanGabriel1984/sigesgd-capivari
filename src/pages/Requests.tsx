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
import { Plus, ClipboardList, Check, X, Truck, FileText } from "lucide-react";
import {
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_COLORS,
  getPermissions,
  type UserRole,
} from "@/types/constants";
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

  // ─── Create dialog state ───
  const [createDialog, setCreateDialog] = useState(false);
  const [items, setItems] = useState<RequestItemForm[]>([{ productId: "", quantity: 1 }]);
  const [observation, setObservation] = useState("");
  const [secretariaId, setSecretariaId] = useState("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [reason, setReason] = useState("");
  const [reasonSelect, setReasonSelect] = useState("");
  const [osNumber, setOsNumber] = useState("");
  const [patrimony, setPatrimony] = useState("");

  // ─── Approve dialog ───
  const [approveDialog, setApproveDialog] = useState<any>(null);
  const [approveObservation, setApproveObservation] = useState("");

  // ─── Reject dialog ───
  const [rejectDialog, setRejectDialog] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");

  // ─── Deliver dialog ───
  const [deliverDialog, setDeliverDialog] = useState<any>(null);
  const [deliverItems, setDeliverItems] = useState<
    Array<{ itemId: string; quantity: number; maxQuantity: number; serialNumbers: string[] }>
  >([]);

  // ─── Delivery term dialog ───
  const [termDialog, setTermDialog] = useState<any>(null);

  const role = (user?.role ?? "technician") as UserRole;
  const permissions = getPermissions(role);

  const myRequests = requests?.filter((r) => r.requesterId === user?._id) ?? [];
  const pendingForApproval =
    requests?.filter((r) => r.status === "pending" && r.requesterId !== user?._id) ?? [];

  // Cascading org selects
  const orgList = organizations?.orgs ?? [];
  const secretarias = useMemo(
    () => orgList.filter((o) => o.type === "secretaria" && o.active),
    [orgList]
  );
  const departamentos = useMemo(
    () => orgList.filter((o) => o.type === "departamento" && o.active && o.parentId === secretariaId),
    [orgList, secretariaId]
  );
  const unidades = useMemo(() => {
    if (departamentoId) {
      return orgList.filter((o) => o.type === "unidade" && o.active && o.parentId === departamentoId);
    }
    return orgList.filter((o) => o.type === "unidade" && o.active && o.parentId === secretariaId);
  }, [orgList, secretariaId, departamentoId]);

  const availableProducts = useMemo(() => products?.filter((p) => p.active) ?? [], [products]);

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

  // ─── Handlers ───

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
      toast.error(e.message ?? "Erro ao aprovar");
    }
  };

  const handleReject = async () => {
    if (!rejectDialog) return;
    if (!rejectReason.trim()) { toast.error("O motivo da rejeição é obrigatório"); return; }
    try {
      await rejectRequest({
        requestId: rejectDialog._id,
        observation: rejectReason.trim(),
      });
      toast.success("Solicitação rejeitada");
      setRejectDialog(null);
      setRejectReason("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao rejeitar");
    }
  };

  const openDeliverModal = (r: any) => {
    const dItems = r.items
      .filter((item: any) => item.quantityApproved > 0)
      .map((item: any) => ({
        itemId: item._id,
        quantity: item.quantityApproved,
        maxQuantity: item.quantityApproved,
        serialNumbers: [] as string[],
      }));
    if (dItems.length === 0) {
      toast.error("Nenhum item aprovado para entrega");
      return;
    }
    setDeliverItems(dItems);
    setDeliverDialog(r);
  };

  const updateDeliverItem = (idx: number, field: string, value: any) => {
    setDeliverItems((prev) => {
      const next = [...prev];
      (next[idx] as any)[field] = value;
      return next;
    });
  };

  const updateSerialNumber = (itemIdx: number, serialIdx: number, value: string) => {
    setDeliverItems((prev) => {
      const next = [...prev];
      const serials = [...next[itemIdx].serialNumbers];
      serials[serialIdx] = value;
      next[itemIdx].serialNumbers = serials;
      return next;
    });
  };

  const handleDeliver = async () => {
    if (!deliverDialog) return;
    // Validate serial numbers
    for (const di of deliverItems) {
      if (di.quantity <= 0) continue;
      const reqItem = deliverDialog.items.find((i: any) => i._id === di.itemId);
      const product = reqItem?.product;
      if (product?.hasSerial) {
        if (di.serialNumbers.length !== di.quantity) {
          toast.error(`Informe ${di.quantity} número(s) de patrimônio/série para "${product.name}"`);
          return;
        }
        if (di.serialNumbers.some((s) => !s.trim())) {
          toast.error(`Preencha todos os números de patrimônio/série para "${product.name}"`);
          return;
        }
      }
    }
    try {
      await deliverRequest({
        requestId: deliverDialog._id,
        items: deliverItems.map((di) => ({
          itemId: di.itemId as any,
          quantityDelivered: di.quantity,
          serialNumbers: di.serialNumbers.length > 0 ? di.serialNumbers : undefined,
        })),
      });
      toast.success("Entrega registrada com sucesso");
      setDeliverDialog(null);
      setDeliverItems([]);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar entrega");
    }
  };

  const handleCancel = async (requestId: string) => {
    try {
      await cancelRequest({ requestId: requestId as any });
      toast.success("Solicitação cancelada");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cancelar");
    }
  };

  // ─── Delivery Term ───
  const renderDeliveryTerm = (r: any) => {
    if (!r) return null;
    const deliveredItems = r.items?.filter((item: any) => item.quantityDelivered > 0) ?? [];
    const today = new Date().toLocaleDateString("pt-BR");
    return (
      <div className="p-6 text-sm space-y-4">
        <div className="text-center space-y-1">
          <p className="font-bold text-base">TERMO DE ENTREGA DE MATERIAL</p>
          <p className="text-xs text-muted-foreground">Solicitação #{r._id?.slice(-8).toUpperCase()}</p>
        </div>
        <div className="border-t pt-3 space-y-1">
          <p><span className="font-medium">Data da Entrega:</span> {today}</p>
          <p><span className="font-medium">Solicitante:</span> {r.requester?.name ?? "—"}</p>
          <p><span className="font-medium">Secretaria:</span> {r.secretaria?.name ?? "—"}</p>
          {r.departamento && <p><span className="font-medium">Departamento:</span> {r.departamento.name}</p>}
          {r.unidade && <p><span className="font-medium">Unidade:</span> {r.unidade.name}</p>}
          {r.reason && <p><span className="font-medium">Motivo:</span> {r.reason}</p>}
          {r.approver && <p><span className="font-medium">Aprovado por:</span> {r.approver.name}</p>}
        </div>
        <div className="border-t pt-3">
          <p className="font-medium mb-2">Itens Entregues:</p>
          <div className="space-y-2">
            {deliveredItems.map((item: any) => (
              <div key={item._id} className="border rounded px-3 py-2">
                <div className="flex justify-between">
                  <span className="font-medium">{item.product?.name ?? "Item"}</span>
                  <span className="font-mono">Qtd: {item.quantityDelivered}</span>
                </div>
                {item.deliveredSerialNumbers && item.deliveredSerialNumbers.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium">Patrimônio/Série:</span>{" "}
                    {item.deliveredSerialNumbers.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="border-t pt-4 flex justify-between text-xs text-muted-foreground">
          <div className="text-center w-1/2">
            <div className="border-t border-foreground/30 mt-12 pt-1">Entregue por</div>
          </div>
          <div className="text-center w-1/2">
            <div className="border-t border-foreground/30 mt-12 pt-1">Recebido por</div>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render request card ───
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
        <div className="space-y-1.5 mb-3">
          {r.items?.map((item: any) => (
            <div key={item._id} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
              <span className="truncate">{item.product?.name ?? "Item"}</span>
              <span className="font-mono text-xs shrink-0 ml-2">
                Sol: {item.quantityRequested}
                {item.quantityApproved > 0 && ` | Apr: ${item.quantityApproved}`}
                {item.quantityDelivered > 0 && ` | Ent: ${item.quantityDelivered}`}
              </span>
            </div>
          ))}
        </div>
        {/* Show rejection reason */}
        {r.status === "rejected" && r.approvalObservation && (
          <div className="mb-2 text-xs bg-red-50 border border-red-200 rounded px-3 py-2">
            <span className="font-medium text-red-700">Motivo da rejeição:</span>{" "}
            <span className="text-red-600">{r.approvalObservation}</span>
          </div>
        )}
        {/* Show approval observation */}
        {r.status === "approved" && r.approvalObservation && (
          <div className="mb-2 text-xs bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            <span className="font-medium text-emerald-700">Observação da aprovação:</span>{" "}
            <span className="text-emerald-600">{r.approvalObservation}</span>
          </div>
        )}
        {r.observation && <p className="text-xs text-muted-foreground italic">"{r.observation}"</p>}
        {/* Show delivered serial numbers */}
        {r.status === "delivered" && r.items?.some((item: any) => item.deliveredSerialNumbers?.length > 0) && (
          <div className="mb-2 text-xs bg-blue-50 border border-blue-200 rounded px-3 py-2">
            <span className="font-medium text-blue-700">Patrimônio/Série:</span>
            {r.items.filter((item: any) => item.deliveredSerialNumbers?.length > 0).map((item: any) => (
              <div key={item._id} className="text-blue-600 mt-0.5">
                {item.product?.name}: {item.deliveredSerialNumbers.join(", ")}
              </div>
            ))}
          </div>
        )}
        {/* Action buttons */}
        {showActions && r.status === "pending" && (
          <div className="flex gap-2 mt-3">
            <Button size="sm" className="gap-1" onClick={() => { setApproveDialog(r); setApproveObservation(""); }}>
              <Check className="h-3.5 w-3.5" /> Aprovar
            </Button>
            <Button size="sm" variant="destructive" className="gap-1" onClick={() => { setRejectDialog(r); setRejectReason(""); }}>
              <X className="h-3.5 w-3.5" /> Rejeitar
            </Button>
          </div>
        )}
        {showActions && r.status === "approved" && permissions.canDeliver && (
          <Button size="sm" className="gap-1 mt-3" onClick={() => openDeliverModal(r)}>
            <Truck className="h-3.5 w-3.5" /> Entregar Material
          </Button>
        )}
        {!showActions && r.status === "pending" && r.requesterId === user?._id && (
          <Button size="sm" variant="outline" className="gap-1 mt-3" onClick={() => handleCancel(r._id)}>
            Cancelar
          </Button>
        )}
        {r.status === "delivered" && (
          <Button size="sm" variant="outline" className="gap-1 mt-3" onClick={() => setTermDialog(r)}>
            <FileText className="h-3.5 w-3.5" /> Termo de Entrega
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

      {/* ═══ Criar Solicitação ═══ */}
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
                  <SelectContent>{departamentos.map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {secretariaId && unidades.length > 0 && (
              <div>
                <Label>Unidade</Label>
                <Select value={unidadeId} onValueChange={setUnidadeId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>{unidades.map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Nº da O.S.</Label>
              <Input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} placeholder="Opcional" className="mt-1" />
            </div>
            <div className="border-t pt-4">
              <Label className="text-sm font-medium">Itens do estoque <span className="text-destructive">*</span></Label>
              {availableProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">Nenhum item disponível. O responsável pelo estoque precisa cadastrar os itens antes da solicitação.</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {items.map((item, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Select value={item.productId} onValueChange={(v) => updateItem(i, "productId", v)}>
                          <SelectTrigger><SelectValue placeholder="Selecione um item..." /></SelectTrigger>
                          <SelectContent>
                            {availableProducts.map((p) => {
                              const av = (p.stock?.physicalQuantity ?? 0) - (p.stock?.reservedQuantity ?? 0);
                              return <SelectItem key={p._id} value={p._id}>{p.name}{p.brand ? ` — ${p.brand}` : ""} — {av} disp.</SelectItem>;
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
                <SelectContent>{REASON_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
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

      {/* ═══ Aprovar Solicitação ═══ */}
      <Dialog open={!!approveDialog} onOpenChange={() => setApproveDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Aprovar Solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Confirme a aprovação dos itens abaixo:</p>
            {approveDialog?.items?.map((item: any) => (
              <div key={item._id} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-2">
                <span>{item.product?.name}</span>
                <span className="font-mono">Solicitado: {item.quantityRequested}</span>
              </div>
            ))}
            <div>
              <Label>Observação (opcional)</Label>
              <Textarea value={approveObservation} onChange={(e) => setApproveObservation(e.target.value)} rows={2} placeholder="Observação do aprovador..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialog(null)}>Cancelar</Button>
            <Button onClick={handleApprove}>Aprovar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Rejeitar Solicitação ═══ */}
      <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rejeitar Solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Informe o motivo da rejeição. Esta informação será registrada e ficará visível ao solicitante.
            </p>
            {rejectDialog?.items?.map((item: any) => (
              <div key={item._id} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-2">
                <span>{item.product?.name}</span>
                <span className="font-mono">Qtd: {item.quantityRequested}</span>
              </div>
            ))}
            <div>
              <Label>Motivo da Rejeição <span className="text-destructive">*</span></Label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Informe o motivo da rejeição..." className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReject}>Rejeitar Solicitação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Entregar Material ═══ */}
      <Dialog open={!!deliverDialog} onOpenChange={() => setDeliverDialog(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Entregar Material</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Informe a quantidade entregue e, quando aplicável, os números de patrimônio/série de cada unidade.
            </p>
            {deliverItems.map((di, idx) => {
              const reqItem = deliverDialog?.items?.find((i: any) => i._id === di.itemId);
              const product = reqItem?.product;
              return (
                <div key={di.itemId} className="border rounded px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{product?.name ?? "Item"}</span>
                    <span className="text-xs text-muted-foreground">Aprovado: {di.maxQuantity}</span>
                  </div>
                  <div>
                    <Label className="text-xs">Quantidade a entregar</Label>
                    <Input
                      type="number" min="1" max={di.maxQuantity}
                      value={di.quantity}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 1 && v <= di.maxQuantity) updateDeliverItem(idx, "quantity", v);
                      }}
                      className="mt-1"
                    />
                  </div>
                  {product?.hasSerial && di.quantity > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Números de Patrimônio/Série ({di.quantity} unidade{di.quantity > 1 ? "s" : ""})</Label>
                      {Array.from({ length: di.quantity }).map((_, sIdx) => (
                        <Input
                          key={sIdx}
                          placeholder={`Patrimônio/Série #${sIdx + 1}`}
                          value={di.serialNumbers[sIdx] ?? ""}
                          onChange={(e) => updateSerialNumber(idx, sIdx, e.target.value)}
                          className="mt-1"
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverDialog(null)}>Cancelar</Button>
            <Button onClick={handleDeliver}>Confirmar Entrega</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Termo de Entrega ═══ */}
      <Dialog open={!!termDialog} onOpenChange={() => setTermDialog(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Termo de Entrega</DialogTitle></DialogHeader>
          {renderDeliveryTerm(termDialog)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTermDialog(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
