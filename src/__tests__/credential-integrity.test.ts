import { describe, expect, it } from "vitest";
import { findUsersByNormalizedEmail, normalizeLoginEmail, resolveUniqueRecord } from "../lib/credential-integrity";

describe("resolveUniqueRecord", () => {
  it("distinguishes missing, unique and duplicate records", () => {
    expect(resolveUniqueRecord([])).toEqual({ status: "missing" });
    expect(resolveUniqueRecord([{ id: "one" }])).toEqual({
      status: "unique",
      record: { id: "one" },
    });
    expect(resolveUniqueRecord([{ id: "one" }, { id: "two" }])).toEqual({
      status: "ambiguous",
      count: 2,
    });
  });

  it("never selects an arbitrary record from duplicates", () => {
    const result = resolveUniqueRecord([{ id: "first" }, { id: "second" }]);
    expect(result).not.toHaveProperty("record");
  });
});


describe("normalizeLoginEmail", () => {
  it("trims surrounding whitespace and lowercases the address", () => {
    expect(normalizeLoginEmail("  Usuario@Capivari.SP.GOV.BR  ")).toBe("usuario@capivari.sp.gov.br");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeLoginEmail("   ")).toBe("");
  });
});

describe("user account email normalization integration", () => {
  it("normalizes and validates e-mail before creating or updating a user", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../convex/users.ts"), "utf8");
    expect(source).toContain("normalizeLoginEmail(args.email)");
    expect(source).toContain("normalizeLoginEmail(updates.email)");
    expect(source).toContain(".collect()");
  });
});


describe("password management rejects ambiguous credentials", () => {
  it("does not change an arbitrary password record in self-service or admin flows", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../convex/passwords.ts"), "utf8");
    for (const mutationName of ["changePassword", "adminResetPassword", "forceChangePassword"]) {
      const start = source.indexOf(`export const ${mutationName} = mutation({`);
      expect(start, `${mutationName} mutation exists`).toBeGreaterThan(-1);
      const nextExport = source.indexOf("\nexport const ", start + 1);
      const block = source.slice(start, nextExport === -1 ? source.length : nextExport);
      expect(block).toContain(".collect()");
      expect(block).toContain('passwordResolution.status === "ambiguous"');
    }

    const bootstrapStart = source.indexOf("export const bootstrapResetPassword = internalMutation({");
    expect(bootstrapStart).toBeGreaterThan(-1);
    const bootstrapEnd = source.indexOf("\nexport const ", bootstrapStart + 1);
    const bootstrapBlock = source.slice(bootstrapStart, bootstrapEnd === -1 ? source.length : bootstrapEnd);
    expect(bootstrapBlock).toContain(".collect()");
    expect(bootstrapBlock).toContain('passwordResolution.status === "ambiguous"');
  });
});


describe("user creation enforces backend password policy before writing the account", () => {
  it("validates temporary password length before calling createUser", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../pages/Users.tsx"), "utf8");
    const validation = source.indexOf("tempPassword.trim().length < 8");
    const create = source.indexOf("await createUser(");
    expect(validation).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(validation);
  });

  it("uses the same eight-character minimum in all password assignment forms", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../pages/Users.tsx"), "utf8");
    expect(source).toContain("password.trim().length < 8");
    expect(source).toContain("disabled={password.trim().length < 8}");
    expect(source).not.toContain("Mínimo 6 caracteres");
  });
});


describe("atomic user and temporary password creation", () => {
  it("creates the user and initial credential inside the same Convex mutation", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const backend = readFileSync(resolve(__dirname, "../convex/users.ts"), "utf8");
    const ui = readFileSync(resolve(__dirname, "../pages/Users.tsx"), "utf8");
    const start = backend.indexOf("export const createUser = mutation({");
    const end = backend.indexOf("\nexport const updateUser", start);
    const block = backend.slice(start, end);
    expect(block).toContain("temporaryPassword: v.string()");
    expect(block).not.toContain("v.optional(v.string())");
    expect(block).not.toContain("temporaryPassword !== undefined");
    expect(block).toContain('ctx.db.insert("passwords"');
    expect(block).toContain("requiresReset: true");
    expect(ui).toContain("temporaryPassword: tempPassword");
    expect(ui).not.toContain("await createPassword({ userId: newUserId");
  });
});


describe("cryptographic password salt generation", () => {
  it("uses Web Crypto secure randomness instead of Math.random", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../convex/auth/passwords.ts"), "utf8");
    expect(source).toContain("crypto.getRandomValues(bytes)");
    expect(source).not.toContain("Math.random()");
  });
});


describe("legacy account email normalization", () => {
  it("matches existing addresses regardless of surrounding whitespace or letter case", () => {
    const users = [
      { id: "legacy-upper", email: "  RENAN@CAPIVARI.SP.GOV.BR " },
      { id: "other", email: "outro@capivari.sp.gov.br" },
    ];
    expect(findUsersByNormalizedEmail(users, "renan@capivari.sp.gov.br")).toEqual([
      users[0],
    ]);
  });

  it("exposes case-variant legacy duplicates instead of choosing one account", () => {
    const users = [
      { id: "lower", email: "renan@capivari.sp.gov.br" },
      { id: "upper", email: "RENAN@CAPIVARI.SP.GOV.BR" },
    ];
    expect(
      resolveUniqueRecord(findUsersByNormalizedEmail(users, "Renan@Capivari.sp.gov.br")),
    ).toEqual({ status: "ambiguous", count: 2 });
  });

  it("uses normalized matching in all credential identity lookups", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const passwords = readFileSync(resolve(__dirname, "../convex/passwords.ts"), "utf8");
    const usersSource = readFileSync(resolve(__dirname, "../convex/users.ts"), "utf8");
    expect(passwords.match(/findUsersByNormalizedEmail\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(usersSource.match(/findUsersByNormalizedEmail\(/g)?.length).toBe(2);
  });
});
