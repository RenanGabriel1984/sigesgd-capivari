import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ClipboardCheck, Play, Eye, CheckCircle, XCircle, Package } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  counting: "Em Contagem",
  review: "Revisão",
  closed: "Fechado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "text-gray-600 bg-gray-50",
  counting: "text-amber-600 bg-amber-50",
  review: "text-blue-600 bg-blue-50",
  closed: "text-emerald-600 bg-emerald-50",
  cancelled: "text-red-600 bg-red-50",
};

// Formato retornado por api.inventory.list (inventário + contagens + joins)
type InventoryCountView = Doc<"inventoryCounts"> & {
  product: Doc<"products"> | null;
};

type InventoryView = Doc<"inventories"> & {
  responsible: Doc<"users"> | null;
  closedBy: Doc<"users"> | null;
  location: Doc<"storageLocations"> | null;
  category: Doc<"categories"> | null;
  counts: InventoryCountView[];
};

export default function Inventory() {
  const inventories = useQuery(api.inventory.list) as InventoryView[] | undefined;
  const createInventory = useMutation(api.inventory.create);
  const startCounting = useMutation(api.inventory.startCounting);
  const saveCount = useMutation(api.inventory.saveCount);
  const startReview = useMutation(api.inventory.startReview);
  const closeInventory = useMutation(api.inventory.close);
  const cancelInventory = useMutation(api.inventory.cancel);

  const [viewId, setViewId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("active");

  const viewInventory = inventories?.find((i) => i._id === viewId);
  const counts = viewInventory?.counts ?? [];

  // Count editing state
  const [countEdits, setCountEdits] = useState<Record<string, string>>({});

  if (inventories === undefined) {
    return (
      <AppShell>
        <div className="space-y-6 max-w-7xl mx-auto">
          <div>
            <Skeleton className="h-8 w-24 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  const filtered = inventories?.filter((i) => {
    if (filter === "active") return i.status !== "closed" && i.status !== "cancelled";
    if (filter === "closed") return i.status === "closed";
    if (filter === "cancelled") return i.status === "cancelled";
    return true;
  });

  const handleCreate = async () => {
    try {
      const id = await createInventory({ observation: "Inventário criado" });
      toast.success("Inventário criado com sucesso");
      setViewId(id as string);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar inventário");
    }
  };

  const handleStartCounting = async (id: string) => {
    try {
      await startCounting({ inventoryId: id as any });
      toast.success("Contagem iniciada");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao iniciar contagem");
    }
  };

  const handleSaveCount = async (countId: string) => {
    const val = countEdits[countId];
    if (val === undefined || val === "") {
      toast.error("Informe a quantidade contada");
      return;
    }
    const qty = Number(val);
    if (isNaN(qty) || qty < 0) {
      toast.error("Quantidade inválida");
      return;
    }
    try {
      await saveCount({ countId: countId as any, countedQuantity: qty });
      toast.success("Contagem salva");
      setCountEdits((prev) => {
        const next = { ...prev };
        delete next[countId];
        return next;
      });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar contagem");
    }
  };

  const handleStartReview = async (id: string) => {
    try {
      await startReview({ inventoryId: id as any });
      toast.success("Inventário em revisão");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao iniciar revisão");
    }
  };

  const handleClose = async (id: string) => {
    try {
      const result = await closeInventory({ inventoryId: id as any });
      const adj = (result as any)?.adjustments ?? 0;
      toast.success(`Inventário fechado. ${adj} ajuste(s) gerado(s).`);
      setViewId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao fechar inventário");
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelInventory({ inventoryId: id as any });
      toast.success("Inventário cancelado");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cancelar inventário");
    }
  };

  const getUncounted = (c: typeof counts) => c.filter((ct) => ct.countedQuantity === null || ct.countedQuantity === undefined);
  const getDiffs = (c: typeof counts) => c.filter((ct) => ct.difference !== null && ct.difference !== undefined && ct.difference !== 0);

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inventário</h1>
            <p className="text-sm text-muted-foreground">
              Contagem física e ajuste de estoque — {inventories?.length ?? 0} inventário(s)
            </p>
          </div>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Novo Inventário
          </Button>
        </div>

        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="active">Ativos</TabsTrigger>
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="closed">Fechados</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelados</TabsTrigger>
          </TabsList>
        </Tabs>

        {filtered?.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16">
              <div className="empty-state">
                <ClipboardCheck className="empty-state-icon" />
                <p className="empty-state-title">
                  {filter === "active" ? "Nenhum inventário ativo" : "Nenhum inventário encontrado"}
                </p>
                <p className="empty-state-desc">
                  {filter === "active" ? "Crie um inventário para iniciar a contagem física" : "Nenhum inventário encontrado com este filtro"}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered?.map((inv) => {
              const uncounted = getUncounted(inv.counts);
              const diffs = getDiffs(inv.counts);
              const isActive = viewId === inv._id;

              return (
                <Card key={inv._id} className={`border-border/50 ${isActive ? "ring-2 ring-primary/20" : ""}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-base">{inv.inventoryNumber}</CardTitle>
                        <Badge className={`text-[10px] ${STATUS_COLORS[inv.status]}`}>
                          {STATUS_LABELS[inv.status]}
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        {inv.status === "draft" && (
                          <>
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => handleStartCounting(inv._id)}>
                              <Play className="h-3 w-3" /> Iniciar Contagem
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleCancel(inv._id)}>
                              <XCircle className="h-3 w-3" /> Cancelar
                            </Button>
                          </>
                        )}
                        {inv.status === "counting" && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => handleStartReview(inv._id)}>
                            <Eye className="h-3 w-3" /> Revisar
                          </Button>
                        )}
                        {inv.status === "review" && (
                          <Button size="sm" className="gap-1" onClick={() => handleClose(inv._id)}>
                            <CheckCircle className="h-3 w-3" /> Fechar e Ajustar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setViewId(isActive ? null : inv._id)}>
                          {isActive ? "Ocultar" : "Detalhes"}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
                      <span>Criado: {new Date(inv.createdAt).toLocaleDateString("pt-BR")}</span>
                      <span>Responsável: {inv.responsible?.name ?? "—"}</span>
                      <span>{inv.counts.length} itens</span>
                      {uncounted.length > 0 && (
                        <Badge variant="destructive" className="text-[10px]">{uncounted.length} não contado(s)</Badge>
                      )}
                      {diffs.length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">{diffs.length} diferença(s)</Badge>
                      )}
                    </div>
                    {/* Progress indicator for counting/review */}
                    {(inv.status === "counting" || inv.status === "review") && inv.counts.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {inv.counts.length - uncounted.length} de {inv.counts.length} produtos conferidos
                          </span>
                          <span className="font-medium">
                            {Math.round(((inv.counts.length - uncounted.length) / inv.counts.length) * 100)}%
                          </span>
                        </div>
                        <Progress
                          value={((inv.counts.length - uncounted.length) / inv.counts.length) * 100}
                          className="h-2"
                        />
                      </div>
                    )}
                  </CardHeader>

                  {isActive && (
                    <CardContent className="pt-0">
                      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Produto</TableHead>
                              <TableHead className="text-xs text-center">Est. Sistema</TableHead>
                              <TableHead className="text-xs text-center">Contado</TableHead>
                              <TableHead className="text-xs text-center">Diferença</TableHead>
                              <TableHead className="text-xs">Observação</TableHead>
                              {(inv.status === "counting" || inv.status === "review") && (
                                <TableHead className="text-xs">Ação</TableHead>
                              )}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {counts.map((c) => {
                              const isEditing = countEdits[c._id] !== undefined;
                              const diff = c.difference;
                              return (
                                <TableRow key={c._id}>
                                  <TableCell>
                                    <p className="font-medium text-sm">{c.product?.name ?? "—"}</p>
                                    <p className="text-[10px] text-muted-foreground">{c.product?.internalCode ?? ""}</p>
                                  </TableCell>
                                  <TableCell className="text-center font-mono text-sm">{c.systemQuantity}</TableCell>
                                  <TableCell className="text-center">
                                    {c.countedQuantity !== null && c.countedQuantity !== undefined ? (
                                      <span className="font-mono text-sm">{c.countedQuantity}</span>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    {diff !== null && diff !== undefined ? (
                                      <span className={`font-mono text-sm font-semibold ${diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                        {diff > 0 ? "+" : ""}{diff}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                                    {c.observation ?? "—"}
                                  </TableCell>
                                  {(inv.status === "counting" || inv.status === "review") && (
                                    <TableCell>
                                      <div className="flex items-center gap-1">
                                        <Input
                                          type="number"
                                          min="0"
                                          className="w-20 h-7 text-xs"
                                          placeholder={String(c.systemQuantity)}
                                          value={countEdits[c._id] ?? ""}
                                          onChange={(e) => setCountEdits((prev) => ({ ...prev, [c._id]: e.target.value }))}
                                        />
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 px-2"
                                          onClick={() => handleSaveCount(c._id)}
                                        >
                                          Salvar
                                        </Button>
                                      </div>
                                    </TableCell>
                                  )}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
