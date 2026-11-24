/**
 * RESOLUÇÃO DA URL DO BACKEND CONVEX (R33.0).
 *
 * Produção: deployment oficial fixo, independente de variáveis injetadas.
 * Desenvolvimento local: usa o deployment cloud de desenvolvimento; nunca
 * grava acidentalmente no banco oficial por falta de configuração local.
 * Homologação: exige URL explícita e rejeita produção e desenvolvimento.
 *
 * O diagnóstico da DANFE importa resolvedConvexHost, portanto exibe o host
 * efetivamente utilizado pelo cliente.
 */
export const OFFICIAL_CONVEX_URL = "https://savory-sockeye-292.convex.cloud";
export const DEVELOPMENT_CONVEX_URL = "https://first-herring-264.convex.cloud";

export interface ConvexUrlEnv {
  VITE_CONVEX_URL?: string;
  VITE_APP_ENV?: string;
  DEV?: boolean;
  MODE?: string;
}

export const HOMOLOGACAO_APP_ENV = "homologacao";
export const DEVELOPMENT_APP_ENV = "development";

export function isHomologacaoEnv(env: ConvexUrlEnv): boolean {
  return String(env.VITE_APP_ENV ?? "")
    .trim()
    .toLowerCase() === HOMOLOGACAO_APP_ENV;
}

export function isDevelopmentEnv(env: ConvexUrlEnv): boolean {
  const configured = String(env.VITE_APP_ENV ?? "").trim().toLowerCase();
  if (configured) return configured === DEVELOPMENT_APP_ENV;
  return env.DEV === true || String(env.MODE ?? "").trim().toLowerCase() === "development";
}

function parseConvexUrl(raw: string, context: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`VITE_CONVEX_URL inválida para ${context}: ${raw}`);
  }

  if (url.protocol !== "https:" || !url.host.endsWith(".convex.cloud")) {
    throw new Error(
      `VITE_CONVEX_URL de ${context} não é um deployment Convex válido: ${url.host}`,
    );
  }

  return url;
}

export function resolveConvexUrl(env: ConvexUrlEnv): string {
  if (isHomologacaoEnv(env)) {
    const raw = String(env.VITE_CONVEX_URL ?? "").trim();
    if (!raw) {
      throw new Error(
        "VITE_APP_ENV=homologacao exige VITE_CONVEX_URL apontando para um deployment isolado.",
      );
    }

    const url = parseConvexUrl(raw, "homologação");
    const forbiddenHosts = [
      new URL(OFFICIAL_CONVEX_URL).host,
      new URL(DEVELOPMENT_CONVEX_URL).host,
    ];
    if (forbiddenHosts.includes(url.host)) {
      throw new Error(
        "Build de homologação não pode apontar para produção ou desenvolvimento — use um deployment isolado.",
      );
    }
    return url.origin;
  }

  if (isDevelopmentEnv(env)) {
    const raw = String(env.VITE_CONVEX_URL ?? DEVELOPMENT_CONVEX_URL).trim();
    const url = parseConvexUrl(raw, "desenvolvimento");
    if (url.host === new URL(OFFICIAL_CONVEX_URL).host) {
      throw new Error(
        "Build de desenvolvimento não pode apontar para o backend oficial de produção.",
      );
    }
    return url.origin;
  }

  // Produção é fixa: VITE_CONVEX_URL externo não pode redirecionar a aplicação.
  return OFFICIAL_CONVEX_URL;
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
