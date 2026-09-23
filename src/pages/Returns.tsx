import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useSearchParams } from "react-router";
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
import { RotateCcw, PackageCheck, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  RETURN_CONDITION_VALUES,
  RETURN_CONDITION_LABELS,
  validateReturnQuantity,
  returnableQuantity,
  formatExitLabel,
  type ReturnCondition,
} from "@/lib/returns-rules";

function LoadingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-4 w-48" /></div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </AppShell>
  );
}

type ExitRow = {
  _id: string;
  quantity: number;
  timestamp: number;
  exitNumber?: string | null;
  product?: { name?: string } | null;
  requesterName?: string | null;
  osNumber?: string | null;
  requestReason?: string | null;
  returned: number;
  available: number;
};

export default function ReturnsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const exits = useQuery(api.returns.returnable);
  const returns = useQuery(api.returns.list);
  const locations = useQuery(api.storageLocations.listActive);
  const createReturn = useMutation(api.returns.create);

  const [selectedExitId, setSelectedExitId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState<ReturnCondition>("unused");
  const [locationId, setLocationId] = useState("");
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Ação "Devolver" vinda da tela de Histórico/Relatório de saídas
  const exitParam = searchParams.get("exit") ?? "";
  useEffect(() => {
    if (exitParam && exits !== undefined) {
      const exists = exits.some((e: ExitRow) => e._id === exitParam);
      if (exists) setSelectedExitId(exitParam);
    }
  }, [exitParam, exits]);

  const selectedExit: ExitRow | undefined = (exits ?? []).find(
    (e: ExitRow) => e._id === selectedExitId
  );

  const alreadyReturned = selectedExit?.returned ?? 0;
  const exitQty = selectedExit?.quantity ?? 0;
  const maxReturnable = returnableQuantity(exitQty, alreadyReturned);

  const handleSubmit = async () => {
    if (!selectedExit) {
      toast.error("Selecione a saída da qual o material será devolvido");
      return;
    }
    const validationError = validateReturnQuantity({
      exitQuantity: exitQty,
      alreadyReturned,
      requested: quantity,
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!reason.trim()) {
      toast.error("Informe o motivo da devolução");
      return;
    }

    setSubmitting(true);
    try {
      await createReturn({
        exitMovementId: selectedExit._id as any,
        quantity,
        reason: reason.trim(),
        condition: condition as any,
        locationId: locationId ? (locationId as any) : undefined,
        observation: observation || undefined,
      });
      toast.success(
        `Devolução de ${quantity} unidade(s) registrada — estoque recomposto`
      );
      setSelectedExitId("");
      setSearchParams({}, { replace: true });
      resetForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar devolução");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setQuantity(1);
    setReason("");
    setCondition("unused");
    setLocationId("");
    setObservation("");
  };

  const openReturn = (row: ExitRow) => {
    setSelectedExitId(row._id);
    setQuantity(row.available >= 1 ? 1 : row.available);
    setReason("");
    setCondition("unused");
    setLocationId("");
    setObservation("");
  };

  const canProcess = user?.role === "admin" || user?.role === "stock_manager";

  if (exits === undefined || returns === undefined) return <LoadingSkeleton />;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl tracking-tight font-bold">Devoluções</h1>
          <p className="text-sm text-muted-foreground">
            Devolução de material sempre vinculada a uma saída real já registrada
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Materiais disponíveis para devolução
            </CardTitle>
          </CardHeader>
          <CardContent>
            {exits.length === 0 ? (
              <p className="text-muted-foreground">
                Nenhuma saída com saldo disponível para devolução
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Saída</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-center">Retirado</TableHead>
                      <TableHead className="text-center">Devolvido</TableHead>
                      <TableHead className="text-center">Disponível</TableHead>
                      <TableHead>Solicitante</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exits.map((row: ExitRow) => (
                      <TableRow key={row._id}>
                        <TableCell className="text-xs font-mono whitespace-nowrap">
                          {formatExitLabel(row)}
                          {row.osNumber && (
                            <span className="block text-[10px] text-muted-foreground font-sans">
                              O.S. {row.osNumber}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {row.product?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-center font-mono">
                          {row.quantity}
                        </TableCell>
                        <TableCell className="text-center font-mono">
                          {row.returned}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="font-mono">
                            {row.available}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.requesterName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(row.timestamp).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right">
                          {canProcess ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => openReturn(row)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Devolver
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Histórico de Devoluções</CardTitle>
          </CardHeader>
          <CardContent>
            {returns.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma devolução registrada</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Saída</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-center">Qtd</TableHead>
                      <TableHead>Condição</TableHead>
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
                        <TableCell className="text-xs font-mono">
                          {r.exit ? formatExitLabel(r.exit) : "—"}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {r.product?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{r.quantity}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.condition
                            ? RETURN_CONDITION_LABELS[r.condition as ReturnCondition]
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          {r.reason}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.returnedBy?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.receivedBy?.name ?? r.returnedBy?.name ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══ Diálogo de devolução vinculado à saída original ═══ */}
        <Dialog
          open={!!selectedExitId}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedExitId("");
              setSearchParams({}, { replace: true });
            }
          }}
        >
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" /> Devolver material
              </DialogTitle>
            </DialogHeader>

            {selectedExit && (
              <div className="space-y-4">
                {/* Dados da saída original */}
                <div className="border rounded-lg divide-y text-sm bg-muted/30">
                  {[
                    ["Produto", selectedExit.product?.name ?? "—"],
                    ["Saída original", formatExitLabel(selectedExit)],
                    ["Solicitante", selectedExit.requesterName ?? "—"],
                    [
                      "Data da saída",
                      new Date(selectedExit.timestamp).toLocaleString("pt-BR"),
                    ],
                    ...(selectedExit.osNumber
                      ? [["O.S.", selectedExit.osNumber]]
                      : []),
                    ...(selectedExit.requestReason
                      ? [["Origem", selectedExit.requestReason]]
                      : []),
                    ["Quantidade retirada", String(selectedExit.quantity)],
                    ["Quantidade já devolvida", String(alreadyReturned)],
                    ["Disponível para devolver", String(maxReturnable)],
                  ].map(([k, v]) => (
                    <div
                      key={k as string}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium text-right">{v}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <Label>Quantidade a devolver (parcial permitida)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={maxReturnable}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Disponível para devolver: {maxReturnable}
                  </p>
                </div>

                <div>
                  <Label>Condição do material</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as ReturnCondition)}
                  >
                    {RETURN_CONDITION_VALUES.map((c) => (
                      <option key={c} value={c}>
                        {RETURN_CONDITION_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label>Motivo da Devolução</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Ex: material não utilizado, defeito, quantidade excedente..."
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Local físico de destino (opcional)</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="">Sem alteração de local</option>
                    {(locations ?? []).map((l: any) => (
                      <option key={l._id} value={l._id}>
                        {l.name}
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

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PackageCheck className="h-4 w-4 shrink-0" />
                  Ao confirmar: o estoque físico é recomposto, uma movimentação
                  de DEVOLUÇÃO é vinculada a esta saída e a auditoria registra
                  usuário, data/hora, motivo e condição. A baixa original não é
                  alterada.
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedExitId("");
                  setSearchParams({}, { replace: true });
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="gap-2"
              >
                {submitting ? (
                  "Registrando..."
                ) : (
                  <>
                    Confirmar Devolução <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
