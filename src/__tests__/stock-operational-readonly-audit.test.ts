import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const query = readFileSync(
  resolve(__dirname, "../../scripts/stock-operational-readonly-audit.inline.ts"),
  "utf8",
);
const runner = readFileSync(
  resolve(__dirname, "../../scripts/audit-operational-stock-readonly.sh"),
  "utf8",
);

describe("auditoria operacional do estoque — somente leitura", () => {
  it("consulta as dimensões operacionais necessárias", () => {
    for (const table of [
      "products",
      "stock",
      "stockByLocation",
      "lots",
      "requests",
      "requestItems",
      "stockMovements",
      "stockTransfers",
      "returns",
      "entries",
      "entryItems",
    ]) {
      expect(query).toContain(`ctx.db.query("${table}")`);
    }
    expect(query).toContain("expectedReservedFromApprovedRequests");
    expect(query).toContain("globalVsLocation");
    expect(query).toContain("lotLocationBalancesAvailable");
  });

  it("não contém qualquer caminho de escrita no banco", () => {
    expect(query).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
    expect(query).not.toMatch(/runMutation|internalMutation|mutation\s*\(/);
    expect(query).toContain("readOnly: true");
  });

  it("fixa o deployment operacional e não publica nem faz push", () => {
    expect(runner).toContain("--deployment first-herring-264");
    expect(runner).toContain("--inline-query");
    expect(runner).not.toContain("--prod");
    expect(runner).not.toContain("--push");
    expect(runner).not.toMatch(/convex\s+(deploy|dev|import|export)/);
  });
});
