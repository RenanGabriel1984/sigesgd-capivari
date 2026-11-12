/**
 * RESOLUÇÃO DA URL DO BACKEND CONVEX (R32.0).
 *
 * Regra:
 *  • Operação atual (padrão): mantém o backend que efetivamente contém os
 *    dados operacionais carregados pelo Freebuff: first-herring-264. Embora o
 *    painel Convex o classifique como Development, ele é a base atualmente
 *    utilizada pelo SIGESGD. Não migrar automaticamente para o deployment
 *    marcado como Production (savory-sockeye-292).
 *  • Homologação: só quando `VITE_APP_ENV=homologacao`. Aí a URL é
 *    OBRIGATÓRIA e deve ser exclusivamente tame-alligator-797, no projeto
 *    Convex separado sigesgd-capivari-homologacao. Outros deployments são
 *    recusados para evitar apontar o teste a dados operacionais.
 *
 * Usada por `src/main.tsx` (cliente Convex) e pelo diagnóstico da DANFE —
 * assim o host exibido é exatamente o host em uso.
 */
/** Backend operacional atual confirmado pelo proprietário (Freebuff). */
export const ACTIVE_OPERATIONAL_CONVEX_URL =
  "https://first-herring-264.convex.cloud";

/** @deprecated Nome legado: este é o backend operacional atual, não o slot Convex Production. */
export const OFFICIAL_CONVEX_URL = ACTIVE_OPERATIONAL_CONVEX_URL;

/** Único backend permitido para a homologação persistente do projeto separado. */
export const HOMOLOGATION_CONVEX_URL =
  "https://tame-alligator-797.convex.cloud";

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
  if (!isHomologacaoEnv(env)) return ACTIVE_OPERATIONAL_CONVEX_URL;

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

  if (url.host !== new URL(HOMOLOGATION_CONVEX_URL).host) {
    throw new Error(
      `Build de homologação só pode usar ${new URL(HOMOLOGATION_CONVEX_URL).host}; destino recusado: ${url.host}.`,
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
