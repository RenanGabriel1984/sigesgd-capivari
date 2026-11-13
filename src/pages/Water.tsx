import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Droplets, Users, Wallet, Plus, PackageOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { getPermissions } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import { buildWaterSupplierReturnDeltas, parseWaterMoneyToCents } from "@/lib/water-control";

type Cadence = "monthly" | "bimonthly" | "custom";
type MovementType = "consumption" | "return" | "adjustment";

function localDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function dateToTimestamp(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}
function formatDate(value?: number) {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}
function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function periodDefaults() {
  const now = new Date();
  return {
    start: localDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: localDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export default function WaterPage() {
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);
  const canManage = permissions.canManageWater;
  const dashboard = useQuery(api.water.dashboard) as any;

  const createParticipant = useMutation(api.water.createParticipant);
  const updateParticipant = useMutation(api.water.updateParticipant);
  const createPeriod = useMutation(api.water.createPeriod);
  const setPeriodParticipants = useMutation(api.water.setPeriodParticipants);
  const createReceipt = useMutation(api.water.createReceipt);
  const recordMovement = useMutation(api.water.recordContainerMovement);
  const closePeriod = useMutation(api.water.closePeriod);
  const recordPayment = useMutation(api.water.recordPayment);

  const [participantName, setParticipantName] = useState("");
  const [periodTitle, setPeriodTitle] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [dates, setDates] = useState(periodDefaults);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [receiptDate, setReceiptDate] = useState(localDateInput());
  const [gallonsReceived, setGallonsReceived] = useState("1");
  const [emptyReturned, setEmptyReturned] = useState("0");
  const [receiptValue, setReceiptValue] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [paidByName, setPaidByName] = useState("");
  const [receiptObservation, setReceiptObservation] = useState("");
  const [movementType, setMovementType] = useState<MovementType>("consumption");
  const [movementDate, setMovementDate] = useState(localDateInput());
  const [movementQuantity, setMovementQuantity] = useState("1");
  const [returnFullQuantity, setReturnFullQuantity] = useState("0");
  const [returnEmptyQuantity, setReturnEmptyQuantity] = useState("1");
  const [adjustFull, setAdjustFull] = useState("0");
  const [adjustEmpty, setAdjustEmpty] = useState("0");
  const [movementObservation, setMovementObservation] = useState("");
  const [paymentValues, setPaymentValues] = useState<Record<string, string>>({});

  const periods = dashboard?.periods ?? [];
  const openPeriod = dashboard?.openPeriod ?? null;
  const activePeriodId = selectedPeriodId || openPeriod?._id || "";
  const details = useQuery(
    api.water.periodDetails,
    activePeriodId ? { periodId: activePeriodId as any } : "skip",
  ) as any;

  const activeParticipants = (dashboard?.participants ?? []).filter((person: any) => person.active);
  const checkedParticipantIds = useMemo(
    () => new Set<string>(details?.period?.participantIds ?? []),
    [details?.period?.participantIds],
  );

  const runAction = async (
    successMessage: string,
    action: () => Promise<unknown>,
    reset?: () => void,
  ) => {
    try {
      await action();
      toast.success(successMessage);
      reset?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a operação.");
    }
  };

  const handleCreatePeriod = () => runAction("Período de rateio aberto", async () => {
    if (!dates.start || !dates.end) throw new Error("Informe as datas do período.");
    const title = periodTitle.trim() || `${cadence === "monthly" ? "Mensal" : cadence === "bimonthly" ? "Bimestral" : "Rateio"} — ${dates.start} a ${dates.end}`;
    const id = await createPeriod({
      title,
      cadence,
      startAt: dateToTimestamp(dates.start),
      endAt: dateToTimestamp(dates.end),
      participantIds: activeParticipants.map((person: any) => person._id),
    });
    setSelectedPeriodId(id as string);
  }, () => setPeriodTitle(""));

  const handleCreateReceipt = () => runAction("Recebimento manual registrado", async () => {
    if (!openPeriod) throw new Error("Abra um período de rateio antes de registrar o recebimento.");
    const cents = parseWaterMoneyToCents(receiptValue);
    if (cents === null) throw new Error("Informe um valor total válido.");
    await createReceipt({
      periodId: openPeriod._id,
      receivedAt: dateToTimestamp(receiptDate),
      gallonsReceived: Number(gallonsReceived),
      emptyGallonsReturned: Number(emptyReturned),
      totalValueCents: cents,
      sourceName: sourceName || undefined,
      paidByName: paidByName || undefined,
      observation: receiptObservation || undefined,
    });
  }, () => {
    setGallonsReceived("1");
    setEmptyReturned("0");
    setReceiptValue("");
    setSourceName("");
    setPaidByName("");
    setReceiptObservation("");
  });

  const handleMovement = () => runAction("Movimentação de galões registrada", async () => {
    let fullDelta = 0;
    let emptyDelta = 0;
    if (movementType === "consumption") {
      const quantity = Number(movementQuantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Informe a quantidade consumida.");
      fullDelta = -quantity;
      emptyDelta = quantity;
    } else if (movementType === "return") {
      const returned = buildWaterSupplierReturnDeltas(
        Number(returnFullQuantity),
        Number(returnEmptyQuantity),
      );
      fullDelta = returned.fullDelta;
      emptyDelta = returned.emptyDelta;
    } else {
      fullDelta = Number(adjustFull);
      emptyDelta = Number(adjustEmpty);
    }
    await recordMovement({
      type: movementType,
      date: dateToTimestamp(movementDate),
      fullDelta,
      emptyDelta,
      observation: movementObservation || undefined,
    });
  }, () => {
    setMovementQuantity("1");
    setReturnFullQuantity("0");
    setReturnEmptyQuantity("1");
    setAdjustFull("0");
    setAdjustEmpty("0");
    setMovementObservation("");
  });

  const handleClosePeriod = () => runAction("Período fechado e rateio calculado", async () => {
    if (!activePeriodId) throw new Error("Selecione um período.");
    await closePeriod({ periodId: activePeriodId as any });
  });

  if (dashboard === undefined) {
    return <AppShell><div className="mx-auto max-w-7xl py-12 text-center text-muted-foreground">Carregando controle de água mineral…</div></AppShell>;
  }

  const balance = dashboard.balance ?? { fullGallons: 0, emptyGallons: 0 };
  const selectedPeriod = periods.find((period: any) => period._id === activePeriodId);
  const totalValueCents = details?.totalValueCents ?? 0;
  const paidCents = details?.totalPaidCents ?? 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Controle de Água Mineral</h1>
            <p className="text-sm text-muted-foreground">Recebimentos manuais, galões retornáveis e rateio entre participantes.</p>
          </div>
          <Badge variant="outline">Controle interno — sem nota fiscal</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Droplets className="h-4 w-4" /> Galões cheios</div><p className="mt-2 text-2xl font-semibold tabular-nums">{balance.fullGallons}</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><PackageOpen className="h-4 w-4" /> Galões vazios</div><p className="mt-2 text-2xl font-semibold tabular-nums">{balance.emptyGallons}</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-4 w-4" /> Participantes ativos</div><p className="mt-2 text-2xl font-semibold tabular-nums">{activeParticipants.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-4 w-4" /> Total do período</div><p className="mt-2 text-xl font-semibold tabular-nums">{money(totalValueCents)}</p><p className="text-xs text-muted-foreground">{money(paidCents)} recebido</p></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Período de rateio</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Consultar período</Label>
                <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={activePeriodId} onChange={(event) => setSelectedPeriodId(event.target.value)}>
                  <option value="">Nenhum período</option>
                  {periods.map((period: any) => <option key={period._id} value={period._id}>{period.title} — {period.status === "open" ? "Aberto" : "Fechado"}</option>)}
                </select>
              </div>
              {openPeriod ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2"><p className="font-medium">{openPeriod.title}</p><Badge variant="secondary">Aberto</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(openPeriod.startAt)} até {formatDate(openPeriod.endAt)}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Todos os recebimentos registrados enquanto este período estiver aberto serão acumulados para o rateio.</p>
                </div>
              ) : canManage ? (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Abrir novo período</p>
                  <div><Label>Identificação (opcional)</Label><Input value={periodTitle} onChange={(e) => setPeriodTitle(e.target.value)} placeholder="Ex.: Água — novembro/dezembro" /></div>
                  <div><Label>Frequência de pagamento</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}><option value="monthly">Mensal</option><option value="bimonthly">Bimestral</option><option value="custom">Personalizado</option></select></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Início</Label><Input type="date" value={dates.start} onChange={(e) => setDates((old) => ({ ...old, start: e.target.value }))} /></div>
                    <div><Label>Fim</Label><Input type="date" value={dates.end} onChange={(e) => setDates((old) => ({ ...old, end: e.target.value }))} /></div>
                  </div>
                  <Button className="w-full" onClick={() => void handleCreatePeriod()}><Plus className="mr-2 h-4 w-4" /> Abrir período</Button>
                  <p className="text-xs text-muted-foreground">Os participantes ativos são incluídos automaticamente; você poderá ajustar a lista antes do fechamento.</p>
                </div>
              ) : <p className="text-sm text-muted-foreground">Nenhum período de rateio aberto.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Registrar recebimento manual</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {openPeriod && canManage ? <>
                <p className="text-xs text-muted-foreground">Informe a quantidade recebida e o valor combinado. Não é necessário DANFE, XML, nota fiscal ou empenho.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Data do recebimento</Label><Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></div>
                  <div><Label>Galões cheios recebidos</Label><Input type="number" min="1" step="1" value={gallonsReceived} onChange={(e) => setGallonsReceived(e.target.value)} /></div>
                  <div><Label>Vazios entregues ao fornecedor</Label><Input type="number" min="0" step="1" value={emptyReturned} onChange={(e) => setEmptyReturned(e.target.value)} /></div>
                  <div><Label>Valor total (R$)</Label><Input inputMode="decimal" value={receiptValue} onChange={(e) => setReceiptValue(e.target.value)} placeholder="Ex.: 80,00" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Fornecedor / entregador (opcional)</Label><Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} /></div>
                  <div><Label>Quem pagou (opcional)</Label><Input value={paidByName} onChange={(e) => setPaidByName(e.target.value)} /></div>
                </div>
                <div><Label>Observação (opcional)</Label><Input value={receiptObservation} onChange={(e) => setReceiptObservation(e.target.value)} /></div>
                <Button className="w-full" onClick={() => void handleCreateReceipt()}>Registrar recebimento</Button>
              </> : <p className="text-sm text-muted-foreground">Abra um período de rateio para registrar recebimentos.</p>}
            </CardContent>
          </Card>
        </div>

        {details && selectedPeriod && (
          <Card>
            <CardHeader><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="text-base">Fechamento e rateio — {details.period.title}</CardTitle>{details.period.status === "open" ? <Badge variant="secondary">Em andamento</Badge> : <Badge>Fechado</Badge>}</div></CardHeader>
            <CardContent className="space-y-4">
              {details.period.status === "open" && canManage && (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Pessoas incluídas neste rateio</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {dashboard.participants.map((person: any) => <label key={person._id} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${person.active ? "" : "opacity-50"}`}>
                      <input type="checkbox" disabled={!person.active} checked={checkedParticipantIds.has(person._id)} onChange={(event) => {
                        const next = new Set(checkedParticipantIds);
                        if (event.target.checked) next.add(person._id); else next.delete(person._id);
                        void runAction("Participantes do período atualizados", () => setPeriodParticipants({ periodId: activePeriodId as any, participantIds: [...next] as any }));
                      }} />
                      {person.name}
                    </label>)}
                  </div>
                  <p className="text-xs text-muted-foreground">O valor é dividido igualmente. A lista fica congelada no fechamento.</p>
                  <Button variant="outline" className="w-full" onClick={() => void handleClosePeriod()}>Fechar período e calcular rateio</Button>
                </div>
              )}

              <div className="flex flex-wrap gap-4 text-sm">
                <span><strong>Recebimentos:</strong> {details.receipts.length}</span>
                <span><strong>Galões recebidos:</strong> {details.totalGallonsReceived}</span>
                <span><strong>Total:</strong> {money(details.totalValueCents)}</span>
                <span><strong>Arrecadado:</strong> {money(details.totalPaidCents)}</span>
                <span><strong>Pendente:</strong> {money(details.totalOutstandingCents)}</span>
              </div>

              {details.receipts.length > 0 && <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr><th className="p-2 text-left">Data</th><th className="p-2 text-right">Cheios</th><th className="p-2 text-right">Vazios entregues</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Origem</th></tr></thead>
                  <tbody>{details.receipts.map((receipt: any) => <tr key={receipt._id} className="border-t"><td className="p-2">{formatDate(receipt.receivedAt)}</td><td className="p-2 text-right">{receipt.gallonsReceived}</td><td className="p-2 text-right">{receipt.emptyGallonsReturned}</td><td className="p-2 text-right">{money(receipt.totalValueCents)}</td><td className="p-2">{receipt.sourceName ?? "—"}</td></tr>)}</tbody>
                </table>
              </div>}

              {details.period.status === "closed" && <div className="space-y-3">
                <h3 className="text-sm font-medium">Rateio individual</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50"><tr><th className="p-2 text-left">Participante</th><th className="p-2 text-right">Devido</th><th className="p-2 text-right">Pago</th><th className="p-2 text-left">Situação</th><th className="p-2 text-left">Registrar pagamento</th></tr></thead>
                    <tbody>
                      {details.shares.map((share: any) => <tr key={share._id} className="border-t align-middle">
                        <td className="p-2 font-medium">{share.participantName}</td><td className="p-2 text-right">{money(share.amountDueCents)}</td><td className="p-2 text-right">{money(share.paidCents)}</td>
                        <td className="p-2"><Badge variant={share.paymentStatus === "paid" ? "default" : "secondary"}>{share.paymentStatus === "paid" ? "Pago" : share.paymentStatus === "partial" ? "Parcial" : "Pendente"}</Badge></td>
                        <td className="p-2"><div className="flex min-w-[190px] gap-1"><Input className="h-8" inputMode="decimal" placeholder="R$" value={paymentValues[share._id] ?? ""} onChange={(e) => setPaymentValues((old) => ({ ...old, [share._id]: e.target.value }))} disabled={!canManage || share.remainingCents <= 0} /><Button size="sm" className="h-8" disabled={!canManage || share.remainingCents <= 0} onClick={() => {
                          const cents = parseWaterMoneyToCents(paymentValues[share._id] ?? "");
                          void runAction(`Pagamento de ${share.participantName} registrado`, async () => {
                            if (!cents) throw new Error("Informe o valor do pagamento.");
                            await recordPayment({ shareId: share._id, amountCents: cents, paidAt: Date.now() });
                          }, () => setPaymentValues((old) => ({ ...old, [share._id]: "" })));
                        }}>Registrar</Button></div></td>
                      </tr>)}
                      {details.shares.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhum participante foi incluído no rateio.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Movimentação dos galões</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {canManage ? <>
                <div><Label>Tipo</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={movementType} onChange={(e) => setMovementType(e.target.value as MovementType)}><option value="consumption">Consumo (cheio vira vazio)</option><option value="return">Devolução de galões ao fornecedor</option><option value="adjustment">Ajuste de saldo / implantação</option></select></div>
                {movementType === "consumption" ? (
                  <div><Label>Galões consumidos</Label><Input type="number" min="1" step="1" value={movementQuantity} onChange={(e) => setMovementQuantity(e.target.value)} /></div>
                ) : movementType === "return" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Galões cheios devolvidos</Label><Input type="number" min="0" step="1" value={returnFullQuantity} onChange={(e) => setReturnFullQuantity(e.target.value)} /></div>
                    <div><Label>Galões vazios devolvidos</Label><Input type="number" min="0" step="1" value={returnEmptyQuantity} onChange={(e) => setReturnEmptyQuantity(e.target.value)} /></div>
                    <p className="col-span-2 text-xs text-muted-foreground">Informe os cheios e/ou vazios entregues ao fornecedor. O sistema valida cada saldo separadamente.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3"><div><Label>Ajuste de cheios (+/-)</Label><Input type="number" step="1" value={adjustFull} onChange={(e) => setAdjustFull(e.target.value)} /></div><div><Label>Ajuste de vazios (+/-)</Label><Input type="number" step="1" value={adjustEmpty} onChange={(e) => setAdjustEmpty(e.target.value)} /></div><p className="col-span-2 text-xs text-muted-foreground">Use valores positivos para acrescentar e negativos para retirar. O sistema impede saldo negativo.</p></div>
                )}
                <div><Label>Data</Label><Input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} /></div>
                <div><Label>Observação</Label><Input value={movementObservation} onChange={(e) => setMovementObservation(e.target.value)} /></div>
                <Button className="w-full" onClick={() => void handleMovement()}><RefreshCw className="mr-2 h-4 w-4" /> Registrar movimentação</Button>
              </> : <p className="text-sm text-muted-foreground">Seu perfil permite consultar os saldos, mas não registrar movimentações.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Participantes do consumo</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {canManage && <div className="flex gap-2"><Input value={participantName} onChange={(e) => setParticipantName(e.target.value)} placeholder="Nome do funcionário" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runAction("Participante cadastrado", () => createParticipant({ name: participantName }), () => setParticipantName("")); } }} /><Button onClick={() => void runAction("Participante cadastrado", () => createParticipant({ name: participantName }), () => setParticipantName(""))} disabled={!participantName.trim()}><Plus className="h-4 w-4" /></Button></div>}
              <div className="space-y-2">
                {dashboard.participants.map((person: any) => <div key={person._id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"><span className={`text-sm ${person.active ? "" : "text-muted-foreground line-through"}`}>{person.name}</span>{canManage && <Button size="sm" variant="outline" onClick={() => void runAction(person.active ? "Participante desativado" : "Participante reativado", () => updateParticipant({ participantId: person._id, active: !person.active }))}>{person.active ? "Desativar" : "Reativar"}</Button>}</div>)}
                {dashboard.participants.length === 0 && <p className="text-sm text-muted-foreground">Cadastre as pessoas que participam do consumo de água.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Movimentações recentes de galões</CardTitle></CardHeader>
          <CardContent>
            {dashboard.movements.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma movimentação de consumo, devolução ou ajuste registrada.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Data</th><th className="p-2">Tipo</th><th className="p-2 text-right">Cheios (+/-)</th><th className="p-2 text-right">Vazios (+/-)</th><th className="p-2">Observação</th></tr></thead><tbody>{dashboard.movements.map((movement: any) => <tr key={movement._id} className="border-b"><td className="p-2">{formatDate(movement.date)}</td><td className="p-2">{movement.type === "consumption" ? "Consumo" : movement.type === "return" ? "Devolução" : "Ajuste"}</td><td className="p-2 text-right">{movement.fullDelta > 0 ? "+" : ""}{movement.fullDelta}</td><td className="p-2 text-right">{movement.emptyDelta > 0 ? "+" : ""}{movement.emptyDelta}</td><td className="p-2">{movement.observation ?? "—"}</td></tr>)}</tbody></table></div>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
