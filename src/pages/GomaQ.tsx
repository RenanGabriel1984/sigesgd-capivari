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
import { AlertTriangle, ArrowRightLeft, Package, Truck, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

export default function GomaQPage() {
  const [tab, setTab] = useState("dashboard");

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl tracking-tight font-bold">GomaQ — Gestão de Suprimentos</h1>
          <p className="text-sm text-muted-foreground">
            Controle de recebimento, troca, carcaças vazias e pedido mensal
          </p>
        </div>

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

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════════════════

function DashboardTab() {
  const awaitingCount = useQuery(api.gomaQ.awaitingCollectionCount);
  const lastCol = useQuery(api.gomaQ.lastCollection);
  const exchanges = useQuery(api.gomaQ.listExchanges, {});
  const monthlyItems = useQuery(api.gomaQ.monthlyOrder);

  const thisMonthExchanges = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return (exchanges ?? []).filter((e: any) => e.exchangedAt >= startOfMonth);
  }, [exchanges]);

  const belowIdeal = (monthlyItems ?? []).filter(
    (i: any) => i.physicalQuantity < i.minimumStock
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <p className="text-sm text-muted-foreground">Abaixo do Mínimo</p>
            </div>
            <p className="text-3xl font-bold mt-1">{belowIdeal.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">Carcaças p/ Coleta</p>
            </div>
            <p className="text-3xl font-bold mt-1">{awaitingCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-emerald-500" />
              <p className="text-sm text-muted-foreground">Trocas no Mês</p>
            </div>
            <p className="text-3xl font-bold mt-1">{thisMonthExchanges.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-violet-500" />
              <p className="text-sm text-muted-foreground">Última Coleta</p>
            </div>
            <p className="text-lg font-bold mt-1">
              {lastCol ? new Date(lastCol.collectedAt).toLocaleDateString("pt-BR") : "Nenhuma"}
            </p>
          </CardContent>
        </Card>
      </div>

      {belowIdeal.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Suprimentos Abaixo do Mínimo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Atual</TableHead>
                  <TableHead>Mínimo</TableHead>
                  <TableHead>Ideal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {belowIdeal.map((i: any) => (
                  <TableRow key={i.productId}>
                    <TableCell className="text-sm font-medium">{i.productName}</TableCell>
                    <TableCell><Badge variant="destructive">{i.physicalQuantity}</Badge></TableCell>
                    <TableCell>{i.minimumStock}</TableCell>
                    <TableCell>{i.idealStock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGES TAB
// ═══════════════════════════════════════════════════════════════════════════

function ExchangesTab() {
  const exchanges = useQuery(api.gomaQ.listExchanges, {});
  const products = useQuery(api.products.listActive);
  const printers = useQuery(api.printers.list);
  const createExchange = useMutation(api.gomaQ.createExchange);

  const [showNew, setShowNew] = useState(false);
  const [productId, setProductId] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [quantityDelivered, setQuantityDelivered] = useState(1);
  const [quantityEmptyReceived, setQuantityEmptyReceived] = useState(1);
  const [receivedByUserId, setReceivedByUserId] = useState("");
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const allUsers = useQuery(api.users.listUsers);

  const handleSubmit = async () => {
    if (!productId || !printerId) {
      toast.error("Selecione o produto e a impressora");
      return;
    }
    if (quantityDelivered <= 0) {
      toast.error("Quantidade entregue deve ser maior que zero");
      return;
    }
    if (quantityEmptyReceived < 0) {
      toast.error("Quantidade de carcaças não pode ser negativa");
      return;
    }
    if (!receivedByUserId) {
      toast.error("Selecione quem recebeu");
      return;
    }

    setSubmitting(true);
    try {
      await createExchange({
        productId: productId as any,
        printerId: printerId as any,
        quantityDelivered,
        quantityEmptyReceived,
        receivedByUserId: receivedByUserId as any,
        observation: observation || undefined,
      });
      toast.success("Troca registrada com sucesso");
      setShowNew(false);
      resetForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar troca");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setProductId("");
    setPrinterId("");
    setQuantityDelivered(1);
    setQuantityEmptyReceived(1);
    setReceivedByUserId("");
    setObservation("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Histórico de Trocas</h2>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <ArrowRightLeft className="h-4 w-4" /> Nova Troca
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {!exchanges ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : exchanges.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma troca registrada</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Nº</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Qtd</TableHead>
                    <TableHead>Impressora</TableHead>
                    <TableHead>Carcaças</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exchanges.map((e: any) => (
                    <TableRow key={e._id}>
                      <TableCell className="text-sm">{new Date(e.exchangedAt).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-xs font-mono">{e.exchangeNumber}</TableCell>
                      <TableCell className="text-sm font-medium">{e.product?.name ?? "\u2014"}</TableCell>
                      <TableCell><Badge>{e.quantityDelivered}</Badge></TableCell>
                      <TableCell className="text-sm">{e.printer?.name ?? "\u2014"}</TableCell>
                      <TableCell><Badge variant="outline">{e.quantityEmptyReceived}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" /> Nova Troca de Suprimento
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Produto (Suprimento)</Label>
              <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Selecione...</option>
                {(products ?? []).map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Impressora</Label>
              <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
                <option value="">Selecione...</option>
                {(printers ?? []).map((p: any) => <option key={p._id} value={p._id}>{p.name} ({p.model})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Qtd Entregue (novo)</Label>
                <Input type="number" min={1} value={quantityDelivered} onChange={(e) => setQuantityDelivered(Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Carcaças Recebidas</Label>
                <Input type="number" min={0} value={quantityEmptyReceived} onChange={(e) => setQuantityEmptyReceived(Number(e.target.value))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Recebido por</Label>
              <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={receivedByUserId} onChange={(e) => setReceivedByUserId(e.target.value)}>
                <option value="">Selecione...</option>
                {(allUsers ?? []).filter((u: any) => u.active !== false && u.role).map((u: any) => <option key={u._id} value={u._id}>{u.name ?? u.email ?? "Usuário"}</option>)}
              </select>
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Observações..." className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Registrando..." : "Registrar Troca"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CARTRIDGES TAB
// ═══════════════════════════════════════════════════════════════════════════

function CartridgesTab() {
  const cartridges = useQuery(api.gomaQ.listEmptyCartridges, {});
  const collections = useQuery(api.gomaQ.listCollections);
  const lastCol = useQuery(api.gomaQ.lastCollection);
  const createCollection = useMutation(api.gomaQ.createCollection);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showCollect, setShowCollect] = useState(false);
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const awaiting = (cartridges ?? []).filter((c: any) => c.status === "awaiting_collection");

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleCollect = async () => {
    if (selectedIds.length === 0) {
      toast.error("Selecione ao menos uma carcaça");
      return;
    }
    setSubmitting(true);
    try {
      await createCollection({
        cartridgeIds: selectedIds as any,
        observation: observation || undefined,
      });
      toast.success("Coleta registrada com sucesso");
      setShowCollect(false);
      setSelectedIds([]);
      setObservation("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar coleta");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Carcaças Vazias</h2>
        {awaiting.length > 0 && (
          <Button onClick={() => setShowCollect(true)} className="gap-2">
            <Truck className="h-4 w-4" /> Registrar Coleta ({selectedIds.length})
          </Button>
        )}
      </div>

      {lastCol && (
        <p className="text-sm text-muted-foreground">
          Última coleta: {new Date(lastCol.collectedAt).toLocaleDateString("pt-BR")} — {lastCol.totalCartridges} carcaça(s)
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          {!cartridges ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : awaiting.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma carcaça aguardando coleta</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Qtd</TableHead>
                    <TableHead>Impressora</TableHead>
                    <TableHead>Gerada em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {awaiting.map((c: any) => (
                    <TableRow key={c._id}>
                      <TableCell>
                        <input type="checkbox" checked={selectedIds.includes(c._id)} onChange={() => toggleSelect(c._id)} className="cursor-pointer" />
                      </TableCell>
                      <TableCell className="text-sm font-medium">{c.product?.name ?? "\u2014"}</TableCell>
                      <TableCell><Badge variant="outline">{c.quantity}</Badge></TableCell>
                      <TableCell className="text-sm">{c.printer?.name ?? "\u2014"}</TableCell>
                      <TableCell className="text-sm">{new Date(c.generatedAt).toLocaleDateString("pt-BR")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {collections && collections.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Histórico de Coletas</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Nº</TableHead>
                  <TableHead>Carcaças</TableHead>
                  <TableHead>Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((c: any) => (
                  <TableRow key={c._id}>
                    <TableCell className="text-sm">{new Date(c.collectedAt).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-xs font-mono">{c.collectionNumber}</TableCell>
                    <TableCell><Badge>{c.totalCartridges}</Badge></TableCell>
                    <TableCell className="text-sm">{c.responsible?.name ?? "\u2014"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCollect} onOpenChange={setShowCollect}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> Registrar Coleta Gomaq
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">Serão coletadas {selectedIds.length} carcaça(s).</p>
            <div>
              <Label>Observação</Label>
              <Textarea value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Observações da coleta..." className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCollect(false)}>Cancelar</Button>
            <Button onClick={handleCollect} disabled={submitting}>{submitting ? "Registrando..." : "Confirmar Coleta"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MONTHLY ORDER TAB
// ═══════════════════════════════════════════════════════════════════════════

function OrderTab() {
  const monthlyItems = useQuery(api.gomaQ.monthlyOrder);
  const exportOrder = useMutation(api.gomaQ.exportMonthlyOrder);

  const [edits, setEdits] = useState<Record<string, number>>({});
  const [observations, setObservations] = useState<Record<string, string>>({});

  const getFinalQty = (item: any) => edits[item.productId] ?? item.suggestedQuantity;

  const handleExport = async () => {
    if (!monthlyItems) return;
    const items = monthlyItems.map((item: any) => ({
      productId: item.productId as any,
      finalQuantity: getFinalQty(item),
      observation: observations[item.productId] || undefined,
    }));
    try {
      await exportOrder({ items });
      toast.success("Pedido mensal registrado com sucesso");

      // Generate CSV
      const headers = ["Produto", "Marca", "Modelo", "Compatibilidade", "Estoque Atual", "Estoque Ideal", "Qtd Solicitada", "Observação"];
      const rows = monthlyItems
        .filter((item: any) => getFinalQty(item) > 0)
        .map((item: any) => [
          item.productName,
          item.brand ?? "",
          item.model ?? "",
          item.compatibleModels.join(", "),
          item.physicalQuantity,
          item.idealStock,
          getFinalQty(item),
          observations[item.productId] ?? "",
        ]);
      const csv = [headers, ...rows].map((r) => r.join(";")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pedido-gomaq-${new Date().toISOString().slice(0, 7)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar pedido");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Pedido Mensal Gomaq</h2>
        <Button onClick={handleExport} className="gap-2">
          <FileSpreadsheet className="h-4 w-4" /> Gerar Planilha CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {!monthlyItems ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : monthlyItems.length === 0 ? (
            <p className="text-muted-foreground">Nenhum suprimento Gomaq cadastrado</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Compatibilidade</TableHead>
                    <TableHead>Atual</TableHead>
                    <TableHead>Ideal</TableHead>
                    <TableHead>Sugerido</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyItems.map((item: any) => (
                    <TableRow key={item.productId}>
                      <TableCell className="text-sm font-medium">{item.productName}</TableCell>
                      <TableCell className="text-xs">{item.compatibleModels.join(", ")}</TableCell>
                      <TableCell>{item.physicalQuantity}</TableCell>
                      <TableCell>{item.idealStock}</TableCell>
                      <TableCell>{item.suggestedQuantity}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={getFinalQty(item)}
                          onChange={(e) => setEdits({ ...edits, [item.productId]: Number(e.target.value) })}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={observations[item.productId] ?? ""}
                          onChange={(e) => setObservations({ ...observations, [item.productId]: e.target.value })}
                          placeholder="Obs..."
                          className="w-32"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
