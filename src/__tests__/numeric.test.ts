import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isInt64, normalizeNumericPatch, toNumber } from "../lib/numeric";

describe("Gestão de Estoque SGGD — Normalização numérica (Int64 → number)", () => {
  it("NU-01: detecta bigint", () => {
    expect(isInt64(10n)).toBe(true);
    expect(isInt64(10)).toBe(false);
    expect(isInt64("10")).toBe(false);
    expect(isInt64(null)).toBe(false);
  });

  it("NU-02: converte bigint preservando o valor", () => {
    expect(toNumber(2803n)).toBe(2803);
    expect(toNumber(0n)).toBe(0);
    expect(toNumber(1789060406110n)).toBe(1789060406110);
  });

  it("NU-03: number idempotente e finito", () => {
    expect(toNumber(15)).toBe(15);
    expect(toNumber(0)).toBe(0);
    expect(() => toNumber(NaN)).toThrow();
    expect(() => toNumber(Infinity)).toThrow();
  });

  it("NU-04: rejeita bigint fora do intervalo seguro", () => {
    const overflow = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() => toNumber(overflow)).toThrow(/intervalo seguro/);
  });

  it("NU-05: strings numéricas e nulos", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });

  it("NU-06: patch só contém campos bigint/string (idempotente)", () => {
    const doc = { a: 10n, b: 5, c: "7", d: 0n };
    const patch = normalizeNumericPatch(doc, ["a", "b", "c", "d", "z"]);
    expect(patch).toEqual({ a: 10, c: 7, d: 0 });
  });

  it("NU-07: aritmética de estoque funciona após normalização", () => {
    const physical = toNumber(2803n);
    const reserved = toNumber(0n);
    const qty = toNumber(2n);
    expect(physical - reserved).toBeGreaterThanOrEqual(qty);
    expect([1n, 2n, 3n].map(toNumber).reduce((s, n) => s + n, 0)).toBe(6);
  });

  it("NU-08: performInitialLoad normaliza quantities (defesa na escrita)", () => {
    const src = readFileSync(resolve(__dirname, "../convex/stockSetup.ts"), "utf8");
    expect(src).toContain("quantity: Number(i.quantity)");
  });

  it("NU-09: quickExit normaliza quantity (defesa na escrita)", () => {
    const src = readFileSync(resolve(__dirname, "../convex/stockSetup.ts"), "utf8");
    expect(src).toContain("quantity: Number(args.quantity)");
  });

  it("NU-10: mutação de normalização existe no backend", () => {
    const src = readFileSync(resolve(__dirname, "../convex/diagnostics.ts"), "utf8");
    expect(src).toContain("normalizeNumericFieldsInternal");
    expect(src).toContain("NUMERIC_FIELDS_BY_TABLE");
  });

  it("NU-11: funções de diagnóstico restauradas no diagnostics.ts", () => {
    const src = readFileSync(resolve(__dirname, "../convex/diagnostics.ts"), "utf8");
    expect(src).toContain("export const environmentCheck = query(");
    expect(src).toContain("export const reconcileFromLocations = mutation(");
    expect(src).toContain("ctx.db.patch(current._id, { physicalQuantity: byLocation })");
    expect(src).toContain("structuralDivergences");
    expect(src).toContain("export const legacyRecordsCheck = query(");
  });
});
