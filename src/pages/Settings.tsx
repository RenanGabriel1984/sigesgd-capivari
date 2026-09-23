import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, Key, User, AlertTriangle } from "lucide-react";
import { ROLE_LABELS, type UserRole } from "@/types/constants";
import { toast } from "sonner";
import { useSearchParams, useNavigate } from "react-router";

export default function Settings() {
  const { user } = useAuth();
  const changePassword = useMutation(api.passwords.changePassword);
  const forceChangePassword = useMutation(api.passwords.forceChangePassword);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isForceChange = searchParams.get("forcePasswordChange") === "true";
  const returnTo = searchParams.get("returnTo") || "/dashboard";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChanging, setIsChanging] = useState(false);

  const role = (user?.role ?? "technician") as UserRole;

  const handleChangePassword = async () => {
    if (!newPassword) {
      toast.error(isForceChange ? "Preencha o campo de nova senha" : "Preencha todos os campos");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não conferem");
      return;
    }
    if (!isForceChange) {
      if (!currentPassword) {
        toast.error("Preencha a senha atual");
        return;
      }
      if (currentPassword === newPassword) {
        toast.error("A nova senha deve ser diferente da atual");
        return;
      }
    }
    setIsChanging(true);
    try {
      if (isForceChange) {
        await forceChangePassword({ newPassword });
        toast.success("Senha alterada com sucesso! Bem-vindo ao sistema Gestão de Estoque SGGD.");
        navigate(returnTo);
      } else {
        await changePassword({ currentPassword, newPassword });
        toast.success("Senha alterada com sucesso");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao alterar senha");
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        {isForceChange && (
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
            <CardContent className="py-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm text-amber-800 dark:text-amber-200">Alteração de senha obrigatória</p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  Esta é sua primeira acesso ao sistema. Você deve definir uma nova senha para continuar.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground">Configurações da sua conta e do sistema</p>
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" /> Informações da Conta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Nome</Label>
                <p className="text-sm font-medium mt-0.5">{user?.name ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <p className="text-sm font-medium mt-0.5">{user?.email ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Perfil</Label>
                <p className="text-sm font-medium mt-0.5">{ROLE_LABELS[role]}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Último acesso</Label>
                <p className="text-sm font-medium mt-0.5">{user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("pt-BR") : "Primeiro acesso"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" /> {isForceChange ? "Definir Nova Senha" : "Alterar Senha"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-md space-y-4">
              {!isForceChange && (
                <div>
                  <Label>Senha Atual</Label>
                  <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Sua senha atual" />
                </div>
              )}
              <div>
                <Label>Nova Senha</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
              </div>
              <div>
                <Label>Confirmar Nova Senha</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repita a nova senha" />
              </div>
              <Button onClick={handleChangePassword} disabled={isChanging || !newPassword || !confirmPassword}>
                {isChanging ? "Alterando..." : "Alterar Senha"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <SettingsIcon className="h-4 w-4" /> Sistema
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p><strong>Gestão de Estoque SGGD</strong> — Sistema Integrado de Gestão</p>
              <p>Secretaria de Gestão e Governo Digital — Prefeitura Municipal de Capivari</p>
              <p className="text-xs">Configurações adicionais serão disponibilizadas nas próximas versões do sistema.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
