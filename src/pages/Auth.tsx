import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, Lock, Mail, Eye, EyeOff, KeyRound, ShieldCheck, AlertTriangle } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"), redirectAfterAuth);

  const requestPasswordReset = useMutation(api.passwords.requestPasswordReset);
  const confirmPasswordReset = useMutation(api.passwords.confirmPasswordReset);
  const forceChangePassword = useMutation(api.passwords.forceChangePassword);
  const user = useQuery(api.users.currentUser);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password state
  const [forgotDialogOpen, setForgotDialogOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<"email" | "code">("email");
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  // First access state
  const [firstAccessOpen, setFirstAccessOpen] = useState(false);
  const [faNewPassword, setFaNewPassword] = useState("");
  const [faConfirmPassword, setFaConfirmPassword] = useState("");
  const [faLoading, setFaLoading] = useState(false);
  const [faShowPassword, setFaShowPassword] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      // Check if user needs to change password (first access)
      if (user?.requiresPasswordReset) {
        setFirstAccessOpen(true);
        return;
      }
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect, user]);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Informe seu e-mail e senha");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("email", email.trim().toLowerCase());
      formData.set("password", password);
      await signIn("credentials", formData);
      navigate(redirect);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro ao entrar";
      if (msg.includes("inativo") || msg.includes("desativado")) {
        setError("Seu acesso está desativado. Procure o administrador do sistema.");
      } else if (msg.includes("bloqueado")) {
        setError(msg);
      } else if (msg.includes("não encontrado") || msg.includes("incorretos") || msg.includes("não configurada") || msg.includes("inválidos")) {
        setError("E-mail ou senha inválidos.");
      } else {
        setError("E-mail ou senha inválidos.");
      }
      setIsLoading(false);
    }
  };

  const handleRequestReset = async () => {
    if (!forgotEmail.trim()) { toast.error("Informe seu e-mail"); return; }
    setForgotLoading(true);
    try {
      await requestPasswordReset({ email: forgotEmail.trim() });
      setForgotStep("code");
      toast.success("Se os dados estiverem cadastrados, enviaremos as instruções para recuperação.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao solicitar recuperação");
    }
    setForgotLoading(false);
  };

  const handleConfirmReset = async () => {
    if (!resetCode.trim()) { toast.error("Informe o código"); return; }
    if (!newPassword.trim() || newPassword.length < 6) { toast.error("A nova senha deve ter pelo menos 6 caracteres"); return; }
    setForgotLoading(true);
    try {
      await confirmPasswordReset({
        email: forgotEmail.trim(),
        code: resetCode.trim(),
        newPassword: newPassword.trim(),
      });
      toast.success("Senha redefinida com sucesso! Faça login.");
      setForgotDialogOpen(false);
      setForgotStep("email");
      setForgotEmail("");
      setResetCode("");
      setNewPassword("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao redefinir senha");
    }
    setForgotLoading(false);
  };

  const handleFirstAccess = async () => {
    if (!faNewPassword.trim() || faNewPassword.length < 6) {
      toast.error("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (faNewPassword !== faConfirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    setFaLoading(true);
    try {
      await forceChangePassword({ newPassword: faNewPassword.trim() });
      toast.success("Senha definida com sucesso! Bem-vindo ao SIGESGD.");
      setFirstAccessOpen(false);
      navigate(redirect);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao definir senha");
    }
    setFaLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top accent stripe — Capivari blue */}
      <div className="h-1 w-full bg-[var(--capivari-blue)]" />

      {/* Header bar */}
      <header className="flex items-center justify-between px-4 sm:px-6 h-14 border-b border-border/40 bg-card/80 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src="/assets/brasao.svg"
            alt="Brasão de Capivari"
            className="h-8 w-8 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div>
            <p className="text-sm font-bold leading-tight tracking-tight text-[var(--capivari-green)]">SIGESGD</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Capivari</p>
          </div>
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-8 bg-gradient-to-b from-[#f8faf9] to-background">
        <div className="w-full max-w-md">
          {/* Institutional header with coat of arms */}
          <div className="text-center mb-8">
            <img
              src="/assets/brasao.svg"
              alt="Brasão Municipal de Capivari"
              className="h-20 w-20 mx-auto mb-4 object-contain drop-shadow-sm"
              onError={(e) => {
                // Fallback to styled div
                (e.target as HTMLImageElement).style.display = "none";
                const fallback = document.getElementById("brasao-fallback");
                if (fallback) fallback.style.display = "flex";
              }}
            />
            <div id="brasao-fallback" style={{ display: "none" }} className="h-20 w-20 mx-auto mb-4 items-center justify-center rounded-2xl bg-[var(--capivari-green)] text-white font-bold text-2xl shadow-lg">
              SG
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--capivari-green)]">SIGESGD Capivari</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sistema Integrado de Gestão
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Secretaria de Gestão e Governo Digital
            </p>
            <img
              src="/assets/bandeira.svg"
              alt="Bandeira de Capivari"
              className="mx-auto mt-4 h-8 w-auto opacity-90"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          <Card className="border-border/50 shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-lg">Acesse o Sistema</CardTitle>
              <CardDescription>
                Informe suas credenciais para continuar
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSignIn}>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail institucional</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        name="email"
                        placeholder="seu.email@capivari.sp.gov.br"
                        type="email"
                        className="pl-9"
                        disabled={isLoading}
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Senha</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        name="password"
                        placeholder="Sua senha"
                        type={showPassword ? "text" : "password"}
                        className="pl-9 pr-9"
                        disabled={isLoading}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                {error && (
                  <Alert variant="destructive" className="mt-3">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{error}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
              <CardFooter className="flex-col gap-3">
                <Button type="submit" className="w-full bg-[var(--capivari-green)] hover:bg-[var(--capivari-green-dark)]" disabled={isLoading || !email.trim() || !password}>
                  {isLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Entrando...</>
                  ) : (
                    <>Entrar<ArrowRight className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
                <button
                  type="button"
                  className="text-xs text-[var(--capivari-blue)] hover:underline text-center cursor-pointer"
                  onClick={() => {
                    setForgotDialogOpen(true);
                    setForgotStep("email");
                    setForgotEmail(email);
                    setResetCode("");
                    setNewPassword("");
                  }}
                >
                  Esqueceu sua senha?
                </button>
              </CardFooter>
            </form>
          </Card>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-[10px] text-muted-foreground/50">
              Prefeitura Municipal de Capivari — SP
            </p>
          </div>
        </div>
      </div>

      {/* ═══ Forgot Password Dialog ═══ */}
      <Dialog open={forgotDialogOpen} onOpenChange={(open) => {
        setForgotDialogOpen(open);
        if (!open) {
          setForgotStep("email");
          setResetCode("");
          setNewPassword("");
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {forgotStep === "email" ? "Recuperar Senha" : "Redefinir Senha"}
            </DialogTitle>
          </DialogHeader>
          {forgotStep === "email" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Informe o e-mail cadastrado. Enviaremos um código de recuperação.
              </p>
              <div>
                <Label>E-mail institucional</Label>
                <Input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="seu.email@capivari.sp.gov.br"
                  className="mt-1"
                  disabled={forgotLoading}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Digite o código de 6 dígitos enviado para <strong>{forgotEmail}</strong>.
              </p>
              <div>
                <Label>Código de Verificação</Label>
                <Input
                  type="text"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="mt-1 text-center text-lg tracking-[0.3em] font-mono"
                  maxLength={6}
                  disabled={forgotLoading}
                />
              </div>
              <div>
                <Label>Nova Senha</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="mt-1"
                  disabled={forgotLoading}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              setForgotDialogOpen(false);
              setForgotStep("email");
              setResetCode("");
              setNewPassword("");
            }}>Cancelar</Button>
            <Button size="sm" className="bg-[var(--capivari-green)] hover:bg-[var(--capivari-green-dark)]" onClick={forgotStep === "email" ? handleRequestReset : handleConfirmReset} disabled={forgotLoading}>
              {forgotLoading ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Processando...</>
              ) : (
                forgotStep === "email" ? "Enviar Código" : "Redefinir Senha"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ First Access — Forced Password Change ═══ */}
      <Dialog open={firstAccessOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[var(--capivari-green)]" />
              Primeiro Acesso
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Por segurança, defina sua senha pessoal para continuar.
                A senha temporária fornecida pelo administrador não poderá ser reutilizada.
              </AlertDescription>
            </Alert>
            <div className="space-y-3">
              <div>
                <Label>Nova Senha</Label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={faShowPassword ? "text" : "password"}
                    value={faNewPassword}
                    onChange={(e) => setFaNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="pl-9 pr-9"
                    disabled={faLoading}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-7 w-7"
                    onClick={() => setFaShowPassword(!faShowPassword)}
                    tabIndex={-1}
                  >
                    {faShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label>Confirmar Nova Senha</Label>
                <Input
                  type="password"
                  value={faConfirmPassword}
                  onChange={(e) => setFaConfirmPassword(e.target.value)}
                  placeholder="Digite a senha novamente"
                  className="mt-1"
                  disabled={faLoading}
                />
              </div>
            </div>
            {faNewPassword && faConfirmPassword && faNewPassword !== faConfirmPassword && (
              <p className="text-xs text-destructive">As senhas não coincidem</p>
            )}
          </div>
          <DialogFooter>
            <Button
              className="w-full bg-[var(--capivari-green)] hover:bg-[var(--capivari-green-dark)]"
              onClick={handleFirstAccess}
              disabled={faLoading || !faNewPassword || !faConfirmPassword || faNewPassword !== faConfirmPassword || faNewPassword.length < 6}
            >
              {faLoading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</>
              ) : (
                "Definir Senha e Entrar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
