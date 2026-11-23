import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf-8");
const passwords = read("src/convex/passwords.ts");
const users = read("src/convex/users.ts");
const credentials = read("src/convex/auth/credentials.ts");
const usersPage = read("src/pages/Users.tsx");

function section(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker);
  expect(start, "início ausente: " + startMarker).toBeGreaterThan(-1);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("integridade de identidade e credenciais", () => {
  it("login exige exatamente um usuário e uma senha", () => {
    const verify = section(passwords, "export const verifyCredentials = internalQuery({", "/** Check if a user has a password configured. */");
    expect(verify).toContain('.withIndex("email", (q) => q.eq("email", args.email)).collect()');
    expect(verify).toContain("userResolution.status !== \"unique\"");
    expect(verify).toContain('.withIndex("by_user", (q) => q.eq("userId", user._id)).collect()');
    expect(verify).toContain("passwordResolution.status !== \"unique\"");
    expect(verify).not.toContain('.withIndex("email", (q) => q.eq("email", args.email)).first()');
    expect(verify).not.toContain('.withIndex("by_user", (q) => q.eq("userId", user._id)).first()');
    expect(credentials).toContain("internal.passwords.verifyCredentials");
  });

  it("criação e troca de senha não escolhem arbitrariamente uma credencial duplicada", () => {
    const create = section(passwords, "export const createPassword = mutation({", "/** Change password");
    const change = section(passwords, "export const changePassword = mutation({", "/** Admin reset password");
    const force = section(passwords, "export const forceChangePassword = mutation({", "/** Verify email and password");
    for (const block of [create, change, force]) {
      expect(block).toContain(".collect()");
      expect(block).toContain("ambiguous");
    }
  });

  it("reset do administrador consolida duplicidades depois de gerar o novo hash", () => {
    const reset = section(passwords, "export const adminResetPassword = mutation({", "/** Force change password");
    expect(reset).toContain("await requireAdmin(ctx)");
    expect(reset).toContain("passwordRows.length > 1");
    expect(reset).toContain("ctx.db.delete(record._id)");
    expect(reset).toContain('ctx.db.insert("passwords"');
    expect(reset).toContain("credencial(is) duplicada(s) removida(s)");
    expect(reset.indexOf("await hashPassword(args.newPassword)"))
      .toBeLessThan(reset.indexOf("ctx.db.delete(record._id)"));
  });

  it("recuperação só prossegue com identidade única e OTP válido", () => {
    const request = section(passwords, "export const requestPasswordReset = mutation({", "/**\n * Confirm password reset");
    const confirm = section(passwords, "export const confirmPasswordReset = mutation({", "export const recordFailedLogin");
    expect(request).toContain("userResolution.status !== \"unique\"");
    expect(request).toContain("RESET_GENERIC_MESSAGE");
    expect(confirm).toContain("userResolution.status === \"unique\"");
    expect(confirm).toContain("existingPasswordRows.map((record) => ctx.db.delete(record._id))");
    expect(confirm).toContain("passwordRecordId");
    expect(confirm).not.toContain('.withIndex("email", (q) => q.eq("email", email)).first()');
  });

  it("bootstraps não escolhem usuários ou senhas duplicados", () => {
    const set = section(passwords, "export const bootstrapSetPassword = internalMutation({", "/**\n * Diagnostic: list all users");
    const reset = section(passwords, "export const bootstrapResetPassword = internalMutation({");
    expect(set).toContain("resolveUniqueRecord(matchingUsers)");
    expect(set).toContain("resolveUniqueRecord(existingPasswordRows)");
    expect(reset).toContain("resolveUniqueRecord(matchingUsers)");
    expect(reset).toContain("existingPasswordRows.length > 1");
  });

  it("cadastro e edição rejeitam e-mails duplicados", () => {
    const createWithPassword = section(users, "export const createUserWithPassword = mutation({", "export const createUser = mutation({");
    const create = section(users, "export const createUser = mutation({", "export const updateUser = mutation({");
    const update = section(users, "export const updateUser = mutation({", "export const activateUser");
    for (const block of [createWithPassword, create, update]) {
      expect(block).toContain(".collect()");
    }
    expect(update).toContain("otherAccounts.length > 0");
  });

  it("painel mostra quantidade de senhas duplicadas e oferece reset corretivo", () => {
    const listing = section(users, "export const listUsers = query({", "/**\n * Opções mínimas de usuário");
    expect(listing).toContain('ctx.db.query("passwords").collect()');
    expect(listing).toContain("passwordRecordCount");
    expect(usersPage).toContain("u.passwordRecordCount > 1");
    expect(usersPage).toContain("senhas duplicadas");
    expect(usersPage).toContain("Redefinir senha e corrigir duplicidade");
  });

  it("contadores de falha não são atualizados por escolha arbitrária", () => {
    const failed = section(passwords, "export const recordFailedLogin = internalMutation({", "/**\n * Zera o contador de falhas");
    const successful = section(passwords, "export const recordSuccessfulLogin = internalMutation({", "export const recordLogout");
    expect(failed).toContain("existingResolution.status === \"ambiguous\"");
    expect(successful).toContain("existingRows.map((record) =>");
    expect(successful).toContain("ctx.db.patch(record._id");
  });
});
