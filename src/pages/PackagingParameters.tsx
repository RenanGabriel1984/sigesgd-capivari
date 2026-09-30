/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE UNIDADES E EMBALAGENS
 * (/packaging-parameters).
 *
 * Tela ADMINISTRATIVA que cadastra a relação entre unidade base, unidade de
 * embalagem e fator de conversão:
 *
 *   1 caixa = 30 rolos   ← configuração cadastral
 *   estoque = 180 rolos  ← dado físico, SEMPRE na unidade base
 *
 * REGRAS DESTA TELA:
 *  - a quantidade em estoque NUNCA é convertida: a coluna "Estoque atual"
 *    mostra o saldo real; a conversão aparece só como "≈ 6 caixas";
 *  - a PRÉVIA antes de salvar é matemática ("185 rolos = 6 caixas + 5
 *    rolos") e nunca arredonda em silêncio;
 *  - salvar chama `packagingParameters.save`, que grava APENAS campos de
 *    embalagem do produto + auditoria `product_packaging_update`;
 *  - nada aqui cria lote, entrada, saída, movimentação ou reserva, nem altera
 *    a quantidade fiscal de NF-e;
 *  - a edição é individual nesta versão, mas o rascunho/diff já é a estrutura
 *    que sustentará a edição em lote futura (mesmos campos, mesma mutation).
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { Boxes, Info, Loader2, Package, Save, Search, SlidersHorizontal } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { getPermissions, type UserRole } from "@/types/constants";
import {
  EMPTY_PACKAGING_DRAFT,
  EMPTY_PACKAGING_FIELD,
  EMPTY_PACKAGING_FILTERS,
  PACKAGING_SCREEN_NOTICE,
  PACKAGING_STATUS_BADGE,
  PACKAGING_STATUS_LABELS,
  PACKAGING_UNITS,
  applyPackagingFilters,
  buildPackagingPreview,
  computePackagingCounters,
  diffPackagingDraft,
  draftFromSettings,
  normalizePackagingInput,
  pluralizeUnit,
  validatePackagingConfig,
  type PackagingDraft,
  type PackagingFilters,
  type PackagingRow,
  type PackagingStatus,
} from "@/lib/packaging-parameters";

type PackagingData = {
  rows: PackagingRow[];
  counters: ReturnType<typeof computePackagingCounters>;
  categoryNames: string[];
};

const ALL_OPTION = "__all__";
const STATUS_ALL = "todos";

function PackagingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 max-w-md" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </AppShell>
  );
}

export default function PackagingParametersPage() {
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);
  // O botão some sem a permissão — quem AUTORIZA é o backend.
  const canEdit = permissions.canManagePackagingParameters;

  const data = useQuery(api.packagingParameters.list) as PackagingData | undefined;
  const savePackaging = useMutation(api.packagingParameters.save);

  const [filters, setFilters] = useState<PackagingFilters>(EMPTY_PACKAGING_FILTERS);
  const [drafts, setDrafts] = useState<Record<string, PackagingDraft>>({});
  const [editing, setEditing] = useState<PackagingRow | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => applyPackagingFilters(rows, filters), [rows, filters]);
  const counters = useMemo(() => computePackagingCounters(rows), [rows]);

  const setFilter = <K extends keyof PackagingFilters>(key: K, value: PackagingFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const draftFor = (row: PackagingRow): PackagingDraft =>
    drafts[row.productId] ?? draftFromSettings(row.settings);

  // Rascunho do diálogo: começa a partir do que está SALVO.
  const [dialogDraft, setDialogDraft] = useState<PackagingDraft>(EMPTY_PACKAGING_DRAFT);
  const dialogValidation = validatePackagingConfig(dialogDraft);
  const dialogNormalized = normalizePackagingInput(dialogDraft);
  const dialogPreview = buildPackagingPreview({
    baseQuantity: editing?.availableStock ?? 0,
    baseUnit: dialogNormalized.baseUnit ?? editing?.unitOfMeasure ?? "un",
    conversion: dialogValidation.ok && dialogNormalized.conversionFactor
      ? {
          baseUnit: dialogNormalized.baseUnit ?? "un",
          packagingUnit: dialogNormalized.packagingUnit ?? "",
          factor: dialogNormalized.conversionFactor,
        }
      : null,
  });

  const openEditor = (row: PackagingRow) => {
    setEditing(row);
    setDialogDraft(draftFromSettings(row.settings));
  };

  const save = async () => {
    if (!editing || !dialogValidation.ok) return;
    setSaving(true);
    try {
      const result = await savePackaging({
        update: {
          productId: editing.productId as never,
          baseUnit: dialogNormalized.baseUnit,
          packagingUnit: dialogNormalized.packagingUnit,
          conversionFactor: dialogNormalized.conversionFactor,
        },
      });
      if (result.unchanged) {
        toast.info("Configuração já estava igual — nada foi gravado.");
      } else {
        toast.success(
          `Embalagem de "${editing.productName}" salva. O estoque continua em ` +
            `${editing.availableStock} ${dialogNormalized.baseUnit ?? editing.unitOfMeasure} — nenhuma movimentação foi registrada.`,
        );
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[editing.productId];
        return next;
      });
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar a embalagem");
    } finally {
      setSaving(false);
    }
  };

  if (data === undefined) return <PackagingSkeleton />;

  return (
    <AppShell>
      <div className="space-y-5 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Parametrização de Embalagens</h1>
            <p className="text-sm text-muted-foreground">
              Unidade base, unidade de embalagem e fator — camada auxiliar de apresentação.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{PACKAGING_SCREEN_NOTICE}</p>
        </div>

        {/* Contadores — dinâmicos, sobre a base inteira. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Counter label="Produtos" value={counters.total} />
          <Counter label="Configurados" value={counters.configurados} tone="emerald" />
          <Counter label="Não parametrizados" value={counters.naoParametrizados} tone="slate" />
          <Counter label="Incompletos" value={counters.incompletos} tone="amber" />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={filters.search}
              onChange={(e) => setFilter("search", e.target.value)}
              className="h-9 pl-8"
            />
          </div>
          <Select
            value={filters.categoryName ?? ALL_OPTION}
            onValueChange={(v) => setFilter("categoryName", v === ALL_OPTION ? null : v)}
          >
            <SelectTrigger className="h-9 w-full sm:w-52">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>Todas as categorias</SelectItem>
              {data.categoryNames.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.status}
            onValueChange={(v) => setFilter("status", v as PackagingFilters["status"])}
          >
            <SelectTrigger className="h-9 w-full sm:w-52">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STATUS_ALL}>Todos os status</SelectItem>
              <SelectItem value="configurado">{PACKAGING_STATUS_LABELS.configurado}</SelectItem>
              <SelectItem value="nao_parametrizado">{PACKAGING_STATUS_LABELS.nao_parametrizado}</SelectItem>
              <SelectItem value="incompleto">{PACKAGING_STATUS_LABELS.incompleto}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[1020px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Produto</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                    <TableHead className="text-xs text-right">Estoque atual</TableHead>
                    <TableHead className="text-xs">Unidade base</TableHead>
                    <TableHead className="text-xs">Unidade de embalagem</TableHead>
                    <TableHead className="text-xs text-center">Fator</TableHead>
                    <TableHead className="text-xs">Conversão</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    {canEdit && <TableHead className="text-xs text-right">Ação</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const draft = draftFor(row);
                    const dirty = drafts[row.productId] !== undefined;
                    const dirtyDiff = diffPackagingDraft(row.settings, draft);
                    return (
                      <TableRow key={row.productId} className={dirty ? "bg-amber-50/40" : undefined}>
                        <TableCell>
                          <p className="text-sm font-medium">{row.productName}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {row.physicalStock} físico{row.reservedStock > 0 ? ` · ${row.reservedStock} reservado` : ""}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.categoryName ?? EMPTY_PACKAGING_FIELD}
                        </TableCell>
                        <TableCell className="text-right">
                          <p className="font-semibold tabular-nums">
                            {row.availableStock} {row.preview?.baseUnit ?? row.unitOfMeasure}
                          </p>
                          {/* Equivalente em embalagens: auxiliar, nunca substitui a base. */}
                          {row.status === "configurado" && row.preview && (
                            <p className="text-[10px] text-muted-foreground">
                              {`≈ ${row.preview.packs} ${pluralizeUnit(row.preview.packagingUnit, row.preview.packs)}`}
                              {row.preview.remainder > 0 && ` + ${row.preview.remainder} ${row.preview.baseUnit}`}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.settings.baseUnit ?? row.unitOfMeasure}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.settings.packagingUnit ?? EMPTY_PACKAGING_FIELD}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.settings.conversionFactor ?? EMPTY_PACKAGING_FIELD}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.conversionLabel}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${PACKAGING_STATUS_BADGE[row.status]}`}>
                            {PACKAGING_STATUS_LABELS[row.status]}
                          </Badge>
                          {dirty && dirtyDiff.length > 0 && (
                            <p className="mt-1 text-[10px] text-amber-700">alteração não salva</p>
                          )}
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEditor(row)}>
                              <SlidersHorizontal className="size-3.5" />
                              Parametrizar
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canEdit ? 9 : 8} className="py-10 text-center">
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
          <Boxes className="size-3.5" />
          A embalagem é apenas forma alternativa de apresentação. A unidade oficial do estoque — e a
          dos parâmetros de mínimo/ideal em <code className="font-mono">/stock-parameters</code> —
          continua sendo a <strong>unidade base</strong>.
        </p>

        {/* ── Edição individual (com prévia antes de salvar) ── */}
        <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Parametrização de embalagem</DialogTitle>
              <DialogDescription>
                {editing?.productName} — {editing?.availableStock}{" "}
                {editing?.preview?.baseUnit ?? editing?.unitOfMeasure} em estoque. Salvar não altera
                essa quantidade.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Unidade base *</p>
                  <Select
                    value={dialogDraft.baseUnit || "__none__"}
                    onValueChange={(v) =>
                      setDialogDraft((d) => ({ ...d, baseUnit: v === "__none__" ? "" : v }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{EMPTY_PACKAGING_FIELD}</SelectItem>
                      {PACKAGING_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Unidade de embalagem</p>
                  <Select
                    value={dialogDraft.packagingUnit || "__none__"}
                    onValueChange={(v) =>
                      setDialogDraft((d) => ({ ...d, packagingUnit: v === "__none__" ? "" : v }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{EMPTY_PACKAGING_FIELD}</SelectItem>
                      {PACKAGING_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Fator de conversão</p>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Quantas unidades-base cabem em 1 embalagem"
                  value={dialogDraft.conversionFactor}
                  onChange={(e) =>
                    setDialogDraft((d) => ({ ...d, conversionFactor: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Inteiro positivo, mínimo 1. Ex.: 30 ⇒ 1 caixa = 30 rolos.
                </p>
              </div>

              {/* Conversão configurada */}
              {dialogValidation.ok && dialogPreview && (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  {dialogNormalized.conversionFactor
                    ? `1 ${dialogNormalized.packagingUnit} = ${dialogNormalized.conversionFactor} ${pluralizeUnit(dialogNormalized.baseUnit ?? "un", dialogNormalized.conversionFactor)}`
                    : "Sem conversão configurada — o estoque é exibido apenas na unidade base."}
                </div>
              )}

              {/* Prévia do estoque atual — matemática, não altera nada */}
              {dialogPreview && dialogNormalized.conversionFactor && (
                <div className="rounded-lg border border-[var(--capivari-green)]/20 bg-[var(--capivari-green)]/5 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--capivari-green)]">
                    Prévia
                  </p>
                  <p className="mt-0.5 text-sm font-medium tabular-nums">{dialogPreview.text}</p>
                  {!dialogPreview.exact && (
                    <p className="text-[11px] text-muted-foreground">
                      Divisão não exata: as {dialogPreview.remainder} {dialogPreview.baseUnit}s
                      restantes ficam avulsas — nada é arredondado.
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    O estoque permanece em {editing?.availableStock}{" "}
                    {dialogPreview.baseUnit} — a embalagem é só apresentação.
                  </p>
                </div>
              )}

              {!dialogValidation.ok && (
                <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {dialogValidation.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={save} disabled={!dialogValidation.ok || saving} className="gap-1.5">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Salvar configuração
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600" :
    tone === "slate" ? "text-slate-600" :
    tone === "amber" ? "text-amber-600" :
    "";
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}
