import { useState, useMemo } from "react";
import { useSearchParams } from "react-router";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, ClipboardList, Check, X, Truck, FileText, Printer, Search, Archive, Lock,
} from "lucide-react";
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
  targetPrinterId: string;
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
  const allPrinters = useQuery(api.printers.listActive);
  const approveRequest = useMutation(api.requests.approve);
  const rejectRequest = useMutation(api.requests.reject);
  const deliverRequest = useMutation(api.requests.deliver);
  const cancelRequest = useMutation(api.requests.cancel);

  // ─── Create dialog state ───
  // Pré-seleção vinda da tela de Estoque ("Solicitar este item" → /requests?product=<id>)
  const [searchParams] = useSearchParams();
  const prefillProduct = searchParams.get("product") ?? "";
  const [createDialog, setCreateDialog] = useState(!!prefillProduct);
  const [items, setItems] = useState<RequestItemForm[]>([{ productId: prefillProduct, quantity: 1, targetPrinterId: "" }]);
  const [observation, setObservation] = useState("");
  const [secretariaId, setSecretariaId] = useState("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [reason, setReason] = useState("");
  const [reasonSelect, setReasonSelect] = useState("");
  const [osNumber, setOsNumber] = useState("");
  const [patrimony, setPatrimony] = useState("");

  // ─── Toner compat data (for validation) ───
  const allCompat = useQuery(api.printers.listAllCompatibility);

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
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const [signatureStep, setSignatureStep] = useState<"items" | "signature">("items");
  const [reverseLogistics, setReverseLogistics] = useState(false);
  const [receivedByUserId, setReceivedByUserId] = useState("");
  const allUsers = useQuery(api.users.listUsers);

  // ─── Delivery term dialog ───
  const [termDialog, setTermDialog] = useState<any>(null);

  // ─── Arquivo Histórico state ───
  const [histSecretariaId, setHistSecretariaId] = useState("");
  const [histStartDate, setHistStartDate] = useState("");
  const [histEndDate, setHistEndDate] = useState("");
  const [histSerialSearch, setHistSerialSearch] = useState("");

  const hasFilters = !!(histSecretariaId || histStartDate || histEndDate || histSerialSearch);
  const deliveredRequests = useQuery(
    api.requests.listDelivered,
    hasFilters
      ? {
          secretariaId: histSecretariaId ? (histSecretariaId as any) : undefined,
          startDate: histStartDate ? new Date(histStartDate).getTime() : undefined,
          endDate: histEndDate ? new Date(histEndDate + "T23:59:59").getTime() : undefined,
          serialSearch: histSerialSearch || undefined,
        }
      : "skip"
  );
  const allDeliveredRequests = useQuery(api.requests.listDelivered, {});

  const role = (user?.role ?? "technician") as UserRole;
  const permissions = getPermissions(role);

  const myRequests = requests?.filter((r) => r.requesterId === user?._id) ?? [];
  const pendingForApproval = requests?.filter((r) => {
    if (r.status !== "pending") return false;
    if (role === "admin" || role === "stock_manager") return true;
    return r.requesterId !== user?._id;
  }) ?? [];

  // ─── Cascading org selects ───
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

  const addItem = () => setItems([...items, { productId: "", quantity: 1, targetPrinterId: "" }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof RequestItemForm, value: any) => {
    const newItems = [...items];
    (newItems[i] as any)[field] = value;
    setItems(newItems);
  };

  const resetForm = () => {
    setItems([{ productId: "", quantity: 1, targetPrinterId: "" }]);
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
    // Frontend toner check: for items with compatibility entries, targetPrinterId is required
    for (const item of validItems) {
      const product = availableProducts.find((p) => p._id === item.productId);
      if (product && (product as any).hasCompat) {
        if (!item.targetPrinterId) {
          toast.error(`"${product.name}" requer seleção da impressora de destino`);
          return;
        }
        // Validate compatibility: check if selected printer model matches toner compat entries
        if (allCompat) {
          const compatModels = allCompat[item.productId];
          if (compatModels && compatModels.length > 0) {
            const printer = allPrinters?.find((p: any) => p._id === item.targetPrinterId);
            if (printer) {
              const isCompatible = compatModels.some((cm: string) => cm === printer.model || cm === `${printer.brand} ${printer.model}`);
              if (!isCompatible) {
                toast.error(`O toner "${product.name}" não é compatível com a impressora "${printer.name}" (${printer.brand} ${printer.model}). Modelos compatíveis: ${compatModels.join(", ")}`);
                return;
              }
            }
          }
        }
      }
    }
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
        items: validItems.map((i) => ({
          productId: i.productId as any,
          quantityRequested: i.quantity,
          targetPrinterId: i.targetPrinterId ? (i.targetPrinterId as any) : undefined,
        })),
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
    setConfirmationPassword("");
    setSignatureStep("items");
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
    if (!confirmationPassword.trim()) {
      toast.error("Informe a senha de confirmação para assinar a entrega");
      return;
    }
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
        receivedByUserId: (receivedByUserId || undefined) as any,
        confirmationPassword: confirmationPassword,
        reverseLogisticsConfirmed: reverseLogistics || undefined,
      });
      toast.success("Entrega registrada com sucesso");
      setDeliverDialog(null);
      setDeliverItems([]);
      setConfirmationPassword("");
      setSignatureStep("items");
      setReverseLogistics(false);
      setReceivedByUserId("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar entrega");
    }
  };

  const handleCancel = async (requestId: string, isApproved: boolean) => {
    if (isApproved) {
      if (!confirm("Tem certeza? Esta ação irá cancelar a solicitação APROVADA e liberar todo o estoque reservado.")) {
        return;
      }
    }
    try {
      await cancelRequest({ requestId: requestId as any });
      toast.success(isApproved ? "Solicitação cancelada e reserva liberada" : "Solicitação cancelada");
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
          <p><span className="font-medium">Data da Entrega:</span> {r.deliveredAt ? new Date(r.deliveredAt).toLocaleDateString("pt-BR") : today}</p>
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
                {item.printer && (
                  <div className="mt-1 text-xs text-blue-600">
                    <span className="font-medium">Impressora destino:</span> {item.printer.name} ({item.printer.brand} {item.printer.model}){item.printer.patrimony ? ` [${item.printer.patrimony}]` : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {r.deliveredBySignature ? (
          <div className="border-t pt-3 space-y-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-xs text-blue-700">Assinatura Eletrônica Válida</span>
              </div>
              <p className="text-xs text-blue-600">{r.deliveredBySignature}</p>
            </div>
            {r.reverseLogisticsConfirmed && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 mt-2">
                <p className="text-xs text-emerald-700 font-medium">
                  ✓ Carcaça antiga recolhida para descarte sustentável
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="border-t pt-4 flex justify-between text-xs text-muted-foreground">
            <div className="text-center w-1/2">
              <div className="border-t border-foreground/30 mt-12 pt-1">Entregue por</div>
            </div>
            <div className="text-center w-1/2">
              <div className="border-t border-foreground/30 mt-12 pt-1">Recebido por</div>
            </div>
          </div>
        )}
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
        {r.status === "rejected" && r.approvalObservation && (
          <div className="mb-2 text-xs bg-red-50 border border-red-200 rounded px-3 py-2">
            <span className="font-medium text-red-700">Motivo da rejeição:</span>{" "}
            <span className="text-red-600">{r.approvalObservation}</span>
          </div>
        )}
        {r.status === "approved" && r.approvalObservation && (
          <div className="mb-2 text-xs bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            <span className="font-medium text-emerald-700">Observação da aprovação:</span>{" "}
            <span className="text-emerald-600">{r.approvalObservation}</span>
          </div>
        )}
        {r.observation && <p className="text-xs text-muted-foreground italic">"{r.observation}"</p>}
        {r.status === "delivered" && r.reverseLogisticsConfirmed && (
          <div className="mb-2 text-xs bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            <span className="font-medium text-emerald-700">Logística reversa:</span>{" "}
            <span className="text-emerald-600">Carcaça antiga recolhida para descarte sustentável</span>
          </div>
        )}
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
        {r.status === "approved" && permissions.canDeliver && (
          <Button size="sm" className="gap-1 mt-3" onClick={() => openDeliverModal(r)}>
            <Truck className="h-3.5 w-3.5" /> Entregar Material
          </Button>
        )}
        {!showActions && (r.status === "pending" || r.status === "approved") && r.requesterId === user?._id && (
          <Button size="sm" variant="outline" className="gap-1 mt-3" onClick={() => handleCancel(r._id, r.status === "approved")}>
            {r.status === "approved" ? "Cancelar e Liberar Reserva" : "Cancelar"}
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
            <TabsTrigger value="archive" className="gap-1"><Archive className="h-3.5 w-3.5" /> Arquivo Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="my" className="space-y-3 mt-4">
            {myRequests.length === 0 ? (
              <Card className="border-border/50"><CardContent className="py-12 text-center">
                <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Nenhuma solicitação</p>
              </CardContent></Card>
            ) : myRequests.map((r) => renderRequest(r, r.status === "pending" && permissions.canApproveRequests))}
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
            {requests?.map((r) => renderRequest(r, r.status === "pending" && permissions.canApproveRequests && (role === "admin" || r.requesterId !== user?._id)))}
          </TabsContent>

          {/* ═══ Arquivo Histórico ═══ */}
          <TabsContent value="archive" className="space-y-4 mt-4">
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Archive className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Arquivo Histórico — Materiais Entregues</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Secretaria / Unidade</Label>
                    <Select value={histSecretariaId} onValueChange={setHistSecretariaId}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Todas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all">Todas</SelectItem>
                        {secretarias.map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Data Inicial</Label>
                    <Input type="date" value={histStartDate} onChange={(e) => setHistStartDate(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Data Final</Label>
                    <Input type="date" value={histEndDate} onChange={(e) => setHistEndDate(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Patrimônio / Série</Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={histSerialSearch}
                        onChange={(e) => setHistSerialSearch(e.target.value)}
                        placeholder="Buscar patrimônio..."
                        className="mt-1 pl-8"
                      />
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline" size="sm" className="mt-3"
                  onClick={() => { setHistSecretariaId(""); setHistStartDate(""); setHistEndDate(""); setHistSerialSearch(""); }}
                >
                  Limpar Filtros
                </Button>
              </CardContent>
            </Card>
            {(() => {
              const list = hasFilters ? deliveredRequests : allDeliveredRequests;
              if (list === undefined) {
                return <Card className="border-border/50"><CardContent className="py-8 text-center"><p className="text-muted-foreground text-sm">Carregando...</p></CardContent></Card>;
              }
              if (list.length === 0) {
                return (
                  <Card className="border-border/50"><CardContent className="py-12 text-center">
                    <Archive className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground text-sm">
                      {hasFilters ? "Nenhum resultado encontrado para os filtros selecionados" : "Nenhuma entrega registrada ainda"}
                    </p>
                  </CardContent></Card>
                );
              }
              return (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">{list.length} entrega(s) encontrada(s)</p>
                  {list.map((r) => renderRequest(r))}
                </div>
              );
            })()}
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
                      {/* Printer selector — only for toner/compat items */}
                      {(() => {
                        const product = availableProducts.find((p) => p._id === item.productId);
                        const isToner = !!(product as any)?.hasCompat;
                        if (!isToner || !allPrinters?.length) return null;
                        const compatModels = allCompat?.[item.productId] ?? [];
                        return (
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Printer className="h-3 w-3 text-blue-600" />
                              <span className="text-xs text-blue-600 font-medium">Impressora de Destino *</span>
                            </div>
                            <Select
                              value={item.targetPrinterId || ""}
                              onValueChange={(v) => updateItem(i, "targetPrinterId", v)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione a impressora" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">Selecione...</SelectItem>
                                {allPrinters.map((p: any) => (
                                  <SelectItem key={p._id} value={p._id}>
                                    {p.name} — {p.brand} {p.model}{p.patrimony ? ` [${p.patrimony}]` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {compatModels.length > 0 && (
                              <p className="text-[10px] text-muted-foreground">
                                Modelos compatíveis: {compatModels.join(", ")}
                              </p>
                            )}
                          </div>
                        );
                      })()}
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
            {signatureStep === "items" ? (
              <>
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
              </>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-amber-600" />
                    <p className="text-sm font-medium text-amber-800">Assinatura Eletrônica por Senha</p>
                  </div>
                  <p className="text-xs text-amber-700">
                    Para confirmar a entrega, informe sua senha de acesso ao sistema. Esta ação constitui assinatura eletrônica com valor legal.
                  </p>
                </div>
                <div>
                  <Label>Recebedor</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={receivedByUserId}
                    onChange={(e) => setReceivedByUserId(e.target.value)}
                  >
                    <option value="">Selecione quem recebeu...</option>
                    {(allUsers ?? []).filter((u: any) => u.active !== false && u.role).map((u: any) => (
                      <option key={u._id} value={u._id}>{u.name ?? u.email ?? "Usuário"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Senha de Confirmação do Servidor/Recebedor <span className="text-destructive">*</span></Label>
                  <Input
                    type="password"
                    value={confirmationPassword}
                    onChange={(e) => setConfirmationPassword(e.target.value)}
                    placeholder="Informe sua senha para assinar"
                    className="mt-1"
                    onKeyDown={(e) => { if (e.key === "Enter" && confirmationPassword.trim()) handleDeliver(); }}
                  />
                </div>
                {confirmationPassword && (
                  <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2">
                    <p className="text-xs text-blue-600">
                      Ao confirmar, será registrado: "Assinado eletronicamente por {user?.name ?? "Servidor"} via autenticação por senha"
                    </p>
                  </div>
                )}
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <Checkbox
                    id="reverseLogistics"
                    checked={reverseLogistics}
                    onCheckedChange={(c) => setReverseLogistics(c === true)}
                  />
                  <Label htmlFor="reverseLogistics" className="text-xs font-medium text-amber-800 cursor-pointer">
                    Toner vazio recolhido / Logística reversa confirmada
                    <p className="text-amber-600 font-normal mt-0.5">
                      Ao marcar, será registrado no Termo de Entrega: "Carcaça antiga recolhida para descarte sustentável"
                    </p>
                  </Label>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverDialog(null)}>Cancelar</Button>
            {signatureStep === "items" ? (
              <Button onClick={() => setSignatureStep("signature")}>Próximo: Assinar</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setSignatureStep("items")}>Voltar</Button>
                <Button onClick={handleDeliver} disabled={!confirmationPassword.trim()}>Confirmar e Assinar Entrega</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Termo de Entrega ═══ */}
      <Dialog open={!!termDialog} onOpenChange={() => setTermDialog(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto print:shadow-none print:border-none print:max-h-none print:w-full">
          <DialogHeader className="print-hide"><DialogTitle>Termo de Entrega</DialogTitle></DialogHeader>
          <div id="delivery-term-content">
            {renderDeliveryTerm(termDialog)}
          </div>
          <DialogFooter className="print-hide">
            <Button variant="outline" onClick={() => window.print()} className="gap-1">
              <Printer className="h-4 w-4" /> Imprimir Termo
            </Button>
            <Button variant="outline" onClick={() => setTermDialog(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #delivery-term-content,
          #delivery-term-content * { visibility: visible; }
          #delivery-term-content { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
          .print-hide { display: none !important; }
        }
      `}</style>
    </AppShell>
  );
}
