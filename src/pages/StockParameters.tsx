/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE ESTOQUE (/stock-parameters).
 *
 * Planilha OPERACIONAL de parâmetros de reposição. Os campos Mínimo, Ideal e
 * Consumo mensal são editáveis direto na tabela — sem obrigar o operador a
 * abrir o cadastro de cada produto.
 *
 * REGRAS DESTA TELA:
 *  - os parâmetros NÃO são estoque: nada aqui cria lote, movimentação,
 *    entrada, saída ou reserva. Salvar chama `stockParameters.updateMany`,
 *    que grava apenas campos de parametrização + auditoria;
 *  - campo vazio = "não parametrizado" (NÃO zero);
 *  - a edição em lote salva SOMENTE as linhas modificadas;
 *  - o saldo exibido é o real (físico − reservado), apenas para leitura.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { Save, SlidersHorizontal, Loader2, Package, Info } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

type RowInputs = { minimum: string; ideal: string; monthly: string; enabled: boolean; note: string };

type ParametersData = {
  rows: StockParameterRow[];
  counters: ReturnType<typeof computeParameterCounters>;
  categoryNames: string[];
  areaNames: string[];
};

const ALL_OPTION = "__all__";

/** Converte `null` (não parametrizado) em string vazia para o input. */
const toInput = (value: number | null): string => (value === null ? "" : String(value));

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

  const data = useQuery(api.stockParameters.list) as ParametersData | undefined;
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

  const draftFor = (row: StockParameterRow): RowInputs =>
    drafts[row.productId] ?? {
      minimum: toInput(row.parameters.minimumStock),
      ideal: toInput(row.parameters.idealStock),
      monthly: toInput(row.parameters.monthlyConsumptionTarget),
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
      const draft = draftFromInputs(input);
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

  const save = async () => {
    if (pending.length === 0) return;
    setSaving(true);
    try {
      const result = await updateMany({
        updates: pending.map((p) => ({
          productId: p.productId as never,
          minimumStock: p.draft.minimumStock,
          idealStock: p.draft.idealStock,
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
              Mínimo, ideal e consumo mensal de TODOS os produtos — parâmetros de planejamento, não de saldo.
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
            entrada, saída, movimentação ou reserva.
          </p>
        </div>

        {/* Contadores — dinâmicos, sobre a base inteira (não só o filtro). */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Counter label="Produtos" value={counters.total} />
          <Counter label="Parametrizados" value={counters.parametrized} tone="emerald" />
          <Counter label="Não parametrizados" value={counters.notParametrized} tone="slate" />
          <Counter label="Reposição necessária" value={counters.needsReplenishment} tone="rose" />
        </div>

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
            Com reposição habilitada
          </FilterChip>
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Produto</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                    <TableHead className="text-xs">Área</TableHead>
                    <TableHead className="text-xs text-right">Estoque disponível</TableHead>
                    <TableHead className="text-xs text-center">Mínimo</TableHead>
                    <TableHead className="text-xs text-center">Ideal</TableHead>
                    <TableHead className="text-xs text-center">Consumo mensal</TableHead>
                    <TableHead className="text-xs text-center">Reposição</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const draft = draftFor(row);
                    const dirty = pendingById.has(row.productId);
                    const warning = validateParameters(draftFromInputs(draft));
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
                          {row.availableStock}
                          {row.suggestedQuantity > 0 && (
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                              (sug. {row.suggestedQuantity})
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
                            <TableCell>
                              <Input
                                type="number" min={0} aria-label="Consumo mensal"
                                placeholder="—"
                                className="h-8 w-20 text-center"
                                value={draft.monthly}
                                onChange={(e) => setDraftInput(row.productId, { monthly: e.target.value })}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                aria-label="Reposição habilitada"
                                checked={draft.enabled}
                                onCheckedChange={(c) => setDraftInput(row.productId, { enabled: c === true })}
                              />
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-center tabular-nums">{row.parameters.minimumStock ?? "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{row.parameters.idealStock ?? "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{row.parameters.monthlyConsumptionTarget ?? "—"}</TableCell>
                            <TableCell className="text-center">{row.parameters.replenishmentEnabled ? "Sim" : "—"}</TableCell>
                          </>
                        )}

                        <TableCell>
                          <Badge className={`text-[10px] ${REPLENISHMENT_STATUS_BADGE[row.status]}`}>
                            {REPLENISHMENT_STATUS_LABELS[row.status]}
                          </Badge>
                          {warning && (
                            <p className="mt-1 text-[10px] text-amber-700">{warning}</p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
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
          A sugestão é <code className="font-mono">max(ideal − disponível, 0)</code> — informativa.
          Ela não cria pedido, não reserva e não movimenta estoque.
        </p>
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
              monthly: toInput(row.parameters.monthlyConsumptionTarget),
              enabled: row.parameters.replenishmentEnabled,
              note: row.parameters.replenishmentNote ?? "",
            }
          : { minimum: "", ideal: "", monthly: "", enabled: false, note: "" });
      return { ...prev, [productId]: { ...base, ...patch } };
    });
  }
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600" :
    tone === "rose" ? "text-rose-600" :
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
