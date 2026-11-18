import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const users = read("src/convex/users.ts");
const page = read("src/pages/Users.tsx");

describe("cadastro seguro de usuários e credenciais", () => {
  it("cria conta e senha na mesma mutation", () => {
    const start = users.indexOf("export const createUserWithPassword = mutation({");
    const end = users.indexOf("export const createUser = mutation({", start);
    const handler = users.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(handler).toContain("requireAdmin(ctx)");
    expect(handler).toContain('ctx.db.insert("users"');
    expect(handler).toContain("hashPassword(args.temporaryPassword)");
    expect(handler).toContain('ctx.db.insert("passwords"');
    expect(handler).toContain("requiresPasswordReset: true");
    expect(handler).toContain("requiresReset: true");
    expect(handler).toContain('entity: "users"');
    expect(handler).toContain('entity: "passwords"');
  });

  it("normaliza e valida e-mail, nome, senha e unidade antes de gravar", () => {
    const start = users.indexOf("export const createUserWithPassword = mutation({");
    const end = users.indexOf("export const createUser = mutation({", start);
    const handler = users.slice(start, end);
    expect(handler).toContain("args.name.trim()");
    expect(handler).toContain("args.email.trim().toLowerCase()");
    expect(handler).toContain("args.temporaryPassword.length < 8");
    expect(handler).toContain("args.temporaryPassword.length > 200");
    expect(handler).toContain("organization.active === false");
    expect(handler.indexOf("args.temporaryPassword.length < 8")).toBeLessThan(handler.indexOf('ctx.db.insert("users"'));
  });

  it("a interface usa a operação atômica, sem duas chamadas separadas", () => {
    expect(page).toContain("api.users.createUserWithPassword");
    expect(page).toContain("temporaryPassword: tempPassword");
    expect(page).not.toContain("const newUserId = await createUser(");
    expect(page).toContain("A senha deve ter pelo menos 8 caracteres");
  });

  it("alinha também a definição e redefinição manual de senha ao mínimo de 8", () => {
    expect(page).toContain('placeholder="Mínimo 8 caracteres"');
    expect(page).toContain("disabled={password.length < 8}");
    expect(page).toContain("if (password.length < 8)");
  });
});
