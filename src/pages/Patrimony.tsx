import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClipboardList, Search, Send, Warehouse, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { roleHasPermission } from "@/lib/rbac";

type DisposalStatus = "sent_to_patrimony" | "confirmed_by_patrimony" | "sent_to_warehouse";

const STATUS_LABELS: Record<DisposalStatus, string> = {
  sent_to_patrimony: "Aguardando Departamento de Patrimônio",
  confirmed_by_patrimony: "Baixa oficial confirmada",
  sent_to_warehouse: "Encaminhado ao barracão",
};

function dateLabel(value?: string | number): string {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR").format(date);
}

function equipmentLabel(asset: any): string {
  if (!asset) return "";
  return [
    asset.patrimonyNumber ? `Patrimônio ${asset.patrimonyNumber}` : null,
    asset.serialNumber ? `Série ${asset.serialNumber}` : null,
    [asset.manufacturer, asset.model].filter(Boolean).join(" "),
    asset.assetType,
  ].filter(Boolean).join(" · ") || "Equipamento sem identificação";
}

export default function PatrimonyPage() {
  const currentUser = useQuery(api.users.currentUser);
  const assets = useQuery(api.assets.list, {}) as any[] | undefined;
  const requests = useQuery(api.assets.listDisposalRequests, {}) as any[] | undefined;
  const requestDisposal = useMutation(api.assets.requestDisposal);
  const recordConfirmation = useMutation(api.assets.recordDisposalConfirmation);
  const markSentToWarehouse = useMutation(api.assets.markSentToWarehouse);
  const assignPatrimonyNumber = useMutation(api.assets.assignPatrimonyNumber);

  const [search, setSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [requestObservation, setRequestObservation] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [confirmationReference, setConfirmationReference] = useState("");
  const [confirmationDate, setConfirmationDate] = useState("");
  const [warehouseDate, setWarehouseDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedAssetForPatrimony, setSelectedAssetForPatrimony] = useState<any | null>(null);
  const [newPatrimonyNumber, setNewPatrimonyNumber] = useState("");
  const [patrimonyObservation, setPatrimonyObservation] = useState("");
  const canRequestDisposal = roleHasPermission(currentUser?.role, "equipment.manage");
  const canAssignPatrimony = roleHasPermission(currentUser?.role, "patrimony.assign");
  const pendingPatrimonyAssets = (assets ?? []).filter((asset) => asset.active !== false && !asset.patrimonyNumber?.trim());

  const availableAssets = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return (assets ?? []).filter((asset) => {
      if (["disposal_pending", "disposal_authorized", "sent_to_warehouse", "disposed", "lost"].includes(asset.status)) return false;
      if (!q) return true;
      return [
        asset.patrimonyNumber ?? "", asset.serialNumber ?? "", asset.manufacturer ?? "",
        asset.model ?? "", asset.assetType ?? "", asset.hostname ?? "",
      ].some((value) => value.toLocaleLowerCase("pt-BR").includes(q));
    });
  }, [assets, search]);

  const submitPatrimonyAssignment = async () => {
    if (!selectedAssetForPatrimony) return;
    if (!newPatrimonyNumber.trim()) {
      toast.error("Informe o número patrimonial.");
      return;
    }
    setBusy(true);
    try {
      await assignPatrimonyNumber({
        assetId: selectedAssetForPatrimony._id,
        patrimonyNumber: newPatrimonyNumber.trim(),
        observation: patrimonyObservation.trim() || undefined,
      });
      toast.success("Número patrimonial associado ao equipamento.");
      setSelectedAssetForPatrimony(null);
      setNewPatrimonyNumber("");
      setPatrimonyObservation("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível associar o número patrimonial.");
    } finally {
      setBusy(false);
    }
  };

  const submitRequest = async () => {
    if (!selectedAsset) return;
    if (reason.trim().length < 5) {
      toast.error("Descreva o motivo da solicitação.");
      return;
    }
    setBusy(true);
    try {
      await requestDisposal({
        assetId: selectedAsset._id,
        reason: reason.trim(),
        observation: requestObservation.trim() || undefined,
      });
      toast.success("Solicitação registrada e encaminhada ao Departamento de Patrimônio.");
      setSelectedAsset(null);
      setReason("");
      setRequestObservation("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a solicitação.");
    } finally {
      setBusy(false);
    }
  };

  const submitConfirmation = async () => {
    if (!selectedRequest) return;
    if (!confirmationReference.trim() || !confirmationDate) {
      toast.error("Informe o documento/protocolo e a data da baixa oficial.");
      return;
    }
    setBusy(true);
    try {
      await recordConfirmation({
        requestId: selectedRequest._id,
        confirmationReference: confirmationReference.trim(),
        confirmationDate,
      });
      toast.success("Confirmação oficial do Departamento de Patrimônio registrada.");
      setSelectedRequest(null);
      setConfirmationReference("");
      setConfirmationDate("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a confirmação.");
    } finally {
      setBusy(false);
    }
  };

  const submitWarehouse = async () => {
    if (!selectedRequest || !warehouseDate) {
      toast.error("Informe a data de encaminhamento ao barracão.");
      return;
    }
    setBusy(true);
    try {
      await markSentToWarehouse({ requestId: selectedRequest._id, warehouseSentDate: warehouseDate });
      toast.success("Encaminhamento ao barracão registrado.");
      setSelectedRequest(null);
      setWarehouseDate("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar o encaminhamento.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-1 h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Solicitações de baixa patrimonial</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              A TI identifica o equipamento e encaminha a solicitação. O Departamento de Patrimônio
              realiza e confirma a baixa oficial. Somente depois dessa confirmação o envio ao barracão
              de inservíveis pode ser registrado.
            </p>
          </div>
        </div>

        {canAssignPatrimony && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equipamentos aguardando tombamento</CardTitle>
              <p className="text-sm text-muted-foreground">Equipamentos recebidos pela TI sem número patrimonial. O Departamento de Patrimônio pode associar o número posteriormente, sem alterar a entrada ou o estoque.</p>
            </CardHeader>
            <CardContent>
              {assets === undefined ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Carregando equipamentos...</p>
              ) : pendingPatrimonyAssets.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Não há equipamentos pendentes de tombamento.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Equipamento</TableHead><TableHead>Série</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {pendingPatrimonyAssets.map((asset) => (
                      <TableRow key={asset._id}>
                        <TableCell className="font-medium">{equipmentLabel(asset)}</TableCell>
                        <TableCell>{asset.serialNumber ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">{asset.status}</Badge></TableCell>
                        <TableCell className="text-right"><Button size="sm" onClick={() => setSelectedAssetForPatrimony(asset)}>Associar patrimônio</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {canRequestDisposal && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Registrar solicitação de baixa</CardTitle>
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Buscar por patrimônio, série, fabricante ou modelo..." />
            </div>
          </CardHeader>
          <CardContent>
            {assets === undefined ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Carregando equipamentos...</p>
            ) : availableAssets.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum equipamento disponível para nova solicitação.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Equipamento / identificação</TableHead>
                    <TableHead>Status atual</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {availableAssets.map((asset) => (
                      <TableRow key={asset._id}>
                        <TableCell className="font-medium">{equipmentLabel(asset)}</TableCell>
                        <TableCell><Badge variant="outline">{asset.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {canRequestDisposal ? <Button size="sm" variant="outline" onClick={() => setSelectedAsset(asset)}>
                            <Send className="mr-2 h-3.5 w-3.5" /> Solicitar baixa
                          </Button> : <span className="text-xs text-muted-foreground">Ação da equipe de TI</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Acompanhamento das solicitações</CardTitle></CardHeader>
          <CardContent>
            {requests === undefined ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Carregando solicitações...</p>
            ) : requests.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma solicitação registrada.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Equipamento</TableHead>
                    <TableHead>Solicitado em / por</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {requests.map((request) => (
                      <TableRow key={request._id}>
                        <TableCell className="min-w-56">
                          <div className="font-medium">{equipmentLabel(request.asset) || request.equipmentDescription}</div>
                          <div className="text-xs text-muted-foreground">{request.patrimonyNumberSnapshot ? `Patrimônio ${request.patrimonyNumberSnapshot}` : "Sem número patrimonial informado"}</div>
                        </TableCell>
                        <TableCell>
                          <div>{dateLabel(request.createdAt)}</div>
                          <div className="text-xs text-muted-foreground">{request.requesterName}</div>
                        </TableCell>
                        <TableCell className="max-w-xs text-sm">{request.reason}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{STATUS_LABELS[request.status as DisposalStatus] ?? request.status}</Badge>
                          {request.confirmationReference ? <div className="mt-1 text-xs text-muted-foreground">Doc. {request.confirmationReference} · {dateLabel(request.confirmationDate)}</div> : null}
                          {request.warehouseSentDate ? <div className="mt-1 text-xs text-muted-foreground">Barracão: {dateLabel(request.warehouseSentDate)}</div> : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {request.status === "sent_to_patrimony" ? (
                            canAssignPatrimony ? <Button size="sm" onClick={() => setSelectedRequest(request)}>Registrar confirmação</Button> : <span className="text-xs text-muted-foreground">Aguardando Patrimônio</span>
                          ) : request.status === "confirmed_by_patrimony" ? (
                            canAssignPatrimony ? <Button size="sm" onClick={() => setSelectedRequest(request)}>
                              <Warehouse className="mr-2 h-3.5 w-3.5" /> Registrar envio
                            </Button> : <span className="text-xs text-muted-foreground">Baixa confirmada</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> Concluído</span>
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
      </div>

      <Dialog open={!!selectedAssetForPatrimony} onOpenChange={(open) => { if (!open && !busy) setSelectedAssetForPatrimony(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Associar número patrimonial</DialogTitle>
            <DialogDescription>{selectedAssetForPatrimony ? equipmentLabel(selectedAssetForPatrimony) : ""}. Esta ação registra o tombamento informado pelo Departamento de Patrimônio e preserva a entrada original.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Número patrimonial</Label><Input value={newPatrimonyNumber} onChange={(event) => setNewPatrimonyNumber(event.target.value)} maxLength={80} /></div>
            <div><Label>Observação (opcional)</Label><Textarea value={patrimonyObservation} onChange={(event) => setPatrimonyObservation(event.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAssetForPatrimony(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void submitPatrimonyAssignment()} disabled={busy || !newPatrimonyNumber.trim()}>{busy ? "Salvando..." : "Associar número"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedAsset} onOpenChange={(open) => { if (!open && !busy) setSelectedAsset(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar baixa patrimonial</DialogTitle>
            <DialogDescription>{selectedAsset ? equipmentLabel(selectedAsset) : ""}. A solicitação será encaminhada ao Departamento de Patrimônio; esta ação não executa a baixa oficial.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Motivo da solicitação</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Descreva o defeito, obsolescência ou motivo para avaliação de baixa..." /></div>
            <div><Label>Observações adicionais (opcional)</Label><Textarea value={requestObservation} onChange={(event) => setRequestObservation(event.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAsset(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void submitRequest()} disabled={busy || reason.trim().length < 5}>{busy ? "Enviando..." : "Encaminhar ao Patrimônio"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedRequest && selectedRequest.status === "sent_to_patrimony"} onOpenChange={(open) => { if (!open && !busy) setSelectedRequest(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar confirmação do Patrimônio</DialogTitle>
            <DialogDescription>Registre os dados do documento ou protocolo recebido do Departamento de Patrimônio. A TI não realiza a baixa oficial.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Documento / protocolo da baixa oficial</Label><Input value={confirmationReference} onChange={(event) => setConfirmationReference(event.target.value)} maxLength={120} /></div>
            <div><Label>Data da baixa oficial</Label><Input type="date" value={confirmationDate} onChange={(event) => setConfirmationDate(event.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRequest(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void submitConfirmation()} disabled={busy || !confirmationReference.trim() || !confirmationDate}>{busy ? "Salvando..." : "Registrar confirmação"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedRequest && selectedRequest.status === "confirmed_by_patrimony"} onOpenChange={(open) => { if (!open && !busy) setSelectedRequest(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar envio ao barracão</DialogTitle>
            <DialogDescription>A baixa oficial já foi confirmada pelo Departamento de Patrimônio. Informe a data em que o equipamento foi encaminhado ao barracão de inservíveis.</DialogDescription>
          </DialogHeader>
          <div><Label>Data de encaminhamento</Label><Input type="date" value={warehouseDate} onChange={(event) => setWarehouseDate(event.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRequest(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void submitWarehouse()} disabled={busy || !warehouseDate}>{busy ? "Salvando..." : "Confirmar encaminhamento"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
