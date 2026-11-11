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
import { ArrowRightLeft, Plus, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

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
  const transfers = useQuery(api.stockTransfers.list);
  const products = useQuery(api.products.listActive);
  const locations = useQuery(api.storageLocations.listActive);
  const areas = useQuery(api.stockAreas.listActive);
  const createTransfer = useMutation(api.stockTransfers.create);

  const [showNew, setShowNew] = useState(false);
  const [productId, setProductId] = useState("");
  const [fromAreaId, setFromAreaId] = useState("");
  const [toAreaId, setToAreaId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!productId || !fromAreaId || !toAreaId || !fromLocationId || !toLocationId) {
      toast.error("Selecione o produto, as áreas e os locais de origem e destino");
      return;
    }
    if (fromLocationId === toLocationId) {
      toast.error("Origem e destino não podem ser o mesmo local");
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
        fromAreaId: fromAreaId === "__none" ? null : fromAreaId as any,
        toAreaId: toAreaId === "__none" ? null : toAreaId as any,
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

  const resetForm = () => {
    setProductId("");
    setFromAreaId("");
    setToAreaId("");
    setFromLocationId("");
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
              Transfere estoque entre locais físicos.
            </p>
          </div>
          {(user?.role === "admin" || user?.role === "stock_manager") && (
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
            {!transfers ? (
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
                <div>
                  <Label>Área de Origem</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={fromAreaId} onChange={(e) => setFromAreaId(e.target.value)}>
                    <option value="">Selecione a área...</option>
                    <option value="__none">Sem área</option>
                    {(areas ?? []).map((a: any) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Local Físico de Origem</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
                    <option value="">Selecione o local...</option>
                    {(locations ?? []).map((l: any) => <option key={l._id} value={l._id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Área de Destino</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={toAreaId} onChange={(e) => setToAreaId(e.target.value)}>
                    <option value="">Selecione a área...</option>
                    <option value="__none">Sem área</option>
                    {(areas ?? []).map((a: any) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Local Físico de Destino</Label>
                  <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                    <option value="">Selecione o local...</option>
                    {(locations ?? []).map((l: any) => <option key={l._id} value={l._id}>{l.name}</option>)}
                  </select>
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
