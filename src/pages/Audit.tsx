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
import { Shield } from "lucide-react";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/types/constants";

export default function Audit() {
  const logs = useQuery(api.auditLogs.list, { limit: 200 });

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
          <p className="text-sm text-muted-foreground">Registro de ações do sistema</p>
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Entidade</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs?.map((log) => (
                    <TableRow key={log._id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm">{log.user?.name ?? "Sistema"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {AUDIT_ACTION_LABELS[log.action as AuditAction]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{log.entity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                        {log.details ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {logs?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12">
                        <Shield className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">Nenhum registro de auditoria</p>
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
