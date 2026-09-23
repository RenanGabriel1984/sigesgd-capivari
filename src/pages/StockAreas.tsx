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
import { Plus, Layers, Edit2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

/**
 * ÁREAS / SUBESTOQUES — conceito INDEPENDENTE.
 *
 * Produto · Categoria · Fornecedor · Área/Subestoque · Local físico são
 * dimensões separadas. Ex.: a área "Impressoras / Gomaq" pode receber
 * material de QUALQUER fornecedor (a área nunca é derivada do fornecedor
 * nem da categoria).
 */
export default function StockAreas() {
  const areas = useQuery(api.stockAreas.list);
  const createArea = useMutation(api.stockAreas.create);
  const updateArea = useMutation(api.stockAreas.update);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName("");
    setDescription("");
    setEditId(null);
  };

  const handleOpen = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleEdit = (area: any) => {
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
        await updateArea({ id: editId as any, name: name.trim(), description: description || undefined });
        toast.success("Área/Subestoque atualizada com sucesso");
      } else {
        await createArea({ name: name.trim(), description: description || undefined });
        toast.success("Área/Subestoque criada com sucesso");
      }
      setDialogOpen(false);
      resetForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar área");
    }
    setSaving(false);
  };

  const handleToggle = async (area: any) => {
    try {
      await updateArea({ id: area._id, active: !area.active });
      toast.success(area.active ? "Área desativada" : "Área ativada");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao alterar status");
    }
  };

  const activeCount = areas?.filter((a) => a.active).length ?? 0;
  const inactiveCount = (areas?.length ?? 0) - activeCount;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Áreas / Subestoques</h1>
            <p className="text-sm text-muted-foreground">
              {activeCount} ativa(s), {inactiveCount} inativa(s) — destino de estoque escolhido na entrada, independente de fornecedor e categoria
            </p>
          </div>
          <Button onClick={handleOpen} className="gap-2">
            <Plus className="h-4 w-4" /> Nova Área
          </Button>
        </div>

        {areas?.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <Layers className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Nenhuma área/subestoque cadastrada</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ex.: crie a área "Impressoras / Gomaq" para separar esse destino de estoque
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {areas?.map((area) => (
              <Card key={area._id} className={`border-border/50 ${!area.active ? "opacity-60" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Layers className="h-4 w-4 text-primary shrink-0" />
                      <h3 className="font-medium text-sm break-words whitespace-normal">{area.name}</h3>
                    </div>
                    <Badge variant={area.active ? "default" : "secondary"} className="text-[10px] shrink-0">
                      {area.active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  {area.description && (
                    <p className="text-xs text-muted-foreground mb-3 whitespace-normal break-words">{area.description}</p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={() => handleEdit(area)}>
                      <Edit2 className="h-3 w-3" /> Editar
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={() => handleToggle(area)}>
                      {area.active ? <ToggleRight className="h-3 w-3" /> : <ToggleLeft className="h-3 w-3" />}
                      {area.active ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

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
                placeholder="Ex: Impressoras / Gomaq"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                A área é uma escolha de destino de estoque — fornecedor e categoria não a definem.
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
