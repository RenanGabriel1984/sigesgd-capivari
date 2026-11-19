import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../components/RequireAuth.tsx"),
  "utf-8",
);

describe("proteção de sessão sem perfil SIGESGD", () => {
  it("não renderiza páginas protegidas quando não existe perfil", () => {
    expect(source).toContain("if (isAuthenticated && !user)");
    expect(source).toContain("Perfil de acesso não encontrado");
    expect(source).toContain("Sua sessão foi reconhecida");
  });

  it("bloqueia imediatamente uma sessão cujo usuário foi desativado", () => {
    expect(source).toContain("if (isAuthenticated && user?.active === false)");
    expect(source).toContain("Acesso desativado");
  });

  it("oferece encerramento da sessão inconsistente ou desativada", () => {
    expect(source).toContain("onClick={() => void signOut()}");
    expect(source).toContain("Sair do sistema");
  });
});
