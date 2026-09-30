/**
 * Gestão de Estoque SGGD — ESTADO ATIVO DO MENU (rota + parâmetros).
 *
 * ─── CAUSA RAIZ DO BUG REPORTADO ────────────────────────────────────────────
 * O item "Todos os equipamentos" tem href "/assets" e os itens de categoria
 * têm href "/assets?categoria=redes", "/assets?categoria=computadores", etc.
 *
 * `location.pathname` é SEMPRE "/assets" para todas elas (o `pathname` não
 * contém a query string). Comparando apenas o pathname:
 *
 *   - "/assets" === "/assets"                                  → "Todos" ATIVO
 *   - "/assets".startsWith("/assets?categoria=redes")         → falso
 *
 * ou seja, clicar em "Redes"/"Computadores"/"Telefonia" deixava o menu
 * apontando para "Todos os equipamentos", parecendo que a tela "caía" para
 * "Todos" sempre que a categoria não tinha documentos.
 *
 * ─── REGRA CORRETA ──────────────────────────────────────────────────────────
 *   1. "Todos os equipamentos" (/assets) só fica ativo quando NENHUMA visão
 *      filha está selecionada (exclusiveParams).
 *   2. "/assets?categoria=redes" só fica ativo quando o MESMO parâmetro está
 *      na URL atual — a categoria selecionada permanece na própria tela.
 *
 * A lógica é pura (sem React) para poder ser testada diretamente.
 */

export interface NavLocation {
  pathname: string;
  search?: string;
}

export interface NavActiveItem {
  href: string;
  /**
   * Parâmetros que, quando presentes na URL atual, signify uma visão filha e
   * portanto DESATIVAM este item (ex.: item "/assets" com
   * exclusiveParams ["categoria"]).
   */
  exclusiveParams?: string[];
}

/** Remove a barra final, preservando a raiz "/". */
function normalizePath(path: string): string {
  if (!path) return "/";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function toSearchParams(search?: string): URLSearchParams {
  const query = (search ?? "").replace(/^\?/, "");
  try {
    return new URLSearchParams(query);
  } catch {
    return new URLSearchParams();
  }
}

/** Separa "/assets?categoria=redes" em caminho + parâmetros. */
export function splitHref(href: string): { path: string; params: URLSearchParams } {
  const [rawPath, rawQuery = ""] = (href ?? "").split("?");
  return { path: normalizePath(rawPath), params: toSearchParams(rawQuery) };
}

/** O caminho da URL atual pertence ao item? (igualdade ou rota filha) */
export function pathMatches(pathname: string, hrefPath: string, allowPrefix: boolean): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(hrefPath);
  if (current === target) return true;
  if (!allowPrefix) return false;
  return current.startsWith(`${target}/`);
}

/**
 * Item de menu ativo? Considera caminho E query string.
 *
 * - `/assets?categoria=redes` com a URL atual `/assets?categoria=redes`
 *   → "Redes" ativo, "Todos os equipamentos" inativo.
 * - `/assets` com a URL atual `/assets?categoria=redes`
 *   → só "Redes" ativo.
 * - `/assets` com a URL atual `/assets` (ou `/assets/123`)
 *   → "Todos os equipamentos" ativo.
 */
export function isNavItemActive(location: NavLocation, item: NavActiveItem): boolean {
  const currentParams = toSearchParams(location.search);

  // 1) Visão filha selecionada desativa o item "pai".
  for (const key of item.exclusiveParams ?? []) {
    if (currentParams.get(key) != null) return false;
  }

  const { path, params } = splitHref(item.href);

  // 2) O caminho precisa bater (igualdade ou rota filha, exceto /dashboard).
  if (!pathMatches(location.pathname, path, path !== "/dashboard")) return false;

  // 3) Variantes por parâmetro: todos os parâmetros do href precisam bater.
  for (const [key, value] of params) {
    if (currentParams.get(key) !== value) return false;
  }

  return true;
}

/** Nome do item ativo entre uma lista — usado em testes e no rodapé do menu. */
export function findActiveNavItem<T extends NavActiveItem>(
  location: NavLocation,
  items: T[]
): T | null {
  return items.find((item) => isNavItemActive(location, item)) ?? null;
}
