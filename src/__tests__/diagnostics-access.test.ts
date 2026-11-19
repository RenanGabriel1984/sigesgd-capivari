import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/diagnostics.ts"), "utf8");

describe("diagnósticos administrativos", () => {
  it("protege a consulta de ambiente com a mesma permissão das rotinas de diagnóstico", () => {
    const start = source.indexOf("export const environmentCheck = query({");
    const end = source.indexOf("export const legacyRecordsCheck", start);
    const block = source.slice(start, end);

    expect(block).toContain("await requireAdmin(ctx)");
    expect(block).not.toContain("getAuthUserId(ctx)");
    expect(block).not.toContain("requirePermission(ctx, \"settings.view\"");
  });
});
