import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Layers, Edit2, ToggleLeft, ToggleRight, ArrowRightLeft, Info } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { NO_AREA_LABEL } from "@/lib/stock-areas";

/**
 * ÁREAS / SUBESTOQUES — conceito INDEPENDENTE.
 *
 * Produto · Categoria · Fornecedor · Área/Subestoque · Local físico são
 * dimensões separadas. A área "Impressoras", por exemplo, recebe material de
 * QUALQUER fornecedor: o nome da área nunca carrega fornecedor, porque uma
 * nova licitação troca a empresa contratada sem alterar a estrutura nem o
 * histórico das entradas antigas.
 */
function StockAreasSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div>
          <Skeleton className="h-8 w-56 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

export default function StockAreas() {
  const areas = useQuery(api.stockAreas.list);
  const summary = useQuery(api.stockAreas.summary);
  const unclassifiedLots = useQuery(api.stockAreas.unclassifiedLots);
  const storageLocations = useQuery(api.storageLocations.listActive);
  const createArea = useMutation(api.stockAreas.create);
  const updateArea = useMutation(api.stockAreas.update);
  const classifyLot = useMutation(api.stockAreas.classifyLot);
  const ensureBaselineAreas = useMutation(api.stockAreas.ensureBaselineAreas);
  const navigate = useNavigate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [classificationLot, setClassificationLot] = useState<any>(null);
  const [classificationAreaId, setClassificationAreaId] = useState("");
  const [classificationLocationId, setClassificationLocationId] = useState("");
  const [classificationSaving, setClassificationSaving] = useState(false);

  if (areas === undefined) return <StockAreasSkeleton />;

  const summaryByArea = new Map((summary ?? []).map((row) => [row.areaId ?? "none", row]));
  const noAreaRow = summaryByArea.get("none");

  const resetForm = () => {
    setName("");
    setDescription("");
    setEditId(null);
  };

  const handleOpen = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleEdit = (area: { _id: string; name: string; description?: string }) => {
    setEditId(area._id);
    setName(area.name);
    setDescription(area.description ?? "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome da área é obrigatório");
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await updateArea({ id: editId as never, name: name.trim(), description: description || undefined });
        toast.success("Área/Subestoque atualizada com sucesso");
      } else {
        await createArea({ name: name.trim(), description: description || undefined });
        toast.success("Área/Subestoque criada com sucesso");
      }
      setDialogOpen(false);
      resetForm();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Não foi possível salvar a área/subestoque.";
      toast.error(message);
    }
    setSaving(false);
  };

  const handleToggle = async (area: { _id: string; name: string; active: boolean }) => {
    try {
      await updateArea({ id: area._id as never, active: !area.active });
      toast.success(area.active ? "Área desativada" : "Área ativada");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Não foi possível alterar o status da área.";
      toast.error(message);
    }
  };

  const handleOpenClassification = (lot: any) => {
    setClassificationLot(lot);
    setClassificationAreaId(lot.suggestedAreaId ?? "");
    setClassificationLocationId(lot.suggestedLocationId ?? "");
  };

  const handleClassifyLot = async () => {
    if (!classificationLot || !classificationAreaId || !classificationLocationId) {
      toast.error("Selecione a área e o local físico após conferir o lote.");
      return;
    }
    setClassificationSaving(true);
    try {
      await classifyLot({
        lotId: classificationLot.lotId as never,
        areaId: classificationAreaId as never,
        locationId: classificationLocationId as never,
      });
      toast.success(`Lote ${classificationLot.lotNumber} classificado. O saldo global não foi alterado.`);
      setClassificationLot(null);
      setClassificationAreaId("");
      setClassificationLocationId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível classificar o lote.");
    } finally {
      setClassificationSaving(false);
    }
  };

  const handleEnsureBaseline = async () => {
    setSeeding(true);
    try {
      const result = await ensureBaselineAreas({});
      toast.success(
        result.created.length
          ? `Áreas padrão criadas: ${result.created.join(", ")}`
          : "As cinco áreas padrão já estão cadastradas."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar as áreas padrão.");
    } finally {
      setSeeding(false);
    }
  };

  const activeCount = areas.filter((a) => a.active).length;
  const inactiveCount = areas.length - activeCount;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Estoque</p>
            <h1 className="text-2xl font-bold tracking-tight">Áreas / Subestoques</h1>
            <p className="text-sm text-muted-foreground">
              {activeCount} ativa(s), {inactiveCount} inativa(s) — destino de estoque escolhido na
              entrada, independente de fornecedor e categoria
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleEnsureBaseline} disabled={seeding}>
              {seeding ? "Criando..." : "Adicionar áreas padrão"}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => navigate("/transfers")}>
              <ArrowRightLeft className="h-4 w-4" /> Transferir estoque
            </Button>
            <Button onClick={handleOpen} className="gap-2">
              <Plus className="h-4 w-4" /> Nova Área
            </Button>
          </div>
        </div>

        {/* Saldo ainda sem área: não é erro — é material que só uma transferência direciona */}
        {noAreaRow && noAreaRow.lots > 0 && (
          <Card className="border-border/50 bg-muted/30">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">{noAreaRow.name || NO_AREA_LABEL}</p>
                <p className="text-muted-foreground text-xs">
                  {noAreaRow.lots} lote(s) · {noAreaRow.quantityAvailable} unidade(s) livres ainda
                  aguardam classificação consistente de área e local físico. Confira a lista de lotes
                  pendentes abaixo antes de disponibilizar esse saldo para solicitações.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {unclassifiedLots && unclassifiedLots.length > 0 && (
          <Card className="border-border/50">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">Lotes pendentes de classificação</p>
                  <p className="text-xs text-muted-foreground">
                    {unclassifiedLots.length} lote(s) com saldo ainda sem área/local consistente.
                    Confira fisicamente antes de classificar.
                  </p>
                </div>
                <Badge variant="secondary">{unclassifiedLots.reduce((sum, lot) => sum + lot.quantityAvailable, 0)} unidade(s)</Badge>
              </div>
              <div className="space-y-2">
                {unclassifiedLots.slice(0, 30).map((lot) => (
                  <div key={lot.lotId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{lot.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        Lote {lot.lotNumber} · {lot.quantityAvailable} disponível(is)
                        {lot.entryNumber ? ` · Entrada ${lot.entryNumber}` : ""}
                        {lot.invoiceNumber ? ` · NF ${lot.invoiceNumber}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Atual: {lot.currentAreaName ?? "Sem área"} / {lot.currentLocationName ?? "Sem local"}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleOpenClassification(lot)}>
                      Conferir e classificar
                    </Button>
                  </div>
                ))}
                {unclassifiedLots.length > 30 && (
                  <p className="text-xs text-muted-foreground">
                    Exibindo os primeiros 30 lotes. Classifique-os para revelar os próximos.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {areas.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <Layers className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Nenhuma área/subestoque cadastrada</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ex.: crie a área &quot;Impressoras&quot; para separar o destino de suprimentos de impressão
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {areas.map((area) => {
              const totals = summaryByArea.get(area._id);
              return (
                <Card key={area._id} className={`border-border/50 ${!area.active ? "opacity-60" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Layers className="h-4 w-4 text-primary shrink-0" />
                        <h3 className="font-medium text-sm break-words whitespace-normal">{area.name}</h3>
                      </div>
                      <Badge variant={area.active ? "default" : "secondary"} className="text-[10px] shrink-0">
                        {area.active ? "Ativa" : "Inativa"}
                      </Badge>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">
                      {totals?.lots ?? 0} lote(s) · {totals?.quantityAvailable ?? 0} livre(s)
                      {(totals as any)?.quantityReserved > 0 ? ` · ${(totals as any).quantityReserved} reservada(s)` : ""}
                    </p>
                    {area.description && (
                      <p className="text-xs text-muted-foreground mt-2 whitespace-normal break-words">
                        {area.description}
                      </p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => handleEdit(area)}>
                        <Edit2 className="h-3 w-3" /> Editar
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => handleToggle(area)}>
                        {area.active ? <ToggleRight className="h-3 w-3" /> : <ToggleLeft className="h-3 w-3" />}
                        {area.active ? "Desativar" : "Ativar"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!classificationLot} onOpenChange={(open) => { if (!open && !classificationSaving) setClassificationLot(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Classificar lote legado</DialogTitle>
          </DialogHeader>
          {classificationLot && (
            <div className="space-y-3 py-2">
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-sm font-medium">{classificationLot.productName}</p>
                <p className="text-xs text-muted-foreground">
                  Lote {classificationLot.lotNumber} · {classificationLot.quantityAvailable} unidade(s) disponíveis
                </p>
                <p className="text-xs text-muted-foreground">
                  Entrada {classificationLot.entryNumber ?? "—"} · NF {classificationLot.invoiceNumber ?? "—"}
                </p>
              </div>
              <div>
                <Label>Área / Subestoque *</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={classificationAreaId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setClassificationAreaId(next);
                    if (!(storageLocations ?? []).some((location: any) => location._id === classificationLocationId && location.areaId === next)) {
                      setClassificationLocationId("");
                    }
                  }}
                >
                  <option value="">Selecione a área...</option>
                  {areas.filter((area) => area.active).map((area) => (
                    <option key={area._id} value={area._id}>{area.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Local físico *</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={classificationLocationId}
                  onChange={(event) => setClassificationLocationId(event.target.value)}
                  disabled={!classificationAreaId}
                >
                  <option value="">Selecione o local...</option>
                  {(storageLocations ?? []).filter((location: any) =>
                    location.active && location.areaId === classificationAreaId
                  ).map((location: any) => (
                    <option key={location._id} value={location._id}>{location.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                Esta ação apenas separa o saldo legado no local/área escolhidos. Não altera a quantidade global.
                Não use para mover fisicamente o material entre locais; para isso, registre uma transferência.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClassificationLot(null)} disabled={classificationSaving}>Cancelar</Button>
            <Button onClick={handleClassifyLot} disabled={classificationSaving || !classificationAreaId || !classificationLocationId}>
              {classificationSaving ? "Classificando..." : "Confirmar classificação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Área/Subestoque" : "Nova Área/Subestoque"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Impressoras"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                A área é uma escolha de destino de estoque — fornecedor e categoria não a definem, e o
                nome da área não deve conter fornecedor.
              </p>
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Descrição opcional da área"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : editId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
