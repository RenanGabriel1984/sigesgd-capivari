import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateSalt,
  generateSecureNumericCode,
  hashPassword,
  verifyPassword,
  nextResetAttempt,
} from "@/convex/auth/passwords";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("segurança criptográfica da autenticação", () => {
  it("gera salts de 128 bits sem depender de Math.random", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random não pode ser usado para segurança");
    });

    const first = generateSalt();
    const second = generateSalt();

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    expect(random).not.toHaveBeenCalled();
  });

  it("gera códigos de recuperação numéricos com seis dígitos usando Web Crypto", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random não pode ser usado para segurança");
    });

    for (let index = 0; index < 20; index++) {
      expect(generateSecureNumericCode()).toMatch(/^[1-9][0-9]{5}$/);
    }
    expect(random).not.toHaveBeenCalled();
  });

  it("contabiliza cada tentativa inválida e invalida o código no limite", () => {
    expect(nextResetAttempt(0, 5, 1_000)).toEqual({ attempts: 1 });
    expect(nextResetAttempt(3, 5, 2_000)).toEqual({ attempts: 4 });
    expect(nextResetAttempt(4, 5, 3_000)).toEqual({
      attempts: 5,
      usedAt: 3_000,
    });
  });

  it("hashes passwords with unique salts and verifies only the correct password", async () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random não pode ser usado para segurança");
    });

    const password = "SIGESGD!SenhaSegura2026";
    const stored = await hashPassword(password);

    expect(stored.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyPassword(password, stored.hash, stored.salt)).resolves.toBe(true);
    await expect(verifyPassword("Senha-incorreta", stored.hash, stored.salt)).resolves.toBe(false);
    expect(random).not.toHaveBeenCalled();
  });
});
