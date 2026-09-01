import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, Filter } from "lucide-react";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/types/constants";

const ALL_ACTIONS = [
  "create",
  "update",
  "activate",
  "deactivate",
  "approve",
  "reject",
  "cancel",
  "move_stock",
  "login",
  "deliver",
  "password_change",
  "password_reset",
  "reserve",
  "toner_update",
] as const;

const ENTITY_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "requests", label: "Solicitações" },
  { value: "stockMovements", label: "Movimentações" },
  { value: "products", label: "Itens do Estoque" },
  { value: "users", label: "Usuários" },
  { value: "organizations", label: "Organizações" },
  { value: "categories", label: "Categorias" },
  { value: "suppliers", label: "Fornecedores" },
];

export default function Audit() {
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const logs = useQuery(api.auditLogs.listFiltered, {
    action: actionFilter !== "all" ? actionFilter : undefined,
    entity: entityFilter !== "all" ? entityFilter : undefined,
    startDate: startDate ? new Date(startDate).getTime() : undefined,
    endDate: endDate ? new Date(endDate + "T23:59:59").getTime() : undefined,
    limit: 300,
  });

  const hasFilters = !!(actionFilter !== "all" || entityFilter !== "all" || startDate || endDate);

  const clearFilters = () => {
    setActionFilter("all");
    setEntityFilter("all");
    setStartDate("");
    setEndDate("");
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
            <p className="text-sm text-muted-foreground">
              Trilha de auditoria completa do sistema — {logs?.length ?? 0} registro(s)
            </p>
          </div>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4" />
            Filtros
            {hasFilters && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-5 min-w-5 px-1.5">
                Ativos
              </Badge>
            )}
          </Button>
        </div>

        {/* ─── Filters Panel ─── */}
        {showFilters && (
          <Card className="border-border/50">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Ação</Label>
                  <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as ações</SelectItem>
                      {ALL_ACTIONS.map((action) => (
                        <SelectItem key={action} value={action}>
                          {AUDIT_ACTION_LABELS[action as AuditAction] ?? action}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Módulo / Entidade</Label>
                  <Select value={entityFilter} onValueChange={setEntityFilter}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Data Inicial</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Data Final</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Limpar Filtros
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Timeline / Table ─── */}
        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data/Hora</TableHead>
                    <TableHead className="text-xs">Usuário</TableHead>
                    <TableHead className="text-xs">Ação</TableHead>
                    <TableHead className="text-xs">Módulo</TableHead>
                    <TableHead className="text-xs">Detalhes</TableHead>
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
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${
                            log.action === "create"
                              ? "bg-blue-50 text-blue-700"
                              : log.action === "update"
                              ? "bg-amber-50 text-amber-700"
                              : log.action === "approve"
                              ? "bg-emerald-50 text-emerald-700"
                              : log.action === "reject"
                              ? "bg-red-50 text-red-700"
                              : log.action === "deliver"
                              ? "bg-violet-50 text-violet-700"
                              : log.action === "cancel"
                              ? "bg-gray-50 text-gray-700"
                              : log.action === "move_stock"
                              ? "bg-cyan-50 text-cyan-700"
                              : log.action === "login"
                              ? "bg-green-50 text-green-700"
                              : ""
                          }`}
                        >
                          {AUDIT_ACTION_LABELS[log.action as AuditAction] ?? log.action}
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
                        <p className="text-muted-foreground">
                          {hasFilters ? "Nenhum registro corresponde aos filtros" : "Nenhum registro de auditoria"}
                        </p>
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
