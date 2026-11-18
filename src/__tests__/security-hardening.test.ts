/**
 * SIGESGD — BATERIA DE HARDENING DE SEGURANÇA (B-01..B-07 + W-02..W-10).
 *
 * Nenhum teste escreve no banco de produção. A cobertura é:
 *
 *  • SEC-*        → comportamento real de `src/convex/rbac.ts` e das queries de
 *                   `src/convex/requests.ts`, com o Convex e o `getAuthUserId`
 *                   mockados (identidade controlada por teste).
 *  • IDOR-REQ-*   → escopo de visibilidade por solicitante (B-03).
 *  • RESET-BF-*   → limite de tentativas do código de recuperação (§8).
 *  • demais checks → asserções sobre o código-fonte real (padrão já usado em
 *                   `rbac-definitive.test.ts`), complementadas por asserts de
 *                   comportamento puro da matriz em `src/lib/rbac.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  APP_ROLES,
  ROLE_PERMISSIONS,
  canActOnRequest,
  roleHasPermission,
} from "@/lib/rbac";
import { assertMaxLength, MAX_TEXT, MAX_OBSERVATION } from "@/lib/text-limits";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

/** Remove comentários para que asserções negativas não sejam enganadas. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MOCKS — identidade autenticada + contexto Convex
 * ═══════════════════════════════════════════════════════════════════════════ */

const h = vi.hoisted(() => ({
  currentUserId: null as string | null,
  captured: new Map<string, any>(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: async (_ctx: unknown) => h.currentUserId,
}));

/** Registra as definições de query/mutation/action por `kind:assinatura(args)`. */
function register(def: any, kind: string) {
  const keys = Object.keys(def.args ?? {}).sort().join(",");
  const fn = def.handler;
  fn.__kind = kind;
  h.captured.set(`${kind}:${keys}`, fn);
  return { ...def, handler: fn, [kind]: true };
}

vi.mock("@/convex/_generated/server", () => ({
  query: (def: any) => register(def, "query"),
  mutation: (def: any) => register(def, "mutation"),
  action: (def: any) => register(def, "action"),
  internalQuery: (def: any) => ({ ...def, __internal: true }),
  internalMutation: (def: any) => ({ ...def, __internal: true }),
  internalAction: (def: any) => ({ ...def, __internal: true }),
  httpAction: (def: any) => def,
}));

/**
 * Banco em memória mínimo. Reproduz o suficiente do `ctx.db` do Convex:
 *  • `ctx.db.get(id)`
 *  • `ctx.db.query(t).withIndex(i, q => q.eq(field, value))` — o callback é
 *    EXECUTADO contra um `q.eq` que captura campo/valor, como o Convex faz;
 *  • `.first()`, `.collect()`, `.order(d).take(n)`, `.paginate()`.
 */
function makeDb(tables: Record<string, any[]>): any {
  const state = { n: 0 };
  const rowsOf = (table: string) => tables[table] ?? [];

  const withRows = (matching: any[]) => ({
    first: async () => matching[0] ?? null,
    collect: async () => matching,
    order: (_dir: string) => ({
      take: async (n: number) => matching.slice(0, n),
      collect: async () => matching,
    }),
  });

  const runIndexFilter = (filter: any): any[] => {
    // Sem callback de filtro (índice sem predicado) ⇒ todas as linhas.
    if (typeof filter !== "function") return rowsOf(currentTable);
    let field: string | undefined;
    let value: any;
    const q = {
      eq: (f: string, v: any) => {
        field = f;
        value = v;
      },
    };
    filter(q);
    if (field === undefined) return [];
    return rowsOf(currentTable).filter((r: any) => r[field!] === value);
  };

  let currentTable = "";

  return {
    async get(id: string) {
      for (const rows of Object.values(tables)) {
        const found = (rows as any[]).find((r: any) => r._id === id);
        if (found) return found;
      }
      return null;
    },
    async insert(table: string, data: any) {
      state.n += 1;
      const id = `${table}_${state.n}`;
      tables[table] = tables[table] ?? [];
      tables[table].push({ _id: id, _creationTime: Date.now(), ...data });
      return id;
    },
    async patch(id: string, data: any) {
      for (const rows of Object.values(tables)) {
        const found = (rows as any[]).find((r: any) => r._id === id);
        if (found) Object.assign(found, data);
      }
    },
    query(table: string) {
      currentTable = table;
      return {
        withIndex(_index: string, filter?: any) {
          return withRows(runIndexFilter(filter));
        },
        ...withRows(rowsOf(table)),
      };
    },
    _tables: tables,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SEC-*: FAIL CLOSED DE requirePermission (B-01)
 * ═══════════════════════════════════════════════════════════════════════════ */

async function loadRbac() {
  return await import("@/convex/rbac");
}

describe("SEC — fail closed na autorização (B-01)", () => {
  beforeEach(() => {
    h.currentUserId = null;
    h.captured.clear();
  });

  async function ctxFor(user: any | null) {
    h.currentUserId = user ? "u1" : null;
    const tables: Record<string, any[]> = { users: user ? [user] : [] };
    return { db: makeDb(tables) } as any;
  }

  it("SEC-AUTH-01: sem sessão autenticada a operação é negada", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor(null);
    await expect(requirePermission(ctx, "stock.view")).rejects.toThrow(/Não autenticado/i);
  });

  it("SEC-AUTH-02: identidade anônima (isAnonymous) é SEMPRE negada", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", isAnonymous: true, active: true });
    await expect(requirePermission(ctx, "stock.view")).rejects.toThrow(/ACESSO NEGADO/i);
  });

  it("SEC-AUTH-03: identidade anônima com role technician também é negada", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", isAnonymous: true, role: "technician", active: true });
    await expect(requirePermission(ctx, "stock.view")).rejects.toThrow(/ACESSO NEGADO/i);
  });

  it("SEC-AUTH-04: usuário SEM role é negado (nunca vira technician)", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", active: true });
    await expect(requirePermission(ctx, "stock.view")).rejects.toThrow(/perfil de acesso válido/i);
  });

  it("SEC-AUTH-05: role inválida é negada", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", role: "superuser", active: true });
    await expect(requirePermission(ctx, "stock.view")).rejects.toThrow(/perfil de acesso válido/i);
  });

  it("SEC-AUTH-06: usuário inativo é negado", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", role: "admin", active: false });
    await expect(requirePermission(ctx, "stock.view")).rejects.toThrow(/inativo/i);
  });

  it("SEC-AUTH-07: usuário inexistente no banco é negado", async () => {
    const { requirePermission } = await loadRbac();
    h.currentUserId = "nao-existe";
    const ctx = { db: makeDb({ users: [] }) } as any;
    await expect(requirePermission(ctx, "stock.view")).rejects.toThrow(/Perfil de usuário/i);
  });

  it("SEC-AUTH-08: técnico autenticado válido recebe apenas o que o perfil permite", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", role: "technician", active: true });
    await expect(requirePermission(ctx, "stock.view")).resolves.toMatchObject({ role: "technician" });
    await expect(requirePermission(ctx, "users.manage")).rejects.toThrow(/ACESSO NEGADO/i);
    await expect(requirePermission(ctx, "audit.view")).rejects.toThrow(/ACESSO NEGADO/i);
    await expect(requirePermission(ctx, "stock.mutate")).rejects.toThrow(/ACESSO NEGADO/i);
  });

  it("SEC-AUTH-09: escalada de privilégio é impossível por perfil", async () => {
    const { requirePermission } = await loadRbac();
    const escalate: Array<[string, string]> = [
      ["technician", "users.manage"],
      ["technician", "roles.manage"],
      ["technician", "stock.mutate"],
      ["technician", "audit.view"],
      ["director", "users.manage"],
      ["director", "stock.mutate"],
      ["stock_manager", "users.manage"],
      ["stock_manager", "audit.view"],
      ["stock_manager", "settings.manage"],
    ];
    for (const [role, perm] of escalate) {
      const ctx = await ctxFor({ _id: "u1", role, active: true });
      await expect(
        requirePermission(ctx, perm as any),
        `${role} não pode ${perm}`,
      ).rejects.toThrow(/ACESSO NEGADO/i);
    }
  });

  it("SEC-AUTH-10: director aprova, mas não muta estoque nem administra usuários", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", role: "director", active: true });
    await expect(requirePermission(ctx, "requests.approve")).resolves.toMatchObject({ role: "director" });
    await expect(requirePermission(ctx, "requests.reject")).resolves.toBeTruthy();
    await expect(requirePermission(ctx, "stock.mutate")).rejects.toThrow(/ACESSO NEGADO/i);
    await expect(requirePermission(ctx, "users.manage")).rejects.toThrow(/ACESSO NEGADO/i);
  });

  it("SEC-AUTH-11: stock_manager opera o estoque mas não administra usuários", async () => {
    const { requirePermission } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", role: "stock_manager", active: true });
    await expect(requirePermission(ctx, "stock.mutate")).resolves.toMatchObject({ role: "stock_manager" });
    await expect(requirePermission(ctx, "entries.create")).resolves.toBeTruthy();
    await expect(requirePermission(ctx, "users.manage")).rejects.toThrow(/ACESSO NEGADO/i);
    await expect(requirePermission(ctx, "roles.manage")).rejects.toThrow(/ACESSO NEGADO/i);
  });

  it("SEC-AUTH-12: admin e secretary mantêm acesso administrativo completo", async () => {
    const { requirePermission } = await loadRbac();
    for (const role of ["admin", "secretary"] as const) {
      const ctx = await ctxFor({ _id: "u1", role, active: true });
      await expect(requirePermission(ctx, "users.manage")).resolves.toMatchObject({ role });
      await expect(requirePermission(ctx, "audit.view")).resolves.toBeTruthy();
    }
  });

  it("SEC-AUTH-13: self-approval é bloqueada inclusive para admin", async () => {
    const { requireRequestAction } = await loadRbac();
    const ctx = await ctxFor({ _id: "u1", role: "admin", active: true });
    await expect(requireRequestAction(ctx, "requests.approve", "u1")).rejects.toThrow(
      /própria solicitação/i,
    );
    await expect(requireRequestAction(ctx, "requests.approve", "outro")).resolves.toBeTruthy();
  });

  it("SEC-AUTH-14: effectiveRole devolve null para perfil ausente ou inválido", async () => {
    const { effectiveRole } = await loadRbac();
    expect(effectiveRole({ role: "admin" })).toBe("admin");
    expect(effectiveRole({ role: undefined })).toBeNull();
    expect(effectiveRole({ role: "root" })).toBeNull();
    expect(effectiveRole(null)).toBeNull();
  });

  it("SEC-AUTH-15: roleHasPermission nunca concede para papel desconhecido", () => {
    for (const role of APP_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
    expect(roleHasPermission(undefined, "stock.view")).toBe(false);
    expect(roleHasPermission(null, "stock.view")).toBe(false);
    expect(roleHasPermission("root" as any, "stock.view")).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * IDOR-REQ-01..05 — escopo de visibilidade em requests (B-03)
 * ═══════════════════════════════════════════════════════════════════════════ */

async function loadRequests() {
  await import("@/convex/requests");
  return h.captured;
}

function handlerFor(captured: Map<string, any>, argsKeys: string, kind = "query") {
  const fn = captured.get(`${kind}:${argsKeys}`);
  if (!fn) throw new Error(`handler não capturado para ${kind} [${argsKeys}]`);
  return fn;
}

async function requestsCtx(role: string, requesterId: string) {
  h.currentUserId = requesterId;
  const requests = [
    { _id: "reqA", requesterId: "tecA", status: "pending", secretariaId: "sec1" },
    { _id: "reqB", requesterId: "tecB", status: "pending", secretariaId: "sec1" },
    { _id: "reqC", requesterId: "tecA", status: "delivered", secretariaId: "sec1" },
    { _id: "reqD", requesterId: "tecB", status: "delivered", secretariaId: "sec1" },
  ];
  const tables: Record<string, any[]> = {
    users: [
      { _id: "tecA", role, active: true },
      { _id: "tecB", role: "technician", active: true },
      { _id: "dir1", role, active: true },
    ],
    requests,
    requestItems: [],
  };
  return { db: makeDb(tables) } as any;
}

let requestsModule: Promise<Map<string, any>> | null = null;

describe("IDOR — escopo de solicitações (B-03)", () => {
  beforeEach(() => {
    h.currentUserId = null;
  });

  it("IDOR-REQ-01: TÉCNICO não lê solicitação de outro usuário por requestId", async () => {
    requestsModule ??= loadRequests();
    const captured = await requestsModule;
    const get = handlerFor(captured, "requestId");
    const ctx = await requestsCtx("technician", "tecA");
    await expect(get(ctx, { requestId: "reqB" })).rejects.toThrow(/ACESSO NEGADO/i);
  });

  it("IDOR-REQ-02: TÉCNICO lê a própria solicitação", async () => {
    requestsModule ??= loadRequests();
    const captured = await requestsModule;
    const get = handlerFor(captured, "requestId");
    const ctx = await requestsCtx("technician", "tecA");
    await expect(get(ctx, { requestId: "reqA" })).resolves.toMatchObject({ _id: "reqA" });
  });

  it("IDOR-REQ-03: TÉCNICO em listDelivered recebe SOMENTE as próprias", async () => {
    requestsModule ??= loadRequests();
    const captured = await requestsModule;
    const listDelivered = handlerFor(captured, "endDate,secretariaId,serialSearch,startDate");
    const ctx = await requestsCtx("technician", "tecA");
    const result = await listDelivered(ctx, {});
    const ids = result.map((r: any) => r._id).sort();
    expect(ids).toEqual(["reqC"]);
    expect(result.some((r: any) => r.requesterId === "tecB")).toBe(false);
  });

  it("IDOR-REQ-04: TÉCNICO em listByOrganization recebe SOMENTE as próprias", async () => {
    requestsModule ??= loadRequests();
    const captured = await requestsModule;
    const listByOrg = handlerFor(captured, "organizationId");
    const ctx = await requestsCtx("technician", "tecA");
    const result = await listByOrg(ctx, { organizationId: "sec1" });
    const ids = result.map((r: any) => r._id).sort();
    expect(ids).toEqual(["reqC"]);
  });

  it("IDOR-REQ-05: perfis com visão completa (diretor/gestor/admin) mantêm acesso total", async () => {
    requestsModule ??= loadRequests();
    const captured = await requestsModule;
    const get = handlerFor(captured, "requestId");
    const listDelivered = handlerFor(captured, "endDate,secretariaId,serialSearch,startDate");
    const listByOrg = handlerFor(captured, "organizationId");
    for (const role of ["director", "stock_manager", "admin", "secretary"]) {
      const ctx = await requestsCtx(role, "dir1");
      await expect(get(ctx, { requestId: "reqB" })).resolves.toMatchObject({ _id: "reqB" });
      const delivered = await listDelivered(ctx, {});
      expect(delivered.length).toBe(2);
      const byOrg = await listByOrg(ctx, { organizationId: "sec1" });
      expect(byOrg.length).toBe(2);
    }
  });

  it("IDOR-REQ-06: listByUser mantém o escopo do solicitante", async () => {
    requestsModule ??= loadRequests();
    const captured = await requestsModule;
    const listByUser = handlerFor(captured, "userId");
    const ctx = await requestsCtx("technician", "tecA");
    const own = await listByUser(ctx, { userId: "tecA" });
    expect(Array.isArray(own)).toBe(true);
    expect(own.every((r: any) => r.requesterId === "tecA")).toBe(true);
    await expect(listByUser(ctx, { userId: "tecB" })).rejects.toThrow(/Acesso negado/i);
  });

  it("IDOR-REQ-07: requests.list aplica o mesmo filtro de escopo no código-fonte", () => {
    const reqSrc = stripComments(read("src/convex/requests.ts"));
    const listBlock = reqSrc.slice(
      reqSrc.indexOf("export const list = query"),
      reqSrc.indexOf("export const listByUser"),
    );
    expect(listBlock).toMatch(/hasFullVisibility\(role\)/);
    expect(listBlock).toMatch(/q\.eq\("requesterId", user\._id\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * RESET-BF-01..04 — brute force na recuperação de senha (§8)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("RESET-BF — limite de tentativas na recuperação de senha (§8)", () => {
  const src = stripComments(read("src/convex/passwords.ts"));

  it("RESET-BF-01: existe constante de limite de tentativas por token", () => {
    expect(src).toMatch(/RESET_MAX_ATTEMPTS\s*=\s*\d+/);
  });

  it("RESET-BF-02: toda tentativa inválida consome o limite e invalida o token ao esgotar", () => {
    expect(src).toMatch(/attempts:\s*0/);
    expect(src).toContain("const activeToken = tokens");
    expect(src).toContain("nextResetAttempt(");
    expect(src).toContain("await ctx.db.patch(activeToken._id, attemptUpdate)");
    expect(src).not.toMatch(/matching\.token === args\.code/);
  });

  it("RESET-BF-03: token usado/expirado/esgotado nunca é aceito", () => {
    expect(src).toMatch(/!token\.usedAt/);
    expect(src).toMatch(/token\.expiresAt\s*>\s*now/);
    expect(src).toMatch(/\(token\.attempts\s*\?\?\s*0\)\s*<\s*RESET_MAX_ATTEMPTS/);
  });

  it("RESET-BF-04: cooldown impede inundação de e-mail e a resposta é genérica", () => {
    expect(src).toMatch(/RESET_REQUEST_COOLDOWN_MS/);
    const genericCount = (src.match(/RESET_GENERIC_MESSAGE/g) ?? []).length;
    expect(genericCount).toBeGreaterThan(1);
    // O retorno não pode carregar o código de recuperação.
    expect(src).not.toMatch(/return\s*\{[^}]*\bcode\b/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * SEC-*: superfície de autenticação, segredos e hardening estrutural
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("SEC — superfície de autenticação (B-01/B-02/B-04)", () => {
  const authSrc = stripComments(read("src/convex/auth.ts"));
  const configSrc = stripComments(read("src/convex/auth.config.ts"));

  it("SEC-PROV-01: apenas o provider `credentials` é habilitado", () => {
    expect(authSrc).toMatch(/providers:\s*\[\s*credentials\s*,?\s*\]/);
    expect(authSrc).not.toMatch(/\bAnonymous\b/);
    expect(authSrc).not.toMatch(/\bemailOtp\b(?!\s*—)/);
  });

  it("SEC-PROV-02: o arquivo do provider OTP não existe mais", () => {
    expect(() => read("src/convex/auth/emailOtp.ts")).toThrow();
  });

  it("SEC-PROV-03: o provider federado está documentado e não concede papel", () => {
    expect(configSrc).toMatch(/customJwt/);
    expect(configSrc).toMatch(/applicationID:\s*"vly-convex"/);
    expect(configSrc).toMatch(/algorithm:\s*"RS256"/);
    // Nenhum papel é atribuído a partir do token federado.
    expect(configSrc).not.toMatch(/role\s*[:=]/);
  });

  it("SEC-PROV-04: bootstrap e seed não são invocáveis pelo cliente", () => {
    const usersSrc = stripComments(read("src/convex/users.ts"));
    const seedSrc = stripComments(read("src/convex/seed.ts"));
    expect(usersSrc).toMatch(/export const bootstrapAdmin = internalMutation\(/);
    expect(seedSrc).toMatch(/export const seedOrganizations = internalMutation\(/);
    expect(usersSrc).not.toMatch(/export const bootstrapAdmin = mutation\(/);
    expect(seedSrc).not.toMatch(/export const seedOrganizations = mutation\(/);
  });

  it("SEC-PROV-05: diagnóstico de contas anônimas é interno e read-only", () => {
    const auditSrc = stripComments(read("src/convex/securityAudit.ts"));
    expect(auditSrc).toMatch(/export const auditAnonymousAccounts = internalQuery\(/);
    expect(auditSrc).toMatch(/export const auditRoleAssignments = internalQuery\(/);
    // Nenhuma escrita: o diagnóstico nunca cria, altera ou remove contas.
    expect(auditSrc).not.toMatch(/db\.(insert|patch|replace|delete)/);
  });
});

describe("SEC — contabilidade de falhas de login (§9/§10) e enumeração (§11)", () => {
  const pwSrc = stripComments(read("src/convex/passwords.ts"));
  const credSrc = stripComments(read("src/convex/auth/credentials.ts"));

  it("SEC-BF-01: recordFailedLogin é interno (não há endpoint público de bloqueio)", () => {
    expect(pwSrc).toMatch(/export const recordFailedLogin = internalMutation\(/);
    expect(pwSrc).not.toMatch(/export const recordFailedLogin = mutation\(/);
  });

  it("SEC-BF-02: tentativas inválidas são auditadas sem bloqueio remoto por e-mail", () => {
    expect(pwSrc).not.toMatch(/lockExpired|LOGIN_MAX_ATTEMPTS|LOGIN_LOCK_MINUTES/);
    expect(pwSrc).toMatch(/attempts: newAttempts/);
    expect(pwSrc).toMatch(/lockedUntil: undefined/);
  });

  it("SEC-BF-03: login bem-sucedido zera o contador de tentativas", () => {
    expect(pwSrc).toMatch(/export const recordSuccessfulLogin = internalMutation\(/);
    expect(pwSrc).toMatch(/attempts:\s*0,\s*lockedUntil:\s*undefined/);
    expect(credSrc).toMatch(/internal\.passwords\.recordSuccessfulLogin/);
  });

  it("SEC-ENUM-01: verifyCredentials usa UMA única mensagem de erro", () => {
    const verifyBlock = pwSrc.slice(
      pwSrc.indexOf("export const verifyCredentials"),
      pwSrc.indexOf("export const hasPassword"),
    );
    expect(verifyBlock).toMatch(/GENERIC_AUTH_ERROR/);
    expect(verifyBlock).not.toMatch(/Usuário não encontrado/);
    expect(verifyBlock).not.toMatch(/Usuário inativo/);
    expect(verifyBlock).not.toMatch(/Senha não configurada/);
    // Contas sem perfil executam o mesmo PBKDF2 fictício; senha incorreta
    // usa o mesmo erro genérico após a verificação real.
    const failures = verifyBlock.match(/return await rejectCredentials\(args\.password\)/g) ?? [];
    expect(failures.length).toBeGreaterThan(3);
    expect(pwSrc).toMatch(/async function rejectCredentials\(password: string\)/);
    expect(pwSrc).toMatch(/verifyPassword\(password, DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT\)/);
    expect(verifyBlock).toMatch(/return \{ success: false, error: GENERIC_AUTH_ERROR \}/);
  });

  it("SEC-ENUM-02: verifyCredentials recusa identidade anônima e sem role", () => {
    const verifyBlock = pwSrc.slice(
      pwSrc.indexOf("export const verifyCredentials"),
      pwSrc.indexOf("export const hasPassword"),
    );
    expect(verifyBlock).toMatch(/isAnonymous === true/);
    expect(verifyBlock).toMatch(/VALID_ROLE_SET\.has/);
  });

  it("SEC-PWD-01: política de senha com mínimo de 8 caracteres", () => {
    expect(pwSrc).toMatch(/MIN_PASSWORD_LENGTH\s*=\s*8/);
    expect(pwSrc).toMatch(/function assertPasswordPolicy/);
    // Nenhuma validação remnants de 6 caracteres.
    expect(pwSrc).not.toMatch(/length < 6/);
    expect(pwSrc).not.toMatch(/pelo menos 6 caracteres/);
  });

  it("SEC-PWD-02: gestão de senha própria também falha fechado", () => {
    expect(pwSrc).toMatch(/requirePermission\(ctx,\s*"settings\.view"/);
  });
});

describe("SEC — segredos (B-07)", () => {
  it("SEC-SECRET-01: nenhuma chave de e-mail está embutida no código-fonte", () => {
    const files = [
      "src/convex/email.ts",
      "src/convex/auth/credentials.ts",
      "src/convex/passwords.ts",
      "src/convex/auth.ts",
    ];
    for (const f of files) {
      expect(stripComments(read(f)), f).not.toMatch(/fb_email_/);
    }
  });

  it("SEC-SECRET-02: a credencial vem do ambiente e falha fechada quando ausente", () => {
    const emailSrc = stripComments(read("src/convex/email.ts"));
    expect(emailSrc).toMatch(/FREEBUFF_EMAIL_API_KEY/);
    expect(emailSrc).toMatch(/function readEmailApiKey\(\)/);
    expect(emailSrc).toMatch(/email_not_configured/);
  });

  it("SEC-SECRET-03: sendFirstAccessEmail é action autenticada e não relay público", () => {
    const emailSrc = stripComments(read("src/convex/email.ts"));
    expect(emailSrc).toMatch(/export const sendFirstAccessEmail = action\(/);
    expect(emailSrc).toMatch(/getAuthUserId\(ctx\)/);
    expect(emailSrc).toMatch(/getFirstAccessRecipientInternal/);
    expect(emailSrc).toMatch(/roleHasPermission\(admin\.role as AppRole, "users\.manage"\)/);
    // O destinatário precisa existir como usuário SIGESGD.
    expect(emailSrc).toMatch(/withIndex\("email"/);
    // A senha é conferida contra o hash e nunca é gravada em auditoria/log.
    expect(emailSrc).toMatch(/verifyPassword\(\s*args\.temporaryPassword/);
    expect(emailSrc).not.toMatch(/console\.(log|info|warn|error)\([^)]*temporaryPassword/);
  });
});

describe("SEC — integridade numérica e campos livres (§14/§17)", () => {
  it("SEC-NAN-01: requests rejeita valores não finitos em aprovação e entrega", () => {
    const reqSrc = stripComments(read("src/convex/requests.ts"));
    expect(reqSrc).toMatch(/Number\.isFinite\(input\.quantityApproved\)/);
    expect(reqSrc).toMatch(/Number\.isFinite\(input\.quantityDelivered\)/);
  });

  it("SEC-NAN-02: cadastros rejeitam valores numéricos não finitos", () => {
    const prodSrc = stripComments(read("src/convex/products.ts"));
    expect(prodSrc).toMatch(/Number\.isFinite\(value as number\)/);
  });

  it("SEC-TEXT-01: campos livres têm limite com erro amigável (sem truncamento)", () => {
    const limitsSrc = stripComments(read("src/lib/text-limits.ts"));
    expect(limitsSrc).toMatch(/MAX_TEXT\s*=\s*1000/);
    expect(limitsSrc).toMatch(/MAX_OBSERVATION\s*=\s*2000/);
    expect(limitsSrc).not.toMatch(/\.slice\(0,\s*max\)/);

    for (const f of [
      "src/convex/requests.ts",
      "src/convex/products.ts",
      "src/convex/suppliers.ts",
      "src/convex/categories.ts",
    ]) {
      expect(stripComments(read(f)), f).toMatch(/assertTextLimits|assertShortTextLimits/);
    }
  });

  it("SEC-TEXT-02: assertMaxLength rejeita (nunca trunca) com limite e tamanho", () => {
    expect(() => assertMaxLength("Motivo", "a".repeat(10), 10)).not.toThrow();
    expect(() => assertMaxLength("Motivo", "a".repeat(11), 10)).toThrow(/Motivo muito longo/);
    expect(() => assertMaxLength("Motivo", "a".repeat(11), 10)).toThrow(/11/);
    expect(MAX_OBSERVATION).toBeGreaterThan(MAX_TEXT);
  });

  it("SEC-TEXT-03: o aviso LGPD está disponível para a interface", () => {
    const noticeSrc = read("src/lib/text-limits.ts");
    expect(noticeSrc).toMatch(/LGPD_FREE_FIELD_NOTICE/);
    expect(noticeSrc).toMatch(/CPF, RG, telefone, endereço, dados de saúde/);
    for (const f of ["src/pages/Requests.tsx", "src/pages/Products.tsx", "src/pages/Suppliers.tsx"]) {
      expect(read(f), f).toMatch(/FreeFieldNotice/);
    }
  });
});

describe("SEC — storage de documentos (§16)", () => {
  it("SEC-STORAGE-01: getUrls limita o lote e valida o formato do storageId", () => {
    const storageSrc = stripComments(read("src/convex/storage.ts"));
    expect(storageSrc).toMatch(/MAX_URLS_PER_CALL\s*=\s*50/);
    expect(storageSrc).toMatch(/STORAGE_ID_PATTERN/);
    expect(storageSrc).toMatch(/assertMaxLength|assertValidStorageId/);
  });

  it("SEC-STORAGE-02: toda função de storage exige permissão de servidor", () => {
    const storageSrc = stripComments(read("src/convex/storage.ts"));
    const required = storageSrc.match(/requirePermission\(ctx,\s*"[a-z_.]+"/g) ?? [];
    // generateUploadUrl e registerUpload exigem a permissão de estoque diretamente;
    // getUrl/getUrls usam getStorageViewer + effectiveRole para autorizar pelo dono.
    expect(required.length).toBeGreaterThanOrEqual(2);
    expect(storageSrc).toMatch(/isAnonymous === true/);
    expect(storageSrc).toMatch(/effectiveRole\(user\)/);
    expect(storageSrc).toMatch(/getStorageViewer/);
  });
});

describe("SEC — anti-autoaprovação (§4) preservada", () => {
  it("SEC-SELF-01: canActOnRequest nega o solicitante em qualquer perfil", () => {
    for (const role of APP_ROLES) {
      expect(canActOnRequest({ role, permission: "requests.approve", actorId: "x", requesterId: "x" })).toBe(false);
    }
    expect(canActOnRequest({ role: "admin", permission: "requests.approve", actorId: "a", requesterId: "b" })).toBe(true);
  });

  it("SEC-SELF-02: approve/reject no backend usam requireRequestAction", () => {
    const reqSrc = stripComments(read("src/convex/requests.ts"));
    expect(reqSrc).toMatch(/requireRequestAction\(ctx,\s*"requests\.approve"/);
    expect(reqSrc).toMatch(/requireRequestAction\(ctx,\s*"requests\.reject"/);
  });
});

describe("AUTH-RESET — proteção adicional de recuperação", () => {
  it("AUTH-RESET-01: confirmação rejeita contas inativas, anônimas ou sem papel válido", () => {
    const passwordSrc = stripComments(read("src/convex/passwords.ts"));
    const confirmBlock = passwordSrc.slice(
      passwordSrc.indexOf("export const confirmPasswordReset"),
      passwordSrc.indexOf("export const recordFailedLogin"),
    );
    expect(confirmBlock).toMatch(/user\.active === false/);
    expect(confirmBlock).toMatch(/isAnonymous === true/);
    expect(confirmBlock).toMatch(/VALID_ROLE_SET\.has/);
    const emailSrc = stripComments(read("src/convex/email.ts"));
    expect(emailSrc).toMatch(/roleHasPermission\(user\.role as AppRole, "settings\.view"\)/);
  });

  it("AUTH-RESET-02: valores dinâmicos do e-mail de primeiro acesso são escapados no HTML", () => {
    const emailSrc = stripComments(read("src/convex/email.ts"));
    expect(emailSrc).toMatch(/function escapeHtml\(value: string\)/);
    expect(emailSrc).toMatch(/htmlSafeName = escapeHtml\(safeName\)/);
    expect(emailSrc).toMatch(/htmlSafeTemporaryPassword = escapeHtml\(args\.temporaryPassword\)/);
    expect(emailSrc).toMatch(/Bem-vindo, \$\{htmlSafeName\}/);
    expect(emailSrc).toMatch(/\$\{htmlSafeTemporaryPassword\}/);
  });
});

describe("RESET-HASH — códigos de recuperação protegidos em repouso", () => {
  it("RESET-HASH-01: novos registros não persistem o código em texto", () => {
    const passwordSrc = stripComments(read("src/convex/passwords.ts"));
    const schemaSrc = stripComments(read("src/convex/schema.ts"));
    const requestBlock = passwordSrc.slice(
      passwordSrc.indexOf("export const requestPasswordReset"),
      passwordSrc.indexOf("export const confirmPasswordReset"),
    );
    expect(schemaSrc).toMatch(/token:\s*v\.optional\(v\.string\(\)\)/);
    expect(schemaSrc).toMatch(/tokenHash:\s*v\.optional\(v\.string\(\)\)/);
    expect(schemaSrc).toMatch(/tokenSalt:\s*v\.optional\(v\.string\(\)\)/);
    expect(requestBlock).not.toMatch(/token:\s*code/);
    expect(requestBlock).toMatch(/runAfter\(0,\s*internal\.email\.sendPasswordResetEmailInternal/);
  });

  it("RESET-HASH-02: envio gera hash antes de persistir e envia o código sem armazená-lo", () => {
    const emailSrc = stripComments(read("src/convex/email.ts"));
    const actionBlock = emailSrc.slice(
      emailSrc.indexOf("export const sendPasswordResetEmailInternal"),
      emailSrc.indexOf("E-mail de primeiro acesso"),
    );
    expect(actionBlock).toMatch(/generateSecureNumericCode\(\)/);
    expect(actionBlock).toMatch(/hashResetCode\(code\)/);
    expect(actionBlock).toMatch(/storePasswordResetHashInternal/);
    expect(actionBlock).toMatch(/sendOtpEmail\(payload\.email,\s*code\)/);
    expect(actionBlock).not.toMatch(/token:\s*code/);
  });

  it("RESET-INPUT-01: solicitações de recuperação limitam e normalizam e-mails sem enumerar contas", () => {
    const passwordSrc = stripComments(read("src/convex/passwords.ts"));
    const requestBlock = passwordSrc.slice(
      passwordSrc.indexOf("export const requestPasswordReset"),
      passwordSrc.indexOf("export const confirmPasswordReset"),
    );
    expect(requestBlock).toMatch(/email\.length > 254/);
    expect(requestBlock).toContain(String.raw`/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/`);
    expect(requestBlock).toMatch(/return \{ message: RESET_GENERIC_MESSAGE \}/);
    expect(requestBlock).not.toMatch(/Number\.isFinite\(args\.email\.length\)/);
  });

  it("RESET-INPUT-02: confirmação rejeita e-mail fora do limite com erro genérico", () => {
    const passwordSrc = stripComments(read("src/convex/passwords.ts"));
    const confirmBlock = passwordSrc.slice(
      passwordSrc.indexOf("export const confirmPasswordReset"),
      passwordSrc.indexOf("export const recordFailedLogin"),
    );
    expect(confirmBlock).toMatch(/email\.length > 254/);
    expect(confirmBlock).toMatch(/throw new Error\("Código inválido ou expirado"\)/);
  });

  it("RESET-HASH-03: confirmação aceita hash novo e somente legado plaintext ainda válido", () => {
    const passwordSrc = stripComments(read("src/convex/passwords.ts"));
    const confirmBlock = passwordSrc.slice(
      passwordSrc.indexOf("export const confirmPasswordReset"),
      passwordSrc.indexOf("export const recordFailedLogin"),
    );
    expect(confirmBlock).toMatch(/verifyResetCode\(args\.code,\s*activeToken\.tokenHash/);
    expect(confirmBlock).toMatch(/activeToken\.token === args\.code/);
    expect(confirmBlock).toMatch(/token\.expiresAt > now/);
  });
});


describe("AUTH-SESSION — revogação e proteção contra bloqueio remoto", () => {
  it("AUTH-SESSION-01: login não bloqueia uma conta apenas por tentativas inválidas por e-mail", () => {
    const credentials = stripComments(read("src/convex/auth/credentials.ts"));
    const passwords = stripComments(read("src/convex/passwords.ts"));
    expect(credentials).not.toMatch(/passwords\.isLockedOut/);
    expect(credentials).toMatch(/passwords\.recordFailedLogin/);
    expect(passwords).not.toMatch(/LOGIN_MAX_ATTEMPTS|LOGIN_LOCK_MINUTES/);
  });

  it("AUTH-SESSION-02: mudança de senha preserva a sessão atual e revoga as demais", () => {
    const passwords = stripComments(read("src/convex/passwords.ts"));
    expect(passwords).toMatch(/getAuthSessionId\(ctx\)/);
    expect(passwords).toMatch(/exceptSessionId: currentSessionId/);
    expect(passwords).toMatch(/invalidateUserSessionsInternal/);
    expect(passwords).toMatch(/invalidateSessions\(ctx/);
  });

  it("AUTH-SESSION-03: reset administrativo e recuperação revogam todas as sessões", () => {
    const passwords = stripComments(read("src/convex/passwords.ts"));
    expect(passwords).toMatch(/userId: args\.userId,[\s\S]{0,100}\n\s*\}\);/);
    expect(passwords).toMatch(/userId: user\.\_id,[\s\S]{0,100}\n\s*\}\);/);
  });

  it("AUTH-SESSION-04: desativação ou mudança de perfil revoga sessões do usuário", () => {
    const users = stripComments(read("src/convex/users.ts"));
    expect(users).toMatch(/securityProfileChanged/);
    expect(users).toMatch(/internal\.passwords\.invalidateUserSessionsInternal/);
  });
});


describe("EMAIL-FIRST-ACCESS — envio externo fora de mutation", () => {
  it("EMAIL-FIRST-ACCESS-01: envio usa action autenticada, valida o administrador e confere a senha armazenada", () => {
    const emailSrc = stripComments(read("src/convex/email.ts"));
    const actionBlock = emailSrc.slice(emailSrc.indexOf("export const sendFirstAccessEmail"));
    expect(actionBlock).toMatch(/sendFirstAccessEmail = action\(/);
    expect(actionBlock).toMatch(/getAuthUserId\(ctx\)/);
    expect(actionBlock).toMatch(/getFirstAccessRecipientInternal/);
    expect(actionBlock).toMatch(/verifyPassword\(\s*args\.temporaryPassword/);
    expect(actionBlock).toMatch(/fetch\("https:\/\/api\.resend\.com\/emails"/);
    expect(emailSrc).toMatch(/roleHasPermission\(admin\.role as AppRole, "users\.manage"\)/);
  });

  it("EMAIL-FIRST-ACCESS-02: senha temporária não é persistida no agendador nem em logs de auditoria", () => {
    const emailSrc = stripComments(read("src/convex/email.ts"));
    const auditBlock = emailSrc.slice(
      emailSrc.indexOf("export const recordFirstAccessEmailAuditInternal"),
      emailSrc.indexOf("export const sendFirstAccessEmail"),
    );
    expect(auditBlock).not.toMatch(/temporaryPassword|passwordHash|salt/);
    expect(emailSrc).not.toMatch(/scheduler\.runAfter[\s\S]{0,100}temporaryPassword/);
  });
});

describe("AUTH-TIMING — anti-enumeração por tempo de resposta", () => {
  it("AUTH-TIMING-01: contas inexistentes, inativas, inválidas ou sem senha executam PBKDF2 fictício", () => {
    const passwords = stripComments(read("src/convex/passwords.ts"));
    const verifyBlock = passwords.slice(
      passwords.indexOf("export const verifyCredentials"),
      passwords.indexOf("/** Check if a user has a password configured."),
    );
    expect(passwords).toMatch(/const DUMMY_PASSWORD_HASH/);
    expect(passwords).toMatch(/const DUMMY_PASSWORD_SALT/);
    expect(passwords).toMatch(/async function rejectCredentials\(password: string\)/);
    expect(verifyBlock.match(/return await rejectCredentials\(args\.password\)/g)?.length).toBe(5);
    expect(verifyBlock).toMatch(/if \(!valid\)\s*\{\s*return \{ success: false, error: GENERIC_AUTH_ERROR \};/);
  });

  it("AUTH-TIMING-02: entradas excessivamente longas são rejeitadas antes da derivação", () => {
    const credentials = stripComments(read("src/convex/auth/credentials.ts"));
    expect(credentials).toMatch(/email\.length > 254 \|\| password\.length > 200/);
  });
});


describe("STORAGE-UPLOAD — autorização e limite no servidor", () => {
  it("STORAGE-UPLOAD-01: geração e registro exigem permissão de mutação e validam metadados", () => {
    const storage = stripComments(read("src/convex/storage.ts"));
    const uploadStart = storage.indexOf("export const generateUploadUrl");
    const uploadEnd = storage.indexOf("export const getUrl", uploadStart);
    const registerStart = storage.indexOf("export const registerUpload");
    const registerEnd = storage.indexOf("export async function attachStorageFile", registerStart);
    const generateBlock = storage.slice(uploadStart, uploadEnd);
    const registerBlock = storage.slice(registerStart, registerEnd);
    expect(generateBlock).toMatch(/requirePermission\(ctx, "stock\.mutate"\)/);
    expect(registerBlock).toMatch(/requirePermission\(ctx, "stock\.mutate"\)/);
    expect(registerBlock).toMatch(/ctx\.db\.system\.get\("_storage"/);
    expect(registerBlock).toMatch(/isStorageUploadSizeAllowed\(metadata\.size\)/);
    expect(registerBlock).toMatch(/ctx\.storage\.delete/);
    expect(registerBlock).toMatch(/return \{ ok: false as const, reason: "invalid-size" as const \}/);
    const uploadUi = stripComments(read("src/components/FileUpload.tsx"));
    expect(uploadUi).toMatch(/if \(!registration\.ok\)/);
  });
});

describe("AUTH-RESET-REVOCATION — códigos antigos após mudança de acesso", () => {
  it("AUTH-RESET-REVOCATION-01: mudança de senha invalida todos os códigos pendentes", () => {
    const passwords = stripComments(read("src/convex/passwords.ts"));
    expect(passwords).toMatch(/async function invalidatePendingPasswordResets/);
    expect(passwords).toMatch(/invalidatePendingPasswordResets\(ctx, userId\)/);
    expect(passwords).toMatch(/invalidatePendingPasswordResets\(ctx, args\.userId\)/);
    expect(passwords).toMatch(/invalidatePendingPasswordResets\(ctx, user\.\_id\)/);
  });

  it("AUTH-RESET-REVOCATION-02: desativação e alteração de perfil invalidam códigos pendentes", () => {
    const users = stripComments(read("src/convex/users.ts"));
    expect(users).toMatch(/internal\.passwords\.invalidatePasswordResetsForUserInternal/);
  });

  it("AUTH-RESET-REVOCATION-03: força de troca só é aceita quando o primeiro acesso está pendente", () => {
    const passwords = stripComments(read("src/convex/passwords.ts"));
    const forceBlock = passwords.slice(
      passwords.indexOf("export const forceChangePassword"),
      passwords.indexOf("/** Verify email and password"),
    );
    expect(forceBlock).toMatch(/user\.requiresPasswordReset !== true && passwordRecord\.requiresReset !== true/);
  });
});
