import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Edit2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

export default function StorageLocations() {
  const locations = useQuery(api.storageLocations.list);
  const createLocation = useMutation(api.storageLocations.create);
  const updateLocation = useMutation(api.storageLocations.update);

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

  const handleEdit = (loc: any) => {
    setEditId(loc._id);
    setName(loc.name);
    setDescription(loc.description ?? "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome do local é obrigatório");
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await updateLocation({ id: editId as any, name: name.trim(), description: description || undefined });
        toast.success("Local atualizado com sucesso");
      } else {
        await createLocation({ name: name.trim(), description: description || undefined });
        toast.success("Local criado com sucesso");
      }
      setDialogOpen(false);
      resetForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar local");
    }
    setSaving(false);
  };

  const handleToggle = async (loc: any) => {
    try {
      await updateLocation({ id: loc._id, active: !loc.active });
      toast.success(loc.active ? "Local desativado" : "Local ativado");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao alterar status");
    }
  };

  const activeCount = locations?.filter((l) => l.active).length ?? 0;
  const inactiveCount = (locations?.length ?? 0) - activeCount;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Locais de Armazenamento</h1>
            <p className="text-sm text-muted-foreground">
              {activeCount} ativo(s), {inactiveCount} inativo(s)
            </p>
          </div>
          <Button onClick={handleOpen} className="gap-2">
            <Plus className="h-4 w-4" /> Novo Local
          </Button>
        </div>

        {locations?.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <MapPin className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Nenhum local de armazenamento cadastrado</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations?.map((loc) => (
              <Card key={loc._id} className={`border-border/50 ${!loc.active ? "opacity-60" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-primary" />
                      <h3 className="font-medium text-sm">{loc.name}</h3>
                    </div>
                    <Badge variant={loc.active ? "default" : "secondary"} className="text-[10px]">
                      {loc.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  {loc.description && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{loc.description}</p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={() => handleEdit(loc)}>
                      <Edit2 className="h-3 w-3" /> Editar
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={() => handleToggle(loc)}>
                      {loc.active ? <ToggleRight className="h-3 w-3" /> : <ToggleLeft className="h-3 w-3" />}
                      {loc.active ? "Desativar" : "Ativar"}
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
            <DialogTitle>{editId ? "Editar Local" : "Novo Local de Armazenamento"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Armário TI 01"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Descrição opcional do local"
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
