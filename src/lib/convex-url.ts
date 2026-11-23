/**
 * RESOLUÇÃO DA URL DO BACKEND CONVEX.
 *
 * Ambiente operacional confirmado pelo responsável do SIGESGD Capivari:
 *   first-herring-264.convex.cloud
 *
 * Esse é o backend que contém o inventário, as entradas de notas fiscais e os
 * demais registros operacionais. Não trocar esse destino por inferência de
 * nomes de deployments ou por configuração herdada de outro ambiente.
 *
 * O alias DEVELOPMENT_CONVEX_URL mantém o comportamento anterior do projeto
 * até que exista uma implantação de desenvolvimento distinta, expressamente
 * confirmada. A homologação usa exclusivamente tame-alligator-797.
 */
export const PRODUCTION_CONVEX_URL =
  "https://first-herring-264.convex.cloud";

/**
 * Compatibilidade operacional: não existe, neste momento, um backend de
 * desenvolvimento distinto confirmado para este repositório.
 * Portanto, preserva-se o destino já utilizado, sem inventar outro ambiente.
 */
export const DEVELOPMENT_CONVEX_URL = PRODUCTION_CONVEX_URL;

export const HOMOLOGATION_CONVEX_URL =
  "https://tame-alligator-797.convex.cloud";

export const ACTIVE_OPERATIONAL_CONVEX_URL = PRODUCTION_CONVEX_URL;
/** @deprecated Use PRODUCTION_CONVEX_URL. */
export const OFFICIAL_CONVEX_URL = PRODUCTION_CONVEX_URL;

export interface ConvexUrlEnv {
  VITE_CONVEX_URL?: string;
  VITE_APP_ENV?: string;
  MODE?: string;
}

export const HOMOLOGACAO_APP_ENV = "homologacao";

export function isHomologacaoEnv(env: ConvexUrlEnv): boolean {
  return String(env.VITE_APP_ENV ?? "")
    .trim()
    .toLowerCase() === HOMOLOGACAO_APP_ENV;
}

function requireExactDeploymentUrl(raw: string, expected: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`VITE_CONVEX_URL inválida para ${label}: ${raw}`);
  }

  if (url.protocol !== "https:" || !url.host.endsWith(".convex.cloud")) {
    throw new Error(`VITE_CONVEX_URL de ${label} não é um deployment Convex válido: ${url.host}`);
  }
  if (url.host !== new URL(expected).host) {
    throw new Error(`Ambiente ${label} só pode usar ${new URL(expected).host}; destino recusado: ${url.host}.`);
  }
  return url.origin;
}

export function resolveConvexUrl(env: ConvexUrlEnv): string {
  const appEnv = String(env.VITE_APP_ENV ?? "").trim().toLowerCase();
  if (appEnv && !["production", "development", HOMOLOGACAO_APP_ENV].includes(appEnv)) {
    throw new Error(`VITE_APP_ENV desconhecido: ${appEnv}`);
  }

  const viteMode = String(env.MODE ?? "").trim().toLowerCase();
  if (viteMode === "production" && appEnv === "development") {
    throw new Error("Build de produção não pode usar o backend de desenvolvimento.");
  }

  if (appEnv === HOMOLOGACAO_APP_ENV) {
    const raw = String(env.VITE_CONVEX_URL ?? "").trim();
    if (!raw) {
      throw new Error(
        "VITE_APP_ENV=homologacao exige VITE_CONVEX_URL apontando para o deployment de homologação.",
      );
    }
    return requireExactDeploymentUrl(raw, HOMOLOGATION_CONVEX_URL, "homologação");
  }

  // Mantém o backend operacional confirmado. Overrides não podem redirecionar
  // produção ou desenvolvimento para deployments desconhecidos.
  if (appEnv === "development" || viteMode === "development") {
    const raw = String(env.VITE_CONVEX_URL ?? DEVELOPMENT_CONVEX_URL).trim();
    return requireExactDeploymentUrl(raw, DEVELOPMENT_CONVEX_URL, "desenvolvimento");
  }

  return PRODUCTION_CONVEX_URL;
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
