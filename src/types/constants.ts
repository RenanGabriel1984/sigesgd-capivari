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
export const PERMISSIONS = {
  admin: {
    canManageUsers: true,
    canManageOrg: true,
    canManageCategories: true,
    canManageProducts: true,
    canManageStock: true,
    canManageSuppliers: true,
    canCreateEntries: true,
    canApproveRequests: true,
    canRejectRequests: true,
    canDeliver: true,
    canViewMovements: true,
    canViewAuditLogs: true,
    canManageSettings: true,
    canCreateRequests: true,
    canManageInventory: true,
    canManageStorageLocations: true,
    canTransferStock: true,
    canReturnStock: true,
    canManageGomaQ: true,
    canManageAssets: true,
    canManageLicenses: true,
  },
  stock_manager: {
    canManageUsers: false,
    canManageOrg: false,
    canManageCategories: true,
    canManageProducts: true,
    canManageStock: true,
    canManageSuppliers: true,
    canCreateEntries: true,
    canApproveRequests: true,
    canRejectRequests: true,
    canDeliver: true,
    canViewMovements: true,
    canViewAuditLogs: false,
    canManageSettings: true,
    canCreateRequests: false,
    canManageInventory: true,
    canManageStorageLocations: true,
    canTransferStock: true,
    canReturnStock: true,
    canManageGomaQ: true,
    canManageAssets: true,
    canManageLicenses: true,
  },
  director: {
    canManageUsers: false,
    canManageOrg: false,
    canManageCategories: false,
    canManageProducts: false,
    canManageStock: false,
    canManageSuppliers: false,
    canCreateEntries: false,
    canApproveRequests: true,
    canRejectRequests: true,
    canDeliver: true,
    canViewMovements: true,
    canViewAuditLogs: false,
    canManageSettings: true,
    canCreateRequests: false,
    canManageInventory: false,
    canManageStorageLocations: false,
    canTransferStock: false,
    canReturnStock: false,
    canManageGomaQ: false,
    canManageAssets: true,
    canManageLicenses: false,
  },
  secretary: {
    canManageUsers: false,
    canManageOrg: false,
    canManageCategories: false,
    canManageProducts: false,
    canManageStock: false,
    canManageSuppliers: false,
    canCreateEntries: false,
    canApproveRequests: true,
    canRejectRequests: false,
    canDeliver: false,
    canViewMovements: true,
    canViewAuditLogs: false,
    canManageSettings: true,
    canCreateRequests: false,
    canManageInventory: false,
    canManageStorageLocations: false,
    canTransferStock: false,
    canReturnStock: false,
    canManageGomaQ: false,
    canManageAssets: false,
    canManageLicenses: false,
  },
  technician: {
    canManageUsers: false,
    canManageOrg: false,
    canManageCategories: false,
    canManageProducts: false,
    canManageStock: false,
    canManageSuppliers: false,
    canCreateEntries: false,
    canApproveRequests: false,
    canRejectRequests: false,
    canDeliver: false,
    canViewMovements: false,
    canViewAuditLogs: false,
    canManageSettings: true,
    canCreateRequests: true,
    canManageInventory: false,
    canManageStorageLocations: false,
    canTransferStock: false,
    canReturnStock: false,
    canManageGomaQ: false,
    canManageAssets: false,
    canManageLicenses: false,
  },
} as const;

export type Permissions = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export function getPermissions(role: UserRole | undefined): Permissions {
  if (!role) return PERMISSIONS.technician;
  return PERMISSIONS[role] ?? PERMISSIONS.technician;
}
