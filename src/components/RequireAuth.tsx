import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user, signOut } = useAuth();
  const location = useLocation();
  const hasShownToast = useRef(false);

  useEffect(() => {
    if (user?.requiresPasswordReset && !hasShownToast.current) {
      hasShownToast.current = true;
      toast.info("Você deve alterar sua senha antes de continuar.", { duration: 5000 });
    }
  }, [user?.requiresPasswordReset]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  // Fail closed if the auth session exists but no SIGESGD profile is
  // available. Rendering protected pages in this state creates confusing
  // query failures and must never be treated as an authenticated app user.
  if (isAuthenticated && !user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-lg font-semibold">Perfil de acesso não encontrado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Sua sessão foi reconhecida, mas não existe um cadastro ativo correspondente no SIGESGD. Saia do sistema e procure um administrador.
        </p>
        <button
          type="button"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          onClick={() => void signOut()}
        >
          Sair do sistema
        </button>
      </main>
    );
  }

  // Force password change on first login
  if (user?.requiresPasswordReset && location.pathname !== "/settings") {
    return (
      <Navigate
        to={`/settings?forcePasswordChange=true&returnTo=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  return children;
}
