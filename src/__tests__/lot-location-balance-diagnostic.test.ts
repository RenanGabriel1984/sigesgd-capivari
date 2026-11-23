import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../convex/stockSetupDiagnostics.ts"),
  "utf-8",
);

describe("diagnóstico de integridade lote × localização", () => {
  const start = source.indexOf("export const lotLocationBalanceIntegrityDiagnostic = internalQuery({");
  const block = source.slice(start);

  it("é uma consulta interna e somente leitura", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('ctx.db.query("lots").collect()');
    expect(block).toContain('ctx.db.query("lotLocationBalances").collect()');
    expect(block).toContain("inspectLotLocationBalances(");
    expect(block).toContain("readOnly: true");
    expect(block).not.toContain("ctx.db.insert(");
    expect(block).not.toContain("ctx.db.patch(");
    expect(block).not.toContain("ctx.db.delete(");
  });

  it("limita amostras sem esconder as contagens completas", () => {
    expect(block).toContain("issueCount: result.issues.length");
    expect(block).toContain("limitationCount: result.limitations.length");
    expect(block).toContain("result.issues.slice(0, 100)");
    expect(block).toContain("result.limitations.slice(0, 100)");
    expect(block).toContain("issuesTruncated");
    expect(block).toContain("limitationsTruncated");
  });
});
