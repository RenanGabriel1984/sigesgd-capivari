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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RotateCcw, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export default function ReturnsPage() {
  const { user } = useAuth();
  const returns = useQuery(api.returns.list);
  const requests = useQuery(api.requests.list);
  const allUsers = useQuery(api.users.listUsers);
  const createReturn = useMutation(api.returns.create);

  const [showNew, setShowNew] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [receivedByUserId, setReceivedByUserId] = useState("");
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const deliveredRequests = (requests ?? []).filter(
    (r: any) => r.status === "delivered"
  );
  const selectedRequest = deliveredRequests.find(
    (r: any) => r._id === selectedRequestId
  );
  const selectedItem = selectedRequest?.items?.find(
    (i: any) => i._id === selectedItemId
  );

  const alreadyReturned = (returns ?? [])
    .filter(
      (r: any) =>
        r.requestId === selectedRequestId &&
        r.requestItemId === selectedItemId
    )
    .reduce((sum: number, r: any) => sum + r.quantity, 0);

  const maxReturnable = (selectedItem?.quantityDelivered ?? 0) - alreadyReturned;

  const handleSubmit = async () => {
    if (!selectedRequestId || !selectedItemId || !selectedItem) {
      toast.error("Selecione a solicitação e o item");
      return;
    }
    if (quantity <= 0) {
      toast.error("Quantidade deve ser maior que zero");
      return;
    }
    if (quantity > maxReturnable) {
      toast.error(`Quantidade máxima retornável: ${maxReturnable}`);
      return;
    }
    if (!reason.trim()) {
      toast.error("Informe o motivo da devolução");
      return;
    }
    if (!receivedByUserId) {
      toast.error("Selecione quem recebeu a devolução");
      return;
    }

    setSubmitting(true);
    try {
      await createReturn({
        requestId: selectedRequestId as any,
        requestItemId: selectedItemId as any,
        productId: selectedItem.productId as any,
        quantity,
        reason: reason.trim(),
        receivedByUserId: receivedByUserId as any,
        observation: observation || undefined,
      });
      toast.success("Devolução registrada com sucesso");
      setShowNew(false);
      resetForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar devolução");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedRequestId("");
    setSelectedItemId("");
    setQuantity(1);
    setReason("");
    setReceivedByUserId("");
    setObservation("");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl tracking-tight font-bold">Devoluções</h1>
            <p className="text-sm text-muted-foreground">
              Devolução de material entregue
            </p>
          </div>
          {(user?.role === "admin" || user?.role === "stock_manager") && (
            <Button onClick={() => setShowNew(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Nova Devolução
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Histórico de Devoluções</CardTitle>
          </CardHeader>
          <CardContent>
            {!returns ? (
              <p className="text-muted-foreground">Carregando...</p>
            ) : returns.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma devolução registrada</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Qtd</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Devolvido por</TableHead>
                      <TableHead>Recebido por</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returns.map((r: any) => (
                      <TableRow key={r._id}>
                        <TableCell className="text-sm">
                          {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {r.product?.name ?? "\u2014"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.quantity}</Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          {r.reason}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.returnedBy?.name ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.receivedBy?.name ?? "\u2014"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" /> Nova Devolução
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Solicitação (entregue)</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedRequestId}
                  onChange={(e) => {
                    setSelectedRequestId(e.target.value);
                    setSelectedItemId("");
                  }}
                >
                  <option value="">Selecione...</option>
                  {deliveredRequests.map((r: any) => (
                    <option key={r._id} value={r._id}>
                      {r._id.slice(-8)} — {r.requester?.name ?? "Solicitante"}
                    </option>
                  ))}
                </select>
              </div>

              {selectedRequest && (
                <div>
                  <Label>Item da Solicitação</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {selectedRequest.items
                      ?.filter((i: any) => i.quantityDelivered > 0)
                      .map((i: any) => (
                        <option key={i._id} value={i._id}>
                          {i.product?.name ?? "Produto"} — Entregue: {i.quantityDelivered}
                        </option>
                      ))}
                  </select>
                  {selectedItemId && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Já devolvido: {alreadyReturned} | Máximo retornável: {maxReturnable}
                    </p>
                  )}
                </div>
              )}

              <div>
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min={1}
                  max={maxReturnable}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Motivo da Devolução</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex: Material defeituoso, quantidade excedente..."
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Recebido por</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={receivedByUserId}
                  onChange={(e) => setReceivedByUserId(e.target.value)}
                >
                  <option value="">Selecione quem recebeu...</option>
                  {(allUsers ?? [])
                    .filter((u: any) => u.active !== false && u.role)
                    .map((u: any) => (
                      <option key={u._id} value={u._id}>
                        {u.name ?? u.email ?? "Usuário"}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <Label>Observação</Label>
                <Textarea
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  placeholder="Observações adicionais..."
                  className="mt-1"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNew(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="gap-2"
              >
                {submitting ? "Registrando..." : "Registrar Devolução"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
