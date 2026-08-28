import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Users as UsersIcon, Search } from "lucide-react";
import { ROLE_LABELS, type UserRole } from "@/types/constants";
import { toast } from "sonner";

export default function UsersPage() {
  const users = useQuery(api.users.listUsers);
  const orgs = useQuery(api.organizations.list);
  const updateUser = useMutation(api.users.updateUser);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [role, setRole] = useState<UserRole>("technician");
  const [orgId, setOrgId] = useState("");
  const [active, setActive] = useState(true);
  const filtered = users?.filter((u) => u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()));

  const openEdit = (u: any) => { setEditUser(u); setRole((u.role ?? "technician") as UserRole); setOrgId(u.organizationId ?? ""); setActive(u.active !== false); setDialogOpen(true); };
  const handleSave = async () => {
    if (!editUser) return;
    try { await updateUser({ userId: editUser._id, role, organizationId: orgId || undefined as any, active }); toast.success("Usuário atualizado"); setDialogOpen(false); }
    catch (e: any) { toast.error(e.message ?? "Erro ao atualizar"); }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div><h1 className="text-2xl font-bold tracking-tight">Usuários</h1><p className="text-sm text-muted-foreground">Gerenciar perfis e permissões de usuários</p></div>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 max-w-md" /></div>
        <Card className="border-border/50"><CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Perfil</TableHead><TableHead>Unidade</TableHead><TableHead>Status</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered?.map((u) => {
              const orgName = orgs?.orgs.find((o) => o._id === u.organizationId)?.name;
              return (<TableRow key={u._id}><TableCell className="font-medium">{u.name ?? "Sem nome"}</TableCell><TableCell className="text-muted-foreground text-sm">{u.email ?? "—"}</TableCell><TableCell><Badge variant="secondary" className="text-xs">{ROLE_LABELS[(u.role ?? "technician") as UserRole]}</Badge></TableCell><TableCell className="text-sm text-muted-foreground">{orgName ?? "—"}</TableCell><TableCell><Badge variant={u.active !== false ? "default" : "destructive"} className="text-[10px]">{u.active !== false ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button></TableCell></TableRow>);
            })}
            {filtered?.length === 0 && (<TableRow><TableCell colSpan={6} className="text-center py-12"><UsersIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" /><p className="text-muted-foreground">Nenhum usuário encontrado</p></TableCell></TableRow>)}
          </TableBody>
        </Table></div></CardContent></Card>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>Nome</Label><Input value={editUser?.name ?? ""} disabled /></div>
          <div><Label>E-mail</Label><Input value={editUser?.email ?? ""} disabled /></div>
          <div><Label>Perfil</Label><Select value={role} onValueChange={(v) => setRole(v as UserRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent></Select></div>
          <div><Label>Unidade Organizacional</Label><Select value={orgId} onValueChange={setOrgId}><SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger><SelectContent>{orgs?.orgs.map((o) => (<SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>))}</SelectContent></Select></div>
          <div><Label>Status</Label><Select value={active ? "active" : "inactive"} onValueChange={(v) => setActive(v === "active")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem></SelectContent></Select></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button onClick={handleSave}>Salvar</Button></DialogFooter>
      </DialogContent></Dialog>
    </AppShell>
  );
}
