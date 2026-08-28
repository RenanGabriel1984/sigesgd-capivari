import { useState, useEffect } from "react";
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
  Warehouse,
  Shield,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getPermissions, ROLE_LABELS } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "canViewMovements" },
  { label: "Estoque", href: "/stock", icon: Warehouse, permission: "canManageStock" },
  { label: "Produtos", href: "/products", icon: Package, permission: "canManageProducts" },
  { label: "Categorias", href: "/categories", icon: Tags, permission: "canManageCategories" },
  { label: "Entradas", href: "/entries", icon: ShoppingCart, permission: "canCreateEntries" },
  { label: "Solicitações", href: "/requests", icon: ClipboardList, permission: "canCreateRequests" },
  { label: "Movimentações", href: "/movements", icon: ArrowLeftRight, permission: "canViewMovements" },
  { label: "Organização", href: "/organization", icon: Building2, permission: "canManageOrg" },
  { label: "Usuários", href: "/users", icon: Users, permission: "canManageUsers" },
  { label: "Fornecedores", href: "/suppliers", icon: FileText, permission: "canManageSuppliers" },
  { label: "Auditoria", href: "/audit", icon: Shield, permission: "canViewAuditLogs" },
  { label: "Configurações", href: "/settings", icon: Settings, permission: "canManageSettings" },
];

function SidebarLink({
  item,
  isActive,
  onClick,
  pendingCount,
}: {
  item: NavItem;
  isActive: boolean;
  onClick?: () => void;
  pendingCount?: number;
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
      <item.icon className={cn("h-4.5 w-4.5 shrink-0", isActive && "text-primary")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.href === "/requests" && pendingCount !== undefined && pendingCount > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 text-[10px] px-1.5">
          {pendingCount}
        </Badge>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const pendingCount = useQuery(api.requests.pendingCount);
  const role = (user?.role ?? "technician") as UserRole;
  const permissions = getPermissions(role);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const filteredNav = NAV_ITEMS.filter((item) => permissions[item.permission]);

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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r border-border/60 bg-card transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 border-b border-border/60 px-4">
          {!collapsed && (
            <Link to="/dashboard" className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs shrink-0">
                SG
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate leading-tight">SIGESGD</p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">Capivari</p>
              </div>
            </Link>
          )}
          {collapsed && (
            <Link to="/dashboard" className="mx-auto">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs">
                SG
              </div>
            </Link>
          )}
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 px-3 py-3">
          <nav className="flex flex-col gap-0.5">
            {filteredNav.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                isActive={location.pathname === item.href}
                pendingCount={pendingCount}
              />
            ))}
          </nav>
        </ScrollArea>

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
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border/60 flex flex-col lg:hidden"
            >
              <div className="flex h-16 items-center justify-between border-b border-border/60 px-4">
                <Link to="/dashboard" className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs">
                    SG
                  </div>
                  <div>
                    <p className="text-sm font-semibold leading-tight">SIGESGD</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Capivari</p>
                  </div>
                </Link>
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <ScrollArea className="flex-1 px-3 py-3">
                <nav className="flex flex-col gap-0.5">
                  {filteredNav.map((item) => (
                    <SidebarLink
                      key={item.href}
                      item={item}
                      isActive={location.pathname === item.href}
                      onClick={() => setSidebarOpen(false)}
                      pendingCount={pendingCount}
                    />
                  ))}
                </nav>
              </ScrollArea>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center gap-4 border-b border-border/60 bg-card/80 backdrop-blur-sm px-4 lg:px-6 shrink-0">
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
                <p className="font-medium">{user?.name ?? "Usuário"}</p>
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
          <div className="h-full p-4 lg:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
