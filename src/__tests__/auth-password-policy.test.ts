import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const settings = readFileSync(resolve(root, "src/pages/Settings.tsx"), "utf8");
const auth = readFileSync(resolve(root, "src/pages/Auth.tsx"), "utf8");
const users = readFileSync(resolve(root, "src/pages/Users.tsx"), "utf8");
const passwords = readFileSync(resolve(root, "src/convex/passwords.ts"), "utf8");

describe("política única de senha", () => {
  it("backend exige oito caracteres", () => {
    expect(passwords).toContain("MIN_PASSWORD_LENGTH = 8");
  });

  it("primeiro acesso e redefinição não oferecem mínimo menor que o backend", () => {
    expect(auth).toContain("faNewPassword.length < 8");
    expect(auth).not.toContain("faNewPassword.length < 6");
    expect(auth).toContain("Mínimo 8 caracteres");
  });

  it("configurações e criação de usuário também exigem oito caracteres", () => {
    expect(settings).toContain("newPassword.length < 8");
    expect(settings).not.toContain("newPassword.length < 6");
    expect(users).toContain("tempPassword.length < 8");
    expect(users).not.toContain("tempPassword.length < 6");
  });
});
