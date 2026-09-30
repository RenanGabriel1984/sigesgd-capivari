import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router";
import {
  Package,
  TrendingDown,
  ClipboardList,
  ArrowUpRight,
  AlertTriangle,
  BarChart3,
  Plus,
  FileBarChart,
  Truck,
  Wrench,
  Key,
  ClipboardCheck,
  SlidersHorizontal,
} from "lucide-react";
import { getPermissions, ROLE_LABELS } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import { useEffect, lazy, Suspense, useMemo } from "react";
import {
  REPLENISHMENT_ALERT_NOTICE,
  replenishmentAlertHref,
  type ReplenishmentAlertRow,
} from "@/lib/replenishment";

/** Visão de planejamento usada nos cards e na listagem de alerta. */
type ReplenishmentData = {
  rows: ReplenishmentAlertRow[];
  counters: {
    necessary: number;
    suggested: number;
    participating: number;
    belowMinimumWithoutPlanning: number;
    notParametrized: number;
  };
};

/** Quantidade de linhas exibidas na listagem de alerta do Dashboard. */
const ALERT_LIST_LIMIT = 15;

const CARD_TONES: Record<string, string> = {
  rose: "bg-rose-50 text-rose-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  slate: "bg-slate-100 text-slate-600",
};

/**
 * Card de contagem do planejamento de reposição. O clique leva à visão FILTRADA
 * da parametrização — o card apenas navega, não altera nenhum dado.
 */
function ReplenishmentCard({
  label,
  value,
  tone,
  hint,
  href,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "emerald" | "slate";
  hint: string;
  href: string;
}) {
  return (
    <Link to={href} className="group block">
      <Card className="h-full border-border/50 transition-colors group-hover:border-primary/50 group-hover:bg-primary/[0.03]">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", CARD_TONES[tone])}>
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3 },
};

const CHART_COLORS = ["#1a5632", "#5b9bd5", "#d97706", "#dc2626", "#7c3aed"];

/**
 * Lazy-load recharts to avoid "Failed to fetch dynamically imported module"
 * in Vite dev mode (recharts ships CommonJS and needs pre-bundling via
 * optimizeDeps, which is not always available in dev server chunks).
 */
const LazyBarChart = lazy(() =>
  import("recharts").then((m) => ({
    default: ({ data, colors }: { data: any[]; colors: string[] }) => (
      <m.ResponsiveContainer width="100%" height={220}>
        <m.BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <m.CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <m.XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={60}
          />
          <m.YAxis tick={{ fontSize: 11 }} />
          <m.Tooltip
            formatter={(value: number, name: string) => [value, name === "items" ? "Itens Recebidos" : "Pedidos"]}
            labelStyle={{ fontSize: 12 }}
          />
          <m.Bar dataKey="items" radius={[4, 4, 0, 0]} name="items">
            {data.map((_: any, idx: number) => (
              <m.Cell key={idx} fill={colors[idx % colors.length]} />
            ))}
          </m.Bar>
        </m.BarChart>
      </m.ResponsiveContainer>
    ),
  }))
);

export default function Dashboard() {
  const { user } = useAuth();
  const recordLogin = useMutation(api.users.recordLogin);
  const stats = useQuery(api.dashboard.stats);
  const navigate = useNavigate();

  const role = (user?.role ?? "technician") as UserRole;
  const permissions = getPermissions(role);

  // Record login timestamp on mount
  useEffect(() => {
    if (user?._id) recordLogin();
  }, [user?._id]);

  const s = stats;
  const loading = s === undefined;

  // ─── Planejamento de reposição (§3) ──────────────────────────────────────
  // O opt-in "Participa do planejamento de reposição" decide o que entra nos
  // alertas: produtos NÃO parametrizados e produtos com o opt-in desligado nunca
  // são contados. A query é somente leitura — nenhum saldo é tocado.
  const canViewPlanning = permissions.canViewStockParameters;
  const planning = useQuery(
    api.stockIntelligence.replenishment,
    canViewPlanning ? {} : "skip"
  ) as ReplenishmentData | undefined;

  const planningRows = useMemo<ReplenishmentAlertRow[]>(
    () => (planning?.rows ?? []).filter((r) => r.planningLevel !== null),
    [planning]
  );
  const necessaryCount = planning?.counters.necessary ?? 0;
  const suggestedCount = planning?.counters.suggested ?? 0;

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* ─── Hero institucional ─── */}
        <motion.div {...fadeIn}>
          <div className="relative overflow-hidden rounded-2xl bg-[var(--capivari-green-dark)] text-white">
            {/* Detalhe dourado institucional (faixa superior) */}
            <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-[var(--capivari-gold)]" />
            <div aria-hidden className="absolute -right-10 -bottom-16 h-48 w-48 rounded-full bg-white/5" />
            <div aria-hidden className="absolute right-16 -bottom-20 h-32 w-32 rounded-full bg-[var(--capivari-blue)]/20" />
            <div className="relative flex items-center gap-4 p-5 sm:p-7">
              <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 flex items-center justify-center rounded-xl bg-white/95 text-[var(--capivari-green-dark)] font-bold text-lg sm:text-xl shadow-sm ring-2 ring-[var(--capivari-gold)]/70">
                SG
              </div>
              <div className="min-w-0">
                <p className="text-xs text-white/70">Prefeitura Municipal de Capivari — SP</p>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-0.5">
                  Olá{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
                </h1>
                <p className="text-sm text-white/80 mt-0.5">Como podemos ajudar?</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ─── Tarefas principais ─── */}
        <motion.div {...fadeIn} transition={{ delay: 0.05 }}>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">O que você precisa fazer?</h2>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
            {permissions.canCreateEntries && (
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-2 p-4 rounded-xl border-2 border-[var(--capivari-green)]/30 hover:border-[var(--capivari-green)] hover:bg-[var(--capivari-green)]/5"
                onClick={() => navigate("/exit")}
              >
                <ArrowUpRight className="h-6 w-6 text-[var(--capivari-green)]" />
                <span className="font-semibold text-sm">Dar saída</span>
                <span className="text-[10px] text-muted-foreground font-normal">Retirar material do estoque</span>
              </Button>
            )}
            {permissions.canCreateEntries && (
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-2 p-4 rounded-xl border-2 border-blue-200 hover:border-blue-500 hover:bg-blue-50"
                onClick={() => navigate("/entries")}
              >
                <Plus className="h-6 w-6 text-blue-600" />
                <span className="font-semibold text-sm">Registrar entrada</span>
                <span className="text-[10px] text-muted-foreground font-normal">Material que chegou</span>
              </Button>
            )}
            {permissions.canCreateRequests && (
              <Button
                variant="outline"
                className="h-auto flex-col items-start gap-2 p-4 rounded-xl border-2 border-amber-200 hover:border-amber-500 hover:bg-amber-50"
                onClick={() => navigate("/requests")}
              >
                <ClipboardList className="h-6 w-6 text-amber-600" />
                <span className="font-semibold text-sm">Nova solicitação</span>
                <span className="text-[10px] text-muted-foreground font-normal">Pedir um material</span>
              </Button>
            )}
            <Button
              variant="outline"
              className="h-auto flex-col items-start gap-2 p-4 rounded-xl border-2 border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50"
              onClick={() => navigate("/stock")}
            >
              <Package className="h-6 w-6 text-emerald-600" />
              <span className="font-semibold text-sm">Consultar estoque</span>
              <span className="text-[10px] text-muted-foreground font-normal">Ver o que tem disponível</span>
            </Button>
          </div>
          {(permissions.canManageInventory || permissions.canViewMovements) && (
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 mt-3">
              {permissions.canManageInventory && (
                <Button variant="ghost" className="h-auto min-h-14 flex-col items-start gap-1 p-3 rounded-xl border text-left hover:bg-muted/50" onClick={() => navigate("/inventory")}>
                  <span className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 shrink-0 text-[var(--capivari-green)]" />
                    <span className="text-sm font-medium">Fazer inventário</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground text-left">Conferir estoque físico</span>
                </Button>
              )}
              {permissions.canViewMovements && (
                <Button variant="ghost" className="h-auto min-h-14 flex-col items-start gap-1 p-3 rounded-xl border text-left hover:bg-muted/50" onClick={() => navigate("/reports")}>
                  <span className="flex items-center gap-2">
                    <FileBarChart className="h-5 w-5 shrink-0 text-blue-600" />
                    <span className="text-sm font-medium">Relatórios</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground text-left">Consumo e movimentações</span>
                </Button>
              )}
            </div>
          )}
        </motion.div>

        {/* ─── Indicadores ─── */}
        <div className="pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Indicadores</h2>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <motion.div {...fadeIn} transition={{ delay: 0.05 }}>
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Package className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold">{loading ? "—" : s!.totalProducts}</p>
                      <p className="text-xs text-muted-foreground">Itens no Catálogo</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div {...fadeIn} transition={{ delay: 0.1 }}>
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold">{loading ? "—" : s!.criticalStock}</p>
                      <p className="text-xs text-muted-foreground">Estoque Crítico</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div {...fadeIn} transition={{ delay: 0.15 }}>
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <ClipboardList className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold">{loading ? "—" : s!.pendingThisMonth}</p>
                      <p className="text-xs text-muted-foreground">Solicitações Pendentes (Mês)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div {...fadeIn} transition={{ delay: 0.2 }}>
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <BarChart3 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-emerald-600">+{loading ? "—" : s!.entriesThisMonth}</span>
                        <span className="text-muted-foreground text-xs">/</span>
                        <span className="text-sm font-bold text-rose-600">-{loading ? "—" : s!.exitsThisMonth}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Entradas / Saídas (Mês)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>

        {/* ─── GOMAQ + Assets + Licenses Cards ─── */}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <motion.div {...fadeIn} transition={{ delay: 0.25 }}>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{loading ? "—" : s!.cartridgesAwaitingCount}</p>
                    <p className="text-xs text-muted-foreground">Carcaças p/ Coleta</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.27 }}>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <Wrench className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{loading ? "—" : s!.maintenanceAssetsCount}</p>
                    <p className="text-xs text-muted-foreground">Em Manutenção</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.29 }}>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
                    <Key className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{loading ? "—" : s!.expiringLicensesCount}</p>
                    <p className="text-xs text-muted-foreground">Licenças p/ Vencer</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.31 }}>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{loading ? "—" : s!.gomaqExchangesThisMonth}</p>
                    <p className="text-xs text-muted-foreground">Trocas Gomaq (Mês)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* ─── PLANEJAMENTO DE REPOSIÇÃO (§3) ─── */}
        {canViewPlanning && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Planejamento de reposição</h2>
              <p className="text-[11px] text-muted-foreground">{REPLENISHMENT_ALERT_NOTICE}</p>
            </div>

            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
              <ReplenishmentCard
                label="Reposição necessária"
                value={necessaryCount}
                tone="rose"
                hint="Mínimo configurado, planejamento ativo e estoque disponível ≤ mínimo"
                href={replenishmentAlertHref("necessary")}
              />
              <ReplenishmentCard
                label="Reposição sugerida"
                value={suggestedCount}
                tone="amber"
                hint="Mínimo e ideal configurados, planejamento ativo e estoque entre os dois"
                href={replenishmentAlertHref("suggested")}
              />
              <ReplenishmentCard
                label="No planejamento"
                value={planning?.counters.participating ?? 0}
                tone="emerald"
                hint="Produtos com “Participa do planejamento de reposição” ativado"
                href={replenishmentAlertHref("all")}
              />
              <ReplenishmentCard
                label="Abaixo do mínimo sem planejamento"
                value={planning?.counters.belowMinimumWithoutPlanning ?? 0}
                tone="slate"
                hint="Visíveis na parametrização, mas fora dos alertas"
                href={replenishmentAlertHref("without_planning")}
              />
            </div>

            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  Alertas de reposição
                  {planning !== undefined && planningRows.length > 0 && (
                    <Badge variant="outline" className="ml-1 text-[10px]">{planningRows.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {planning === undefined ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
                ) : planningRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nenhum produto no planejamento de reposição. Ative “Participa do planejamento de
                    reposição” em {"/stock-parameters"} para começar a acompanhar.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead>
                          <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Produto</th>
                            <th className="py-2 pr-3 font-medium">Categoria</th>
                            <th className="py-2 pr-3 font-medium">Área</th>
                            <th className="py-2 pr-3 text-right font-medium">Estoque atual</th>
                            <th className="py-2 pr-3 text-right font-medium">Mínimo</th>
                            <th className="py-2 pr-3 text-right font-medium">Ideal</th>
                            <th className="py-2 pr-3 text-right font-medium">Necessidade p/ o ideal</th>
                            <th className="py-2 font-medium">Situação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {planningRows.slice(0, ALERT_LIST_LIMIT).map((r) => (
                            <tr key={r.productId} className="hover:bg-muted/40">
                              <td className="py-2 pr-3">
                                <Link to={`/products/${r.productId}`} className="font-medium hover:underline">
                                  {r.productName}
                                </Link>
                              </td>
                              <td className="py-2 pr-3 text-xs text-muted-foreground">{r.categoryName ?? "—"}</td>
                              <td className="py-2 pr-3 text-xs text-muted-foreground">{r.areaName ?? "—"}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {r.availableStock} {r.baseUnit}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{r.minimumStock ?? "—"}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{r.idealStock ?? "—"}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{r.needToIdeal}</td>
                              <td className="py-2">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${
                                    r.planningLevel === "necessary"
                                      ? "border-rose-200 bg-rose-50 text-rose-700"
                                      : "border-amber-200 bg-amber-50 text-amber-700"
                                  }`}
                                >
                                  {r.planningLabel}
                                </Badge>
                                <span className="ml-1.5 text-[10px] text-muted-foreground">{r.situationLabel}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        A necessidade para atingir o ideal é <code className="font-mono">max(ideal − disponível, 0)</code> —
                        informativa. Nenhuma compra, entrada ou solicitação é criada automaticamente.
                      </p>
                      {planningRows.length > ALERT_LIST_LIMIT && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={replenishmentAlertHref("all")}>Ver todos ({planningRows.length})</Link>
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ─── Charts Row ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Consumption by Secretaria */}
          <motion.div {...fadeIn} transition={{ delay: 0.25 }}>
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-600" />
                  Consumo por Secretaria (Top 5)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
                ) : s!.topSecretarias.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma entrega registrada</p>
                ) : (
                  <Suspense fallback={<p className="text-sm text-muted-foreground py-8 text-center">Carregando gráfico…</p>}>
                    <LazyBarChart data={s!.topSecretarias} colors={CHART_COLORS} />
                  </Suspense>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Urgent Alerts */}
          <motion.div {...fadeIn} transition={{ delay: 0.3 }}>
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                  <TrendingDown className="h-4 w-4" />
                  Saldos baixos no catálogo (independe do planejamento)
                  {!loading && s!.urgentAlerts.length > 0 && (
                    <Badge variant="destructive" className="ml-1 text-[10px]">{s!.urgentAlerts.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
                ) : s!.urgentAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Nenhum saldo baixo no catálogo</p>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto">
                    {s!.urgentAlerts.slice(0, 10).map((a: any) => (
                      <Link key={a._id} to={`/products/${a._id}`} className="flex items-center justify-between text-sm hover:bg-muted/50 rounded px-2 py-1.5 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{a.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {a.brand && `${a.brand} — `}{a.categoryName}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-xs text-muted-foreground">
                            {a.currentStock}/{a.minimumStock}
                          </span>
                          <Badge variant="destructive" className="text-[10px]">
                            {a.currentStock === 0 ? "Zerado" : "Crítico"}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </AppShell>
  );
}
