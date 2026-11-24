import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Droplets, Users, Wallet, Plus, RefreshCw, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);

const dateInputToTimestamp = (value: string) => new Date(`${value}T12:00:00`).getTime();
const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

type MovementType = "opening_balance" | "supplier_delivery" | "consumption" | "supplier_exchange" | "adjustment";

export default function WaterManagement() {
  const data = useQuery(api.water.dashboard);
  const createParticipant = useMutation(api.water.createParticipant);
  const setParticipantActive = useMutation(api.water.setParticipantActive);
  const recordMovement = useMutation(api.water.recordMovement);
  const createPeriod = useMutation(api.water.createPeriod);
  const recordPayment = useMutation(api.water.recordPayment);

  const [participantName, setParticipantName] = useState("");
  const [participantDepartment, setParticipantDepartment] = useState("");
  const [movementType, setMovementType] = useState<MovementType>("supplier_delivery");
  const [fullQuantity, setFullQuantity] = useState("");
  const [emptyQuantity, setEmptyQuantity] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [movementCost, setMovementCost] = useState("");
  const [movementObservation, setMovementObservation] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodGallons, setPeriodGallons] = useState("");
  const [periodCost, setPeriodCost] = useState("");
  const [periodParticipants, setPeriodParticipants] = useState<string[]>([]);
  const [periodObservation, setPeriodObservation] = useState("");
  const [paymentPeriodId, setPaymentPeriodId] = useState("");
  const [paymentParticipantId, setPaymentParticipantId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(localToday());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentObservation, setPaymentObservation] = useState("");
  const [busy, setBusy] = useState(false);

  const activeParticipants = useMemo(
    () => (data?.participants ?? []).filter((participant: any) => participant.active),
    [data?.participants],
  );
  const selectedPaymentPeriod = (data?.periods ?? []).find((period: any) => String(period._id) === paymentPeriodId);
  const payableParticipants = selectedPaymentPeriod?.participants ?? [];

  const resetMovement = () => {
    setFullQuantity("");
    setEmptyQuantity("");
    setSupplierName("");
    setMovementCost("");
    setMovementObservation("");
  };

  const submitParticipant = async () => {
    if (!participantName.trim()) return toast.error("Informe o nome do participante.");
    setBusy(true);
    try {
      await createParticipant({ name: participantName.trim(), department: participantDepartment.trim() || undefined });
      setParticipantName("");
      setParticipantDepartment("");
      toast.success("Participante cadastrado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cadastrar o participante.");
    } finally {
      setBusy(false);
    }
  };

  const submitMovement = async () => {
    const full = Number(fullQuantity);
    const empty = Number(emptyQuantity);
    if (!Number.isFinite(full) || !Number.isFinite(empty) || (movementType !== "adjustment" && (full < 0 || empty < 0))) {
      return toast.error("Informe quantidades válidas e não negativas.");
    }
    let fullDelta = full;
    let emptyDelta = empty;
    if (movementType === "consumption") fullDelta = -full;
    if (movementType === "supplier_exchange") emptyDelta = -empty;
    if (movementType === "adjustment") {
      fullDelta = Number(fullQuantity);
      emptyDelta = Number(emptyQuantity);
    }
    if (movementType === "supplier_delivery") emptyDelta = 0;
    setBusy(true);
    try {
      await recordMovement({
        movementType,
        fullDelta,
        emptyDelta,
        supplierName: movementType === "supplier_delivery" || movementType === "supplier_exchange" ? supplierName.trim() || undefined : undefined,
        costAmount: movementType === "supplier_delivery" || movementType === "supplier_exchange"
          ? movementCost.trim() ? Number(movementCost) : undefined
          : undefined,
        observation: movementObservation.trim(),
      });
      resetMovement();
      toast.success("Movimentação de garrafões registrada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a movimentação.");
    } finally {
      setBusy(false);
    }
  };

  const submitPeriod = async () => {
    if (periodParticipants.length === 0) return toast.error("Selecione ao menos um participante.");
    setBusy(true);
    try {
      await createPeriod({
        label: periodLabel,
        startDate: periodStart,
        endDate: periodEnd,
        gallonsConsumed: Number(periodGallons),
        totalCost: Number(periodCost),
        participantIds: periodParticipants as any,
        observation: periodObservation.trim() || undefined,
      });
      setPeriodLabel("");
      setPeriodStart("");
      setPeriodEnd("");
      setPeriodGallons("");
      setPeriodCost("");
      setPeriodParticipants([]);
      setPeriodObservation("");
      toast.success("Competência registrada e rateio calculado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a competência.");
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async () => {
    if (!paymentPeriodId || !paymentParticipantId) return toast.error("Selecione a competência e o participante.");
    setBusy(true);
    try {
      await recordPayment({
        periodId: paymentPeriodId as any,
        participantId: paymentParticipantId as any,
        amount: Number(paymentAmount),
        paidAt: dateInputToTimestamp(paymentDate),
        method: paymentMethod.trim() || undefined,
        observation: paymentObservation.trim() || undefined,
      });
      setPaymentAmount("");
      setPaymentObservation("");
      toast.success("Pagamento registrado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar o pagamento.");
    } finally {
      setBusy(false);
    }
  };

  if (data === undefined) {
    return <AppShell><div className="mx-auto max-w-7xl p-6 text-sm text-muted-foreground">Carregando gestão de água mineral...</div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-primary"><Droplets className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-wide">Operação especial</span></div>
          <h1 className="text-2xl font-bold tracking-tight">Água mineral</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Controle manual de garrafões cheios e vazios, recebimentos e trocas com fornecedor, rateio por competência e pagamentos individuais. Não utiliza entrada por NF nem exige fechamento mensal.</p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Garrafões cheios</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.balances.full}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Garrafões vazios</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.balances.empty}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total rateado</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(data.totals.allocatedCost)}</p><p className="text-xs text-muted-foreground">Compras registradas: {money(data.totals.purchasedCost)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Em aberto</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(data.totals.outstandingCost)}</p><p className="text-xs text-muted-foreground">Pago: {money(data.totals.paidCost)}</p></CardContent></Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4" />Movimentar garrafões</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Tipo de movimentação</Label><Select value={movementType} onValueChange={(value) => setMovementType(value as MovementType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="opening_balance">Contagem / saldo inicial</SelectItem>
                <SelectItem value="supplier_delivery">Recebimento do fornecedor</SelectItem>
                <SelectItem value="consumption">Consumo interno</SelectItem>
                <SelectItem value="supplier_exchange">Troca com fornecedor (cheios por vazios)</SelectItem>
                <SelectItem value="adjustment">Ajuste de contagem</SelectItem>
              </SelectContent></Select></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>{movementType === "adjustment" ? "Ajuste de cheios (+/-)" : movementType === "consumption" ? "Cheios consumidos" : "Garrafões cheios"}</Label><Input type="number" step="1" value={fullQuantity} onChange={(event) => setFullQuantity(event.target.value)} placeholder="0" /></div>
                {movementType !== "supplier_delivery" && <div className="space-y-2"><Label>{movementType === "adjustment" ? "Ajuste de vazios (+/-)" : movementType === "consumption" ? "Vazios recebidos" : movementType === "supplier_exchange" ? "Vazios devolvidos ao fornecedor" : "Garrafões vazios"}</Label><Input type="number" step="1" value={emptyQuantity} onChange={(event) => setEmptyQuantity(event.target.value)} placeholder="0" /></div>}
              </div>
              {(movementType === "supplier_delivery" || movementType === "supplier_exchange") && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Fornecedor</Label><Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Nome do fornecedor" /></div><div className="space-y-2"><Label>Custo manual (R$)</Label><Input type="number" min="0" step="0.01" value={movementCost} onChange={(event) => setMovementCost(event.target.value)} placeholder="0,00" /></div></div>}
              <div className="space-y-2"><Label>Observação / justificativa</Label><Textarea value={movementObservation} onChange={(event) => setMovementObservation(event.target.value)} placeholder="Informe o recebimento, consumo, troca ou motivo do ajuste." /></div>
              <Button disabled={busy} onClick={() => void submitMovement()} className="w-full"><Plus className="mr-2 h-4 w-4" />Registrar movimentação</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Participantes do rateio</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Nome do servidor</Label><Input value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Nome completo" /></div><div className="space-y-2"><Label>Setor (opcional)</Label><Input value={participantDepartment} onChange={(event) => setParticipantDepartment(event.target.value)} placeholder="Secretaria / departamento" /></div></div>
              <Button disabled={busy} onClick={() => void submitParticipant()} variant="outline" className="w-full"><Plus className="mr-2 h-4 w-4" />Cadastrar participante</Button>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {data.participants.map((participant: any) => <div key={participant._id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{participant.name}</p><p className="text-xs text-muted-foreground">{participant.department || "Sem setor"}</p><p className="text-xs text-muted-foreground">Rateado: {money(participant.totalDue)} · Pago: {money(participant.totalPaid)} · Em aberto: {money(participant.outstanding)}</p></div>
                  <div className="flex items-center gap-2"><Badge variant={participant.active ? "default" : "secondary"}>{participant.active ? "Ativo" : "Inativo"}</Badge><Button size="sm" variant="ghost" onClick={() => void setParticipantActive({ participantId: participant._id, active: !participant.active }).catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao alterar participante"))}>{participant.active ? "Inativar" : "Ativar"}</Button></div>
                </div>)}
                {data.participants.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum participante cadastrado.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4" />Registrar competência e rateio</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">Use um mês ou um intervalo de dois meses, conforme o período efetivo de cobrança. O custo é dividido igualmente entre os participantes selecionados; depois de criado, o período e as cotas individuais ficam preservados no histórico.</p>
              <div className="space-y-2"><Label>Nome da competência</Label><Input value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} placeholder="Ex.: Outubro/Novembro 2026" /></div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Data inicial</Label><Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></div><div className="space-y-2"><Label>Data final</Label><Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></div></div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Garrafões consumidos</Label><Input type="number" min="0.01" step="1" value={periodGallons} onChange={(event) => setPeriodGallons(event.target.value)} /></div><div className="space-y-2"><Label>Custo total manual (R$)</Label><Input type="number" min="0.01" step="0.01" value={periodCost} onChange={(event) => setPeriodCost(event.target.value)} /></div></div>
              <div className="space-y-2"><Label>Participantes nesta competência</Label><div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
                {activeParticipants.map((participant: any) => <label key={participant._id} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={periodParticipants.includes(String(participant._id))} onChange={(event) => setPeriodParticipants((current) => event.target.checked ? [...current, String(participant._id)] : current.filter((id) => id !== String(participant._id)))} />{participant.name}{participant.department ? <span className="text-xs text-muted-foreground">— {participant.department}</span> : null}</label>)}
                {activeParticipants.length === 0 && <p className="text-xs text-muted-foreground">Cadastre participantes antes de criar um rateio.</p>}
              </div></div>
              <div className="space-y-2"><Label>Observação (opcional)</Label><Textarea value={periodObservation} onChange={(event) => setPeriodObservation(event.target.value)} /></div>
              <Button disabled={busy || activeParticipants.length === 0} onClick={() => void submitPeriod()} className="w-full"><Plus className="mr-2 h-4 w-4" />Criar rateio</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4" />Registrar pagamento</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Competência</Label><Select value={paymentPeriodId} onValueChange={(value) => { setPaymentPeriodId(value); setPaymentParticipantId(""); }}><SelectTrigger><SelectValue placeholder="Selecione o período" /></SelectTrigger><SelectContent>{data.periods.map((period: any) => <SelectItem key={period._id} value={String(period._id)}>{period.label} · Em aberto {money(period.outstandingAmount)}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Participante</Label><Select value={paymentParticipantId} onValueChange={setPaymentParticipantId}><SelectTrigger><SelectValue placeholder="Selecione o participante" /></SelectTrigger><SelectContent>{payableParticipants.filter((row: any) => row.outstandingAmount > 0).map((row: any) => <SelectItem key={row.participantId} value={String(row.participantId)}>{row.participantName} · Falta {money(row.outstandingAmount)}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Valor recebido (R$)</Label><Input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div><div className="space-y-2"><Label>Data do pagamento</Label><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div></div>
              <div className="space-y-2"><Label>Forma de pagamento (opcional)</Label><Input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} placeholder="Dinheiro, PIX, transferência..." /></div>
              <div className="space-y-2"><Label>Observação (opcional)</Label><Textarea value={paymentObservation} onChange={(event) => setPaymentObservation(event.target.value)} /></div>
              <Button disabled={busy || !paymentPeriodId || !paymentParticipantId} onClick={() => void submitPayment()} className="w-full"><ArrowDownToLine className="mr-2 h-4 w-4" />Lançar pagamento</Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Histórico de competências e saldos individuais</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {data.periods.map((period: any) => <div key={period._id} className="rounded-lg border p-4">
              <div className="flex flex-col justify-between gap-2 sm:flex-row"><div><h3 className="font-semibold">{period.label}</h3><p className="text-xs text-muted-foreground">{period.startDate} a {period.endDate} · {period.gallonsConsumed} garrafões</p></div><div className="text-sm sm:text-right"><p>Rateado: <strong>{money(period.allocatedAmount)}</strong></p><p>Pago: {money(period.paidAmount)} · Em aberto: <strong>{money(period.outstandingAmount)}</strong></p></div></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{period.participants.map((row: any) => <div key={row.participantId} className="rounded-md bg-muted/40 p-3 text-sm"><p className="font-medium">{row.participantName}</p><p className="text-xs text-muted-foreground">Cota: {money(row.shareAmount)} · Pago: {money(row.paidAmount)}</p><p className="text-xs font-medium">Em aberto: {money(row.outstandingAmount)}</p></div>)}</div>
            </div>)}
            {data.periods.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma competência registrada.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4" />Histórico de pagamentos recebidos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.payments.map((payment: any) => <div key={payment._id} className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{payment.participantName} · {payment.periodLabel}</p><p className="text-xs text-muted-foreground">{new Date(payment.paidAt).toLocaleDateString("pt-BR")} · {payment.method || "Forma não informada"} · Recebido por: {payment.receivedByName}</p><p className="text-xs text-muted-foreground">{payment.observation || "Sem observação"}</p></div><p className="text-sm font-semibold tabular-nums">{money(payment.amount)}</p></div>)}
            {data.payments.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum pagamento registrado.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ArrowUpFromLine className="h-4 w-4" />Movimentações recentes de garrafões</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.movements.map((movement: any) => <div key={movement._id} className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{movement.movementType.replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{new Date(movement.createdAt).toLocaleString("pt-BR")} · {movement.supplierName || "Movimentação interna"} · Operador: {movement.operatorName}</p><p className="text-xs text-muted-foreground">{movement.observation}</p></div><div className="text-sm tabular-nums sm:text-right"><p>Cheios: {movement.fullDelta > 0 ? "+" : ""}{movement.fullDelta}</p><p>Vazios: {movement.emptyDelta > 0 ? "+" : ""}{movement.emptyDelta}</p>{movement.costAmount !== undefined && <p>{money(movement.costAmount)}</p>}</div></div>)}
            {data.movements.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
