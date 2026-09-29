/**
 * Gestão de Estoque SGGD — GESTÃO DE SUPRIMENTOS DE IMPRESSÃO (/gomaq).
 *
 * Painel operacional do estoque REAL recortado pela Área/Subestoque
 * "Impressoras" — não é um segundo estoque. Estrutura:
 *
 *   ESTOQUE            → Estoque atual · Retirada rápida
 *   MOVIMENTAÇÃO       → Entradas (módulo Entradas) · Consumo mensal · Reposição
 *   LOGÍSTICA REVERSA  → Carcaças · Trocas · Coletas · Pedido mensal (fornecedores)
 *
 * RBAC: consulta exige stock.view; retirada exige stock.mutate no backend
 * (o botão é ocultado sem a permissão; a autorização REAL é no servidor).
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import {
  Printer, PackageMinus, Download, Settings2, Loader2, Search,
  RefreshCcw, Truck, ShoppingCart, ArrowLeftRight,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { getPermissions } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import {
  computeCardTotals,
  validateWithdrawal,
  type SupplyRow,
  type StockStatus,
} from "@/lib/print-supplies";

const SUPPLY_CATEGORY_ID = "k57fk85xwpj3b3xj9dc31jwqpd8dgk3a";

type DashboardData = {
  rows: Array<SupplyRow & { inArea?: number }>;
  totals: ReturnType<typeof computeCardTotals>;
  areaQuantity: number;
};

type OrgDoc = { _id: string; name: string; parentId?: string | null };

function StatusBadge({ status }: { status: StockStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STOCK_BADGE[status]}`}>
      {status}
    </span>
  );
}

const STOCK_BADGE: Record<StockStatus, string> = {
  Normal: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Baixo: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "Crítico": "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

function Card({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ═══ Aba ESTOQUE ═══════════════════════════════════════════════════════════ */

function EstoqueTab() {
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);

  const dashboard = useQuery(api.printSupplies.getSupplyDashboard) as DashboardData | undefined;
  const rows = dashboard?.rows ?? [];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("todos");
  const [withdrawFor, setWithdrawFor] = useState<SupplyRow | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "todos" && r.type !== typeFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.productName.toLowerCase().includes(q) ||
        (r.brand ?? "").toLowerCase().includes(q) ||
        (r.model ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, typeFilter]);

  const totals = dashboard?.totals ?? computeCardTotals([]);
  const types = ["Toner", "Cartão", "Ribbon", "Papel", "Etiqueta", "Outros"];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Toners" value={totals.toners} />
        <Card label="Cartões" value={totals.cartoes} />
        <Card label="Ribbons" value={totals.ribbons} />
        <Card label="Papéis" value={totals.papeis} />
        <Card label="Etiquetas" value={totals.etiquetas} />
        <Card label="Estoque baixo" value={totals.lowStock} hint="Baixo ou crítico" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar produto, marca ou modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table className="min-w-[900px]">
          <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead>Modelo/Compat.</TableHead>
              <TableHead>Cor</TableHead>
              <TableHead>Un.</TableHead>
              <TableHead className="text-right">Atual</TableHead>
              <TableHead className="text-right">Mín.</TableHead>
              <TableHead className="text-right">Ideal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.productId}>
                <TableCell className="font-medium">{r.type}</TableCell>
                <TableCell>
                  {r.type === "Toner" ? (
                    <span>
                      <span className="font-medium">{r.displayLabel.split(" — ")[0]}</span>
                      {" — "}
                      <span className="text-muted-foreground">{r.displayLabel.split(" — ")[1]}</span>
                    </span>
                  ) : (
                    r.productName
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.brand ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.model ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.color ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.unitOfMeasure}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{r.currentStock}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.minimumStock != null && r.minimumStock > 0 ? r.minimumStock : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.idealStock != null && r.idealStock > 0 ? r.idealStock : "—"}
                </TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="text-right">
                  {permissions.canCreateEntries ? (
                    <Button variant="outline" size="sm" onClick={() => setWithdrawFor(r)}>
                      Retirar
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  {dashboard === undefined ? "Carregando..." : "Nenhum suprimento encontrado."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {withdrawFor && (
        <WithdrawDialog row={withdrawFor} open={!!withdrawFor} onClose={() => setWithdrawFor(null)} />
      )}
    </div>
  );
}

/* ═══ Retirada rápida ═══════════════════════════════════════════════════════ */

function WithdrawDialog({ row, open, onClose }: { row: SupplyRow; open: boolean; onClose: () => void }) {
  const orgs = useQuery(api.organizations.list) as OrgDoc[] | undefined;
  const withdraw = useMutation(api.printSupplies.withdraw);

  const [quantity, setQuantity] = useState("1");
  const [secretariaId, setSecretariaId] = useState("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [reason, setReason] = useState("");
  const [osNumber, setOsNumber] = useState("");
  const [observation, setObservation] = useState("");
  const [saving, setSaving] = useState(false);

  const qty = Number(quantity) || 0;
  const check = useMemo(() => validateWithdrawal(qty, row.currentStock), [qty, row.currentStock]);
  const secretarias = (orgs ?? []).filter((o) => !o.parentId);

  const submit = async () => {
    if (!check.ok) {
      toast.error(check.reason ?? "Quantidade inválida");
      return;
    }
    setSaving(true);
    try {
      await withdraw({
        productId: row.productId as Id<"products">,
        quantity: qty,
        secretariaId: (secretariaId || undefined) as Id<"organizations"> | undefined,
        departamentoId: (departamentoId || undefined) as Id<"organizations"> | undefined,
        unidadeId: (unidadeId || undefined) as Id<"organizations"> | undefined,
        reason: reason || undefined,
        osNumber: osNumber || undefined,
        observation: observation || undefined,
      });
      toast.success(`Retirada registrada: ${qty} ${row.unitOfMeasure} — ${row.displayLabel}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na retirada");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Retirar suprimento</DialogTitle>
          <DialogDescription>
            {row.displayLabel} · unidade: {row.unitOfMeasure}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/40 p-3 text-center text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Estoque atual</p>
              <p className="font-semibold tabular-nums">{row.currentStock}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Solicitado</p>
              <p className={`font-semibold tabular-nums ${!check.ok ? "text-destructive" : ""}`}>{qty}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saldo após saída</p>
              <p className="font-semibold tabular-nums">{check.ok ? check.balanceAfter : "—"}</p>
            </div>
          </div>

          <div>
            <Label>Quantidade *</Label>
            <Input
              type="number" min={1} max={row.currentStock} value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-invalid={!check.ok}
            />
            {!check.ok && <p className="mt-1 text-xs text-destructive">{check.reason}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Secretaria</Label>
              <Select value={secretariaId} onValueChange={(v) => { setSecretariaId(v); setDepartamentoId(""); setUnidadeId(""); }}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {secretarias.map((o) => (
                    <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Departamento</Label>
              <Select value={departamentoId} onValueChange={(v) => { setDepartamentoId(v); setUnidadeId(""); }} disabled={!secretariaId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(orgs ?? []).filter((o) => o.parentId === secretariaId).map((o) => (
                    <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidade</Label>
              <Select value={unidadeId} onValueChange={setUnidadeId} disabled={!departamentoId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(orgs ?? []).filter((o) => o.parentId === departamentoId).map((o) => (
                    <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Motivo *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Reposição de impressora" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>O.S. (opcional)</Label>
              <Input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} />
            </div>
            <div>
              <Label>Observação</Label>
              <Input value={observation} onChange={(e) => setObservation(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !check.ok || !reason.trim()} className="gap-1.5">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Confirmar retirada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══ Aba CONSUMO MENSAL ════════════════════════════════════════════════════ */

type ConsumptionLine = {
  productId: string; productName: string; type: string; brand: string | null;
  unitOfMeasure: string; entries: number; exits: number; currentStock: number;
};
type ConsumptionData = {
  lines: ConsumptionLine[];
  byOrg: Array<{ orgName: string; productLabel: string; type: string; quantity: number }>;
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function ConsumoTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [exporting, setExporting] = useState(false);

  const consumption = useQuery(api.printSupplies.getMonthlyConsumption, { year, month }) as ConsumptionData | undefined;

  const exportXlsx = async () => {
    if (!consumption) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const header = ["Produto", "Tipo", "Marca", "Unidade", "Entradas", "Saídas (consumo)", "Saldo atual"];
      const body = consumption.lines.map((l) => [
        l.productName, l.type, l.brand ?? "—", l.unitOfMeasure, l.entries, l.exits, l.currentStock,
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [`Consumo de Suprimentos de Impressão — ${MONTHS[month - 1]}/${year}`],
        [], header, ...body,
      ]), "Consumo");

      const orgWs = XLSX.utils.aoa_to_sheet([
        ["Secretaria", "Produto / Tipo", "Quantidade consumida"],
        ...consumption.byOrg.map((o) => [o.orgName, `${o.productLabel} (${o.type})`, o.quantity]),
      ]);
      XLSX.utils.book_append_sheet(wb, orgWs, "Por Secretaria");

      XLSX.writeFile(wb, `consumo-suprimentos-${year}-${String(month).padStart(2, "0")}.xlsx`);
      toast.success("Planilha de consumo gerada");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label>Mês</Label>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Ano</Label>
          <Input
            type="number" value={year}
            onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
            className="w-24"
          />
        </div>
        <Button variant="outline" onClick={exportXlsx} disabled={!consumption?.lines.length || exporting} className="gap-1.5">
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Gerar planilha de consumo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead className="text-right">Entradas</TableHead>
              <TableHead className="text-right">Saídas</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(consumption?.lines ?? []).map((l) => (
              <TableRow key={l.productId}>
                <TableCell className="font-medium">{l.productName}</TableCell>
                <TableCell>{l.type}</TableCell>
                <TableCell className="text-muted-foreground">{l.brand ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{l.entries}</TableCell>
                <TableCell className="text-right tabular-nums">{l.exits}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{l.currentStock}</TableCell>
              </TableRow>
            ))}
            {(consumption?.lines.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {consumption === undefined ? "Carregando..." : "Sem movimentações de suprimentos neste mês."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Consumo por secretaria (entregas)</h3>
        <div className="rounded-lg border">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Secretaria</TableHead>
                <TableHead>Produto / Tipo</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(consumption?.byOrg ?? []).map((o, i) => (
                <TableRow key={`${o.orgName}-${o.productLabel}-${i}`}>
                  <TableCell className="font-medium">{o.orgName}</TableCell>
                  <TableCell>{o.productLabel} <span className="text-muted-foreground">({o.type})</span></TableCell>
                  <TableCell className="text-right tabular-nums">{o.quantity}</TableCell>
                </TableRow>
              ))}
              {(consumption?.byOrg.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    Sem entregas de suprimentos neste mês.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/* ═══ Aba REPOSIÇÃO ═════════════════════════════════════════════════════════ */

function ReposicaoTab() {
  const dashboard = useQuery(api.printSupplies.getSupplyDashboard) as DashboardData | undefined;
  const updateParams = useMutation(api.printSupplies.updateStockParameters);
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);

  const [editing, setEditing] = useState<SupplyRow | null>(null);
  const [minVal, setMinVal] = useState("");
  const [idealVal, setIdealVal] = useState("");

  const reorder = (dashboard?.rows ?? []).filter((r) => r.status !== "Normal");

  const submitParams = async () => {
    if (!editing) return;
    try {
      await updateParams({
        productId: editing.productId as Id<"products">,
        minimumStock: minVal === "" ? undefined : Number(minVal),
        idealStock: idealVal === "" ? undefined : Number(idealVal),
      });
      toast.success("Parâmetros atualizados");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar parâmetros");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Produtos com estoque igual ou abaixo do mínimo. A quantidade sugerida
        (ideal − atual) só aparece quando mínimo e ideal estão definidos.
      </p>
      <div className="rounded-lg border">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Estoque atual</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead className="text-right">Ideal</TableHead>
              <TableHead className="text-right">Quantidade sugerida</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reorder.map((r) => (
              <TableRow key={r.productId}>
                <TableCell className="font-medium">{r.displayLabel}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{r.currentStock}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.minimumStock != null && r.minimumStock > 0 ? r.minimumStock : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.idealStock != null && r.idealStock > 0 ? r.idealStock : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.suggestedReorder != null ? (
                    <strong>{r.suggestedReorder}</strong>
                  ) : (
                    <span className="text-xs text-muted-foreground">Parâmetros não definidos</span>
                  )}
                </TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="text-right">
                  {permissions.canManageProducts ? (
                    <Button
                      variant="outline" size="sm" className="gap-1.5"
                      onClick={() => {
                        setEditing(r);
                        setMinVal(r.minimumStock != null && r.minimumStock > 0 ? String(r.minimumStock) : "");
                        setIdealVal(r.idealStock != null && r.idealStock > 0 ? String(r.idealStock) : "");
                      }}
                    >
                      <Settings2 className="size-3.5" /> Parâmetros
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {reorder.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {dashboard === undefined ? "Carregando..." : "Nenhum item abaixo do mínimo."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Parâmetros de estoque</DialogTitle>
            <DialogDescription>{editing?.displayLabel}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label>Estoque mínimo</Label>
              <Input type="number" min={0} value={minVal} onChange={(e) => setMinVal(e.target.value)} placeholder="—" />
            </div>
            <div>
              <Label>Estoque ideal</Label>
              <Input type="number" min={0} value={idealVal} onChange={(e) => setIdealVal(e.target.value)} placeholder="—" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={submitParams}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══ Aba LOGÍSTICA REVERSA (funcionalidades GomaQ existentes) ══════════════ */

type Exchange = {
  _id: string; exchangeNumber: string; productId: string;
  quantityDelivered: number; quantityEmptyReceived: number; exchangedAt: number;
};
type Cartridge = {
  _id: string; productId: string; quantity: number;
  status: "awaiting_collection" | "collected"; generatedAt: number;
};
type Collection = {
  _id: string; collectionNumber: string; collectedAt: number; items?: Array<{ productLabel?: string; quantity?: number }>;
};
type OrderItem = {
  productId: string; productName: string; brand?: string | null;
  availableQuantity: number; idealStock?: number; suggestedQuantity: number;
};

function ReversaTab() {
  const exchanges = useQuery(api.gomaQ.listExchanges, {}) as Exchange[] | undefined;
  const cartridges = useQuery(api.gomaQ.listEmptyCartridges, {}) as Cartridge[] | undefined;
  const collections = useQuery(api.gomaQ.listCollections, {}) as Collection[] | undefined;
  const order = useQuery(api.gomaQ.monthlyOrder, {}) as OrderItem[] | undefined;
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);

  const awaiting = (cartridges ?? []).filter((c) => c.status === "awaiting_collection").length;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const exchangesThisMonth = (exchanges ?? []).filter((e) => e.exchangedAt >= monthStart).length;

  const exportOrder = async () => {
    if (!order) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Pedido mensal de suprimentos — Gerado em " + new Date().toLocaleDateString("pt-BR")],
      [],
      ["Produto", "Marca", "Disponível", "Ideal", "Quantidade sugerida"],
      ...order.map((i) => [i.productName, i.brand ?? "—", i.availableQuantity, i.idealStock ?? 0, i.suggestedQuantity]),
    ]), "Pedido");
    XLSX.writeFile(wb, `pedido-suprimentos-${new Date().toISOString().slice(0, 7)}.xlsx`);
    toast.success("Pedido mensal exportado");
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Carcaças p/ coleta" value={awaiting} />
        <Card label="Trocas no mês" value={exchangesThisMonth} />
        <Card label="Coletas registradas" value={collections?.length ?? 0} />
        <Card label="Itens no pedido" value={order?.length ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <RefreshCcw className="size-4 text-muted-foreground" /> Últimas trocas
          </h3>
          <div className="space-y-1.5">
            {(exchanges ?? []).slice(0, 6).map((e) => (
              <div key={e._id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{e.exchangeNumber}</span>
                <span className="tabular-nums">{e.quantityDelivered} entregue(s) · {e.quantityEmptyReceived} carcaça(s)</span>
              </div>
            ))}
            {(exchanges ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Sem trocas registradas.</p>
            )}
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Truck className="size-4 text-muted-foreground" /> Últimas coletas
          </h3>
          <div className="space-y-1.5">
            {(collections ?? []).slice(0, 6).map((c) => (
              <div key={c._id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{c.collectionNumber}</span>
                <span>{new Date(c.collectedAt).toLocaleDateString("pt-BR")}</span>
              </div>
            ))}
            {(collections ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Sem coletas registradas.</p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <ShoppingCart className="size-4 text-muted-foreground" /> Pedido mensal
          </h3>
          {permissions.canManageGomaQ && (
            <Button variant="outline" size="sm" onClick={exportOrder} disabled={!order?.length} className="gap-1.5">
              <Download className="size-3.5" /> Exportar
            </Button>
          )}
        </div>
        <div className="rounded-lg border">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead className="text-right">Ideal</TableHead>
                <TableHead className="text-right">Sugerido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order ?? []).map((i) => (
                <TableRow key={i.productId}>
                  <TableCell className="font-medium">{i.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{i.brand ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.availableQuantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.idealStock ?? 0}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{i.suggestedQuantity}</TableCell>
                </TableRow>
              ))}
              {(order ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Sem itens no pedido mensal.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

/* ═══ Página ════════════════════════════════════════════════════════════════ */

export default function GomaQPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Printer className="size-5 text-primary" />
              Gestão de Suprimentos de Impressão
            </h1>
            <p className="text-sm text-muted-foreground">
              Controle de estoque, consumo, retiradas e abastecimento
            </p>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <ArrowLeftRight className="size-3.5" /> Área: Impressoras
          </Badge>
        </div>

        <Tabs defaultValue="estoque">
          <TabsList className="flex-wrap">
            <TabsTrigger value="estoque">Estoque</TabsTrigger>
            <TabsTrigger value="consumo">Consumo Mensal</TabsTrigger>
            <TabsTrigger value="reposicao">Reposição</TabsTrigger>
            <TabsTrigger value="reversa">Logística Reversa</TabsTrigger>
          </TabsList>
          <TabsContent value="estoque"><EstoqueTab /></TabsContent>
          <TabsContent value="consumo"><ConsumoTab /></TabsContent>
          <TabsContent value="reposicao"><ReposicaoTab /></TabsContent>
          <TabsContent value="reversa"><ReversaTab /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
