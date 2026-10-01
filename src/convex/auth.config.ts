import type { AuthConfig } from "convex/server";

// ─── Hardening B-04 (superfície de autenticação) ─────────────────────────────
// POR QUE ESTE PROVIDER EXISTE
// A plataforma Freebuff (freebuff.com) assina tokens JWT próprios e o injeta
// no ambiente hospedado para permitir a sessão do próprio painel/prévia. Sem
// esta entrada, o `RequireAuth` do ambiente hospedado nunca confirma a sessão
// e fica em loop para `/auth`. NÃO REMOVER sem antes validar o preview.
//
// O QUE ELE NÃO CONSEGUE FAZER
// Este provider NÃO concede nenhum perfil de acesso. A autenticação federada
// pode, no máximo, produzir uma IDENTIDADE. Toda vez que uma função protegida
// é chamada, `src/convex/rbac.ts:requirePermission` revalida a identidade
// contra a tabela `users` do SIGESGD e falha fechado se:
//   • o documento não existir; ou
//   • `isAnonymous === true`; ou
//   • `active === false`; ou
//   • `role` estiver ausente ou não estiver em APP_ROLES.
// A autenticação por senhas (`internal.passwords.verifyCredentials`) tem a
// mesma regra. Portanto: uma identidade federada SEM usuário SIGESGD
// correspondente, ou com usuário sem `role`, NÃO obtém nenhuma permissão — nem
// a mínima de técnico. `verifyCredentials` também recusa login de identidade
// anônima ou sem `role` válido.
//
// RECOMENDAÇÃO (W-01 pendente): avaliar a remoção deste provider em um
// go-live posterior, mantendo então apenas o primeiro bloco (domínio próprio).
const freebuffIssuer =
  process.env.VLY_CONVEX_AUTH_ISSUER ?? "https://freebuff.com";

export default {
  providers: [
    // Standard Convex Auth provider for this project's own sign-in ("Get
    // Started" email/guest, see src/convex/auth.ts). The deployment
    // self-issues JWTs (iss = CONVEX_SITE_URL, no `kid` header) validated
    // via OIDC discovery at `${domain}/.well-known/openid-configuration`,
    // served by auth.addHttpRoutes() in convex/http.ts. Do NOT convert this
    // entry to `type: "customJwt"` — that path rejects tokens without a
    // `kid` header, so sign-in would silently never confirm and RequireAuth
    // would loop back to /auth forever.
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
    {
      // Identidade federada da plataforma — ver justificativa no topo do
      // arquivo. NÃO concede papel: `requirePermission` falha fechado para
      // qualquer identidade sem usuário SIGESGD ativo com `role` válido.
      type: "customJwt",
      issuer: freebuffIssuer,
      jwks: `${freebuffIssuer}/api/web/.well-known/jwks.json`,
      applicationID: "vly-convex",
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
