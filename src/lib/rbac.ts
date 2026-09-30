/**
 * Gestão de Estoque SGGD — MATRIZ CENTRAL DE PERMISSÕES (RBAC definitivo).
 *
 * FONTE ÚNICA DE VERDADE: backend (`src/convex/rbac.ts`) e frontend
 * (`RequirePermission`, `AppShell`, `constants.ts`) derivam TUDO daqui.
 * Nenhuma verificação espalhada do tipo `role === "admin"` deve ser criada.
 *
 * ─── PERFIS ──────────────────────────────────────────────────────────────────
 *  admin + secretary → acesso completo (MESMO conjunto central — a diferença é
 *                      apenas identidade institucional; as regras NÃO são
 *                      duplicadas).
 *  stock_manager     → operação diária do estoque, sem administração de
 *                      usuários, papéis ou configurações críticas.
 *  director          → decisão: consulta + aprovação/rejeição de requisições;
 *                      NÃO altera estoque fora do fluxo operacional.
 *  technician        → interface simplificada: consulta estoque e cria as
 *                      PRÓPRIAS requisições.
 */

export const APP_ROLES = [
  "admin",
  "stock_manager",
  "director",
  "secretary",
  "technician",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** Todas as permissões do sistema. */
export const APP_PERMISSIONS = [
  "dashboard.view",
  "stock.view",
  "stock.mutate",

  "products.view",
  "products.manage",

  "categories.view",
  "categories.manage",

  "suppliers.view",
  "suppliers.manage",

  "organizations.view",
  "organizations.manage",

  "users.view",
  "users.manage",
  "roles.manage",

  "areas.view",
  "areas.manage",

  "locations.view",
  "locations.manage",

  "entries.view",
  "entries.create",
  "entries.import_nfe",

  "exits.view",
  "exits.create",

  "returns.view",
  "returns.create",

  "transfers.view",
  "transfers.create",

  "adjustments.view",
  "adjustments.create",

  "requests.view",
  "requests.create",
  "requests.approve",
  "requests.reject",
  "requests.deliver",

  "inventory.manage",

  "lots.view",
  "lots.manage",

  // Parametrização de reposição (parâmetros; NUNCA movimentação de estoque)
  "stock_parameters.view",
  "stock_parameters.manage",

  // Parametrização de unidades e embalagens (cadastro; NUNCA converte estoque)
  "packaging_parameters.view",
  "packaging_parameters.manage",

  // Solicitação mensal de suprimentos (documento de planejamento)
  "supply_requests.view",
  "supply_requests.manage",

  "movements.view",

  "reports.view",

  "equipment.view",
  "equipment.manage",

  "printers.view",
  "printers.manage",

  "gomaq.view",
  "gomaq.manage",

  "licenses.view",
  "licenses.manage",

  "audit.view",

  "settings.view",
  "settings.manage",
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

/* ─── Conjuntos por perfil ──────────────────────────────────────────────────── */

/** admin e secretary apontam para o MESMO array — regra única, sem duplicação. */
const FULL_ACCESS: readonly AppPermission[] = APP_PERMISSIONS;

const STOCK_MANAGER_ACCESS: readonly AppPermission[] = [
  // Operação
  "dashboard.view",
  "stock.view",
  "stock.mutate",
  // Cadastros de estoque
  "products.view",
  "products.manage",
  "categories.view",
  "categories.manage",
  "suppliers.view",
  "suppliers.manage",
  "areas.view",
  "areas.manage",
  "locations.view",
  "locations.manage",
  "lots.view",
  "lots.manage",
  // Parametrização de reposição (editar/salvar parâmetros)
  "stock_parameters.view",
  "stock_parameters.manage",
  // Parametrização de embalagens (cadastral; altera só a unidade de apresentação)
  "packaging_parameters.view",
  "packaging_parameters.manage",
  // Solicitação mensal de suprimentos
  "supply_requests.view",
  "supply_requests.manage",
  // Movimentações
  "entries.view",
  "entries.create",
  "entries.import_nfe",
  "exits.view",
  "exits.create",
  "returns.view",
  "returns.create",
  "transfers.view",
  "transfers.create",
  "adjustments.view",
  "adjustments.create",
  "movements.view",
  // Requisições (atendimento operacional)
  "requests.view",
  "requests.approve",
  "requests.reject",
  "requests.deliver",
  "inventory.manage",
  // Consulta e relatórios
  "reports.view",
  "equipment.view",
  "equipment.manage",
  "printers.view",
  "printers.manage",
  "gomaq.view",
  "gomaq.manage",
  "licenses.view",
  "licenses.manage",
  // Ajustes pessoais (senha própria) — sem configurações críticas
  "settings.view",
];

const DIRECTOR_ACCESS: readonly AppPermission[] = [
  "dashboard.view",
  "stock.view",
  "products.view",
  "equipment.view",
  // Diretor CONSULTA a parametrização e a solicitação mensal, mas NÃO altera
  // parâmetros nem cria/gera documentos (decisão é de quem opera o estoque).
  "stock_parameters.view",
  "packaging_parameters.view",
  "supply_requests.view",
  "requests.view",
  "requests.approve",
  "requests.reject",
  "movements.view",
  "reports.view",
  "settings.view",
];

const TECHNICIAN_ACCESS: readonly AppPermission[] = [
  "dashboard.view",
  "stock.view",
  "products.view",
  // Consulta e criação das PRÓPRIAS requisições
  "requests.view",
  "requests.create",
  // Info de impressoras para solicitar suprimentos de impressão
  "printers.view",
  // Estrutura organizacional para informar secretaria/departamento/unidade
  // na requisição (consulta; sem administração).
  "organizations.view",
  // Acesso às configurações de conta (troca de senha obrigatória no 1º login)
  "settings.view",
];

export const ROLE_PERMISSIONS: Record<AppRole, readonly AppPermission[]> = {
  admin: FULL_ACCESS,
  secretary: FULL_ACCESS, // mesmo array de admin — não duplicado
  stock_manager: STOCK_MANAGER_ACCESS,
  director: DIRECTOR_ACCESS,
  technician: TECHNICIAN_ACCESS,
};

/* ─── API de consulta ───────────────────────────────────────────────────────── */

/** Todos os papéis que possuem a permissão (útil para relatórios/auditoria). */
export function rolesWithPermission(permission: AppPermission): AppRole[] {
  return APP_ROLES.filter((role) => roleHasPermission(role, permission));
}

/** Verificação central: o papel possui a permissão? */
export function roleHasPermission(
  role: AppRole | undefined | null,
  permission: AppPermission,
): boolean {
  if (!role) return false;
  const set = ROLE_PERMISSIONS[role];
  return Array.isArray(set) ? set.includes(permission) : false;
}

/** Conjunto de permissões de um papel (para auditoria/testes). */
export function getRolePermissions(role: AppRole): readonly AppPermission[] {
  return ROLE_PERMISSIONS[role] ?? TECHNICIAN_ACCESS;
}

/* ─── Requisições: regra especial de AUTOAPROVAÇÃO ──────────────────────────── */

/**
 * Um ator pode executar a ação sobre a requisição?
 *
 * REGRA OBRIGATÓRIA: o SOLICITANTE NUNCA aprova/rejeita a PRÓPRIA requisição —
 * mesmo admin. A checagem é feita no BACKEND (esta função é pura e também
 * usada pelo frontend apenas para esconder o botão).
 */
export function canActOnRequest(input: {
  role: AppRole | undefined | null;
  permission: "requests.approve" | "requests.reject" | "requests.deliver";
  actorId: string;
  requesterId: string;
}): boolean {
  if (input.actorId === input.requesterId) return false; // autoaprovação bloqueada
  return roleHasPermission(input.role, input.permission);
}

/* ─── Mapa de rotas → permissão (proteção de acesso direto por URL) ────────── */

export const ROUTE_PERMISSIONS: Record<string, AppPermission> = {
  "/dashboard": "dashboard.view",
  "/stock": "stock.view",
  "/stock-parameters": "stock_parameters.view",
  "/packaging-parameters": "packaging_parameters.view",
  "/exit": "exits.create",
  "/products": "products.view",
  "/categories": "categories.view",
  "/entries": "entries.view",
  "/lots": "lots.view",
  "/storage-locations": "locations.view",
  "/stock-areas": "areas.view",
  "/inventory": "inventory.manage",
  "/requests": "requests.view",
  "/returns": "returns.view",
  "/transfers": "transfers.view",
  "/gomaq": "gomaq.view",
  "/assets": "equipment.view",
  "/licenses": "licenses.view",
  "/movements": "movements.view",
  "/organization": "organizations.view",
  "/users": "users.view",
  "/suppliers": "suppliers.view",
  "/printers": "printers.view",
  "/reports": "reports.view",
  "/audit": "audit.view",
  "/settings": "settings.view",
};

/**
 * Permissão exigida pela rota (prefixo mais longo vence — cobre /products/:id,
 * /assets/:id etc.). Rotas públicas (`/`, `/auth`) e desconhecidas → null
 * (são tratadas pelos mecanismos existentes).
 */
export function permissionForRoute(pathname: string): AppPermission | null {
  const match = Object.keys(ROUTE_PERMISSIONS)
    .filter((route) => pathname === route || pathname.startsWith(route + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_PERMISSIONS[match] : null;
}
