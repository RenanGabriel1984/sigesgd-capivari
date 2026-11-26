import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  ArrowUpRight,
  Building2,
  Download,
  FileSpreadsheet,
  Printer,
  Share2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

type Period = "15d" | "30d" | "90d" | "6m" | "12m";
type Dimension = "secretaria" | "departamento" | "unidade" | "produto" | "categoria";
type Payload = NonNullable<ReturnType<typeof useConsumptionQuery>>;
type HierarchyRow = Payload["current"]["hierarchy"][number];

function useConsumptionQuery() {
  return useQuery(api.stockIntelligence.consumptionByOrganization, { period: "12m" });
}

function currency(value: number | null): string {
  return value === null
    ? "Custo não informado"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function number(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCSV(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function filterKey(value: string | null): string {
  return value ?? "__none__";
}

function groupDetails(rows: HierarchyRow[], dimension: Dimension) {
  type Group = {
    key: string;
    label: string;
    quantity: number;
    exits: number;
    cost: number | null;
    costKnown: boolean;
  };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    let key = "";
    let label = "";
    if (dimension === "secretaria") {
      key = filterKey(row.secretariaId) + "|" + row.secretariaName;
      label = row.secretariaName;
    } else if (dimension === "departamento") {
      key = filterKey(row.departamentoId) + "|" + row.departamentoName;
      label = row.departamentoName;
    } else if (dimension === "unidade") {
      key = filterKey(row.unidadeId) + "|" + row.unidadeName;
      label = row.unidadeName;
    } else if (dimension === "produto") {
      key = row.productId;
      label = row.productName;
    } else {
      key = row.categoryName;
      label = row.categoryName;
    }
    const group = groups.get(key) ?? {
      key,
      label,
      quantity: 0,
      exits: 0,
      cost: 0,
      costKnown: true,
    };
    group.quantity += row.quantity;
    group.exits += row.exitCount;
    if (row.cost === null) group.costKnown = false;
    else group.cost = (group.cost ?? 0) + row.cost;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, cost: group.costKnown ? group.cost : null }))
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, "pt-BR"));
}

function optionsFor(rows: HierarchyRow[], field: "secretaria" | "departamento" | "unidade" | "produto") {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = field === "secretaria" ? row.secretariaId
      : field === "departamento" ? row.departamentoId
      : field === "unidade" ? row.unidadeId
      : row.productId;
    const label = field === "secretaria" ? row.secretariaName
      : field === "departamento" ? row.departamentoName
      : field === "unidade" ? row.unidadeName
      : row.productName;
    map.set(filterKey(id), label);
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function matchesFilters(
  row: HierarchyRow,
  filters: { secretaria: string; departamento: string; unidade: string; produto: string },
) {
  return (filters.secretaria === "all" || filterKey(row.secretariaId) === filters.secretaria) &&
    (filters.departamento === "all" || filterKey(row.departamentoId) === filters.departamento) &&
    (filters.unidade === "all" || filterKey(row.unidadeId) === filters.unidade) &&
    (filters.produto === "all" || filterKey(row.productId) === filters.produto);
}

function summarize(rows: HierarchyRow[]) {
  return {
    products: new Set(rows.map((row) => row.productId)).size,
    exits: rows.reduce((sum, row) => sum + row.exitCount, 0),
    cost: rows.length > 0 && rows.every((row) => row.cost !== null)
      ? rows.reduce((sum, row) => sum + (row.cost ?? 0), 0)
      : null,
    unknownCosts: rows.filter((row) => row.cost === null).length,
  };
}

function percentChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "Novo no período" : "Sem base comparativa";
  const delta = ((current - previous) / previous) * 100;
  const formatted = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Math.abs(delta));
  return delta > 0 ? `+${formatted}%` : delta < 0 ? `-${formatted}%` : "0%";
}

export function ConsumptionManagement() {
  const [period, setPeriod] = useState<Period>("12m");
  const data = useQuery(api.stockIntelligence.consumptionByOrganization, { period });
  const [dimension, setDimension] = useState<Dimension>("secretaria");
  const [secretaria, setSecretaria] = useState("all");
  const [departamento, setDepartamento] = useState("all");
  const [unidade, setUnidade] = useState("all");
  const [produto, setProduto] = useState("all");

  const allRows = useMemo(
    () => data ? [...data.current.hierarchy, ...data.previous.hierarchy] : [],
    [data],
  );
  const secretariaOptions = useMemo(() => optionsFor(allRows, "secretaria"), [allRows]);
  const departmentSource = useMemo(
    () => allRows.filter((row) => secretaria === "all" || filterKey(row.secretariaId) === secretaria),
    [allRows, secretaria],
  );
  const departamentoOptions = useMemo(() => optionsFor(departmentSource, "departamento"), [departmentSource]);
  const unitSource = useMemo(
    () => departmentSource.filter((row) => departamento === "all" || filterKey(row.departamentoId) === departamento),
    [departmentSource, departamento],
  );
  const unidadeOptions = useMemo(() => optionsFor(unitSource, "unidade"), [unitSource]);
  const productSource = useMemo(
    () => unitSource.filter((row) => unidade === "all" || filterKey(row.unidadeId) === unidade),
    [unitSource, unidade],
  );
  const productOptions = useMemo(() => optionsFor(productSource, "produto"), [productSource]);

  const currentRows = useMemo(
    () => (data?.current.hierarchy ?? []).filter((row) => matchesFilters(row, { secretaria, departamento, unidade, produto })),
    [data, secretaria, departamento, unidade, produto],
  );
  const previousRows = useMemo(
    () => (data?.previous.hierarchy ?? []).filter((row) => matchesFilters(row, { secretaria, departamento, unidade, produto })),
    [data, secretaria, departamento, unidade, produto],
  );
  const currentSummary = useMemo(() => summarize(currentRows), [currentRows]);
  const previousSummary = useMemo(() => summarize(previousRows), [previousRows]);

  const currentGroups = useMemo(() => groupDetails(currentRows, dimension), [currentRows, dimension]);
  const previousGroups = useMemo(() => groupDetails(previousRows, dimension), [previousRows, dimension]);
  const comparisonRows = useMemo(() => {
    const previousByKey = new Map(previousGroups.map((row) => [row.key, row]));
    const currentByKey = new Map(currentGroups.map((row) => [row.key, row]));
    const keys = new Set([...currentByKey.keys(), ...previousByKey.keys()]);
    return [...keys].map((key) => {
      const current = currentByKey.get(key);
      const previous = previousByKey.get(key);
      return {
        key,
        label: current?.label ?? previous?.label ?? "—",
        quantity: current?.quantity ?? 0,
        exits: current?.exits ?? 0,
        cost: current?.cost ?? null,
        previousQuantity: previous?.quantity ?? 0,
        previousExits: previous?.exits ?? 0,
        change: percentChange(
          dimension === "produto" || dimension === "categoria"
            ? current?.quantity ?? 0
            : current?.exits ?? 0,
          dimension === "produto" || dimension === "categoria"
            ? previous?.quantity ?? 0
            : previous?.exits ?? 0,
        ),
        currentCost: current?.cost ?? null,
        previousCost: previous?.cost ?? null,
        costChange: current?.cost == null || previous?.cost == null
          ? "Não comparável"
          : percentChange(current.cost, previous.cost),
      };
    }).sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, "pt-BR"));
  }, [currentGroups, previousGroups]);

  const chartUsesQuantity = dimension === "produto" || dimension === "categoria";
  const maxChartQuantity = Math.max(1, ...currentGroups.slice(0, 7).map((row) => chartUsesQuantity ? row.quantity : row.exits));
  const periodLabel = data?.periodLabel ?? "Período selecionado";
  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).toLocaleString("pt-BR") : "";

  function exportRows() {
    return currentRows.map((row) => [
      row.secretariaName,
      row.departamentoName,
      row.unidadeName,
      row.productName,
      row.categoryName,
      row.unitOfMeasure,
      row.reason,
      row.quantity,
      row.exitCount,
      row.cost ?? "Custo não informado",
    ]);
  }

  function exportExcel() {
    if (!data || currentRows.length === 0) {
      toast.error("Não há dados para exportar com os filtros atuais.");
      return;
    }
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ["RELATÓRIO GERENCIAL DE CONSUMO — SIGESGD CAPIVARI"],
      ["Período", periodLabel],
      ["Gerado em", generatedAt],
      ["Secretaria", secretariaOptions.find((item) => item.value === secretaria)?.label ?? "Todas"],
      ["Departamento", departamentoOptions.find((item) => item.value === departamento)?.label ?? "Todos"],
      ["Unidade", unidadeOptions.find((item) => item.value === unidade)?.label ?? "Todas"],
      ["Produto", productOptions.find((item) => item.value === produto)?.label ?? "Todos"],
      [],
      ["Indicador", "Período atual", "Período anterior"],
      ["Produtos distintos com saída", currentSummary.products, previousSummary.products],
      ["Saídas registradas", currentSummary.exits, previousSummary.exits],
      ["Custo identificado", currentSummary.cost ?? "Custo não informado", previousSummary.cost ?? "Custo não informado"],
      ["Combinações sem custo", currentSummary.unknownCosts, previousSummary.unknownCosts],
      [],
      ["Nota", data.current.note],
    ]);
    const detailSheet = XLSX.utils.aoa_to_sheet([
      ["Secretaria", "Departamento", "Unidade", "Produto", "Categoria", "Unidade de medida", "Motivo/observação registrada", "Quantidade", "Saídas", "Custo"],
      ...exportRows(),
    ]);
    const workbook = XLSX.utils.book_new();
    const comparisonSheet = XLSX.utils.aoa_to_sheet([
      ["Grupo", "Quantidade atual", "Quantidade anterior", "Variação da quantidade", "Custo atual", "Custo anterior", "Variação do custo"],
      ...comparisonRows.map((row) => [row.label, row.quantity, row.previousQuantity, row.change, row.currentCost ?? "Custo não informado", row.previousCost ?? "Custo não informado", row.costChange]),
    ]);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo executivo");
    XLSX.utils.book_append_sheet(workbook, comparisonSheet, "Comparativo");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalhamento");
    XLSX.writeFile(workbook, "relatorio-gerencial-consumo-sigesgd.xlsx");
    toast.success("Planilha Excel exportada.");
  }

  function exportCsv() {
    if (currentRows.length === 0) {
      toast.error("Não há dados para exportar com os filtros atuais.");
      return;
    }
    downloadCSV("detalhamento-gerencial-consumo.csv", [
      ["Secretaria", "Departamento", "Unidade", "Produto", "Categoria", "Unidade de medida", "Justificativa registrada", "Quantidade", "Saídas", "Custo"],
      ...exportRows(),
    ]);
    toast.success("CSV exportado.");
  }

  async function shareSummary() {
    const summary = [
      "RELATÓRIO GERENCIAL DE CONSUMO — SIGESGD CAPIVARI",
      `Período: ${periodLabel}`,
      `Gerado em: ${generatedAt}`,
      `Produtos distintos com saída: ${number(currentSummary.products)}`,
      `Saídas registradas: ${number(currentSummary.exits)}`,
      `Custo identificado no período atual: ${currency(currentSummary.cost)}`,
      `Custo identificado no período anterior: ${currency(previousSummary.cost)}`,
      `Produtos distintos com saída: ${number(currentSummary.products)} (período anterior: ${number(previousSummary.products)})`,
      `Variação na frequência de saídas: ${percentChange(currentSummary.exits, previousSummary.exits)}`,
      "A frequência de saídas permite comparar órgãos sem misturar unidades de medida. Quantidades devem ser analisadas por produto/categoria. Os custos só aparecem quando há informação confiável para todas as movimentações do agrupamento.",
    ].join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Relatório gerencial de consumo — SIGESGD", text: summary });
      } else {
        await navigator.clipboard.writeText(summary);
        toast.success("Resumo copiado. Anexe a planilha ou o PDF ao encaminhar.");
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        toast.error("Não foi possível compartilhar. Use a opção Copiar pelo navegador.");
      }
    }
  }

  return (
    <div className="space-y-4" id="consumption-management-report">
      <Card className="border-border/50 print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-sm">Filtros do relatório</p>
            <p className="text-xs text-muted-foreground">Altere o período e refine a análise por estrutura administrativa ou produto.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Período</Label>
              <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15d">Quinzenal · 15 dias</SelectItem>
                  <SelectItem value="30d">Mensal · 30 dias</SelectItem>
                  <SelectItem value="90d">Trimestral · 90 dias</SelectItem>
                  <SelectItem value="6m">Semestral · 6 meses</SelectItem>
                  <SelectItem value="12m">Anual · últimos 12 meses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Secretaria</Label>
              <Select value={secretaria} onValueChange={(value) => { setSecretaria(value); setDepartamento("all"); setUnidade("all"); setProduto("all"); }}>
                <SelectTrigger><SelectValue placeholder="Todas as Secretarias" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Secretarias</SelectItem>
                  {secretariaOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Departamento</Label>
              <Select value={departamento} onValueChange={(value) => { setDepartamento(value); setUnidade("all"); setProduto("all"); }}>
                <SelectTrigger><SelectValue placeholder="Todos os Departamentos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Departamentos</SelectItem>
                  {departamentoOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unidade</Label>
              <Select value={unidade} onValueChange={(value) => { setUnidade(value); setProduto("all"); }}>
                <SelectTrigger><SelectValue placeholder="Todas as Unidades" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Unidades</SelectItem>
                  {unidadeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Produto</Label>
              <Select value={produto} onValueChange={setProduto}>
                <SelectTrigger><SelectValue placeholder="Todos os Produtos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Produtos</SelectItem>
                  {productOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setSecretaria("all"); setDepartamento("all"); setUnidade("all"); setProduto("all"); setDimension("secretaria"); }}
            >
              Limpar filtros
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={exportExcel} disabled={!data}>
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
                <Download className="h-4 w-4 mr-1.5" /> CSV
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()} disabled={!data}>
                <Printer className="h-4 w-4 mr-1.5" /> Imprimir / PDF
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void shareSummary()} disabled={!data}>
                <Share2 className="h-4 w-4 mr-1.5" /> Compartilhar resumo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!data ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Carregando inteligência de consumo…</CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Visão executiva</h2>
              <p className="text-xs text-muted-foreground">{periodLabel} · comparação com a janela imediatamente anterior · gerado em {generatedAt}</p>
            </div>
            <Badge variant={data.current.withoutHistory ? "secondary" : "outline"}>
              {data.current.withoutHistory ? "Sem saídas no período" : "Baseada em saídas reais"}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Card className="border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Produtos distintos consumidos</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{number(currentSummary.products)}</p>
                <p className="text-xs text-muted-foreground mt-1">Anterior: {number(previousSummary.products)}</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Saídas registradas</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{number(currentSummary.exits)}</p>
                <p className="text-xs text-muted-foreground mt-1">Anterior: {number(previousSummary.exits)} · {percentChange(currentSummary.exits, previousSummary.exits)}</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Custo identificado</CardTitle></CardHeader>
              <CardContent>
                <p className="text-lg font-semibold tabular-nums">{currency(currentSummary.cost)}</p>
                <p className="text-xs text-muted-foreground mt-1">Anterior: {currency(previousSummary.cost)} · {currentSummary.unknownCosts} combinação(ões) sem custo confiável</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Variação no número de saídas</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  {currentSummary.exits > previousSummary.exits
                    ? <TrendingUp className="h-5 w-5 text-amber-600" />
                    : currentSummary.exits < previousSummary.exits
                    ? <TrendingDown className="h-5 w-5 text-emerald-600" />
                    : <ArrowUpRight className="h-5 w-5 text-muted-foreground" />}
                  <p className="text-xl font-semibold tabular-nums">{percentChange(currentSummary.exits, previousSummary.exits)}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Frequência de retiradas em relação à janela anterior; não mistura unidades de medida.</p>
              </CardContent>
            </Card>
          </div>

          {currentRows.length === 0 ? (
            <Card><CardContent className="py-10 text-center">
              <Building2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhuma saída real corresponde aos filtros.</p>
              <p className="text-xs text-muted-foreground mt-1">Isso não significa necessariamente consumo zero: verifique o período e os vínculos das solicitações.</p>
            </CardContent></Card>
          ) : (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card className="border-border/50">
                  <CardHeader className="flex flex-row items-center justify-between gap-3">
                    <CardTitle className="text-sm">Onde está concentrado o consumo?</CardTitle>
                    <Select value={dimension} onValueChange={(value) => setDimension(value as Dimension)}>
                      <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="secretaria">Por Secretaria</SelectItem>
                        <SelectItem value="departamento">Por Departamento</SelectItem>
                        <SelectItem value="unidade">Por Unidade</SelectItem>
                        <SelectItem value="produto">Por Produto</SelectItem>
                        <SelectItem value="categoria">Por Categoria</SelectItem>
                      </SelectContent>
                    </Select>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {chartUsesQuantity ? "Quantidade por produto/categoria (unidades de medida podem variar entre produtos)." : "Frequência de saídas por grupo, sem somar unidades de medida diferentes."}
                    </p>
                    {currentGroups.slice(0, 7).map((group) => {
                      const value = chartUsesQuantity ? group.quantity : group.exits;
                      return (
                        <div key={group.key} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium truncate">{group.label}</span>
                            <span className="tabular-nums text-muted-foreground">{number(value)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, value / maxChartQuantity * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader><CardTitle className="text-sm">Comparativo com o período anterior</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Grupo</TableHead>
                          <TableHead className="text-right">{dimension === "produto" || dimension === "categoria" ? "Qtd. atual" : "Saídas atuais"}</TableHead>
                          <TableHead className="text-right">{dimension === "produto" || dimension === "categoria" ? "Qtd. anterior" : "Saídas anteriores"}</TableHead>
                          <TableHead className="text-right">Variação</TableHead>
                          <TableHead className="text-right">Custo atual</TableHead>
                          <TableHead className="text-right">Custo anterior</TableHead>
                          <TableHead className="text-right">Var. custo</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {comparisonRows.slice(0, 8).map((row) => (
                            <TableRow key={row.key}>
                              <TableCell className="text-xs font-medium max-w-[160px] truncate">{row.label}</TableCell>
                              <TableCell className="text-right text-xs tabular-nums">{number(dimension === "produto" || dimension === "categoria" ? row.quantity : row.exits)}</TableCell>
                              <TableCell className="text-right text-xs tabular-nums">{number(dimension === "produto" || dimension === "categoria" ? row.previousQuantity : row.previousExits)}</TableCell>
                              <TableCell className="text-right text-xs">
                                <span className={row.quantity > row.previousQuantity ? "text-amber-700" : row.quantity < row.previousQuantity ? "text-emerald-700" : "text-muted-foreground"}>
                                  {row.change}
                                </span>
                              </TableCell>
                              <TableCell className="text-right text-xs whitespace-nowrap">{currency(row.currentCost)}</TableCell>
                              <TableCell className="text-right text-xs whitespace-nowrap">{currency(row.previousCost)}</TableCell>
                              <TableCell className="text-right text-xs whitespace-nowrap">{row.costChange}</TableCell>
                            </TableRow>
                          ))}
                          {comparisonRows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Sem dados comparáveis.</TableCell></TableRow>}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-sm">Cruzamento por órgão e produto</CardTitle>
                  <p className="text-xs text-muted-foreground">Detalhamento que permite localizar onde cada material foi consumido e comparar a distribuição entre as áreas administrativas.</p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Secretaria</TableHead>
                        <TableHead>Departamento</TableHead>
                        <TableHead>Unidade</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Unidade</TableHead>
                        <TableHead>Justificativa registrada</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                        <TableHead className="text-right">Saídas</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {currentRows.slice(0, 100).map((row, index) => (
                          <TableRow key={`${row.secretariaId}|${row.departamentoId}|${row.unidadeId}|${row.productId}|${index}`}>
                            <TableCell className="text-xs">{row.secretariaName}</TableCell>
                            <TableCell className="text-xs">{row.departamentoName}</TableCell>
                            <TableCell className="text-xs">{row.unidadeName}</TableCell>
                            <TableCell className="text-xs font-medium">{row.productName}<span className="block text-[10px] text-muted-foreground">{row.categoryName}</span></TableCell>
                            <TableCell className="text-xs">{row.unitOfMeasure}</TableCell>
                            <TableCell className="text-xs min-w-[180px]">{row.reason}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{number(row.quantity)}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{number(row.exitCount)}</TableCell>
                            <TableCell className="text-right text-xs whitespace-nowrap">{currency(row.cost)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {currentRows.length > 100 && <p className="px-4 py-2 text-xs text-muted-foreground">Exibindo as primeiras 100 combinações. A exportação contém todas as linhas filtradas.</p>}
                </CardContent>
              </Card>
            </>
          )}

          <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
            <p>{data.current.note} Motivos e observações refletem o que foi registrado na solicitação/saída; o sistema não presume a causa de uma variação. Custos não identificados não são tratados como zero nem substituídos por estimativas.</p>
            <p>O relatório contém somente movimentações do tipo saída, não canceladas e não vinculadas a devoluções.</p>
          </div>
        </>
      )}
    </div>
  );
}

export default ConsumptionManagement;
