import type { Id } from "@/convex/_generated/dataModel";

// ─── Roles ───────────────────────────────────────────────────────────────────
export type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  stock_manager: "Responsável pelo Estoque",
  director: "Diretor",
  secretary: "Secretário",
  technician: "Técnico",
};

export const ROLE_LABELS_EN: Record<UserRole, string> = {
  admin: "Administrator",
  stock_manager: "Stock Manager",
  director: "Director",
  secretary: "Secretary",
  technician: "Technician",
};

// ─── Organization Types ──────────────────────────────────────────────────────
export type OrgType = "prefeitura" | "paco_municipal" | "gabinete" | "secretaria" | "departamento" | "unidade";

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  prefeitura: "Prefeitura",
  paco_municipal: "Paço Municipal",
  gabinete: "Gabinete",
  secretaria: "Secretaria",
  departamento: "Departamento",
  unidade: "Unidade",
};

// ─── Movement Types ──────────────────────────────────────────────────────────
export type MovementType = "entry" | "exit" | "transfer" | "adjustment" | "return";

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  entry: "Entrada",
  exit: "Saída",
  transfer: "Transferência",
  adjustment: "Ajuste",
  return: "Devolução",
};

export const MOVEMENT_TYPE_COLORS: Record<MovementType, string> = {
  entry: "text-emerald-600 bg-emerald-50",
  exit: "text-rose-600 bg-rose-50",
  transfer: "text-amber-600 bg-amber-50",
  adjustment: "text-blue-600 bg-blue-50",
  return: "text-violet-600 bg-violet-50",
};

// ─── Request Status ──────────────────────────────────────────────────────────
export type RequestStatusType = "pending" | "approved" | "rejected" | "delivered" | "cancelled";

export const REQUEST_STATUS_LABELS: Record<RequestStatusType, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export const REQUEST_STATUS_COLORS: Record<RequestStatusType, string> = {
  pending: "text-amber-600 bg-amber-50",
  approved: "text-emerald-600 bg-emerald-50",
  rejected: "text-rose-600 bg-rose-50",
  delivered: "text-blue-600 bg-blue-50",
  cancelled: "text-gray-600 bg-gray-50",
};

// ─── Audit Actions ───────────────────────────────────────────────────────────
export type AuditAction = "create" | "update" | "activate" | "deactivate" | "approve" | "reject" | "cancel" | "move_stock" | "login" | "logout" | "deliver" | "password_change" | "password_reset" | "reserve" | "toner_update" | "confirm_entry" | "reverse_entry" | "open_inventory" | "count_inventory" | "close_inventory" | "return_stock" | "reverse_exit" | "transfer_stock" | "gomaq_exchange" | "gomaq_collection"  | "gomaq_order"
  | "asset_create"
  | "asset_update"
  | "asset_assign"
  | "asset_transfer"
  | "asset_maintenance"
  | "asset_disposal"
  | "asset_part_install"
  | "asset_part_remove"
  | "license_create"
  | "license_assign";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: "Criação",
  update: "Alteração",
  activate: "Ativação",
  deactivate: "Desativação",
  approve: "Aprovação",
  reject: "Rejeição",
  cancel: "Cancelamento",
  move_stock: "Movimentação",
  login: "Login",
  logout: "Logout",
  deliver: "Entrega",
  password_change: "Alteração de Senha",
  password_reset: "Redefinição de Senha",
  reserve: "Reserva",
  toner_update: "Atualização Toner",
  confirm_entry: "Confirmação de Entrada",
  reverse_entry: "Estorno de Entrada",
  open_inventory: "Abertura de Inventário",
  count_inventory: "Contagem de Inventário",
  close_inventory: "Fechamento de Inventário",
  return_stock: "Devolução de Estoque",
  reverse_exit: "Estorno de Saída",
  transfer_stock: "Transferência de Estoque",
  gomaq_exchange: "Troca de Suprimento",
  gomaq_collection: "Coleta Gomaq",
  gomaq_order: "Pedido Mensal Gomaq",
  asset_create: "Criação de Equipamento",
  asset_update: "Atualização de Equipamento",
  asset_assign: "Atribuição de Equipamento",
  asset_transfer: "Transferência de Equipamento",
  asset_maintenance: "Manutenção de Equipamento",
  asset_disposal: "Descarte de Equipamento",
  asset_part_install: "Instalação de Peça",
  asset_part_remove: "Remoção de Peça",
  license_create: "Criação de Licença",
  license_assign: "Vinculação de Licença",
};

// ─── Units of Measure ────────────────────────────────────────────────────────
export const UNITS_OF_MEASURE = [
  "un", "pc", "cx", "m", "rl", "pct", "po", "kt", "outro",
] as const;

export const UNIT_LABELS: Record<string, string> = {
  un: "Unidade (UN)",
  pc: "Peça (PC)",
  cx: "Caixa (CX)",
  m: "Metro (M)",
  rl: "Rolo (RL)",
  pct: "Pacote (PCT)",
  po: "Pote (PO)",
  kt: "Kit (KT)",
  outro: "Outro",
};

// ─── Permissions by Role ─────────────────────────────────────────────────────
//
// FONTE ÚNICA DE VERDADE: a matriz vive em `src/lib/rbac.ts`. Os flags abaixo
// (usados por menus/botões) são DERIVADOS dela — admin e secretary apontam
// para o MESMO conjunto central, sem duplicação de regras.

import {
  ROLE_PERMISSIONS,
  roleHasPermission,
  type AppPermission,
  type AppRole,
} from "@/lib/rbac";

/** Mapa flag de UI → permissão central. */
const PERMISSION_FLAGS = {
  canViewDashboard: "dashboard.view",
  canViewStock: "stock.view",
  canViewMovements: "movements.view",
  canViewAuditLogs: "audit.view",
  canViewRequests: "requests.view",

  canManageUsers: "users.manage",
  canManageOrg: "organizations.manage",
  canManageCategories: "categories.manage",
  canManageProducts: "products.manage",
  canManageStock: "lots.manage",
  canManageSuppliers: "suppliers.manage",
  canManageSettings: "settings.manage",
  canManageInventory: "inventory.manage",
  canManageStorageLocations: "locations.manage",
  canManageGomaQ: "gomaq.manage",
  // Parametrização de reposição (parâmetros; não movimenta estoque)
  canViewStockParameters: "stock_parameters.view",
  canManageStockParameters: "stock_parameters.manage",
  // Solicitação mensal de suprimentos (documento de planejamento)
  canViewSupplyRequests: "supply_requests.view",
  canManageSupplyRequests: "supply_requests.manage",
  canManageAssets: "equipment.manage",
  canManageLicenses: "licenses.manage",

  canCreateEntries: "entries.create",
  canApproveRequests: "requests.approve",
  canRejectRequests: "requests.reject",
  canDeliver: "requests.deliver",
  canCreateRequests: "requests.create",
  canTransferStock: "transfers.create",
  canReturnStock: "returns.create",
} as const satisfies Record<string, AppPermission>;

export type Permissions = { [F in keyof typeof PERMISSION_FLAGS]: boolean };

function derivePermissions(role: AppRole): Permissions {
  const out = {} as { -readonly [F in keyof Permissions]: boolean };
  for (const [flag, permission] of Object.entries(PERMISSION_FLAGS) as Array<[
    keyof typeof PERMISSION_FLAGS,
    AppPermission
  ]>) {
    out[flag] = roleHasPermission(role, permission);
  }
  return out;
}

export const PERMISSIONS: Record<AppRole, Permissions> = {
  admin: derivePermissions("admin"),
  secretary: derivePermissions("secretary"), // MESMO conjunto de admin (matriz central)
  stock_manager: derivePermissions("stock_manager"),
  director: derivePermissions("director"),
  technician: derivePermissions("technician"),
};

export function getPermissions(role: UserRole | undefined): Permissions {
  if (!role) return PERMISSIONS.technician;
  return PERMISSIONS[role] ?? PERMISSIONS.technician;
}
