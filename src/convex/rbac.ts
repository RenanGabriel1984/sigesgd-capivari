/**
 * Gestão de Estoque SGGD — AUTORIZAÇÃO DE BACKEND (RBAC).
 *
 * Toda mutation/query sensível valida permissão AQUI, a partir do usuário
 * AUTENTICADO no contexto — nunca de parâmetros, localStorage ou do navegador.
 * A fonte de verdade da matriz é `src/lib/rbac.ts` (compartilhada com o front).
 *
 * Uso:
 *   const { userId, user, role } = await requirePermission(ctx, "entries.create");
 *   // → lança "ACESSO NEGADO" ANTES de qualquer leitura/escrita de dados
 *     sensíveis, e registra um auditLog permission_denied (sem dados sensíveis).
 *
 * ─── FAIL CLOSED (hardening B-01) ────────────────────────────────────────────
 * A identidade autenticada é SEMPRE validada contra a tabela `users` do
 * SIGESGD. NÃO existe mais nenhum fallback que conceda acesso por ausência de
 * `role`: um documento sem papel, com papel inválido ou marcado como
 * `isAnonymous` é NEGADO. Somente um usuário autenticado, ATIVO, com `role`
 * presente no conjunto APP_ROLES e usuário correspondente no banco recebe
 * permissão.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  APP_ROLES,
  roleHasPermission,
  canActOnRequest as canActOnRequestPure,
  type AppPermission,
  type AppRole,
} from "../lib/rbac";

type UserId = Id<"users">;

/** Papéis efetivamente válidos (fonte única: src/lib/rbac.ts). */
const VALID_ROLES = new Set<string>(APP_ROLES);

/**
 * Papel efetivo do usuário autenticado.
 * Retorna `null` quando o documento NÃO possui um papel válido — o chamador
 * deve NEGAR o acesso (fail closed). Nunca assume "technician".
 */
export function effectiveRole(user: { role?: string } | null | undefined): AppRole | null {
  const role = user?.role as AppRole | undefined;
  if (!role) return null;
  return VALID_ROLES.has(role) ? role : null;
}

/**
 * Exige que o usuário autenticado possua a permissão.
 *
 * Ordem garantida: autenticação → documento no banco → não anônimo → ativo →
 * role válida → permissão → SÓ ENTÃO a função prossegue. Em caso de negação,
 * grava um auditLog `permission_denied` (usuário, papel, entidade, motivo) —
 * sem senha, token ou payload sensível.
 */
export async function requirePermission(
  ctx: MutationCtx | QueryCtx,
  permission: AppPermission,
  opts: { entity?: string; entityId?: string } = {},
): Promise<{ userId: UserId; user: any; role: AppRole }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");

  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");

  // B-01: identidade anônima (Convex Auth Anonymous provider) nunca é aceita,
  // mesmo que exista um documento correspondente na tabela `users`.
  if ((user as { isAnonymous?: boolean }).isAnonymous === true) {
    await logPermissionDenied(ctx, {
      userId,
      role: "anonymous",
      permission,
      entity: opts.entity ?? "auth",
      entityId: opts.entityId,
      details: "Identidade anônima rejeitada pelo SIGESGD (sessão sem credenciais).",
    });
    throw new Error("ACESSO NEGADO: sessão anônima não é aceita por este sistema.");
  }

  if (user.active === false) throw new Error("Usuário inativo. Procure um administrador.");

  // B-01: fail closed — sem `role` OU com `role` inválido o acesso é NEGADO.
  const role = effectiveRole(user);
  if (!role) {
    await logPermissionDenied(ctx, {
      userId,
      role: typeof user.role === "string" ? user.role : "(ausente)",
      permission,
      entity: opts.entity ?? "users",
      entityId: opts.entityId,
      details:
        "Perfil de acesso ausente ou inválido. Usuários do SIGESGD são criados " +
        "exclusivamente por um administrador (users.createUser).",
    });
    throw new Error(
      "ACESSO NEGADO: seu cadastro não possui um perfil de acesso válido. Procure um administrador.",
    );
  }

  if (!roleHasPermission(role, permission)) {
    await logPermissionDenied(ctx, {
      userId,
      role,
      permission,
      entity: opts.entity,
      entityId: opts.entityId,
    });
    throw new Error(
      `ACESSO NEGADO: seu perfil (${role}) não possui a permissão "${permission}".`,
    );
  }

  return { userId, user, role };
}

/**
 * Regra especial de REQUISIÇÕES: o solicitante NUNCA aprova/rejeita a própria
 * requisição — nem admin. O ator é sempre o usuário do contexto autenticado.
 */
export async function requireRequestAction(
  ctx: MutationCtx | QueryCtx,
  permission: "requests.approve" | "requests.reject" | "requests.deliver",
  requesterId: string,
  opts: { entity?: string; entityId?: string } = {},
): Promise<{ userId: UserId; user: any; role: AppRole }> {
  const auth = await requirePermission(ctx, permission, opts);
  if (auth.userId === requesterId) {
    await logPermissionDenied(ctx, {
      userId: auth.userId,
      role: auth.user.role ?? "technician",
      permission: "requests.self_approval",
      entity: opts.entity,
      entityId: opts.entityId,
      details: "Solicitante tentou agir sobre a própria requisição (autoaprovação bloqueada).",
    });
    throw new Error(
      "ACESSO NEGADO: não é possível aprovar, rejeitar ou entregar a sua própria solicitação.",
    );
  }
  return auth;
}

/** Variante pura (sem banco) reexportada para uso no frontend/testes. */
export const canActOnRequest = canActOnRequestPure;

/* ─── Auditoria de negação ──────────────────────────────────────────────────── */

async function logPermissionDenied(
  ctx: MutationCtx | QueryCtx,
  input: {
    userId: string;
    role: string;
    permission: string;
    entity?: string;
    entityId?: string;
    details?: string;
  },
): Promise<void> {
  try {
    // Queries não podem escrever no Convex — o log só acontece em mutations
    // (onde ctx.db possui `insert`). Nunca mascara o erro original.
    const db = ctx.db as unknown as { insert?: (...a: unknown[]) => unknown };
    if (typeof db.insert !== "function") return;
    await db.insert("auditLogs", {
      userId: input.userId as never,
      action: "permission_denied",
      entity: input.entity ?? "permission",
      entityId: input.entityId ?? input.permission,
      details:
        `ACESSO NEGADO — permissão exigida: "${input.permission}". ` +
        `Papel do usuário: "${input.role}".` +
        (input.details ? ` ${input.details}` : ""),
      timestamp: Date.now(),
    } as never);
  } catch {
    // Auditoria de negação é best-effort: nunca deve mascarar o erro original.
  }
}