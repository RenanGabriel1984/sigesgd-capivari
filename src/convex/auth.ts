// Auth providers for Gestão de Estoque SGGD (Capivari).
//
// ─── SUPERFÍCIE MÍNIMA (hardening B-01 / B-02) ─────────────────────────────
// O SIGESGD é um sistema municipal de usuários ADMINISTRADOS: somente um
// administrador/secretário cria contas (users.createUser exige `users.manage`)
// e o acesso acontece por e-mail + senha.
//
// Providers NÃO habilitados aqui (e não devem ser reabilitados sem revisão):
//
//  • Anonymous  — permitia obter uma sessão válida SEM credenciais. Como a
//    tabela `users` do SIGESGD É a própria tabela de usuários do Convex Auth,
//    o documento anônimo (sem `role`) caía no perfil técnico em
//    `requirePermission` (fallback `user.role ?? "technician"`). Qualquer
//    visitante obtinha leitura de estoque/catálogo e criação de solicitações.
//    → Removido (B-01). `requirePermission` agora falha fechado para
//      qualquer identidade sem `role` válida ou marcada como `isAnonymous`.
//
//  • emailOtp   — permitia AUTO-REGISTRO: qualquer pessoa com um e-mail sob seu
//    controle recebia um OTP e criava um documento em `users` sem `role`,
//    obtendo o mesmo perfil técnico. → Removido (B-02).
//
// RECUPERAÇÃO DE SENHA NÃO DEPENDE DESTES PROVIDERS: ela é feita por
// `passwords.requestPasswordReset` → `passwords.confirmPasswordReset`, que
// enviam o código por `internal.email.sendPasswordResetEmailInternal`. Os dois
// fluxos são independentes: AUTENTICAÇÃO ≠ RECUPERAÇÃO DE SENHA.

import { convexAuth } from "@convex-dev/auth/server";
import { credentials } from "./auth/credentials";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [credentials],
});