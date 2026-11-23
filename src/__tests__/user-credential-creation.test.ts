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
    expect(listing).toContain("hasPassword: passwordRecordCount > 0");
    expect(listing).toContain("passwordRecordCount");
    expect(listing).not.toContain("passwordHash");
    expect(page).toContain("u.passwordRecordCount > 1");
    expect(page).toContain("senhas duplicadas");
    expect(page).toContain("Redefinir senha e corrigir duplicidade");
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

const passwordsSource = read("src/convex/passwords.ts");
const credentialsSource = read("src/convex/auth/credentials.ts");

function sourceSection(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker);
  expect(start, "início ausente: " + startMarker).toBeGreaterThan(-1);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("autenticação e recuperação com registros únicos", () => {
  it("login exige exatamente um usuário e uma senha", () => {
    const verify = sourceSection(passwordsSource, "export const verifyCredentials = internalQuery({", "/** Check if a user has a password configured. */");
    expect(verify).toContain('.withIndex("email", (q) => q.eq("email", args.email))');
    expect(verify).toContain(".collect();");
    expect(verify).toContain("userResolution.status !== \"unique\"");
    expect(verify).toContain('.withIndex("by_user", (q) => q.eq("userId", user._id))');
    expect(verify).toContain(".collect();");
    expect(verify).toContain("passwordResolution.status !== \"unique\"");
    expect(verify).not.toContain('.withIndex("email", (q) => q.eq("email", args.email)).first()');
    expect(verify).not.toContain('.withIndex("by_user", (q) => q.eq("userId", user._id)).first()');
    expect(credentialsSource).toContain("internal.passwords.verifyCredentials");
  });

  it("criação, troca e primeiro acesso não escolhem senha duplicada", () => {
    const create = sourceSection(passwordsSource, "export const createPassword = mutation({", "/** Change password");
    const change = sourceSection(passwordsSource, "export const changePassword = mutation({", "/** Admin reset password");
    const force = sourceSection(passwordsSource, "export const forceChangePassword = mutation({", "/** Verify email and password");
    for (const block of [create, change, force]) {
      expect(block).toContain(".collect()");
      expect(block).toContain("ambiguous");
    }
  });

  it("reset administrativo autorizado consolida credenciais duplicadas com novo hash", () => {
    const reset = sourceSection(passwordsSource, "export const adminResetPassword = mutation({", "/** Force change password");
    expect(reset).toContain("await requireAdmin(ctx)");
    expect(reset).toContain("passwordRows.length > 1");
    expect(reset).toContain("ctx.db.delete(record._id)");
    expect(reset).toContain('ctx.db.insert("passwords"');
    expect(reset).toContain("credencial(is) duplicada(s) removida(s)");
    expect(reset.indexOf("await hashPassword(args.newPassword)"))
      .toBeLessThan(reset.indexOf("ctx.db.delete(record._id)"));
  });

  it("recuperação por e-mail não enumera contas e só prossegue com usuário único", () => {
    const request = sourceSection(passwordsSource, "export const requestPasswordReset = mutation({", "/**\n * Confirm password reset");
    const confirm = sourceSection(passwordsSource, "export const confirmPasswordReset = mutation({", "export const recordFailedLogin");
    expect(request).toContain("userResolution.status !== \"unique\"");
    expect(request).toContain("RESET_GENERIC_MESSAGE");
    expect(confirm).toContain("userResolution.status === \"unique\"");
    expect(confirm).toContain("existingPasswordRows.map((record) => ctx.db.delete(record._id))");
    expect(confirm).toContain("passwordRecordId");
    expect(confirm).not.toContain('.withIndex("email", (q) => q.eq("email", email)).first()');
  });

  it("bootstraps rejeitam identidades duplicadas e não escolhem hash arbitrário", () => {
    const set = sourceSection(passwordsSource, "export const bootstrapSetPassword = internalMutation({", "/**\n * Diagnostic: list all users");
    const reset = sourceSection(passwordsSource, "export const bootstrapResetPassword = internalMutation({");
    expect(set).toContain("resolveUniqueRecord(matchingUsers)");
    expect(set).toContain("resolveUniqueRecord(existingPasswordRows)");
    expect(reset).toContain("resolveUniqueRecord(matchingUsers)");
    expect(reset).toContain("existingPasswordRows.length > 1");
  });

  it("cadastro e edição verificam todos os registros para o e-mail normalizado", () => {
    const createWithPassword = sourceSection(users, "export const createUserWithPassword = mutation({", "export const createUser = mutation({");
    const create = sourceSection(users, "export const createUser = mutation({", "export const updateUser = mutation({");
    const update = sourceSection(users, "export const updateUser = mutation({", "export const activateUser");
    for (const block of [createWithPassword, create, update]) expect(block).toContain(".collect()");
    expect(update).toContain("otherAccounts.length > 0");
  });

  it("painel administrativo mostra credenciais duplicadas e permite correção controlada", () => {
    const listing = sourceSection(users, "export const listUsers = query({", "/**\n * Opções mínimas de usuário");
    expect(listing).toContain('ctx.db.query("passwords").collect()');
    expect(listing).toContain("passwordRecordCount");
    expect(listing).not.toContain("passwordHash");
    expect(page).toContain("u.passwordRecordCount > 1");
    expect(page).toContain("senhas duplicadas");
    expect(page).toContain("Redefinir senha e corrigir duplicidade");
  });

  it("contadores de tentativas não alteram registros duplicados arbitrariamente", () => {
    const failed = sourceSection(passwordsSource, "export const recordFailedLogin = internalMutation({", "/**\n * Zera o contador de falhas");
    const successful = sourceSection(passwordsSource, "export const recordSuccessfulLogin = internalMutation({", "export const recordLogout");
    expect(failed).toContain("existingResolution.status === \"ambiguous\"");
    expect(successful).toContain("existingRows.map((record) =>");
    expect(successful).toContain("ctx.db.patch(record._id");
  });
});
