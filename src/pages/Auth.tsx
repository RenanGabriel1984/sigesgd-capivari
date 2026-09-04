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

import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, Lock, Mail, Eye, EyeOff, KeyRound } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import { useMutation } from "convex/react";
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
  const [resetDevCode, setResetDevCode] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate(redirect);
  }, [authLoading, isAuthenticated, navigate, redirect]);

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
      if (msg.includes("inativo")) {
        setError("Usuário inativo. Contate o administrador do sistema.");
      } else if (msg.includes("não encontrado") || msg.includes("incorretos") || msg.includes("não configurada")) {
        setError("E-mail ou senha incorretos");
      } else {
        setError(msg);
      }
      setIsLoading(false);
    }
  };

  const handleRequestReset = async () => {
    if (!forgotEmail.trim()) { toast.error("Informe seu e-mail"); return; }
    setForgotLoading(true);
    try {
      const result = await requestPasswordReset({ email: forgotEmail.trim() });
      setResetDevCode((result as any)?._devCode ?? null);
      setForgotStep("code");
      toast.success("Verifique seu e-mail para o código de recuperação.");
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
      setResetDevCode(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao redefinir senha");
    }
    setForgotLoading(false);
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      setError(`Não foi possível entrar como visitante: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#1a5632] via-[#1a5632] to-[#0d3a1f]">
      {/* Top bar with Capivari blue accent */}
      <div className="h-1 w-full bg-[#5b9bd5]" />

      <header className="flex items-center justify-between px-4 sm:px-6 h-16 border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#1a5632] font-bold text-sm shadow-sm">
            SG
          </div>
          <div>
            <p className="text-sm font-bold leading-tight tracking-tight text-white">SIGESGD</p>
            <p className="text-[10px] text-white/60 leading-tight">Capivari</p>
          </div>
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Institutional header */}
          <div className="text-center mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-[#1a5632] font-bold text-2xl mx-auto mb-4 shadow-lg">
              SG
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">SIGESGD Capivari</h1>
            <p className="text-sm text-white/70 mt-1">
              Sistema Integrado de Gestão
            </p>
            <p className="text-xs text-white/50">
              Secretaria de Gestão e Governo Digital
            </p>
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
                    <Label htmlFor="email">E-mail</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        name="email"
                        placeholder="seu@email.com"
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
                  <p className="mt-3 text-sm text-destructive text-center">{error}</p>
                )}

                <div className="mt-4">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">Ou</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full mt-4"
                    onClick={handleGuestLogin}
                    disabled={isLoading}
                  >
                    Entrar como Visitante
                  </Button>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Button type="submit" className="w-full" disabled={isLoading || !email.trim() || !password}>
                  {isLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Entrando...</>
                  ) : (
                    <>Entrar<ArrowRight className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline text-center mt-2 cursor-pointer"
                  onClick={() => {
                    setForgotDialogOpen(true);
                    setForgotStep("email");
                    setForgotEmail(email);
                    setResetCode("");
                    setNewPassword("");
                    setResetDevCode(null);
                  }}
                >
                  Esqueceu sua senha?
                </button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotDialogOpen} onOpenChange={(open) => {
        setForgotDialogOpen(open);
        if (!open) {
          setForgotStep("email");
          setResetCode("");
          setNewPassword("");
          setResetDevCode(null);
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
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="mt-1"
                  disabled={forgotLoading}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {resetDevCode && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-amber-800">Código de desenvolvimento:</p>
                  <p className="text-lg font-mono font-bold text-amber-900 mt-1">{resetDevCode}</p>
                  <p className="text-[10px] text-amber-600 mt-1">Remova esta mensagem ao configurar envio de e-mail.</p>
                </div>
              )}
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
              setResetDevCode(null);
            }}>Cancelar</Button>
            <Button size="sm" onClick={forgotStep === "email" ? handleRequestReset : handleConfirmReset} disabled={forgotLoading}>
              {forgotLoading ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Processando...</>
              ) : (
                forgotStep === "email" ? "Enviar Código" : "Redefinir Senha"
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
