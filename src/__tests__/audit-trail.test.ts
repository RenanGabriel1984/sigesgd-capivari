import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const schema = readFileSync(resolve(root, "src/convex/schema.ts"), "utf8");
const passwords = readFileSync(resolve(root, "src/convex/passwords.ts"), "utf8");
const credentials = readFileSync(resolve(root, "src/convex/auth/credentials.ts"), "utf8");
const auditBackend = readFileSync(resolve(root, "src/convex/auditLogs.ts"), "utf8");
const auditPage = readFileSync(resolve(root, "src/pages/Audit.tsx"), "utf8");
const appShell = readFileSync(resolve(root, "src/components/AppShell.tsx"), "utf8");

describe("trilha de auditoria de autenticação", () => {
  it("schema aceita login bem-sucedido, login recusado e logout como eventos distintos", () => {
    expect(schema).toContain('LOGIN: "login"');
    expect(schema).toContain('LOGIN_FAILED: "login_failed"');
    expect(schema).toContain('LOGOUT: "logout"');
    expect(schema).toContain("v.literal(AUDIT_ACTIONS.LOGIN_FAILED)");
  });

  it("provider registra falhas e sucessos no fluxo real de credenciais", () => {
    expect(credentials).toContain("internal.passwords.recordFailedLogin");
    expect(credentials).toContain("internal.passwords.recordSuccessfulLogin");
    expect(passwords).toContain('action: "login_failed"');
    expect(passwords).toContain('details: `Login realizado com sucesso: ${email}`');
  });

  it("registra o encerramento explícito da sessão antes do signOut", () => {
    expect(passwords).toContain("export const recordLogout = mutation({");
    const recordIndex = appShell.indexOf("await recordLogout({})");
    const signOutIndex = appShell.indexOf("await signOut();", recordIndex);
    expect(recordIndex).toBeGreaterThanOrEqual(0);
    expect(signOutIndex).toBeGreaterThan(recordIndex);
  });
});

describe("consulta e navegação do histórico de auditoria", () => {
  it("usa paginação por cursor e não limita todo o histórico a uma janela fixa", () => {
    expect(auditBackend).toContain("paginationOpts: paginationOptsValidator");
    expect(auditBackend).toContain("orderedQuery.paginate(args.paginationOpts)");
    expect(auditPage).toContain("usePaginatedQuery(api.auditLogs.listFiltered");
    expect(auditPage).toContain('loadMoreAuditLogs(50)');
  });

  it("aplica simultaneamente usuário, ação, módulo e intervalo de datas", () => {
    expect(auditBackend).toContain('if (args.userId) filtered = filtered.filter');
    expect(auditBackend).toContain('if (args.action) filtered = filtered.filter');
    expect(auditBackend).toContain('if (args.entity) filtered = filtered.filter');
    expect(auditBackend).toContain("if (args.startDate !== undefined)");
    expect(auditBackend).toContain("if (args.endDate !== undefined)");
    expect(auditBackend).toContain("validateDateRange(args.startDate, args.endDate)");
  });

  it("mantém a lista de filtros para falha de login e logout", () => {
    expect(auditPage).toContain('"login_failed"');
    expect(auditPage).toContain('"logout"');
  });

  it("retorna somente os campos básicos do usuário na consulta de auditoria", () => {
    expect(auditBackend).toContain("_id: user._id, name: user.name, email: user.email, role: user.role");
    expect(auditBackend).not.toContain("return { ...log, user };");
  });
});
