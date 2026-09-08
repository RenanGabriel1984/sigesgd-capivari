import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Search, Warehouse } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UNIT_LABELS } from "@/types/constants";
import { getStockSituation, STOCK_SITUATION_LABELS, STOCK_SITUATION_BADGE_CLASSES } from "@/lib/stock-status";
import type { ProductView } from "@/lib/product-types";

function StockSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 max-w-md" />
        <Card className="border-border/50">
          <CardContent className="p-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 border-b border-border/30 last:border-b-0">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export default function Stock() {
  const products = useQuery(api.products.list) as ProductView[] | undefined;
  const [search, setSearch] = useState("");

  if (products === undefined) return <StockSkeleton />;

  const filtered = products?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.internalCode?.toLowerCase().includes(search.toLowerCase()) ||
      p.manufacturer?.toLowerCase().includes(search.toLowerCase()) ||
      p.brand?.toLowerCase().includes(search.toLowerCase())
  );

  const criticalCount = filtered?.filter((p) => {
    const physical = p.stock?.physicalQuantity ?? 0;
    return getStockSituation(physical, p.minimumStock, p.idealStock) === "critical";
  }).length ?? 0;

  const belowMinCount = filtered?.filter((p) => {
    const physical = p.stock?.physicalQuantity ?? 0;
    const s = getStockSituation(physical, p.minimumStock, p.idealStock);
    return s === "critical" || s === "below_min";
  }).length ?? 0;

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Estoque</h1>
            <p className="text-sm text-muted-foreground">
              Saldo atual por produto — calculado pelas movimentações
              {criticalCount > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs">
                  {criticalCount} crítico{criticalCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {belowMinCount > 0 && (
                <Badge variant="outline" className="ml-2 text-xs border-amber-200 bg-amber-50 text-amber-700">
                  {belowMinCount} abaixo do mínimo
                </Badge>
              )}
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 max-w-sm"
            />
          </div>
        </div>

        {/* Desktop Table */}
        <Card className="border-border/50 hidden sm:block">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-center">Estoque Físico</TableHead>
                    <TableHead className="text-center">Reservado</TableHead>
                    <TableHead className="text-center">Disponível</TableHead>
                    <TableHead className="text-center">Mínimo</TableHead>
                    <TableHead className="text-center">Ideal</TableHead>
                    <TableHead className="w-[170px]">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered?.map((p) => {
                    const physical = p.stock?.physicalQuantity ?? 0;
                    const reserved = p.stock?.reservedQuantity ?? 0;
                    const available = Math.max(physical - reserved, 0);
                    const situation = getStockSituation(physical, p.minimumStock, p.idealStock);
                    const isLow = situation === "critical" || situation === "below_min";
                    return (
                      <TableRow key={p._id} className={isLow ? "bg-rose-50/30" : ""}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.brand || p.manufacturer ? `${p.brand ?? p.manufacturer}${p.model ? ` ${p.model}` : ""}` : p.internalCode ?? ""}
                              <span className="ml-1 text-[10px] text-muted-foreground/70">({UNIT_LABELS[p.unitOfMeasure] ?? p.unitOfMeasure})</span>
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{p.category?.name ?? "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-center font-mono font-semibold">{physical}</TableCell>
                        <TableCell className="text-center font-mono text-amber-600">
                          {reserved > 0 ? reserved : "—"}
                        </TableCell>
                        <TableCell className="text-center font-mono">{available}</TableCell>
                        <TableCell className="text-center font-mono text-muted-foreground">{p.minimumStock}</TableCell>
                        <TableCell className="text-center font-mono text-muted-foreground">{p.idealStock}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] shrink-0 ${STOCK_SITUATION_BADGE_CLASSES[situation]}`}>
                              {STOCK_SITUATION_LABELS[situation]}
                            </Badge>
                            {p.maximumStock > 0 && (
                              <Progress
                                value={Math.min(100, (physical / p.maximumStock) * 100)}
                                className="h-1.5 flex-1"
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <div className="empty-state py-12">
                          <Warehouse className="empty-state-icon" />
                          <p className="empty-state-title">
                            {search ? "Nenhum produto encontrado" : "Nenhum produto em estoque"}
                          </p>
                          <p className="empty-state-desc">
                            {search ? "Tente outro termo de busca" : "Cadastre produtos para iniciar o controle de estoque"}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Mobile Card Layout */}
        <div className="sm:hidden space-y-3">
          {filtered?.map((p) => {
            const physical = p.stock?.physicalQuantity ?? 0;
            const reserved = p.stock?.reservedQuantity ?? 0;
            const available = Math.max(physical - reserved, 0);
            const situation = getStockSituation(physical, p.minimumStock, p.idealStock);
            const isLow = situation === "critical" || situation === "below_min";
            return (
              <Card key={p._id} className={`border-border/50 ${isLow ? "border-rose-200 bg-rose-50/20" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.category?.name ?? "—"} • {UNIT_LABELS[p.unitOfMeasure] ?? p.unitOfMeasure}
                      </p>
                    </div>
                    <Badge className={`text-[10px] shrink-0 ml-2 ${STOCK_SITUATION_BADGE_CLASSES[situation]}`}>
                      {STOCK_SITUATION_LABELS[situation]}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold font-mono">{physical}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Físico</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold font-mono text-amber-600">{reserved || "—"}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Reservado</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold font-mono">{available}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Disponível</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Mínimo: {p.minimumStock}</span>
                    <span>Ideal: {p.idealStock}</span>
                    <span>Máximo: {p.maximumStock}</span>
                  </div>
                  {p.maximumStock > 0 && (
                    <Progress value={Math.min(100, (physical / p.maximumStock) * 100)} className="h-1.5 mt-2" />
                  )}
                </CardContent>
              </Card>
            );
          })}
          {filtered?.length === 0 && (
            <div className="empty-state py-12">
              <Warehouse className="empty-state-icon" />
              <p className="empty-state-title">
                {search ? "Nenhum produto encontrado" : "Nenhum produto em estoque"}
              </p>
              <p className="empty-state-desc">
                {search ? "Tente outro termo de busca" : "Cadastre produtos para iniciar o controle de estoque"}
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}