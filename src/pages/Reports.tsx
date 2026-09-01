import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  FileBarChart,
  Download,
  Printer,
  Package,
  ArrowLeftRight,
  Building2,
  Search,
} from "lucide-react";
import { UNIT_LABELS } from "@/types/constants";
import { toast } from "sonner";

function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportStockPositionCSV(data: any[]) {
  const header = "Código;Nome;Categoria;Marca;Modelo;Saldo Atual;Mínimo;Ideal;Máximo;Status;Unidade";
  const rows = data.map((r) =>
    [
      r.internalCode,
      r.name,
      r.categoryName,
      r.brand ?? "",
      r.model ?? "",
      r.currentStock,
      r.minimumStock,
      r.idealStock,
      r.maximumStock,
      r.status,
      UNIT_LABELS[r.unitOfMeasure] ?? r.unitOfMeasure,
    ].join(";")
  );
  downloadCSV("posicao_estoque.csv", [header, ...rows].join("\n"));
}

function exportMovementCSV(data: any[]) {
  const header = "Data;Tipo;Produto;Quantidade;Usuário;Fornecedor;Documento;Observação;Cancelada";
  const rows = data.map((r) =>
    [
      new Date(r.timestamp).toLocaleString("pt-BR"),
      r.type === "entry" ? "Entrada" : r.type === "exit" ? "Saída" : r.type,
      r.productName,
      r.quantity,
      r.userName,
      r.supplierTrade || r.supplierName,
      r.documentNumber,
      r.observation,
      r.canceled ? "Sim" : "Não",
    ].join(";")
  );
  downloadCSV("movimentacoes.csv", [header, ...rows].join("\n"));
}

function exportConsumptionCSV(data: any[]) {
  const header = "Data;Solicitante;Motivo;Itens;Qtd Total";
  const rows = data.map((r) =>
    [
      new Date(r.deliveredAt).toLocaleString("pt-BR"),
      r.requesterName,
      r.reason,
      r.items.map((i: any) => `${i.name} (${i.quantityDelivered})`).join(", "),
      r.totalItems,
    ].join(";")
  );
  downloadCSV("consumo_por_secretaria.csv", [header, ...rows].join("\n"));
}

export default function Reports() {
  // ─── Stock Position ───
  const stockPosition = useQuery(api.dashboard.stockPosition);

  // ─── Movement Report ───
  const [movStartDate, setMovStartDate] = useState("");
  const [movEndDate, setMovEndDate] = useState("");
  const movements = useQuery(api.dashboard.movementReport, {
    startDate: movStartDate ? new Date(movStartDate).getTime() : undefined,
    endDate: movEndDate ? new Date(movEndDate + "T23:59:59").getTime() : undefined,
  });

  // ─── Consumption Report ───
  const organizations = useQuery(api.organizations.list);
  const [consumptionOrgId, setConsumptionOrgId] = useState("");
  const consumptionData = useQuery(
    api.dashboard.consumptionByOrg,
    consumptionOrgId ? { organizationId: consumptionOrgId as any } : "skip"
  );

  const orgList = useMemo(() => organizations?.orgs ?? [], [organizations]);
  const secretarias = useMemo(
    () => orgList.filter((o) => o.type === "secretaria" && o.active),
    [orgList]
  );

  const stockStatusCounts = useMemo(() => {
    if (!stockPosition) return { normal: 0, baixo: 0, critico: 0, zerado: 0, total: 0 };
    return stockPosition.reduce(
      (acc, item) => {
        acc.total++;
        if (item.status === "Zerado") acc.zerado++;
        else if (item.status === "Crítico") acc.critico++;
        else if (item.status === "Baixo") acc.baixo++;
        else acc.normal++;
        return acc;
      },
      { normal: 0, baixo: 0, critico: 0, zerado: 0, total: 0 }
    );
  }, [stockPosition]);

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
            <p className="text-sm text-muted-foreground">Consultas e exportação de dados do sistema</p>
          </div>
        </div>

        <Tabs defaultValue="stock">
          <TabsList>
            <TabsTrigger value="stock" className="gap-1">
              <Package className="h-3.5 w-3.5" /> Posição de Estoque
            </TabsTrigger>
            <TabsTrigger value="movements" className="gap-1">
              <ArrowLeftRight className="h-3.5 w-3.5" /> Movimentações
            </TabsTrigger>
            <TabsTrigger value="consumption" className="gap-1">
              <Building2 className="h-3.5 w-3.5" /> Consumo por Secretaria
            </TabsTrigger>
          </TabsList>

          {/* ═══ RELATÓRIO 1: POSIÇÃO DE ESTOQUE ═══ */}
          <TabsContent value="stock" className="space-y-4 mt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  Total: {stockPosition?.length ?? 0} itens
                </Badge>
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200">
                  Normal: {stockStatusCounts.normal}
                </Badge>
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                  Baixo: {stockStatusCounts.baixo}
                </Badge>
                <Badge variant="destructive" className="text-xs">
                  Crítico: {stockStatusCounts.critico}
                </Badge>
                <Badge variant="destructive" className="text-xs">
                  Zerado: {stockStatusCounts.zerado}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (!stockPosition || stockPosition.length === 0) {
                      toast.error("Nenhum dado para exportar");
                      return;
                    }
                    exportStockPositionCSV(stockPosition);
                    toast.success("CSV exportado com sucesso");
                  }}
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" /> Imprimir
                </Button>
              </div>
            </div>

            <Card className="border-border/50" id="report-content">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Código</TableHead>
                        <TableHead className="text-xs">Nome</TableHead>
                        <TableHead className="text-xs">Categoria</TableHead>
                        <TableHead className="text-xs">Marca/Modelo</TableHead>
                        <TableHead className="text-xs text-right">Saldo</TableHead>
                        <TableHead className="text-xs text-right">Mínimo</TableHead>
                        <TableHead className="text-xs text-right">Ideal</TableHead>
                        <TableHead className="text-xs text-right">Máximo</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockPosition?.map((item) => (
                        <TableRow key={item._id}>
                          <TableCell className="text-xs font-mono">{item.internalCode || "—"}</TableCell>
                          <TableCell className="text-sm font-medium">{item.name}</TableCell>
                          <TableCell className="text-xs">{item.categoryName}</TableCell>
                          <TableCell className="text-xs">{[item.brand, item.model].filter(Boolean).join(" — ") || "—"}</TableCell>
                          <TableCell className="text-sm text-right font-mono">{item.currentStock}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{item.minimumStock}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{item.idealStock}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{item.maximumStock}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                item.status === "Crítico" || item.status === "Zerado"
                                  ? "destructive"
                                  : item.status === "Baixo"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-[10px]"
                            >
                              {item.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!stockPosition && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                            Carregando…
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ RELATÓRIO 2: MOVIMENTAÇÕES POR PERÍODO ═══ */}
          <TabsContent value="movements" className="space-y-4 mt-4">
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Data Inicial</Label>
                    <Input
                      type="date"
                      value={movStartDate}
                      onChange={(e) => setMovStartDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Data Final</Label>
                    <Input
                      type="date"
                      value={movEndDate}
                      onChange={(e) => setMovEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setMovStartDate(""); setMovEndDate(""); }}
                    >
                      Limpar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  {movements?.length ?? 0} movimentações
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (!movements || movements.length === 0) {
                      toast.error("Nenhum dado para exportar");
                      return;
                    }
                    exportMovementCSV(movements);
                    toast.success("CSV exportado com sucesso");
                  }}
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" /> Imprimir
                </Button>
              </div>
            </div>

            <Card className="border-border/50">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data/Hora</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs">Produto</TableHead>
                        <TableHead className="text-xs text-right">Qtd</TableHead>
                        <TableHead className="text-xs">Usuário</TableHead>
                        <TableHead className="text-xs">Fornecedor</TableHead>
                        <TableHead className="text-xs">Documento</TableHead>
                        <TableHead className="text-xs">Obs.</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movements?.map((m) => (
                        <TableRow key={m._id} className={m.canceled ? "opacity-50" : ""}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(m.timestamp).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                m.type === "entry"
                                  ? "text-emerald-600 border-emerald-200"
                                  : m.type === "exit"
                                  ? "text-rose-600 border-rose-200"
                                  : ""
                              }`}
                            >
                              {m.type === "entry" ? "Entrada" : m.type === "exit" ? "Saída" : m.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{m.productName}</TableCell>
                          <TableCell className="text-sm text-right font-mono">{m.quantity}</TableCell>
                          <TableCell className="text-xs">{m.userName}</TableCell>
                          <TableCell className="text-xs">{m.supplierTrade || m.supplierName || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{m.documentNumber || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">{m.observation || "—"}</TableCell>
                          <TableCell>
                            {m.canceled && <Badge variant="destructive" className="text-[10px]">Estornada</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!movements && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                            Carregando…
                          </TableCell>
                        </TableRow>
                      )}
                      {movements && movements.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                            Nenhuma movimentação encontrada
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ RELATÓRIO 3: CONSUMO POR SECRETARIA ═══ */}
          <TabsContent value="consumption" className="space-y-4 mt-4">
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Secretaria / Unidade</Label>
                    <Select value={consumptionOrgId} onValueChange={setConsumptionOrgId}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Selecione uma secretaria" />
                      </SelectTrigger>
                      <SelectContent>
                        {secretarias.map((o) => (
                          <SelectItem key={o._id} value={o._id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {!consumptionOrgId ? (
              <Card className="border-border/50">
                <CardContent className="py-12 text-center">
                  <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">
                    Selecione uma secretaria para visualizar o consumo de materiais
                  </p>
                </CardContent>
              </Card>
            ) : consumptionData === undefined ? (
              <Card className="border-border/50">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground text-sm">Carregando…</p>
                </CardContent>
              </Card>
            ) : consumptionData.length === 0 ? (
              <Card className="border-border/50">
                <CardContent className="py-12 text-center">
                  <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">
                    Nenhuma entrega registrada para esta secretaria
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs">
                      {consumptionData.length} entrega(s)
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      Total de itens: {consumptionData.reduce((sum, r) => sum + r.totalItems, 0)}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        exportConsumptionCSV(consumptionData);
                        toast.success("CSV exportado com sucesso");
                      }}
                    >
                      <Download className="h-3.5 w-3.5" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                      <Printer className="h-3.5 w-3.5" /> Imprimir
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {consumptionData.map((r) => (
                    <Card key={r._id} className="border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-sm">{r.requesterName}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(r.deliveredAt).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {r.totalItems} item(ns)
                          </Badge>
                        </div>
                        {r.reason && (
                          <p className="text-xs text-muted-foreground mb-2">
                            <span className="font-medium">Motivo:</span> {r.reason}
                          </p>
                        )}
                        <div className="space-y-1">
                          {r.items.map((item: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
                              <span className="truncate">{item.name}</span>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="font-mono text-xs">Qtd: {item.quantityDelivered}</span>
                                {item.serialNumbers.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    S/N: {item.serialNumbers.join(", ")}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-content,
          #report-content * { visibility: visible; }
          #report-content { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
          .print-hide { display: none !important; }
        }
      `}</style>
    </AppShell>
  );
}
