import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Tags } from "lucide-react";
import { toast } from "sonner";

export default function Categories() {
  const categories = useQuery(api.categories.list);
  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const openCreate = () => { setName(""); setDescription(""); setEditingId(null); setDialogOpen(true); };
  const openEdit = (c: any) => { setName(c.name); setDescription(c.description ?? ""); setEditingId(c._id); setDialogOpen(true); };
  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nome é obrigatório"); return; }
    try {
      if (editingId) { await updateCategory({ id: editingId as any, name, description: description || undefined }); toast.success("Categoria atualizada"); }
      else { await createCategory({ name, description: description || undefined }); toast.success("Categoria criada"); }
      setDialogOpen(false);
    } catch (e: any) { toast.error(e.message ?? "Erro ao salvar"); }
  };
  const toggleActive = async (id: string, active: boolean) => {
    try { await updateCategory({ id: id as any, active: !active }); toast.success(active ? "Categoria desativada" : "Categoria ativada"); }
    catch (e: any) { toast.error(e.message ?? "Erro"); }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><h1 className="text-2xl font-bold tracking-tight">Categorias</h1><p className="text-sm text-muted-foreground">Gerenciar categorias de materiais</p></div>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Nova Categoria</Button>
        </div>
        <Card className="border-border/50"><CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Descrição</TableHead><TableHead>Status</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
          <TableBody>
            {categories?.map((c) => (<TableRow key={c._id}><TableCell className="font-medium">{c.name}</TableCell><TableCell className="text-muted-foreground">{c.description ?? "—"}</TableCell><TableCell><Badge variant={c.active ? "default" : "secondary"} className="text-[10px]">{c.active ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => toggleActive(c._id, c.active)}>{c.active ? "Desativar" : "Ativar"}</Button></div></TableCell></TableRow>))}
            {categories?.length === 0 && (<TableRow><TableCell colSpan={4} className="text-center py-12"><Tags className="h-8 w-8 mx-auto text-muted-foreground mb-2" /><p className="text-muted-foreground">Nenhuma categoria cadastrada</p></TableCell></TableRow>)}
          </TableBody>
        </Table></div></CardContent></Card>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editingId ? "Editar Categoria" : "Nova Categoria"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2"><div><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da categoria" /></div><div><Label>Descrição</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button onClick={handleSave}>{editingId ? "Salvar" : "Criar"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </AppShell>
  );
}
