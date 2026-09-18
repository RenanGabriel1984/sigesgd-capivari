import { useState, useEffect, memo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Package,
  Tags,
  ShoppingCart,
  ArrowLeftRight,
  ClipboardList,
  Building2,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronDown,
  Warehouse,
  Shield,
  FileText,
  BarChart3,
  Download,
  Printer,
  Boxes,
  MapPin,
  ClipboardCheck,
  Monitor,
  Key,
  RotateCcw,
  ArrowRightLeft,
  PackageMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getPermissions, ROLE_LABELS } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useIsDesktop } from "@/hooks/use-mobile";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: keyof ReturnType<typeof getPermissions>;
  /** Permissão alternativa (ex.: técnico pode consultar estoque) */
  permission2?: keyof ReturnType<typeof getPermissions>;
  badge?: number;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

// Navegação organizada por TAREFAS (não pela estrutura técnica do banco).
const NAV_SECTIONS: NavSection[] = [
  { items: [
    { label: "Início", href: "/dashboard", icon: LayoutDashboard, permission: "canViewMovements", permission2: "canCreateRequests" },
  ]},
  { title: "Operação", items: [
    { label: "Estoque", href: "/stock", icon: Warehouse, permission: "canViewMovements", permission2: "canCreateRequests" },
    { label: "Entrada de material", href: "/entries", icon: ShoppingCart, permission: "canCreateEntries" },
    { label: "Dar saída", href: "/exit", icon: PackageMinus, permission: "canCreateEntries" },
    { label: "Solicitações", href: "/requests", icon: ClipboardList, permission: "canCreateRequests" },
    { label: "Inventário", href: "/inventory", icon: ClipboardCheck, permission: "canManageInventory" },
  ]},
  { title: "Equipamentos", items: [
    { label: "Impressoras / Gomaq", href: "/gomaq", icon: Printer, permission: "canManageGomaQ" },
    { label: "Equipamentos", href: "/assets", icon: Monitor, permission: "canManageAssets" },
    { label: "Licenças", href: "/licenses", icon: Key, permission: "canManageLicenses" },
    { label: "Impressoras", href: "/printers", icon: Printer, permission: "canManageProducts" },
  ]},
  { title: "Consultas", items: [
    { label: "Relatórios", href: "/reports", icon: BarChart3, permission: "canViewMovements" },
    { label: "Histórico", href: "/movements", icon: ArrowLeftRight, permission: "canViewMovements" },
    { label: "Devoluções", href: "/returns", icon: RotateCcw, permission: "canReturnStock" },
    { label: "Transferências", href: "/transfers", icon: ArrowRightLeft, permission: "canTransferStock" },
  ]},
  { title: "Administração", items: [
    { label: "Produtos", href: "/products", icon: Package, permission: "canManageProducts" },
    { label: "Categorias", href: "/categories", icon: Tags, permission: "canManageCategories" },
    { label: "Fornecedores", href: "/suppliers", icon: FileText, permission: "canManageSuppliers" },
    { label: "Lotes", href: "/lots", icon: Boxes, permission: "canManageStock" },
    { label: "Locais", href: "/storage-locations", icon: MapPin, permission: "canManageStorageLocations" },
    { label: "Organizações", href: "/organization", icon: Building2, permission: "canManageOrg" },
    { label: "Usuários", href: "/users", icon: Users, permission: "canManageUsers" },
    { label: "Auditoria", href: "/audit", icon: Shield, permission: "canViewAuditLogs" },
    { label: "Configurações", href: "/settings", icon: Settings, permission: "canManageUsers" },
  ]},
];

const SidebarLink = memo(function SidebarLink({
  item,
  isActive,
  onClick,
  pendingCount,
  alertCount,
}: {
  item: NavItem;
  isActive: boolean;
  onClick?: () => void;
  pendingCount?: number;
  alertCount?: number;
}) {
  return (
    <Link
      to={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
        isActive
          ? "bg-primary/10 text-primary shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <item.icon className={cn("h-4.5 w-4.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/70")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.href === "/requests" && pendingCount !== undefined && pendingCount > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 text-[10px] px-1.5">
          {pendingCount}
        </Badge>
      )}
      {item.href === "/products" && alertCount !== undefined && alertCount > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 text-[10px] px-1.5">
          {alertCount}
        </Badge>
      )}
    </Link>
  );
});

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // iOS: 100vh ignora a barra de endereço; dvh corrige.
  useEffect(() => {
    const setVH = () => {
      document.documentElement.style.setProperty("--app-vh", `${window.innerHeight * 0.01}px`);
    };
    setVH();
    window.addEventListener("resize", setVH);
    window.addEventListener("orientationchange", setVH);
    return () => {
      window.removeEventListener("resize", setVH);
      window.removeEventListener("orientationchange", setVH);
    };
  }, []);

  // ─── PWA Install Prompt ───
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    // Don't show if already running in standalone mode
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Don't show if user previously dismissed
    if (localStorage.getItem("sigesgd-pwa-dismissed") === "1") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstallBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismissInstall = () => {
    setShowInstallBanner(false);
    localStorage.setItem("sigesgd-pwa-dismissed", "1");
  };

  const pendingCount = useQuery(api.requests.pendingCount);
  const belowMinItems = useQuery(api.products.belowMinimum);
  const role = (user?.role ?? "technician") as UserRole;
  const permissions = getPermissions(role);
  const alertCount = belowMinItems?.length ?? 0;

  // ── Mobile menu ────────────────────────────────────────────────────────────
  // Grupos recolhíveis apenas no mobile: reduz a altura do drawer sem remover
  // nenhuma rota. No desktop (lg+) tudo fica expandido como sempre.
  const isDesktop = useIsDesktop();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    // Na primeira abertura, todas as seções começam abertas.
    try {
      const saved = sessionStorage.getItem("sigesgd-sidebar-sections");
      if (saved) return JSON.parse(saved) as Record<string, boolean>;
    } catch {
      /* sessionStorage indisponível — segue com padrão */
    }
    return {};
  });
  const toggleSection = (title: string) => {
    setOpenSections((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      try {
        sessionStorage.setItem("sigesgd-sidebar-sections", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Bloqueia o scroll da página atrás do drawer (iOS incluído).
  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  const filteredSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => permissions[item.permission] || (item.permission2 ? permissions[item.permission2] : false)
    ),
  })).filter((section) => section.items.length > 0);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "??";

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r border-border/60 bg-card transition-[width] duration-200 ease-out",
          "h-dvh supports-[height:100dvh]:h-dvh",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Logo */}
        <div className="relative flex h-16 items-center gap-2.5 border-b border-border/60 px-4">
          <div aria-hidden className="absolute bottom-0 left-4 right-4 h-px bg-[var(--capivari-gold)]/60" />
          {!collapsed && (
            <Link to="/dashboard" className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--capivari-green)] text-white font-bold text-xs shrink-0 ring-2 ring-[var(--capivari-gold)]/70">
                SG
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate leading-tight text-[var(--capivari-green)]">SIGESGD</p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">Capivari — SP</p>
              </div>
            </Link>
          )}
          {collapsed && (
            <Link to="/dashboard" className="mx-auto">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--capivari-green)] text-white font-bold text-xs ring-2 ring-[var(--capivari-gold)]/70">
                SG
              </div>
            </Link>
          )}
        </div>

        {/* Nav — rolagem nativa (overflow-y-auto) para garantir alcance total por toque e teclado */}
        <nav
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3"
          style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          <div className="flex flex-col gap-1">
            {filteredSections.map((section, sIdx) => (
              <div key={sIdx}>
                {section.title && !collapsed && (
                  <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {section.title}
                  </p>
                )}
                {section.items.map((item) => (
                  <SidebarLink
                    key={item.href}
                    item={item}
                    isActive={location.pathname === item.href || (item.href !== "/dashboard" && location.pathname.startsWith(item.href))}
                    pendingCount={pendingCount}
                    alertCount={alertCount}
                  />
                ))}
              </div>
            ))}
          </div>
        </nav>

        {/* Collapse toggle */}
        <div className="border-t border-border/60 p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              /* Fluidez: apenas transform (composição na GPU), 180ms, easing
               * iOS-like. Sem spring — resposta imediata ao toque, sem o
               * "tranco" final percebido como travamento ao fechar. */
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              className="fixed left-0 top-0 z-50 w-[min(19.5rem,100vw)] max-w-full bg-card border-r border-border/60 flex flex-col lg:hidden"
              style={{
                height: "100dvh",
                maxHeight: "100dvh",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              {/* Cabeçalho sempre visível */}
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-4">
                <Link to="/dashboard" className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--capivari-green)] text-white font-bold text-xs ring-2 ring-[var(--capivari-gold)]/70">
                    SG
                  </div>
                  <div>
                    <p className="text-sm font-semibold leading-tight text-[var(--capivari-green)]">SIGESGD</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Capivari — SP</p>
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Fechar menu"
                  className="touch-manipulation"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              {/* Lista com rolagem vertical própria — chega até o último item */}
              <nav
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3"
                style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
              >
                <div className="flex flex-col gap-1 pb-2">
                  {filteredSections.map((section, sIdx) => (
                    <div key={sIdx}>
                      {section.title ? (
                        <Collapsible
                          open={isDesktop || (openSections[section.title] ?? true)}
                          onOpenChange={() => toggleSection(section.title!)}
                        >
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              aria-expanded={openSections[section.title] ?? true}
                              className="flex w-full touch-manipulation items-center justify-between rounded-md px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70"
                            >
                              {section.title}
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", (openSections[section.title] ?? true) && "rotate-180")} />
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="flex flex-col gap-1">
                              {section.items.map((item) => (
                                <SidebarLink
                                  key={item.href}
                                  item={item}
                                  isActive={location.pathname === item.href || (item.href !== "/dashboard" && location.pathname.startsWith(item.href))}
                                  onClick={() => setSidebarOpen(false)}
                                  pendingCount={pendingCount}
                                  alertCount={alertCount}
                                />
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {section.items.map((item) => (
                            <SidebarLink
                              key={item.href}
                              item={item}
                              isActive={location.pathname === item.href || (item.href !== "/dashboard" && location.pathname.startsWith(item.href))}
                              onClick={() => setSidebarOpen(false)}
                              pendingCount={pendingCount}
                              alertCount={alertCount}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* PWA Install Banner */}
        {showInstallBanner && (
          <div className="flex items-center gap-3 bg-[var(--capivari-green)]/5 border-b border-[var(--capivari-green)]/20 px-4 py-2.5 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--capivari-green)] text-white font-bold text-[10px] shrink-0 ring-1 ring-[var(--capivari-gold)]/70">
              SG
            </div>
            <p className="text-sm text-foreground flex-1 min-w-0">
              <span className="font-medium">Instalar o SIGESGD</span> na Tela Inicial para acesso rápido.
            </p>
            <Button size="sm" onClick={handleInstall} className="gap-1.5 shrink-0">
              <Download className="h-3.5 w-3.5" /> Instalar PWA
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDismissInstall} className="shrink-0">
              Fechar
            </Button>
          </div>
        )}

        {/* Top bar */}
        <header className="flex h-16 items-center gap-4 border-b border-border/60 bg-card/80 backdrop-blur-sm page-x-pad shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 gap-2 pl-2 pr-3">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:flex flex-col items-start text-left">
                  <span className="text-sm font-medium leading-tight truncate max-w-[120px]">
                    {user?.name ?? "Usuário"}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {ROLE_LABELS[role]}
                  </span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                <p className="font-medium">{user?.name ?? "User"}</p>
                <p className="text-xs text-muted-foreground font-normal">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-background/50">
          <div className="h-full page-x-pad page-bot-pad py-4 lg:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
