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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const createTransfer = useMutation(api.stockTransfers.create);

  const [showNew, setShowNew] = useState(false);
  const [productId, setProductId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [lotId, setLotId] = useState("");
  const lots = useQuery(api.lots.listActiveByProduct, productId ? { productId: productId as any } : "skip");
  const [quantity, setQuantity] = useState(1);
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!productId || !fromLocationId || !toLocationId) {
      toast.error("Selecione o produto, local de origem e destino");
      return;
    }
    if (fromLocationId === toLocationId) {
      toast.error("Origem e destino não podem ser o mesmo local");
      return;
    }
    if (quantity <= 0 || !Number.isFinite(quantity)) {
      toast.error("Quantidade deve ser um número válido maior que zero");
      return;
    }
    if (lots === undefined) {
      toast.error("Aguarde o carregamento dos lotes do produto.");
      return;
    }
    if (lots.length > 0 && !lotId) {
      toast.error("Selecione o lote que será transferido.");
      return;
    }

    setSubmitting(true);
    try {
      await createTransfer({
        productId: productId as any,
        lotId: lotId ? (lotId as any) : undefined,
        fromLocationId: fromLocationId as any,
        toLocationId: toLocationId as any,
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
    setFromLocationId("");
    setToLocationId("");
    setLotId("");
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
                          {t.fromLocation?.name ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t.toLocation?.name ?? "\u2014"}
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
                  onChange={(e) => { setProductId(e.target.value); setLotId(""); }}
                >
                  <option value="">Selecione o produto...</option>
                  {(products ?? []).map((p: any) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {productId && lots && lots.length > 0 && (
                <div>
                  <Label>Lote de origem</Label>
                  <Select value={lotId} onValueChange={setLotId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Selecione o lote..." />
                    </SelectTrigger>
                    <SelectContent>
                      {lots.map((lot: any) => (
                        <SelectItem key={lot._id} value={lot._id}>
                          {lot.lotNumber} · disponível no lote: {lot.quantityAvailable}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A transferência preserva a área do lote e exige saldo rastreável no armário de origem.
                  </p>
                </div>
              )}
              {productId && lots && lots.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Produto sem saldo ativo em lotes; a transferência será validada pelo saldo físico do armário.
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Local de Origem</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={fromLocationId}
                    onChange={(e) => setFromLocationId(e.target.value)}
                  >
                    <option value="">Origem...</option>
                    {(locations ?? []).map((l: any) => (
                      <option key={l._id} value={l._id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Local de Destino</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                  >
                    <option value="">Destino...</option>
                    {(locations ?? []).map((l: any) => (
                      <option key={l._id} value={l._id}>
                        {l.name}
                      </option>
                    ))}
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
