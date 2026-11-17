/**
 * Gestão de Estoque SGGD — PROTEÇÃO DE ROTAS POR PERMISSÃO (RBAC).
 *
 * O menu oculto NÃO é segurança: esta camada bloqueia o acesso DIRETO por URL.
 * A permissão exigida por rota vem da matriz central (`src/lib/rbac.ts`); o
 * papel vem do usuário autenticado no backend (nunca de localStorage etc.).
 * A autorização REAL continua no backend (`requirePermission`).
 */
import { useMemo } from "react";
import { Loader2, ShieldAlert, Home } from "lucide-react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { permissionForRoute, roleHasPermission, type AppRole } from "@/lib/rbac";

/** Estado consistente de ACESSO NÃO AUTORIZADO (não quebra o PWA/layout). */
export function Unauthorized({ message }: { message?: string }) {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="size-7 text-destructive" aria-hidden />
      </div>
      <div>
        <h1 className="text-lg font-semibold">Acesso não autorizado</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {message ??
            "Seu perfil não possui permissão para acessar esta área. Procure um administrador caso acredite que isso seja um erro."}
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/dashboard">
          <Home className="size-4" />
          Voltar ao início
        </Link>
      </Button>
    </main>
  );
}

export function RequirePermission({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();

  const required = useMemo(
    () => permissionForRoute(location.pathname),
    [location.pathname],
  );

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated || !user) {
    // Sem sessão: deixa o RequireAuth (wrapper externo) tratar o redirect.
    return children;
  }

  if (required && !roleHasPermission(user.role as AppRole, required)) {
    return <Unauthorized />;
  }

  return children;
}
