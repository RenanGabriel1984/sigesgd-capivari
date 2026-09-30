/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE ESTOQUE (/stock-parameters).
 *
 * Tela de PARÂMETROS OPERACIONAIS — separada de tudo o que é HISTÓRICO:
 *
 *   aba "Parâmetros"  → o que o gestor CONFIGURA: estoque mínimo, estoque ideal
 *                       e a participation no planejamento de reposição.
 *   aba "Consumo real" → o que o SISTEMA APONTA: consumo calculado exclusivamente
 *                       a partir das SAÍDAS registradas (nada é digitado aqui).
 *
 * REGRAS INEGOCIÁVEIS DESTA TELA:
 *  - os parâmetros NÃO são estoque: salvar grava apenas campos de
 *    parametrização + auditoria; nunca cria lote, entrada, saída, movimentação,
 *    reserva, solicitação de compra, fornecedor ou pedido;
 *  - "Participa do planejamento de reposição" é um OPT-IN: quando desligado o
 *    produto continua visível com sua situação, mas não entra em alertas;
 *  - "Consumo mensal" deixa de ser digitado: o consumo passa a ser CALCULADO
 *    pelas saídas reais. O valor antigo permanece no cadastro apenas como
 *    referência legada e não é exigido nem apagado;
 *  - campo vazio = "não parametrizado" (NÃO zero);
 *  - a edição em lote salva SOMENTE as linhas modificadas;
 *  - o saldo exibido é o real (físico − reservado), apenas para leitura.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Save, SlidersHorizontal, Loader2, Package, Info, History, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { getPermissions, type UserRole } from "@/types/constants";
import {
  draftFromParameters,
  draftFromInputs,
  diffParameterDraft,
  applyParameterFilters,
  computeParameterCounters,
  validateParameters,
  REPLENISHMENT_STATUS_BADGE,
  REPLENISHMENT_STATUS_LABELS,
  EMPTY_PARAMETER_FILTERS,
  type ParameterDraft,
  type ParameterFilters,
  type StockParameterRow,
} from "@/lib/stock-parameters";
import {
  CONSUMPTION_AUTO_NOTICE,
  REPLENISHMENT_PLANNING_HELP,
  REPLENISHMENT_PLANNING_LABEL,
  REPLENISHMENT_PLANNING_ONLY_NOTE,
  REPLENISHMENT_SITUATION_LABELS,
  applyReplenishmentAlertFilter,
  buildReplenishmentAlertRows,
  computeReplenishmentCounters,
  readReplenishmentAlertFilter,
  replenishmentAlertHref,
  type ReplenishmentAlertFilter,
} from "@/lib/replenishment";
import { CONSUMPTION_PERIODS, type ConsumptionPeriodKey } from "@/lib/consumption-history";
import { COST_UNAVAILABLE_LABEL } from "@/lib/consumption-organization";

/** Campos digitáveis na linha. O consumo NÃO é digitado (é calculado). */
type RowInputs = { minimum: string; ideal: string; enabled: boolean; note: string };

type ParametersData = {
  rows: StockParameterRow[];
  counters: ReturnType<typeof computeParameterCounters>;
  categoryNames: string[];
  areaNames: string[];
};

type ConsumptionData = {
  period: string;
  periodLabel: string;
  summaries: Array<{
    productId: string;
    productName: string;
    baseUnit: string;
    quantity: number;
    exitCount: number;
    monthlyAverage: number;
    lastExitAt: number | null;
    firstExitAt: number | null;
    hasHistory: boolean;
    statusLabel: string;
  }>;
  totalQuantity: number;
  totalExits: number;
  withoutHistory: boolean;
};

type OrganizationData = {
  bySecretaria: Array<{ label: string; quantity: number; exitCount: number; costLabel: string }>;
  byDepartment: Array<{ label: string; quantity: number; exitCount: number; costLabel: string }>;
  byUnit: Array<{ label: string; quantity: number; exitCount: number; costLabel: string }>;
  byProduct: Array<{ label: string; quantity: number; exitCount: number; costLabel: string }>;
  costLabel: string;
  withoutHistory: boolean;
  note: string;
};

const ALL_OPTION = "__all__";

/** Converte `null` (não parametrizado) em string vazia para o input. */
const toInput = (value: number | null): string => (value === null ? "" : String(value));

const formatDate = (timestamp: number | null): string =>
  timestamp === null
    ? "—"
    : new Date(timestamp).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function ParametersSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 max-w-md" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </AppShell>
  );
}

export default function StockParameters() {
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);
  // O botão some sem a permissão — mas quem AUTORIZA é o backend.
  const canEdit = permissions.canManageStockParameters;

  const [searchParams, setSearchParams] = useSearchParams();
  const alertFilter = readReplenishmentAlertFilter(window.location.search);
  const [period, setPeriod] = useState<ConsumptionPeriodKey>("30d");

  const data = useQuery(api.stockParameters.list) as ParametersData | undefined;
  const consumption = useQuery(api.stockIntelligence.consumption, { period }) as ConsumptionData | undefined;
  const byOrganization = useQuery(api.stockIntelligence.consumptionByOrganization, { period }) as
    | OrganizationData
    | undefined;
  const updateMany = useMutation(api.stockParameters.updateMany);

  const [filters, setFilters] = useState<ParameterFilters>(EMPTY_PARAMETER_FILTERS);
  // Rascunho local por produto: só o que o operador digitou conta como mudança.
  const [drafts, setDrafts] = useState<Record<string, RowInputs>>({});
  const [saving, setSaving] = useState(false);

  const setFilter = <K extends keyof ParameterFilters>(key: K, value: ParameterFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => applyParameterFilters(rows, filters), [rows, filters]);
  const counters = useMemo(() => computeParameterCounters(rows), [rows]);

  // Planejamento: mesmo conjunto de dados, leitura de ALERTA (respeita o opt-in).
  const alertRows = useMemo(() => buildReplenishmentAlertRows(rows), [rows]);
  const planningCounters = useMemo(() => computeReplenishmentCounters(alertRows), [alertRows]);
  const visibleRows = useMemo(() => {
    if (alertFilter === "all") return filtered;
    const allowed = new Set(applyReplenishmentAlertFilter(alertRows, alertFilter).map((r) => r.productId));
    return filtered.filter((row) => allowed.has(row.productId));
  }, [alertRows, alertFilter, filtered]);

  const consumptionByProduct = useMemo(
    () => new Map((consumption?.summaries ?? []).map((s) => [s.productId, s])),
    [consumption]
  );

  const draftFor = (row: StockParameterRow): RowInputs =>
    drafts[row.productId] ?? {
      minimum: toInput(row.parameters.minimumStock),
      ideal: toInput(row.parameters.idealStock),
      enabled: row.parameters.replenishmentEnabled,
      note: row.parameters.replenishmentNote ?? "",
    };

  /**
   * Rascunho efetivo de cada linha visível, comparado com o valor SALVO.
   * Só as diferenças entram na mutation — é o "salvar somente o que mudou".
   */
  const pending = useMemo(() => {
    const result: Array<{ productId: string; changes: ReturnType<typeof diffParameterDraft>; draft: ParameterDraft }> = [];
    for (const row of rows) {
      const input = drafts[row.productId];
      if (!input) continue;
      const draft = draftFromInputs(input, row.parameters);
      const changes = diffParameterDraft(row.productId, draftFromParameters(row.parameters), draft);
      if (changes.length > 0) result.push({ productId: row.productId, changes, draft });
    }
    return result;
  }, [drafts, rows]);

  const pendingById = useMemo(() => {
    const map = new Map<string, ParameterDraft>();
    for (const p of pending) map.set(p.productId, p.draft);
    return map;
  }, [pending]);

  const setAlertFilter = (value: ReplenishmentAlertFilter) => {
    if (value === "all") {
      searchParams.delete("situacao");
    } else {
      searchParams.set("situacao", value);
    }
    setSearchParams(searchParams, { replace: true });
  };

  const save = async () => {
    if (pending.length === 0) return;
    setSaving(true);
    try {
      const result = await updateMany({
        updates: pending.map((p) => ({
          productId: p.productId as never,
          minimumStock: p.draft.minimumStock,
          idealStock: p.draft.idealStock,
          // Legado: mantém o valor já cadastrado (nunca exigido, nunca apagado
          // automaticamente) e nunca o substitui pelo consumo calculado.
          monthlyConsumptionTarget: p.draft.monthlyConsumptionTarget,
          replenishmentEnabled: p.draft.replenishmentEnabled,
          replenishmentNote: p.draft.replenishmentNote,
        })),
      });
      // Só o que foi de fato salvo deixa de ser "pendente".
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of pending) delete next[p.productId];
        return next;
      });
      toast.success(
        `Parâmetros salvos: ${result.updated} produto(s). Nenhuma movimentação de estoque foi registrada.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar parâmetros");
    } finally {
      setSaving(false);
    }
  };

  if (data === undefined) return <ParametersSkeleton />;

  return (
    <AppShell>
      <div className="space-y-5 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Parametrização de Estoque</h1>
            <p className="text-sm text-muted-foreground">
              Parâmetros operacionais de mínimo e ideal e participação no planejamento de reposição — o consumo é calculado pelo sistema, não digitado.
            </p>
          </div>
          {canEdit && (
            <Button
              onClick={save}
              disabled={saving || pending.length === 0}
              className="gap-1.5 shrink-0"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar alterações
              {pending.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">{pending.length}</Badge>
              )}
            </Button>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Campo em branco significa <strong>não parametrizado</strong> — que é diferente de zero.
            Salvar grava apenas parâmetros e gera auditoria; <strong>nunca</strong> cria lote,
            entrada, saída, movimentação, reserva, solicitação de compra ou pedido. Mínimo e ideal
            são sempre na <strong>unidade base</strong> — a embalagem é apenas apresentação.
          </p>
        </div>

        <Tabs defaultValue="parametros">
          <TabsList>
            <TabsTrigger value="parametros" className="gap-1.5">
              <SlidersHorizontal className="h-4 w-4" /> Parâmetros
            </TabsTrigger>
            <TabsTrigger value="consumo" className="gap-1.5">
              <History className="h-4 w-4" /> Consumo real
            </TabsTrigger>
          </TabsList>

          {/* ══════════════ ABA PARÂMETROS ══════════════ */}
          <TabsContent value="parametros" className="mt-4 space-y-4">
            {/* Texto de ajuda do campo booleano de planejamento */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
              <p className="font-medium text-amber-900">{REPLENISHMENT_PLANNING_LABEL}</p>
              <p className="text-amber-900/90">{REPLENISHMENT_PLANNING_HELP}</p>
              <p className="mt-1 text-xs text-amber-800/80">{REPLENISHMENT_PLANNING_ONLY_NOTE}</p>
            </div>

            {/* Contadores — dinâmicos, sobre a base inteira (não só o filtro). */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Counter label="Produtos" value={counters.total} />
              <Counter label="Parametrizados" value={counters.parametrized} tone="emerald" />
              <Counter label="Não parametrizados" value={counters.notParametrized} tone="slate" />
              <Counter label="Reposição necessária" value={planningCounters.necessary} tone="rose" />
              <Counter label="Reposição sugerida" value={planningCounters.suggested} tone="amber" />
            </div>

            {alertFilter !== "all" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
                <TriangleAlert className="size-4 text-primary" />
                <span>
                  Visão filtrada: <strong>{REPLENISHMENT_SITUATION_LABELS[alertFilter === "necessary" ? "replenish_required" : alertFilter === "suggested" ? "replenish_suggested" : "replenish_required"]}</strong>
                  {alertFilter === "without_planning" && " (sem planejamento ativo)"}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setAlertFilter("all")}>
                  Ver todos
                </Button>
              </div>
            )}

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Buscar produto..."
                value={filters.search}
                onChange={(e) => setFilter("search", e.target.value)}
                className="h-9 w-full sm:w-56"
              />
              <Select value={filters.categoryName ?? ALL_OPTION} onValueChange={(v) => setFilter("categoryName", v === ALL_OPTION ? null : v)}>
                <SelectTrigger className="h-9 w-full sm:w-48"><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_OPTION}>Todas as categorias</SelectItem>
                  {data.categoryNames.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={filters.areaName ?? ALL_OPTION} onValueChange={(v) => setFilter("areaName", v === ALL_OPTION ? null : v)}>
                <SelectTrigger className="h-9 w-full sm:w-48"><SelectValue placeholder="Área" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_OPTION}>Todas as áreas</SelectItem>
                  {data.areaNames.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
                </SelectContent>
              </Select>
              <FilterChip active={filters.onlyUnparametrized} onClick={() => setFilter("onlyUnparametrized", !filters.onlyUnparametrized)}>
                Somente não parametrizados
              </FilterChip>
              <FilterChip active={filters.onlyBelowMinimum} onClick={() => setFilter("onlyBelowMinimum", !filters.onlyBelowMinimum)}>
                Somente abaixo do mínimo
              </FilterChip>
              <FilterChip active={filters.onlyReplenishmentEnabled} onClick={() => setFilter("onlyReplenishmentEnabled", !filters.onlyReplenishmentEnabled)}>
                No planejamento de reposição
              </FilterChip>
            </div>

            <Card className="border-border/50">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[1180px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Produto</TableHead>
                        <TableHead className="text-xs">Categoria</TableHead>
                        <TableHead className="text-xs">Área</TableHead>
                        <TableHead className="text-xs text-right">Estoque disponível</TableHead>
                        <TableHead className="text-xs text-center">Mínimo</TableHead>
                        <TableHead className="text-xs text-center">Ideal</TableHead>
                        <TableHead className="text-xs text-center">
                          Participa do planejamento
                        </TableHead>
                        <TableHead className="text-xs">Situação</TableHead>
                        <TableHead className="text-xs text-center">Consumo (30d)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map((row) => {
                        const draft = draftFor(row);
                        const dirty = pendingById.has(row.productId);
                        const warning = validateParameters(draftFromInputs(draft, row.parameters));
                        const consumptionSummary = consumptionByProduct.get(row.productId);
                        return (
                          <TableRow key={row.productId} className={dirty ? "bg-amber-50/40" : undefined}>
                            <TableCell>
                              <p className="text-sm font-medium">{row.productName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {row.physicalStock} físico{row.reservedStock > 0 ? ` · ${row.reservedStock} reservado` : ""}
                              </p>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{row.categoryName ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{row.areaName ?? "—"}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {row.availableStock} {row.baseUnit}
                              {row.suggestedQuantity > 0 && (
                                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                  (sug. {row.suggestedQuantity})
                                </span>
                              )}
                              {/* Embalagem: camada auxiliar, NUNCA substitui a base. */}
                              {row.equivalentLabel && (
                                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                  {row.equivalentLabel}
                                </span>
                              )}
                            </TableCell>

                            {canEdit ? (
                              <>
                                <TableCell>
                                  <Input
                                    type="number" min={0} aria-label="Estoque mínimo"
                                    placeholder="—"
                                    className="h-8 w-20 text-center"
                                    value={draft.minimum}
                                    onChange={(e) => setDraftInput(row.productId, { minimum: e.target.value })}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number" min={0} aria-label="Estoque ideal"
                                    placeholder="—"
                                    className="h-8 w-20 text-center"
                                    value={draft.ideal}
                                    onChange={(e) => setDraftInput(row.productId, { ideal: e.target.value })}
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  <Checkbox
                                    aria-label={REPLENISHMENT_PLANNING_LABEL}
                                    checked={draft.enabled}
                                    onCheckedChange={(c) => setDraftInput(row.productId, { enabled: c === true })}
                                  />
                                  {draft.note !== "" && (
                                    <Input
                                      aria-label="Observação da reposição"
                                      placeholder="Observação…"
                                      className="mt-1 h-7 w-32 text-[10px]"
                                      value={draft.note}
                                      onChange={(e) => setDraftInput(row.productId, { note: e.target.value })}
                                    />
                                  )}
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-center tabular-nums">{row.parameters.minimumStock ?? "—"}</TableCell>
                                <TableCell className="text-center tabular-nums">{row.parameters.idealStock ?? "—"}</TableCell>
                                <TableCell className="text-center">
                                  {row.parameters.replenishmentEnabled ? "Sim" : "Não"}
                                  {row.parameters.replenishmentNote && (
                                    <p className="text-[10px] text-muted-foreground">{row.parameters.replenishmentNote}</p>
                                  )}
                                </TableCell>
                              </>
                            )}

                            <TableCell>
                              <Badge className={`text-[10px] ${REPLENISHMENT_STATUS_BADGE[row.status]}`}>
                                {REPLENISHMENT_STATUS_LABELS[row.status]}
                              </Badge>
                              {row.parameters.replenishmentEnabled && row.status !== "normal" && (
                                <p className="mt-1 text-[10px] text-primary">
                                  {row.status === "replenish_required" ? "No planejamento" : "Planejamento sugerido"}
                                </p>
                              )}
                              {!row.parameters.replenishmentEnabled && row.status === "replenish_required" && (
                                <p className="mt-1 text-[10px] text-muted-foreground">Fora do planejamento</p>
                              )}
                              {warning && (
                                <p className="mt-1 text-[10px] text-amber-700">{warning}</p>
                              )}
                            </TableCell>

                            {/* Consumo: NUNCA digitado, sempre calculado das saídas. */}
                            <TableCell className="text-center text-xs">
                              {consumptionSummary ? (
                                <span className="tabular-nums">
                                  {consumptionSummary.quantity} {consumptionSummary.baseUnit}
                                  <span className="block text-[10px] text-muted-foreground">
                                    {consumptionSummary.exitCount} saída{consumptionSummary.exitCount === 1 ? "" : "s"}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">Sem histórico suficiente</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {visibleRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="py-10 text-center">
                            <div className="empty-state">
                              <Package className="empty-state-icon" />
                              <p className="empty-state-title">Nenhum produto corresponde aos filtros</p>
                              <p className="empty-state-desc">Ajuste a busca ou limpe os filtros.</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />
              A necessidade até o ideal é <code className="font-mono">max(ideal − disponível, 0)</code> — informativa.
              Ela não cria pedido, não reserva e não movimenta estoque.
            </p>
          </TabsContent>

          {/* ══════════════ ABA CONSUMO REAL ══════════════ */}
          <TabsContent value="consumo" className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground max-w-2xl">
                Consumo calculado <strong>exclusivamente</strong> a partir das movimentações de SAÍDA
                registradas no SIGESGD. Entradas, transferências, ajustes e devoluções não contam como consumo.
              </p>
              <Select value={period} onValueChange={(v) => setPeriod(v as ConsumptionPeriodKey)}>
                <SelectTrigger className="h-9 w-full sm:w-56">
                  <SelectValue placeholder="Período" />
                </SelectTrigger>
                <SelectContent>
                  {CONSUMPTION_PERIODS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {CONSUMPTION_AUTO_NOTICE} Nenhum valor é estimado: sem saídas reais no período, a
              tela informa <strong>"Sem histórico suficiente"</strong> em vez de mostrar zero.
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Counter label="Saídas no período" value={consumption?.totalExits ?? 0} />
              <Counter
                label="Consumo total"
                value={consumption?.withoutHistory === false ? (consumption?.totalQuantity ?? 0) : 0}
                tone="emerald"
              />
              <Counter label="Período" value={CONSUMPTION_PERIODS.find((p) => p.key === period)?.months ?? 0} tone="slate" />
            </div>

            {consumption?.withoutHistory ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Sem histórico suficiente — aguardando movimentações de saída em {consumption.periodLabel.toLowerCase()}.
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border/50">
                <CardHeader className="pb-2"><CardTitle className="text-base">Consumo por produto</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-xs text-right">Consumido</TableHead>
                          <TableHead className="text-xs text-right">Saídas</TableHead>
                          <TableHead className="text-xs text-right">Média mensal</TableHead>
                          <TableHead className="text-xs">Última saída</TableHead>
                          <TableHead className="text-xs text-right">Custo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(consumption?.summaries ?? []).map((s) => (
                          <TableRow key={s.productId}>
                            <TableCell className="text-sm font-medium">{s.productName}</TableCell>
                            <TableCell className="text-right tabular-nums">{s.quantity} {s.baseUnit}</TableCell>
                            <TableCell className="text-right tabular-nums">{s.exitCount}</TableCell>
                            <TableCell className="text-right tabular-nums">{s.monthlyAverage}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(s.lastExitAt)}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{COST_UNAVAILABLE_LABEL}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <OrganizationList title="Por Secretaria" rows={byOrganization?.bySecretaria ?? []} />
              <OrganizationList title="Por Departamento" rows={byOrganization?.byDepartment ?? []} />
              <OrganizationList title="Por Unidade" rows={byOrganization?.byUnit ?? []} />
              <OrganizationList title="Por produto (consumo total)" rows={byOrganization?.byProduct ?? []} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );

  /** Atualiza o rascunho preservando os demais campos já digitados. */
  function setDraftInput(productId: string, patch: Partial<RowInputs>) {
    setDrafts((prev) => {
      const row = rows.find((r) => r.productId === productId);
      const base =
        prev[productId] ??
        (row
          ? {
              minimum: toInput(row.parameters.minimumStock),
              ideal: toInput(row.parameters.idealStock),
              enabled: row.parameters.replenishmentEnabled,
              note: row.parameters.replenishmentNote ?? "",
            }
          : { minimum: "", ideal: "", enabled: false, note: "" });
      return { ...prev, [productId]: { ...base, ...patch } };
    });
  }
}

function OrganizationList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; quantity: number; exitCount: number; costLabel: string }>;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Consumo {title.toLowerCase()}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            Sem histórico suficiente — aguardando movimentações.
          </p>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="tabular-nums font-medium">{row.quantity}</span>
                  <span className="text-[10px] text-muted-foreground">{row.costLabel}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600" :
    tone === "rose" ? "text-rose-600" :
    tone === "amber" ? "text-amber-600" :
    tone === "slate" ? "text-slate-600" : "";
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
