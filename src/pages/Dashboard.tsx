import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  Package,
  TrendingDown,
  ClipboardList,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  ShoppingCart,
} from "lucide-react";
import { ROLE_LABELS } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import { useEffect } from "react";
const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3 },
};

export default function Dashboard() {
  const { user } = useAuth();
  const recordLogin = useMutation(api.users.recordLogin);
  const products = useQuery(api.products.list);
  const movements = useQuery(api.stockMovements.list);
  const pendingRequests = useQuery(api.requests.pendingCount);
  const belowMin = useQuery(api.products.belowMinimum);

  const role = (user?.role ?? "technician") as UserRole;

  // Record login timestamp on mount
  useEffect(() => {
    if (user?._id) recordLogin();
  }, [user?._id]);

  const totalProducts = products?.length ?? 0;
  const totalStock = products?.reduce((sum, p) => sum + (p.stock?.physicalQuantity ?? 0), 0) ?? 0;
  const pendingCount = pendingRequests ?? 0;
  const belowMinCount = belowMin?.length ?? 0;

  const recentEntries = movements
    ?.filter((m) => m.type === "entry")
    .slice(0, 5) ?? [];
  const recentExits = movements
    ?.filter((m) => m.type === "exit")
    .slice(0, 5) ?? [];

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <motion.div {...fadeIn}>
          <h1 className="text-2xl font-bold tracking-tight">
            Olá{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {ROLE_LABELS[role]} — Visão Geral
          </p>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <motion.div {...fadeIn} transition={{ delay: 0.05 }}>
            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{totalProducts}</p>
                    <p className="text-xs text-muted-foreground">Itens do Estoque</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.1 }}>
            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <ShoppingCart className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{totalStock}</p>
                    <p className="text-xs text-muted-foreground">Estoque Total</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.15 }}>
            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{pendingCount}</p>
                    <p className="text-xs text-muted-foreground">Solicitações Pendentes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.2 }}>
            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{belowMinCount}</p>
                    <p className="text-xs text-muted-foreground">Abaixo do Mínimo</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div {...fadeIn} transition={{ delay: 0.25 }}>
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                  Últimas Entradas
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recentEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma entrada registrada</p>
                ) : (
                  <div className="space-y-3">
                    {recentEntries.map((m) => (
                      <div key={m._id} className="flex items-center justify-between text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{m.product?.name ?? "Produto"}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.quantity} un. — {m.user?.name ?? "Usuário"}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-emerald-600 border-emerald-200 shrink-0 ml-2">
                          +{m.quantity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeIn} transition={{ delay: 0.3 }}>
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowDownRight className="h-4 w-4 text-rose-600" />
                  Últimas Saídas
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recentExits.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma saída registrada</p>
                ) : (
                  <div className="space-y-3">
                    {recentExits.map((m) => (
                      <div key={m._id} className="flex items-center justify-between text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{m.product?.name ?? "Produto"}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.quantity} un. — {m.user?.name ?? "Usuário"}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-rose-600 border-rose-200 shrink-0 ml-2">
                          -{m.quantity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {belowMinCount > 0 && (
          <motion.div {...fadeIn} transition={{ delay: 0.35 }}>
            <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                  <TrendingDown className="h-4 w-4" />
                  Estoque Abaixo do Mínimo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {belowMin?.slice(0, 10).map((p) => (
                    <div key={p._id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Atual: {p.currentStock} / Mín: {p.minimumStock}
                        </span>
                        <Badge variant="destructive" className="text-[10px]">
                          Baixo
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}
