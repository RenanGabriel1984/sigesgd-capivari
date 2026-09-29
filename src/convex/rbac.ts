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
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  roleHasPermission,
  canActOnRequest as canActOnRequestPure,
  type AppPermission,
  type AppRole,
} from "../lib/rbac";

type UserId = Id<"users">;

/** Papel efetivo do usuário autenticado (fallback seguro: technician). */
export function effectiveRole(user: { role?: string } | null | undefined): AppRole {
  const role = user?.role as AppRole | undefined;
  return role ?? "technician";
}

/**
 * Exige que o usuário autenticado possua a permissão.
 *
 * Ordem garantida: autenticação → papel no banco → permissão → SÓ ENTÃO a
 * função prossegue. Em caso de negação, grava um auditLog `permission_denied`
 * (usuário, papel, entidade, motivo) — sem senha, token ou payload sensível.
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
  if (user.active === false) throw new Error("Usuário inativo. Procure um administrador.");

  const role = (user.role ?? "technician") as AppRole;
  if (!roleHasPermission(role, permission)) {
    await logPermissionDenied(ctx, {
      userId,
      role: user.role ?? "technician",
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
