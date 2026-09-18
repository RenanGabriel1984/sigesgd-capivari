import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { SearchInput } from "@/components/SearchInput";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Building, Search } from "lucide-react";
import { toast } from "sonner";

interface SupplierForm { legalName: string; tradeName: string; cnpj: string; contact: string; phone: string; email: string; address: string; observation: string; }
const emptyForm: SupplierForm = { legalName: "", tradeName: "", cnpj: "", contact: "", phone: "", email: "", address: "", observation: "" };

function LoadingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div><Skeleton className="h-8 w-36 mb-2" /><Skeleton className="h-4 w-48" /></div>
          <Skeleton className="h-9 w-36" />
        </div>
        <Skeleton className="h-10 max-w-md" />
        <Card className="border-border/50"><CardContent className="p-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-b border-border/30 last:border-b-0">
              <Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-14" />
            </div>
          ))}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}

export default function Suppliers() {
  const suppliers = useQuery(api.suppliers.list);
  const createSupplier = useMutation(api.suppliers.create);
  const updateSupplier = useMutation(api.suppliers.update);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);

  if (suppliers === undefined) return <LoadingSkeleton />;

  const filtered = suppliers.filter((s) => s.legalName.toLowerCase().includes(search.toLowerCase()) || s.tradeName?.toLowerCase().includes(search.toLowerCase()) || s.cnpj?.includes(search));

  const openCreate = () => { setForm(emptyForm); setEditingId(null); setDialogOpen(true); };
  const openEdit = (s: any) => { setForm({ legalName: s.legalName, tradeName: s.tradeName ?? "", cnpj: s.cnpj ?? "", contact: s.contact ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", observation: s.observation ?? "" }); setEditingId(s._id); setDialogOpen(true); };
  const handleSave = async () => {
    if (!form.legalName.trim()) { toast.error("Razão social é obrigatória"); return; }
    try {
      const data = { legalName: form.legalName, tradeName: form.tradeName || undefined, cnpj: form.cnpj || undefined, contact: form.contact || undefined, phone: form.phone || undefined, email: form.email || undefined, address: form.address || undefined, observation: form.observation || undefined };
      if (editingId) { await updateSupplier({ id: editingId as any, ...data }); toast.success("Fornecedor atualizado"); }
      else { await createSupplier(data); toast.success("Fornecedor criado"); }
      setDialogOpen(false);
    } catch (e: any) { toast.error(e.message ?? "Erro ao salvar"); }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
            <p className="text-sm text-muted-foreground">{suppliers.length} fornecedor(es) cadastrado(s)</p>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Novo Fornecedor</Button>
        </div>
        <div className="relative"><SearchInput placeholder="Buscar por razão social, nome fantasia ou CNPJ..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" /></div>
        <Card className="border-border/50"><CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Razão Social</TableHead><TableHead>Nome Fantasia</TableHead><TableHead>CNPJ</TableHead><TableHead>Contato</TableHead><TableHead>Status</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.map((s) => (<TableRow key={s._id}><TableCell className="font-medium">{s.legalName}</TableCell><TableCell className="text-muted-foreground">{s.tradeName ?? "—"}</TableCell><TableCell className="font-mono text-xs">{s.cnpj ?? "—"}</TableCell><TableCell className="text-sm">{s.contact ?? "—"}</TableCell><TableCell><Badge variant={s.active ? "default" : "secondary"} className="text-[10px]">{s.active ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button></TableCell></TableRow>))}
            {filtered.length === 0 && (<TableRow><TableCell colSpan={6}><div className="empty-state py-12"><Building className="empty-state-icon" /><p className="empty-state-title">{search ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}</p><p className="empty-state-desc">{search ? "Tente outro termo de busca" : "Cadastre fornecedores para registrar origens de materiais"}</p></div></TableCell></TableRow>)}
          </TableBody>
        </Table></div></CardContent></Card>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingId ? "Editar Fornecedor" : "Novo Fornecedor"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>Razão Social *</Label><Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4"><div><Label>Nome Fantasia</Label><Input value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} /></div><div><Label>CNPJ</Label><Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></div></div>
          <div className="grid grid-cols-2 gap-4"><div><Label>Contato</Label><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div><div><Label>Telefone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div></div>
          <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Endereço</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><Label>Observações</Label><Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button onClick={handleSave}>{editingId ? "Salvar" : "Criar"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </AppShell>
  );
}
