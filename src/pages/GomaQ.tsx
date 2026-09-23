import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ArrowRightLeft, Package, Truck, FileSpreadsheet, ShoppingCart, Printer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useNavigate } from "react-router";

function GomaQSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-56 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-10 w-80" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </AppShell>
  );
}

export default function GomaQPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("dashboard");
  const stats = useQuery(api.gomaQ.awaitingCollectionCount);
  const lastCol = useQuery(api.gomaQ.lastCollection);
  const exchanges = useQuery(api.gomaQ.listExchanges, {});
  const monthlyOrder = useQuery(api.gomaQ.monthlyOrder);

  if (stats === undefined || lastCol === undefined) return <GomaQSkeleton />;

  const thisMonthExchanges = exchanges?.filter(
    (e) => e.exchangedAt >= new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  ).length ?? 0;

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Equipamentos · Impressoras
            </p>
            <h1 className="text-2xl tracking-tight font-bold">
              Gestão de Suprimentos de Impressão
            </h1>
            <p className="text-sm text-muted-foreground">
              Recebimento, troca de suprimentos, carcaças vazias e pedido mensal. O fornecedor de
              cada coleta é dado cadastral/histórico — a estrutura da Secretaria não depende dele.
            </p>
          </div>
          <Button variant="outline" className="gap-2 shrink-0" onClick={() => navigate("/printers")}>
            <Printer className="h-4 w-4" /> Parque de impressoras
          </Button>
        </div>

        {/* Quick Stats — Operational First */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-border/50 card-hover">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Carcaças p/ Coleta</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 card-hover">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ArrowRightLeft className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{thisMonthExchanges}</p>
                  <p className="text-xs text-muted-foreground">Trocas no Mês</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 card-hover">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <ShoppingCart className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{monthlyOrder?.length ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Itens no Pedido</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 card-hover">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {lastCol
                      ? new Date(lastCol.collectedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Última Coleta</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="dashboard">Painel</TabsTrigger>
            <TabsTrigger value="exchanges">Trocas</TabsTrigger>
            <TabsTrigger value="cartridges">Carcaças</TabsTrigger>
            <TabsTrigger value="order">Pedido Mensal</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard"><DashboardTab /></TabsContent>
          <TabsContent value="exchanges"><ExchangesTab /></TabsContent>
          <TabsContent value="cartridges"><CartridgesTab /></TabsContent>
          <TabsContent value="order"><OrderTab /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════════════════════
function DashboardTab() {
  const stats = useQuery(api.gomaQ.awaitingCollectionCount);
  const lastCol = useQuery(api.gomaQ.lastCollection);
  const cartridges = useQuery(api.gomaQ.listEmptyCartridges, { status: "awaiting_collection" });

  if (stats === undefined) {
    return (
      <div className="space-y-3 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {stats === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-12">
            <div className="empty-state">
              <Truck className="empty-state-icon" />
              <p className="empty-state-title">Nenhuma carcaça aguardando coleta</p>
              <p className="empty-state-desc">Todas as carcaças foram coletadas ou nenhuma troca foi realizada ainda</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50 border-orange-200 bg-orange-50/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <div>
                <p className="font-medium">{stats} carcaça(s) aguardando coleta</p>
                <p className="text-xs text-muted-foreground">
                  Última coleta: {lastCol
                    ? new Date(lastCol.collectedAt).toLocaleDateString("pt-BR")
                    : "Nenhuma coleta registrada"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXCHANGES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ExchangesTab() {
  const exchanges = useQuery(api.gomaQ.listExchanges, {});
  const products = useQuery(api.products.listActive);
  const printers = useQuery(api.printers.listActive);
  const users = useQuery(api.users.listUsers);
  const createExchange = useMutation(api.gomaQ.createExchange);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    productId: "", printerId: "", quantityDelivered: "1", quantityEmptyReceived: "1",
    receivedByUserId: "", observation: "",
  });

  if (exchanges === undefined) {
    return (
      <div className="space-y-3 mt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const handleCreate = async () => {
    try {
      await createExchange({
        productId: form.productId as any,
        printerId: form.printerId as any,
        quantityDelivered: Number(form.quantityDelivered),
        quantityEmptyReceived: Number(form.quantityEmptyReceived),
        receivedByUserId: form.receivedByUserId as any,
        observation: form.observation || undefined,
      });
      toast.success("Troca registrada com sucesso");
      setShowNew(false);
      setForm({ productId: "", printerId: "", quantityDelivered: "1", quantityEmptyReceived: "1", receivedByUserId: "", observation: "" });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar troca");
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <ArrowRightLeft className="h-4 w-4" /> Nova Troca
        </Button>
      </div>

      {exchanges.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-12">
            <div className="empty-state">
              <ArrowRightLeft className="empty-state-icon" />
              <p className="empty-state-title">Nenhuma troca registrada</p>
              <p className="empty-state-desc">Registre uma troca de suprimento para iniciar o controle</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Número</TableHead>
                    <TableHead className="text-xs">Produto</TableHead>
                    <TableHead className="text-xs">Impressora</TableHead>
                    <TableHead className="text-xs text-center">Qtd</TableHead>
                    <TableHead className="text-xs text-center">Vazias</TableHead>
                    <TableHead className="text-xs">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exchanges.slice(0, 100).map((e) => (
                    <TableRow key={e._id}>
                      <TableCell className="font-mono text-xs">{e.exchangeNumber}</TableCell>
                      <TableCell className="text-sm">{e.product?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{e.printer?.name ?? "—"}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{e.quantityDelivered}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{e.quantityEmptyReceived}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(e.exchangedAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Exchange Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Troca de Suprimento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Produto</Label>
              <select className="w-full border rounded-md p-2 text-sm" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                <option value="">Selecione...</option>
                {products?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Impressora</Label>
              <select className="w-full border rounded-md p-2 text-sm" value={form.printerId} onChange={(e) => setForm({ ...form, printerId: e.target.value })}>
                <option value="">Selecione...</option>
                {printers?.map((p) => <option key={p._id} value={p._id}>{p.name} — {p.model}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Qtd Entregue</Label>
                <Input type="number" min="1" value={form.quantityDelivered} onChange={(e) => setForm({ ...form, quantityDelivered: e.target.value })} />
              </div>
              <div>
                <Label>Qtd Carcaças Vazias</Label>
                <Input type="number" min="0" value={form.quantityEmptyReceived} onChange={(e) => setForm({ ...form, quantityEmptyReceived: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Recebedor</Label>
              <select className="w-full border rounded-md p-2 text-sm" value={form.receivedByUserId} onChange={(e) => setForm({ ...form, receivedByUserId: e.target.value })}>
                <option value="">Selecione...</option>
                {users?.map((u) => <option key={u._id} value={u._id}>{u.name ?? u.email}</option>)}
              </select>
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!form.productId || !form.printerId || !form.receivedByUserId}>Registrar Troca</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// CARTRIDGES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function CartridgesTab() {
  const cartridges = useQuery(api.gomaQ.listEmptyCartridges, {});
  const collections = useQuery(api.gomaQ.listCollections);
  const createCollection = useMutation(api.gomaQ.createCollection);

  const [selected, setSelected] = useState<Set<string>>(new Set<string>());

  if (cartridges === undefined) {
    return (
      <div className="space-y-3 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const awaiting = cartridges.filter((c) => c.status === "awaiting_collection");
  const collected = cartridges.filter((c) => c.status === "collected");

  const handleCollect = async () => {
    if (selected.size === 0) { toast.error("Selecione ao menos uma carcaça"); return; }
    try {
      await createCollection({ cartridgeIds: Array.from(selected) as any });
      toast.success(`${selected.size} carcaça(s) coletada(s)`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar coleta");
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4 mt-4">
      {awaiting.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-12">
            <div className="empty-state">
              <Package className="empty-state-icon" />
              <p className="empty-state-title">Nenhuma carcaça aguardando coleta</p>
              <p className="empty-state-desc">Todas as carcaças foram coletadas</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{awaiting.length} carcaça(s) aguardando coleta</p>
            {selected.size > 0 && (
              <Button onClick={handleCollect} className="gap-2" size="sm">
                <Truck className="h-4 w-4" /> Registrar Coleta ({selected.size})
              </Button>
            )}
          </div>
          {awaiting.map((c) => (
            <Card key={c._id} className="border-border/50 card-hover cursor-pointer" onClick={() => toggle(c._id)}>
              <CardContent className="p-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(c._id)}
                  onChange={() => toggle(c._id)}
                  className="h-4 w-4 rounded"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.product?.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.printer?.name ?? "—"} • Qtd: {c.quantity}
                  </p>
                </div>
                <Badge variant="secondary" className="text-[10px]">Pendente</Badge>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {/* Collection History */}
      {collected.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium mb-3">Coletas Anteriores</h3>
          <div className="space-y-2">
            {collected.slice(0, 20).map((c) => (
              <div key={c._id} className="flex items-center justify-between text-xs text-muted-foreground p-2 rounded-lg bg-muted/30">
                <span>{c.product?.name ?? "—"}</span>
                <span>Coletado em {new Date(c.collectedAt ?? 0).toLocaleDateString("pt-BR")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// MONTHLY ORDER TAB
// ═══════════════════════════════════════════════════════════════════════════════
function OrderTab() {
  const order = useQuery(api.gomaQ.monthlyOrder);

  if (order === undefined) {
    return (
      <div className="space-y-3 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (order.length === 0) {
    return (
      <Card className="border-border/50 mt-4">
        <CardContent className="py-12">
          <div className="empty-state">
            <ShoppingCart className="empty-state-icon" />
            <p className="empty-state-title">Nenhum item para pedido</p>
            <p className="empty-state-desc">Cadastre produtos com compatibilidade de impressora para gerar o pedido mensal</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const validOrder = order.filter((o): o is NonNullable<typeof o> => o !== null && o !== undefined);
  const toExport = validOrder.map((o) => ({
    Produto: o.productName,
    Marca: o.brand ?? "",
    Modelo: o.model ?? "",
    Compatibilidade: o.compatibleModels.join(", "),
    "Em Estoque": o.physicalQuantity,
    Ideal: o.idealStock,
    "Sugerido": o.suggestedQuantity,
  }));

  const exportCSV = () => {
    const headers = Object.keys(toExport[0]);
    const csv = [headers.join(","), ...toExport.map((r) => headers.map((h) => `"${String(r[h as keyof typeof r]).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedido-gomaq-${new Date().toISOString().slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2">
          <FileSpreadsheet className="h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      {/* Desktop Table */}
      <Card className="border-border/50 hidden sm:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Produto</TableHead>
                  <TableHead className="text-xs">Compatibilidade</TableHead>
                  <TableHead className="text-xs text-center">Estoque</TableHead>
                  <TableHead className="text-xs text-center">Ideal</TableHead>
                  <TableHead className="text-xs text-center">Sugerido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>                  {validOrder.map((o, i) => (
                    <TableRow key={i}>
                    <TableCell>
                      <p className="font-medium text-sm">{o.productName}</p>
                      <p className="text-[10px] text-muted-foreground">{o.brand} {o.model}</p>
                    </TableCell>
                    <TableCell className="text-xs">{o.compatibleModels.join(", ")}</TableCell>
                    <TableCell className="text-center font-mono text-sm">{o.physicalQuantity}</TableCell>
                    <TableCell className="text-center font-mono text-sm">{o.idealStock}</TableCell>
                    <TableCell className="text-center">
                      <span className={`font-mono text-sm font-semibold ${o.suggestedQuantity > 0 ? "text-primary" : "text-muted-foreground"}`}>
                        {o.suggestedQuantity}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-3">
        {validOrder.map((o, i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-3">
              <p className="font-medium text-sm mb-1">{o.productName}</p>
              <p className="text-xs text-muted-foreground mb-2">{o.compatibleModels.join(", ")}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold font-mono">{o.physicalQuantity}</p>
                  <p className="text-[10px] text-muted-foreground">Estoque</p>
                </div>
                <div>
                  <p className="text-lg font-bold font-mono">{o.idealStock}</p>
                  <p className="text-[10px] text-muted-foreground">Ideal</p>
                </div>
                <div>
                  <p className={`text-lg font-bold font-mono ${o.suggestedQuantity > 0 ? "text-primary" : "text-muted-foreground"}`}>{o.suggestedQuantity}</p>
                  <p className="text-[10px] text-muted-foreground">Sugerido</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
