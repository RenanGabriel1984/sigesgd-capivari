import { useState } from "react";
import { usePaginatedQuery, useQuery, useMutation } from "convex/react";
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
import { ArrowRightLeft, Plus, Loader2, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { roleHasPermission, type AppRole } from "@/lib/rbac";

function LoadingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-48" /></div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </AppShell>
  );
}

export default function StockTransfersPage() {
  const { user } = useAuth();
  const canManageTransfers = roleHasPermission(user?.role as AppRole | undefined, "transfers.create");
  const { results: transfers, status: transfersStatus, loadMore: loadMoreTransfers } = usePaginatedQuery(api.stockTransfers.listPage, {}, { initialNumItems: 50 });
  const products = useQuery(api.products.listActive);
  const locations = useQuery(api.storageLocations.listActive);
  const areas = useQuery(api.stockAreas.listActive);
  const createTransfer = useMutation(api.stockTransfers.create);
  const reverseTransfer = useMutation(api.stockTransfers.reverse);

  const [showNew, setShowNew] = useState(false);
  const [productId, setProductId] = useState("");
  const [fromAreaId, setFromAreaId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toAreaId, setToAreaId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<any>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const handleSubmit = async () => {
    if (!productId || !fromAreaId || !fromLocationId || !toAreaId || !toLocationId) {
      toast.error("Selecione o produto, área e local físico de origem e destino");
      return;
    }
    if (fromLocationId === toLocationId && fromAreaId === toAreaId) {
      toast.error("Origem e destino não podem ser a mesma combinação de área e local");
      return;
    }
    if (quantity <= 0) {
      toast.error("Quantidade deve ser maior que zero");
      return;
    }

    setSubmitting(true);
    try {
      await createTransfer({
        productId: productId as any,
        fromLocationId: fromLocationId as any,
        toLocationId: toLocationId as any,
        fromAreaId: fromAreaId as any,
        toAreaId: toAreaId as any,
        quantity,
        observation: observation || undefined,
      });
      toast.success("Transferência registrada com sucesso");
      setShowNew(false);
      resetForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar transferência");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverse = async () => {
    const reason = reversalReason.trim();
    if (!selectedTransfer || !reason) {
      toast.error("Informe a justificativa do estorno");
      return;
    }
    setReversing(true);
    try {
      await reverseTransfer({ transferId: selectedTransfer._id, reason });
      toast.success("Estorno registrado. A transferência original foi preservada no histórico.");
      setSelectedTransfer(null);
      setReversalReason("");
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível estornar a transferência");
    } finally {
      setReversing(false);
    }
  };

  const resetForm = () => {
    setProductId("");
    setFromAreaId("");
    setFromLocationId("");
    setToAreaId("");
    setToLocationId("");
    setQuantity(1);
    setObservation("");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl tracking-tight font-bold">Transferências</h1>
            <p className="text-sm text-muted-foreground">
              Transfere estoque entre áreas/subestoques e locais físicos, que são dimensões independentes.
            </p>
          </div>
          {canManageTransfers && (
            <Button onClick={() => setShowNew(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Nova Transferência
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Histórico de Transferências</CardTitle>
          </CardHeader>
          <CardContent>
            {transfersStatus === "LoadingFirstPage" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando transferências...
              </div>
            ) : transfers.length === 0 ? (
              <div className="py-10 text-center">
                <ArrowRightLeft className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Nenhuma transferência registrada</p>
                <p className="text-xs text-muted-foreground mt-1">
                  A transferência move material entre locais/áreas de forma auditável, preservando lote e histórico.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Qtd</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead>Destino</TableHead>
                      <TableHead>Responsável</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfers.map((t: any) => (
                      <TableRow key={t._id}>
                        <TableCell className="text-sm">
                          {new Date(t.createdAt).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {t.product?.name ?? "\u2014"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{t.quantity}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {(t.fromArea?.name ? `${t.fromArea.name} / ` : "") + (t.fromLocation?.name ?? "\u2014")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {(t.toArea?.name ? `${t.toArea.name} / ` : "") + (t.toLocation?.name ?? "\u2014")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t.responsible?.name ?? "\u2014"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.reversedAt ? "destructive" : "secondary"}>
                            {t.reversedAt ? "Estornada" : "Concluída"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {!t.reversedAt && canManageTransfers && (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => { setSelectedTransfer(t); setReversalReason(""); }}>
                              <RotateCcw className="h-3.5 w-3.5" /> Estornar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {transfersStatus !== "LoadingFirstPage" && transfersStatus !== "Exhausted" ? (
              <div className="flex justify-center pt-4">
                <Button variant="outline" onClick={() => loadMoreTransfers(50)} disabled={transfersStatus === "LoadingMore"}>
                  {transfersStatus === "LoadingMore" ? "Carregando..." : "Carregar mais transferências"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Dialog open={!!selectedTransfer} onOpenChange={(open) => { if (!open && !reversing) setSelectedTransfer(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" /> Estornar transferência
              </DialogTitle>
            </DialogHeader>
            {selectedTransfer && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 text-sm space-y-1">
                  <p><strong>Produto:</strong> {selectedTransfer.product?.name ?? "—"}</p>
                  <p><strong>Quantidade:</strong> {selectedTransfer.quantity}</p>
                  <p><strong>Origem:</strong> {selectedTransfer.fromArea?.name ?? "Área não identificada"} / {selectedTransfer.fromLocation?.name ?? "—"}</p>
                  <p><strong>Destino:</strong> {selectedTransfer.toArea?.name ?? "Área não identificada"} / {selectedTransfer.toLocation?.name ?? "—"}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  O estorno só será aceito se os lotes transferidos continuarem integralmente disponíveis no destino e sem reservas. O histórico original não será apagado.
                </p>
                <div>
                  <Label>Justificativa obrigatória</Label>
                  <Textarea value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} placeholder="Descreva o motivo da reversão..." className="mt-1" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={reversing} onClick={() => setSelectedTransfer(null)}>Cancelar</Button>
              <Button onClick={handleReverse} disabled={reversing || !reversalReason.trim()} className="gap-2">
                {reversing ? "Estornando..." : "Confirmar estorno"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5" /> Nova Transferência
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Produto</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">Selecione o produto...</option>
                  {(products ?? []).map((p: any) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Origem</p>
                  <div>
                    <Label>Área / Subestoque</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={fromAreaId}
                      onChange={(e) => setFromAreaId(e.target.value)}
                    >
                      <option value="">Selecione a área...</option>
                      {(areas ?? []).map((a: any) => <option key={a._id} value={a._id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Local físico</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={fromLocationId}
                      onChange={(e) => setFromLocationId(e.target.value)}
                    >
                      <option value="">Selecione o local...</option>
                      {(locations ?? []).map((l: any) => <option key={l._id} value={l._id}>{l.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Destino</p>
                  <div>
                    <Label>Área / Subestoque</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={toAreaId}
                      onChange={(e) => setToAreaId(e.target.value)}
                    >
                      <option value="">Selecione a área...</option>
                      {(areas ?? []).map((a: any) => <option key={a._id} value={a._id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Local físico</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={toLocationId}
                      onChange={(e) => setToLocationId(e.target.value)}
                    >
                      <option value="">Selecione o local...</option>
                      {(locations ?? []).map((l: any) => <option key={l._id} value={l._id}>{l.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Observação</Label>
                <Textarea
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  placeholder="Observações sobre a transferência..."
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
                {submitting ? "Registrando..." : "Registrar Transferência"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
