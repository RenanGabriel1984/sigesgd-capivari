import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  currentUserId: null as string | null,
  handlers: new Map<string, any>(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: async () => h.currentUserId,
}));

function register(def: any, kind: string) {
  const keys = Object.keys(def.args ?? {}).sort().join(",");
  h.handlers.set(`${kind}:${keys}`, def.handler);
  return { ...def, [kind]: true };
}

vi.mock("@/convex/_generated/server", () => ({
  query: (def: any) => register(def, "query"),
  mutation: (def: any) => register(def, "mutation"),
  internalQuery: (def: any) => register(def, "internalQuery"),
  internalMutation: (def: any) => register(def, "internalMutation"),
  action: (def: any) => register(def, "action"),
  internalAction: (def: any) => register(def, "internalAction"),
  httpAction: (def: any) => def,
}));

function makeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = Object.fromEntries(
    Object.entries(seed).map(([name, rows]) => [name, [...rows]]),
  );

  function matching(table: string, indexFilter?: (q: any) => void) {
    const rows = tables[table] ?? [];
    if (!indexFilter) return rows;
    let field: string | undefined;
    let value: unknown;
    indexFilter({
      eq: (name: string, expected: unknown) => {
        field = name;
        value = expected;
      },
    });
    return field === undefined ? [] : rows.filter((row) => row[field!] === value);
  }

  function queryBuilder(rows: any[]) {
    return {
      first: async () => rows[0] ?? null,
      collect: async () => rows,
      order: (_direction: string) => ({
        take: async (limit: number) => rows.slice(0, limit),
      }),
    };
  }

  return {
    async get(id: string) {
      for (const rows of Object.values(tables)) {
        const found = rows.find((row) => row._id === id);
        if (found) return found;
      }
      return null;
    },
    async insert(table: string, value: any) {
      tables[table] ??= [];
      const id = `${table}_${tables[table].length + 1}`;
      tables[table].push({ _id: id, ...value });
      return id;
    },
    async patch(id: string, value: any) {
      for (const rows of Object.values(tables)) {
        const found = rows.find((row) => row._id === id);
        if (found) Object.assign(found, value);
      }
    },
    query(table: string) {
      const rows = tables[table] ?? [];
      return {
        ...queryBuilder(rows),
        withIndex: (_name: string, filter?: (q: any) => void) =>
          queryBuilder(matching(table, filter)),
      };
    },
    _tables: tables,
  };
}

async function loadUsers() {
  await import("@/convex/users");
  return h.handlers;
}

async function loadAuditLogs() {
  await import("@/convex/auditLogs");
  return h.handlers;
}

function usersContext(seedUsers: any[]) {
  h.currentUserId = seedUsers.find((user) => user.role === "secretary")?._id
    ?? seedUsers.find((user) => user.role === "admin")?._id
    ?? "actor";
  return { db: makeDb({ users: seedUsers, passwords: [], auditLogs: [] }) } as any;
}

describe("gestão de usuários — autorização e último administrador ativo", () => {
  beforeEach(() => {
    h.currentUserId = null;
    h.handlers.clear();
  });

  it("permite à secretaria criar usuários porque users.manage é a regra central", async () => {
    const handlers = await loadUsers();
    const createUser = handlers.get("mutation:email,name,organizationId,role");
    expect(createUser).toBeTypeOf("function");

    const ctx = usersContext([
      { _id: "sec-1", role: "secretary", active: true },
    ]);
    const userId = await createUser(ctx, {
      name: "Novo técnico",
      email: "tecnico@example.test",
      role: "technician",
      organizationId: undefined,
    });

    expect(userId).toBe("users_1");
    expect(ctx.db._tables.users).toHaveLength(2);
    expect(ctx.db._tables.users[1]).toMatchObject({
      name: "Novo técnico",
      email: "tecnico@example.test",
      role: "technician",
      active: true,
    });
  });

  it("bloqueia rebaixar o último administrador ativo, mesmo havendo admins inativos", async () => {
    const handlers = await loadUsers();
    const updateUser = handlers.get("mutation:active,email,name,organizationId,role,userId");
    const ctx = usersContext([
      { _id: "sec-1", role: "secretary", active: true },
      { _id: "admin-1", role: "admin", active: true },
      { _id: "admin-2", role: "admin", active: false },
    ]);

    await expect(updateUser(ctx, {
      userId: "admin-1",
      role: "technician",
      active: undefined,
      name: undefined,
      email: undefined,
      organizationId: undefined,
    })).rejects.toThrow(/último administrador ativo/i);

    expect((await ctx.db.get("admin-1")).role).toBe("admin");
  });

  it("permite rebaixar um administrador quando outro administrador está ativo", async () => {
    const handlers = await loadUsers();
    const updateUser = handlers.get("mutation:active,email,name,organizationId,role,userId");
    const ctx = usersContext([
      { _id: "sec-1", role: "secretary", active: true },
      { _id: "admin-1", role: "admin", active: true },
      { _id: "admin-2", role: "admin", active: true },
    ]);

    await expect(updateUser(ctx, {
      userId: "admin-1",
      role: "technician",
      active: undefined,
      name: undefined,
      email: undefined,
      organizationId: undefined,
    })).resolves.toBe("admin-1");

    expect((await ctx.db.get("admin-1")).role).toBe("technician");
  });

  it("bloqueia a desativação direta do último administrador ativo", async () => {
    const handlers = await loadUsers();
    // deactivateUser é a última mutation registrada com o argumento userId.
    const deactivateUser = handlers.get("mutation:userId");
    const ctx = usersContext([
      { _id: "sec-1", role: "secretary", active: true },
      { _id: "admin-1", role: "admin", active: true },
      { _id: "admin-2", role: "admin", active: false },
    ]);

    await expect(deactivateUser(ctx, { userId: "admin-1" }))
      .rejects.toThrow(/último administrador ativo/i);
    expect((await ctx.db.get("admin-1")).active).toBe(true);
  });
});

describe("auditoria — aplicação simultânea de filtros", () => {
  beforeEach(() => {
    h.currentUserId = null;
    h.handlers.clear();
  });

  it("combina ação, entidade, usuário e intervalo de datas sem retornar falsos positivos", async () => {
    const handlers = await loadAuditLogs();
    const listFiltered = handlers.get("query:action,endDate,entity,limit,startDate,userId");
    expect(listFiltered).toBeTypeOf("function");

    h.currentUserId = "auditor-1";
    const logs = [
      { _id: "log-1", userId: "actor-1", action: "create", entity: "entries", timestamp: 200 },
      { _id: "log-2", userId: "actor-1", action: "create", entity: "users", timestamp: 210 },
      { _id: "log-3", userId: "actor-2", action: "create", entity: "entries", timestamp: 220 },
      { _id: "log-4", userId: "actor-1", action: "update", entity: "entries", timestamp: 230 },
      { _id: "log-5", userId: "actor-1", action: "create", entity: "entries", timestamp: 400 },
    ];
    const ctx = {
      db: makeDb({
        users: [{ _id: "auditor-1", role: "admin", active: true }],
        auditLogs: logs,
      }),
    } as any;

    const result = await listFiltered(ctx, {
      action: "create",
      entity: "entries",
      userId: "actor-1",
      startDate: 150,
      endDate: 300,
      limit: 50,
    });

    expect(result.map((row: any) => row._id)).toEqual(["log-1"]);
  });
});
