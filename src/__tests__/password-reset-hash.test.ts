import { describe, expect, it } from "vitest";
import { hashResetCode, verifyResetCode } from "../convex/auth/passwords";

describe("password reset code hashing", () => {
  it("stores a salted PBKDF2 hash and verifies the original code", async () => {
    const { hash, salt } = await hashResetCode("482951");

    expect(hash).not.toBe("482951");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(salt).toMatch(/^[a-f0-9]{32}$/);
    await expect(verifyResetCode("482951", hash, salt)).resolves.toBe(true);
    await expect(verifyResetCode("482950", hash, salt)).resolves.toBe(false);
  });

  it("uses a fresh salt for every generated code hash", async () => {
    const first = await hashResetCode("482951");
    const second = await hashResetCode("482951");

    expect(second.salt).not.toBe(first.salt);
    expect(second.hash).not.toBe(first.hash);
  });

  it("rejects malformed recovery codes", async () => {
    await expect(hashResetCode("12345")).rejects.toThrow(/inválido/i);
    await expect(verifyResetCode("12345", "0".repeat(64), "0".repeat(32))).resolves.toBe(false);
  });
});
