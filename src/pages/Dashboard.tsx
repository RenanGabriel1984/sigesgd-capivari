import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "react-router";
import {
  Package,
  TrendingDown,
  ClipboardList,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  ShoppingCart,
  BarChart3,
  ShoppingCart as OrderIcon,
  Plus,
  FileBarChart,
  Truck,
  Wrench,
  Key,
} from "lucide-react";
import { ROLE_LABELS } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import { useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3 },
};

const CHART_COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed"];

export default function Dashboard() {
  const { user } = useAuth();
  const recordLogin = useMutation(api.users.recordLogin);
  const stats = useQuery(api.dashboard.stats);

  const role = (user?.role ?? "technician") as UserRole;

  // Record login timestamp on mount
  useEffect(() => {
    if (user?._id) recordLogin();
  }, [user?._id]);

  const s = stats;
  const loading = s === undefined;

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <motion.div {...fadeIn}>
          <h1 className="text-2xl font-bold tracking-tight">
            Olá{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {ROLE_LABELS[role]} — Painel de Gestão
          </p>
        </motion.div>

        {/* ─── KPI Cards ─── */}
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
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={s!.topSecretarias} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number, name: string) => [value, name === "items" ? "Itens Recebidos" : "Pedidos"]}
                        labelStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="items" radius={[4, 4, 0, 0]} name="items">
                        {s!.topSecretarias.map((_: any, idx: number) => (
                          <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
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

        {/* ─── Quick Actions ─── */}
        <motion.div {...fadeIn} transition={{ delay: 0.35 }}>
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Atalhos Rápidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Link to="/entries">
                  <Button variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Nova Entrada
                  </Button>
                </Link>
                <Link to="/requests">
                  <Button variant="outline" className="gap-2">
                    <OrderIcon className="h-4 w-4" />
                    Nova Solicitação
                  </Button>
                </Link>
                <Link to="/reports">
                  <Button variant="outline" className="gap-2">
                    <FileBarChart className="h-4 w-4" />
                    Relatórios
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </AppShell>
  );
}
