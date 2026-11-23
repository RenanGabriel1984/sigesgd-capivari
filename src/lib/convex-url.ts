/**
 * RESOLUÇÃO DA URL DO BACKEND CONVEX (R32.0).
 *
 * Regra:
 *  • Produção (padrão): SEMPRE o deployment oficial fixo. O ambiente de build
 *    da plataforma pode injetar um `VITE_CONVEX_URL` desatualizado (outro
 *    deployment, sem a carga oficial) — esse valor é ignorado de propósito.
 *  • Homologação: só quando `VITE_APP_ENV=homologacao`. Aí a URL é
 *    OBRIGATÓRIA, precisa ser um deployment Convex válido e NUNCA pode ser o
 *    oficial. Sem isso o app falha fechado (erro explícito) em vez de
 *    consultar dados oficiais achando que está em homologação.
 *
 * Usada por `src/main.tsx` (cliente Convex) e pelo diagnóstico da DANFE —
 * assim o host exibido é exatamente o host em uso.
 */
export const OFFICIAL_CONVEX_URL = "https://first-herring-264.convex.cloud";

export interface ConvexUrlEnv {
  VITE_CONVEX_URL?: string;
  VITE_APP_ENV?: string;
}

export const HOMOLOGACAO_APP_ENV = "homologacao";

export function isHomologacaoEnv(env: ConvexUrlEnv): boolean {
  return String(env.VITE_APP_ENV ?? "")
    .trim()
    .toLowerCase() === HOMOLOGACAO_APP_ENV;
}

export function resolveConvexUrl(env: ConvexUrlEnv): string {
  if (!isHomologacaoEnv(env)) return OFFICIAL_CONVEX_URL;

  const raw = String(env.VITE_CONVEX_URL ?? "").trim();
  if (!raw) {
    throw new Error(
      "VITE_APP_ENV=homologacao exige VITE_CONVEX_URL apontando para o deployment de homologação.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`VITE_CONVEX_URL inválida para homologação: ${raw}`);
  }

  if (url.protocol !== "https:" || !url.host.endsWith(".convex.cloud")) {
    throw new Error(
      `VITE_CONVEX_URL de homologação não é um deployment Convex válido: ${url.host}`,
    );
  }

  if (url.host === new URL(OFFICIAL_CONVEX_URL).host) {
    throw new Error(
      "Build de homologação não pode apontar para o deployment oficial — use um backend isolado.",
    );
  }

  return url.origin;
}

/** Host de uma URL Convex (somente o host; nunca credenciais). */
export function convexHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** URL efetivamente usada por esta build. */
export const resolvedConvexUrl: string = resolveConvexUrl(
  import.meta.env as unknown as ConvexUrlEnv,
);

/** Host do backend desta build (exibido no diagnóstico). */
export const resolvedConvexHost: string | null = convexHost(resolvedConvexUrl);
