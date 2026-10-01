/**
 * Gestão de Estoque SGGD — DIAGNÓSTICO DE SEGURANÇA (somente leitura).
 *
 * Funções INTERNAL: não são alcançáveis pelo cliente. Executáveis apenas via
 * CLI/dashboard do deployment (`bunx convex run securityAudit:<fn> '{}'`).
 *
 * NENHUMA função deste módulo altera dados. Este módulo existe para que a
 * auditoria de segurança possa VERIFICAR o estado das contas sem precisar
 * criar, alterar ou excluir usuários de produção.
 */

import { internalQuery } from "./_generated/server";
import { APP_ROLES } from "../lib/rbac";

/**
 * Contas históricas criadas pelo provider `Anonymous` do Convex Auth
 * (removido em 2026-10 — hardening B-01).
 *
 * Reporta, sem apagar nada: quantidade, IDs, se estão ativos e se possuem
 * senha. Contas anônimas NÃO recebem mais nenhuma permissão: `requirePermission`
 * falha fechado para `isAnonymous === true` e para ausência de `role`.
 */
export const auditAnonymousAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const anonymous = users.filter((u: any) => u.isAnonymous === true);

    const rows: Array<{
      userId: string;
      createdAt: number;
      isActive: boolean | undefined;
      hasName: boolean;
      hasEmail: boolean;
      hasPassword: boolean;
    }> = [];

    for (const u of anonymous as any[]) {
      const password = await ctx.db
        .query("passwords")
        .withIndex("by_user", (q: any) => q.eq("userId", u._id))
        .first();
      rows.push({
        userId: u._id as string,
        createdAt: u._creationTime,
        isActive: u.active,
        hasName: !!u.name,
        hasEmail: !!u.email,
        hasPassword: !!password,
      });
    }

    return {
      totalUsers: users.length,
      anonymousCount: anonymous.length,
      anonymous: rows,
      note:
        "Diagnóstico read-only. Nenhuma conta foi criada, alterada ou removida. " +
        "Contas anônimas permanecem sem acesso: requirePermission falha fechado " +
        "para isAnonymous=true e para ausência de role.",
    };
  },
});

/**
 * Panorama de perfis de acesso (read-only).
 *
 * `withoutRole` são identidades autenticadas que NÃO possuem perfil SIGESGD —
 * por definição, não conseguem executar nenhuma operação protegida. Nenhuma
 * delas deve receber `role` automaticamente.
 */
export const auditRoleAssignments = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect() as any[];

    const byRole: Record<string, number> = {};
    for (const u of users) {
      const key = typeof u.role === "string" ? u.role : "(sem papel)";
      byRole[key] = (byRole[key] ?? 0) + 1;
    }

    const invalidRole = users
      .filter((u) => typeof u.role === "string" && !APP_ROLES.includes(u.role as never))
      .map((u) => ({ userId: u._id as string, role: u.role as string }));

    return {
      totalUsers: users.length,
      validRoles: APP_ROLES as unknown as string[],
      byRole,
      invalidRole,
      withoutRole: users
        .filter((u) => u.role === undefined || u.role === null)
        .map((u) => ({
          userId: u._id as string,
          isAnonymous: u.isAnonymous === true,
          createdAt: u._creationTime,
        })),
      inactive: users
        .filter((u) => u.active === false)
        .map((u) => ({ userId: u._id as string, role: u.role ?? "(sem papel)" })),
    };
  },
});