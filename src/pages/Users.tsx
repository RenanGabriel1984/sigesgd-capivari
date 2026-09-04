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
import { Pencil, Users as UsersIcon, Search, Plus, UserCheck, UserX, Key, Shield } from "lucide-react";
import { ROLE_LABELS, type UserRole } from "@/types/constants";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function LoadingSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div><Skeleton className="h-8 w-24 mb-2" /><Skeleton className="h-4 w-48" /></div>
        <Skeleton className="h-10 max-w-md" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </AppShell>
  );
}

export default function UsersPage() {
  const users = useQuery(api.users.listUsers);
  const orgs = useQuery(api.organizations.list);
  const createUser = useMutation(api.users.createUser);
  const updateUser = useMutation(api.users.updateUser);
  const activateUser = useMutation(api.users.activateUser);
  const deactivateUser = useMutation(api.users.deactivateUser);
  const createPassword = useMutation(api.passwords.createPassword);
  const adminResetPassword = useMutation(api.passwords.adminResetPassword);

  if (users === undefined) return <LoadingSkeleton />;

  const [search, setSearch] = useState("");
  const [editDialog, setEditDialog] = useState(false);
  const [createDialog, setCreateDialog] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<{ userId: any; userName: string; isNew: boolean } | null>(null);
  const [editUser, setEditUser] = useState<any>(null);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("technician");
  const [orgId, setOrgId] = useState("");
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState("");
  const [tempPassword, setTempPassword] = useState("");

  const filtered = users?.filter((u: any) =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setName(""); setEmail(""); setRole("technician"); setOrgId(""); setTempPassword("");
    setCreateDialog(true);
  };

  const openEdit = (u: any) => {
    setEditUser(u);
    setRole((u.role ?? "technician") as UserRole);
    setOrgId(u.organizationId ?? "");
    setActive(u.active !== false);
    setEditDialog(true);
  };

  const openPassword = (userId: string, userName: string, isNew: boolean) => {
    setPassword("");
    setPasswordDialog({ userId, userName, isNew });
  };

  const handleCreate = async () => {
    if (!name.trim() || !email.trim()) { toast.error("Nome e e-mail são obrigatórios"); return; }
    if (!tempPassword.trim()) { toast.error("A senha temporária é obrigatória"); return; }
    if (tempPassword.length < 6) { toast.error("A senha temporária deve ter pelo menos 6 caracteres"); return; }
    try {
      const newUserId = await createUser({ name: name.trim(), email: email.trim(), role, organizationId: (orgId || undefined) as any });
      // Auto-create password with requiresReset: true
      await createPassword({ userId: newUserId as Id<"users">, password: tempPassword, requiresReset: true });
      toast.success("Usuário criado com sucesso. Obrigará troca de senha no primeiro acesso.");
      setCreateDialog(false);
    } catch (e: any) { toast.error(e.message ?? "Erro ao criar usuário"); }
  };

  const handleEdit = async () => {
    if (!editUser) return;
    try {
      await updateUser({ userId: editUser._id, role, organizationId: (orgId || undefined) as any, active });
      toast.success("Usuário atualizado");
      setEditDialog(false);
    } catch (e: any) { toast.error(e.message ?? "Erro ao atualizar"); }
  };

  const handleToggleActive = async (userId: any, currentActive: boolean, userName: string) => {
    if (currentActive) {
      if (!confirm(`Tem certeza que deseja desativar o usuário "${userName}"?`)) return;
      try {
        await deactivateUser({ userId });
        toast.success("Usuário desativado");
      } catch (e: any) { toast.error(e.message ?? "Erro ao desativar"); }
    } else {
      try {
        await activateUser({ userId });
        toast.success("Usuário ativado");
      } catch (e: any) { toast.error(e.message ?? "Erro ao ativar"); }
    }
  };

  const handleSetPassword = async () => {
    if (!passwordDialog) return;
    if (password.length < 6) { toast.error("A senha deve ter pelo menos 6 caracteres"); return; }
    try {
      if (passwordDialog.isNew) {
        await createPassword({ userId: passwordDialog.userId as Id<"users">, password, requiresReset: true });
      } else {
        await adminResetPassword({ userId: passwordDialog.userId as Id<"users">, newPassword: password });
      }
      toast.success(passwordDialog.isNew ? "Senha definida com sucesso" : "Senha redefinida com sucesso");
      setPasswordDialog(null);
    } catch (e: any) { toast.error(e.message ?? "Erro ao definir senha"); }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
            <p className="text-sm text-muted-foreground">Gerenciar perfis, permissões e acessos</p>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Novo Usuário</Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 max-w-md" />
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered?.map((u: any) => {
                    const orgName = orgs?.orgs.find((o: any) => o._id === u.organizationId)?.name;
                    return (
                      <TableRow key={u._id}>
                        <TableCell className="font-medium">{u.name ?? "Sem nome"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{u.email ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Shield className="h-3 w-3" />
                            {ROLE_LABELS[(u.role ?? "technician") as UserRole]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{orgName ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={u.active !== false ? "default" : "destructive"} className="text-[10px]">
                            {u.active !== false ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 items-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)} title="Editar">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPassword(u._id, u.name ?? u.email, true)} title="Definir senha">
                              <Key className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => handleToggleActive(u._id, u.active !== false, u.name ?? u.email)}
                              title={u.active !== false ? "Desativar" : "Ativar"}
                            >
                              {u.active !== false ? <UserX className="h-3.5 w-3.5 text-destructive" /> : <UserCheck className="h-3.5 w-3.5 text-emerald-600" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12">
                        <UsersIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">Nenhum usuário encontrado</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Usuário</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nome completo *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do usuário" /></div>
            <div><Label>E-mail *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" /></div>
            <div><Label>Perfil *</Label><Select value={role} onValueChange={(v) => setRole(v as UserRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent></Select></div>
            <div><Label>Unidade Organizacional</Label><Select value={orgId} onValueChange={setOrgId}><SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger><SelectContent>{orgs?.orgs.map((o: any) => (<SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>))}</SelectContent></Select></div>
            <div>
              <Label>Senha Temporária *</Label>
              <Input type="password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
              <p className="text-xs text-muted-foreground mt-1">O usuário será obrigado a alterar a senha no primeiro acesso.</p>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateDialog(false)}>Cancelar</Button><Button onClick={handleCreate}>Criar Usuário</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Nome</Label><Input value={editUser?.name ?? ""} disabled /></div>
            <div><Label>E-mail</Label><Input value={editUser?.email ?? ""} disabled /></div>
            <div><Label>Perfil</Label><Select value={role} onValueChange={(v) => setRole(v as UserRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent></Select></div>
            <div><Label>Unidade Organizacional</Label><Select value={orgId} onValueChange={setOrgId}><SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger><SelectContent>{orgs?.orgs.map((o: any) => (<SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>))}</SelectContent></Select></div>
            <div><Label>Status</Label><Select value={active ? "active" : "inactive"} onValueChange={(v) => setActive(v === "active")} disabled={editUser?._id === users?.find((u: any) => u.role === "admin")?._id}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem></SelectContent></Select></div>
            <div><Button variant="outline" size="sm" className="gap-2" onClick={() => { setEditDialog(false); openPassword(editUser._id, editUser.name ?? editUser.email, false); }}><Key className="h-3.5 w-3.5" /> Redefinir Senha</Button></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditDialog(false)}>Cancelar</Button><Button onClick={handleEdit}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Dialog */}
      <Dialog open={!!passwordDialog} onOpenChange={() => setPasswordDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{passwordDialog?.isNew ? "Definir Senha" : "Redefinir Senha"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {passwordDialog?.isNew ? `Definir senha para ${passwordDialog?.userName}` : `Redefinir senha de ${passwordDialog?.userName}`}
            </p>
            <div><Label>Nova Senha *</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" /></div>
            {passwordDialog?.isNew && <p className="text-xs text-muted-foreground">O usuário será obrigado a alterar a senha no primeiro acesso.</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPasswordDialog(null)}>Cancelar</Button><Button onClick={handleSetPassword} disabled={password.length < 6}>{passwordDialog?.isNew ? "Definir" : "Redefinir"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
