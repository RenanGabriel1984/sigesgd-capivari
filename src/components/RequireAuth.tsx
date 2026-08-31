import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
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
