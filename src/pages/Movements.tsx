import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeftRight } from "lucide-react";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_COLORS, type MovementType } from "@/types/constants";

export default function Movements() {
  const movements = useQuery(api.stockMovements.list);

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimentações</h1>
          <p className="text-sm text-muted-foreground">Histórico de movimentações de estoque</p>
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-center">Qtd</TableHead>
                    <TableHead className="text-center">Est. Anterior</TableHead>
                    <TableHead className="text-center">Est. Novo</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements?.map((m) => (
                    <TableRow key={m._id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(m.timestamp).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{m.product?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={MOVEMENT_TYPE_COLORS[m.type as MovementType]}
                        >
                          {MOVEMENT_TYPE_LABELS[m.type as MovementType]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center font-mono font-semibold">
                        {m.type === "entry" || m.type === "return" ? "+" : m.type === "exit" ? "-" : ""}
                        {m.quantity}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">
                        {m.previousPhysical}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">
                        {m.newPhysical}
                      </TableCell>
                      <TableCell className="text-sm">{m.user?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {m.observation ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {movements?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12">
                        <ArrowLeftRight className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">Nenhuma movimentação registrada</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
