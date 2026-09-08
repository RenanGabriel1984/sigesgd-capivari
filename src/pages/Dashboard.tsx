import { useAuth } from "@/hooks/use-auth";
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
} from "lucide-react";
import { getPermissions, ROLE_LABELS } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import { useEffect, lazy, Suspense } from "react";

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

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* ─── Hero institucional ─── */}
        <motion.div {...fadeIn}>
          <div className="relative overflow-hidden rounded-2xl bg-[var(--capivari-green-dark)] text-white">
            <img
              src="/assets/bandeira.svg"
              alt=""
              aria-hidden
              className="absolute right-0 top-0 h-full w-48 sm:w-72 object-cover opacity-10"
            />
            <div className="relative flex items-center gap-4 p-5 sm:p-7">
              <img
                src="/assets/brasao.svg"
                alt="Brasão de Capivari"
                className="h-14 w-14 sm:h-16 sm:w-16 object-contain rounded-full bg-white/95 p-1 shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
            <div className="grid grid-cols-2 gap-3 mt-3">
              {permissions.canManageInventory && (
                <Button variant="ghost" className="h-auto justify-start gap-2 p-3 rounded-xl border hover:bg-muted/50" onClick={() => navigate("/inventory")}>
                  <ClipboardCheck className="h-5 w-5 text-[var(--capivari-green)]" />
                  <span className="text-sm font-medium">Fazer inventário</span>
                  <span className="text-[10px] text-muted-foreground">Conferir estoque físico</span>
                </Button>
              )}
              {permissions.canViewMovements && (
                <Button variant="ghost" className="h-auto justify-start gap-2 p-3 rounded-xl border hover:bg-muted/50" onClick={() => navigate("/reports")}>
                  <FileBarChart className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-medium">Relatórios</span>
                  <span className="text-[10px] text-muted-foreground">Consumo e movimentações</span>
                </Button>
              )}
            </div>
          )}
        </motion.div>

        {/* ─── Indicadores ─── */}
        <div className="pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Indicadores</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <motion.div {...fadeIn} transition={{ delay: 0.05 }}>
              <Card className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Package className="h-5 w-5" />
                    </div>
                    <div>
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
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
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
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <ClipboardList className="h-5 w-5" />
                    </div>
                    <div>
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
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <BarChart3 className="h-5 w-5" />
                    </div>
                    <div>
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

        {/* ─── KPI Cards (2ª linha) ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <motion.div {...fadeIn} transition={{ delay: 0.05 }}>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
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
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
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
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{loading ? "—" : s!.pendingThisMonth}</p>
                    <p className="text-xs text-muted-foreground">Pedidos Pendentes (Mês)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.2 }}>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                  <div>
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

        {/* ─── GOMAQ + Assets + Licenses Cards ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <motion.div {...fadeIn} transition={{ delay: 0.25 }}>
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
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
                <div className="flex items-center gap-3">
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
                <div className="flex items-center gap-3">
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
                <div className="flex items-center gap-3">
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
                  Alertas de Reposição Urgente
                  {!loading && s!.urgentAlerts.length > 0 && (
                    <Badge variant="destructive" className="ml-1 text-[10px]">{s!.urgentAlerts.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
                ) : s!.urgentAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Nenhum alerta de estoque</p>
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
