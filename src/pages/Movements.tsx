import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeftRight } from "lucide-react";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_COLORS, type MovementType } from "@/types/constants";

function LoadingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-48" /></div>
        <Card className="border-border/50"><CardContent className="p-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-b border-border/30 last:border-b-0">
              <Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-32" /><Skeleton className="h-5 w-16" /><Skeleton className="h-4 w-10" />
            </div>
          ))}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}

export default function Movements() {
  const movements = useQuery(api.stockMovements.list);

  if (movements === undefined) return <LoadingSkeleton />;

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimentações</h1>
          <p className="text-sm text-muted-foreground">Histórico de movimentações de estoque — {movements.length} registro(s)</p>
        </div>

        {/* Desktop Table */}
        <Card className="border-border/50 hidden sm:block"><CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Data/Hora</TableHead><TableHead>Produto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-center">Qtd</TableHead><TableHead className="text-center">Est. Anterior</TableHead><TableHead className="text-center">Est. Novo</TableHead><TableHead>Usuário</TableHead><TableHead>Observação</TableHead></TableRow></TableHeader>
          <TableBody>
            {movements.map((m) => (<TableRow key={m._id} className={m.canceled ? "opacity-50" : ""}>
              <TableCell className="text-xs whitespace-nowrap">{new Date(m.timestamp).toLocaleString("pt-BR")}</TableCell>
              <TableCell className="font-medium text-sm">{m.product?.name ?? "—"}</TableCell>
              <TableCell><Badge variant="secondary" className={`text-[10px] ${MOVEMENT_TYPE_COLORS[m.type as MovementType]}`}>{MOVEMENT_TYPE_LABELS[m.type as MovementType]}</Badge></TableCell>
              <TableCell className="text-center font-mono font-semibold">{m.type === "entry" || m.type === "return" ? "+" : m.type === "exit" ? "-" : ""}{m.quantity}</TableCell>
              <TableCell className="text-center font-mono text-xs text-muted-foreground">{m.previousPhysical}</TableCell>
              <TableCell className="text-center font-mono text-xs">{m.newPhysical}</TableCell>
              <TableCell className="text-sm">{m.user?.name ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{m.observation ?? "—"}</TableCell>
            </TableRow>))}
            {movements.length === 0 && (<TableRow><TableCell colSpan={8}><div className="empty-state py-12"><ArrowLeftRight className="empty-state-icon" /><p className="empty-state-title">Nenhuma movimentação registrada</p><p className="empty-state-desc">As movimentações aparecerão aqui após entradas, saídas e transferências</p></div></TableCell></TableRow>)}
          </TableBody>
        </Table></div></CardContent></Card>

        {/* Mobile Cards */}
        <div className="sm:hidden space-y-3">
          {movements.slice(0, 100).map((m) => (
            <Card key={m._id} className={`border-border/50 ${m.canceled ? "opacity-50" : ""}`}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <p className="font-medium text-sm">{m.product?.name ?? "—"}</p>
                  <Badge variant="secondary" className={`text-[10px] ${MOVEMENT_TYPE_COLORS[m.type as MovementType]}`}>
                    {MOVEMENT_TYPE_LABELS[m.type as MovementType]}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className={`font-mono font-bold ${m.type === "entry" || m.type === "return" ? "text-emerald-600" : m.type === "exit" ? "text-rose-600" : ""}`}>
                      {m.type === "entry" || m.type === "return" ? "+" : m.type === "exit" ? "-" : ""}{m.quantity}
                    </p>
                    <p className="text-muted-foreground">Qtd</p>
                  </div>
                  <div>
                    <p className="font-mono text-muted-foreground">{m.previousPhysical}</p>
                    <p className="text-muted-foreground">Antes</p>
                  </div>
                  <div>
                    <p className="font-mono font-semibold">{m.newPhysical}</p>
                    <p className="text-muted-foreground">Depois</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {new Date(m.timestamp).toLocaleString("pt-BR")} • {m.user?.name ?? "—"}
                </p>
              </CardContent>
            </Card>
          ))}
          {movements.length === 0 && (
            <div className="empty-state py-12">
              <ArrowLeftRight className="empty-state-icon" />
              <p className="empty-state-title">Nenhuma movimentação registrada</p>
              <p className="empty-state-desc">As movimentações aparecerão aqui após entradas, saídas e transferências</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
