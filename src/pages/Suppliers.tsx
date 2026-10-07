import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { SearchInput } from "@/components/SearchInput";
import { FreeFieldNotice } from "@/components/FreeFieldNotice";
import { SupplierForm } from "@/components/SupplierForm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Building } from "lucide-react";
import { toast } from "sonner";
import { formatCnpj, digitsOnly } from "@/lib/br-validators";

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
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (suppliers === undefined) return <LoadingSkeleton />;

  // Busca ignorando máscara: digitos vs dígitos para CNPJ/telefone/CEP.
  const term = search.trim().toLowerCase();
  const termDigits = digitsOnly(search);
  const filtered = suppliers.filter((s) => {
    if (!term) return true;
    if (s.legalName.toLowerCase().includes(term)) return true;
    if (s.tradeName?.toLowerCase().includes(term)) return true;
    if (termDigits && s.cnpj && digitsOnly(s.cnpj).includes(termDigits)) return true;
    return false;
  });

  const openCreate = () => { setEditingId(null); setDialogOpen(true); };
  const openEdit = (id: string) => { setEditingId(id); setDialogOpen(true); };

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
            {filtered.map((s) => (<TableRow key={s._id}><TableCell className="font-medium">{s.legalName}</TableCell><TableCell className="text-muted-foreground">{s.tradeName ?? "—"}</TableCell><TableCell className="font-mono text-xs">{s.cnpj ? formatCnpj(s.cnpj) : "—"}</TableCell><TableCell className="text-sm">{s.contact ?? "—"}</TableCell><TableCell><Badge variant={s.active ? "default" : "secondary"} className="text-[10px]">{s.active ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(s._id)}><Pencil className="h-4 w-4" /></Button></TableCell></TableRow>))}
            {filtered.length === 0 && (<TableRow><TableCell colSpan={6}><div className="empty-state py-12"><Building className="empty-state-icon" /><p className="empty-state-title">{search ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}</p><p className="empty-state-desc">{search ? "Tente outro termo de busca" : "Cadastre fornecedores para registrar origens de materiais"}</p></div></TableCell></TableRow>)}
          </TableBody>
        </Table></div></CardContent></Card>

        <FreeFieldNotice />
      </div>

      {/* Formulário padrão: dados cadastrais + endereço estruturado + máscaras.
          Endereço legado (addressLegacy) é preservado como referência. */}
      <SupplierForm
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingId(null); }}
        mode={editingId ? "edit" : "create"}
        supplierId={editingId}
        onCreated={() => toast.success("Fornecedor criado")}
      />
    </AppShell>
  );
}
