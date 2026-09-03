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
  AlertTriangle,
  Monitor,
  ClipboardList,
  Truck,
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

function exportRequestsCSV(data: any[]) {
  const header = "Nº;Data;Solicitante;Secretaria;Status;Itens;Qtd Total";
  const rows = data.map((r) =>
    [
      r._id.slice(-6),
      new Date(r.createdAt).toLocaleString("pt-BR"),
      r.requesterName,
      r.secretariaName,
      r.status,
      r.itemCount,
      r.totalItems,
    ].join(";")
  );
  downloadCSV("solicitacoes.csv", [header, ...rows].join("\n"));
}

function exportAssetsCSV(data: any[]) {
  const header = "Patrimônio;Série;Tipo;Fabricante;Modelo;Usuário;Secretaria;Status";
  const rows = data.map((a) =>
    [
      a.patrimonyNumber ?? "",
      a.serialNumber ?? "",
      a.assetType,
      a.manufacturer ?? "",
      a.model ?? "",
      a.responsible?.name ?? "",
      a.organization?.name ?? "",
      a.status,
    ].join(";")
  );
  downloadCSV("equipamentos.csv", [header, ...rows].join("\n"));
}

function exportGomaqCSV(exchanges: any[]) {
  const header = "Data;Nº;Produto;Qtd Entregue;Carcaças;Impressora";
  const rows = exchanges.map((e) =>
    [
      new Date(e.exchangedAt).toLocaleDateString("pt-BR"),
      e.exchangeNumber,
      e.product?.name ?? "",
      e.quantityDelivered,
      e.quantityEmptyReceived,
      e.printer?.name ?? "",
    ].join(";")
  );
  downloadCSV("trocas_gomaq.csv", [header, ...rows].join("\n"));
}

export default function Reports() {
  // ─── Stock Position ───
  const stockPosition = useQuery(api.dashboard.stockPosition);
  const tonerMetrics = useQuery(api.printers.tonerMetrics);

  // ─── Requests Report ───
  const [reqStartDate, setReqStartDate] = useState("");
  const [reqEndDate, setReqEndDate] = useState("");
  const allRequests = useQuery(api.requests.list, {});

  // ─── Assets Report ───
  const allAssets = useQuery(api.assets.list, {});

  // ─── GomaQ Report ───
  const gomaqExchanges = useQuery(api.gomaQ.listExchanges, {});
  const gomaqCartridges = useQuery(api.gomaQ.listEmptyCartridges, {});
  const gomaqCollections = useQuery(api.gomaQ.listCollections);

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
            <TabsTrigger value="toners" className="gap-1">
              <Printer className="h-3.5 w-3.5" /> Métricas de Toners
            </TabsTrigger>
            <TabsTrigger value="requests" className="gap-1">
              <ClipboardList className="h-3.5 w-3.5" /> Solicitações
            </TabsTrigger>
            <TabsTrigger value="assets" className="gap-1">
              <Monitor className="h-3.5 w-3.5" /> Equipamentos
            </TabsTrigger>
            <TabsTrigger value="gomaq" className="gap-1">
              <Truck className="h-3.5 w-3.5" /> GomaQ
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

          {/* ═══ RELATÓRIO 4: MÉTRICAS DE TONERS ═══ */}
          <TabsContent value="toners" className="space-y-4 mt-4">
            {tonerMetrics === undefined ? (
              <Card className="border-border/50"><CardContent className="py-8 text-center"><p className="text-muted-foreground text-sm">Carregando…</p></CardContent></Card>
            ) : tonerMetrics.printerMetrics.length === 0 ? (
              <Card className="border-border/50"><CardContent className="py-12 text-center">
                <Printer className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground text-sm">Nenhuma impressora cadastrada ou nenhuma troca de toner registrada</p>
              </CardContent></Card>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge variant="outline" className="text-xs">
                    {tonerMetrics.printerMetrics.length} impressora(s)
                  </Badge>
                  {tonerMetrics.unassignedCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {tonerMetrics.unassignedCount} toner(es) sem impressora vinculada
                    </Badge>
                  )}
                </div>
                <div className="space-y-4">
                  {tonerMetrics.printerMetrics.map((pm: any) => (
                    <Card key={pm.printer._id} className="border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-sm">{pm.printer.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {pm.printer.brand} {pm.printer.model}
                              {pm.printer.patrimony ? ` [${pm.printer.patrimony}]` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {pm.excessive && (
                              <Badge variant="destructive" className="text-[10px] gap-1">
                                <AlertTriangle className="h-3 w-3" /> Consumo Excessivo
                              </Badge>
                            )}
                            {pm.totalTonerChanges > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {pm.totalTonerChanges} troca(s)
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                          <div className="bg-muted/50 rounded px-3 py-2">
                            <p className="text-[10px] text-muted-foreground">Total de Trocas</p>
                            <p className="text-sm font-bold">{pm.totalTonerChanges}</p>
                          </div>
                          <div className="bg-muted/50 rounded px-3 py-2">
                            <p className="text-[10px] text-muted-foreground">Intervalo Médio</p>
                            <p className="text-sm font-bold">
                              {pm.avgDaysBetweenChanges > 0 ? `${pm.avgDaysBetweenChanges} dias` : "—"}
                            </p>
                          </div>
                          <div className="bg-muted/50 rounded px-3 py-2">
                            <p className="text-[10px] text-muted-foreground">Última Troca</p>
                            <p className="text-sm font-bold">
                              {pm.lastChangeDate ? new Date(pm.lastChangeDate).toLocaleDateString("pt-BR") : "—"}
                            </p>
                          </div>
                        </div>
                        {pm.items.length > 0 && (
                          <div className="mt-3 space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Histórico recente:</p>
                            {pm.items.map((item: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1">
                                <span>{item.productName}</span>
                                <span className="text-muted-foreground">
                                  {item.quantity} un. — {new Date(item.deliveredAt).toLocaleDateString("pt-BR")}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          {/* ═══ RELATÓRIO 5: SOLICITAÇÕES ═══ */}
          <TabsContent value="requests" className="space-y-4 mt-4">
            <Card className="border-border/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Data Inicial</Label>
                    <Input type="date" value={reqStartDate} onChange={(e) => setReqStartDate(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Data Final</Label>
                    <Input type="date" value={reqEndDate} onChange={(e) => setReqEndDate(e.target.value)} className="mt-1" />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setReqStartDate(""); setReqEndDate(""); }}>Limpar</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            {!allRequests ? <p className="text-muted-foreground text-sm">Carregando...</p> : (
              <>
                <div className="flex gap-2 mb-3">
                  <Badge variant="outline" className="text-xs">{allRequests.length} solicitação(ões)</Badge>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                    const filtered = allRequests.filter((r: any) => {
                      if (reqStartDate && r.createdAt < new Date(reqStartDate).getTime()) return false;
                      if (reqEndDate && r.createdAt > new Date(reqEndDate + "T23:59:59").getTime()) return false;
                      return true;
                    });
                    exportRequestsCSV(filtered.map((r: any) => ({ ...r, requesterName: r.requester?.name ?? "—", secretariaName: r.secretaria?.name ?? "—", itemCount: r.items?.length ?? 0, totalItems: (r.items ?? []).reduce((s: number, i: any) => s + (i.quantityDelivered ?? 0), 0) })));
                    toast.success("CSV exportado");
                  }}><Download className="h-3.5 w-3.5" /> CSV</Button>
                </div>
                <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Data</TableHead><TableHead className="text-xs">Solicitante</TableHead><TableHead className="text-xs">Secretaria</TableHead><TableHead className="text-xs">Motivo</TableHead><TableHead className="text-xs">Status</TableHead><TableHead className="text-xs text-right">Itens</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {allRequests.filter((r: any) => {
                      if (reqStartDate && r.createdAt < new Date(reqStartDate).getTime()) return false;
                      if (reqEndDate && r.createdAt > new Date(reqEndDate + "T23:59:59").getTime()) return false;
                      return true;
                    }).map((r: any) => (
                      <TableRow key={r._id}>
                        <TableCell className="text-xs">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell className="text-sm">{r.requester?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{r.secretaria?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs truncate max-w-[200px]">{r.reason}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{r.status}</Badge></TableCell>
                        <TableCell className="text-sm text-right">{r.items?.length ?? 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table></div></CardContent></Card>
              </>
            )}
          </TabsContent>

          {/* ═══ RELATÓRIO 6: EQUIPAMENTOS ═══ */}
          <TabsContent value="assets" className="space-y-4 mt-4">
            {!allAssets ? <p className="text-muted-foreground text-sm">Carregando...</p> : (
              <>
                <div className="flex gap-2 mb-3">
                  <Badge variant="outline" className="text-xs">{allAssets.length} equipamento(s)</Badge>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { exportAssetsCSV(allAssets); toast.success("CSV exportado"); }}><Download className="h-3.5 w-3.5" /> CSV</Button>
                </div>
                <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Patrimônio</TableHead><TableHead className="text-xs">Série</TableHead><TableHead className="text-xs">Tipo</TableHead><TableHead className="text-xs">Fabricante / Modelo</TableHead><TableHead className="text-xs">Usuário</TableHead><TableHead className="text-xs">Secretaria</TableHead><TableHead className="text-xs">Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {allAssets.map((a: any) => (
                      <TableRow key={a._id}>
                        <TableCell className="text-xs font-mono">{a.patrimonyNumber ?? "—"}</TableCell>
                        <TableCell className="text-xs">{a.serialNumber ?? "—"}</TableCell>
                        <TableCell className="text-sm">{a.assetType}</TableCell>
                        <TableCell className="text-sm">{[a.manufacturer, a.model].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="text-sm">{a.responsible?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{a.organization?.name ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{a.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table></div></CardContent></Card>
              </>
            )}
          </TabsContent>

          {/* ═══ RELATÓRIO 7: GOMAQ ═══ */}
          <TabsContent value="gomaq" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total de Trocas</p><p className="text-2xl font-bold">{gomaqExchanges?.length ?? 0}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Carcaças Aguardando</p><p className="text-2xl font-bold text-orange-600">{gomaqCartridges?.filter((c: any) => c.status === "awaiting_collection").length ?? 0}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Coletas Realizadas</p><p className="text-2xl font-bold">{gomaqCollections?.length ?? 0}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Coletado</p><p className="text-2xl font-bold">{gomaqCollections?.reduce((s: number, c: any) => s + c.totalCartridges, 0) ?? 0}</p></CardContent></Card>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { if (gomaqExchanges) { exportGomaqCSV(gomaqExchanges); toast.success("CSV exportado"); } }}><Download className="h-3.5 w-3.5" /> CSV Trocas</Button>
            </div>
            {gomaqExchanges && gomaqExchanges.length > 0 && (
              <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">Data</TableHead><TableHead className="text-xs">Nº</TableHead><TableHead className="text-xs">Produto</TableHead><TableHead className="text-xs text-right">Qtd</TableHead><TableHead className="text-xs">Impressora</TableHead><TableHead className="text-xs text-right">Carcaças</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {gomaqExchanges.slice(0, 100).map((e: any) => (
                    <TableRow key={e._id}>
                      <TableCell className="text-xs">{new Date(e.exchangedAt).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-xs font-mono">{e.exchangeNumber}</TableCell>
                      <TableCell className="text-sm">{e.product?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-right">{e.quantityDelivered}</TableCell>
                      <TableCell className="text-sm">{e.printer?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-right">{e.quantityEmptyReceived}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table></div></CardContent></Card>
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
