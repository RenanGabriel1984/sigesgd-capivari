import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("hardening de operações destrutivas", () => {
  it("mantém a limpeza de dados de teste fora da API pública do Convex", () => {
    const source = readFileSync("src/convex/stockSetup.ts", "utf8");
    const start = source.indexOf("export const cleanupTestData");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("\n/**", start);
    const cleanup = source.slice(start, end < 0 ? undefined : end);

    expect(source).toContain('import { internalMutation, mutation, query } from "./_generated/server";');
    expect(cleanup).toContain("export const cleanupTestData = internalMutation({");
    expect(cleanup).not.toContain("cleanupTestData = mutation({");
    expect(cleanup).toContain('ctx.db.patch(s._id, { physicalQuantity: 0, reservedQuantity: 0 })');
    expect(cleanup).toContain('ctx.db.delete(s._id)');
  });
});
