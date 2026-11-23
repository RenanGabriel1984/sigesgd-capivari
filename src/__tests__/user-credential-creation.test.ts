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
    expect(handler).toContain("requireUserManager(ctx)");
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
    expect(handler).toContain("normalizeUserName(args.name)");
    expect(handler).toContain("normalizeUserEmail(args.email)");
    expect(users).toContain("email.length > 254");
    expect(users).toContain("name.length > 120");
    expect(handler).toContain("args.temporaryPassword.length < 8");
    expect(handler).toContain("args.temporaryPassword.length > 200");
    expect(handler).toContain("organization.active === false");
    expect(handler.indexOf("args.temporaryPassword.length < 8")).toBeLessThan(handler.indexOf('ctx.db.insert("users"'));
  });

  it("aplica a mesma validação às rotas legadas de criação e edição", () => {
    const createStart = users.indexOf("export const createUser = mutation({");
    const updateStart = users.indexOf("export const updateUser = mutation({");
    const activateStart = users.indexOf("export const activateUser", updateStart);
    const createHandler = users.slice(createStart, updateStart);
    const updateHandler = users.slice(updateStart, activateStart);
    expect(createHandler).toContain("normalizeUserName(args.name)");
    expect(createHandler).toContain("normalizeUserEmail(args.email)");
    expect(updateHandler).toContain("normalizeUserName(updates.name)");
    expect(updateHandler).toContain("normalizeUserEmail(updates.email)");
    expect(updateHandler).toContain("organization.active === false");
  });

  it("usa expressão regular compatível com e-mails comuns", () => {
    expect(users).toContain(String.raw`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    expect(emailPattern.test("renan.martins@example.com")).toBe(true);
    expect(emailPattern.test("renan@example.com.br")).toBe(true);
    expect(emailPattern.test("renan example.com")).toBe(false);
  });

  it("expõe apenas a existência da senha e permite definir ou redefinir", () => {
    const start = users.indexOf("export const listUsers = query({");
    const end = users.indexOf("export const listUserOptions", start);
    const listing = users.slice(start, end);
    expect(listing).toContain("hasPassword: !!passwordRecord");
    expect(listing).not.toContain("passwordHash");
    expect(page).toContain('openPassword(u._id, u.name ?? u.email, !u.hasPassword)');
    expect(page).toContain('u.hasPassword ? "Redefinir senha" : "Definir senha"');
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


describe("primeiro acesso após autenticação", () => {
  const authPage = read("src/pages/Auth.tsx");

  it("aguarda o perfil Convex carregar antes de redirecionar", () => {
    expect(authPage).toContain("isAuthenticated && user !== undefined");
    expect(authPage).toContain("if (user?.requiresPasswordReset)");
    expect(authPage).not.toContain("if (!authLoading && isAuthenticated) {");
  });

  it("não navega imediatamente após signIn antes de verificar a troca obrigatória", () => {
    const start = authPage.indexOf('await signIn("credentials", formData)');
    const end = authPage.indexOf("} catch (error)", start);
    const signInHandler = authPage.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(signInHandler).not.toContain("navigate(redirect)");
    expect(signInHandler).toContain("setIsLoading(false)");
  });
});
