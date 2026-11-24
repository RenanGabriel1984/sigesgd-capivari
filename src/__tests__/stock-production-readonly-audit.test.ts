import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(
  resolve(__dirname, "../../.github/workflows/stock-production-readonly-audit.yml"),
  "utf8",
);
const query = readFileSync(
  resolve(__dirname, "../../scripts/stock-operational-readonly-audit.inline.ts"),
  "utf8",
);

describe("auditoria do deployment de produção — somente leitura", () => {
  it("fixa o nome do deployment e exige prefixo de chave de produção correspondente", () => {
    expect(workflow).toContain("TARGET_DEPLOYMENT: savory-sockeye-292");
    expect(workflow).toContain("CONVEX_MAINTENANCE_KEY_SAVORY_SOCKEYE");
    expect(workflow).toContain('prefix}" != "prod:${TARGET_DEPLOYMENT}"');
    expect(workflow).toContain('refs/heads/codex/stock-ledger-integration');
    expect(workflow).toContain("CONVEX_DEPLOYMENT");
  });

  it("usa somente convex run inline e não publica nem executa mutations", () => {
    expect(workflow).toContain("bunx convex run --inline-query");
    expect(workflow).not.toMatch(/bunx convex (deploy|dev|import|export)/);
    expect(workflow).not.toMatch(/bunx convex[^\\n]*--push/);
    expect(workflow).not.toMatch(/bunx convex[^\\n]*--prod/);
    expect(query).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
    expect(query).not.toMatch(/runMutation|internalMutation|mutation\s*\(/);
  });

  it("não tenta acessar produção quando o secret ainda não foi configurado", () => {
    expect(workflow).toContain('echo "enabled=false"');
    expect(workflow).toContain("Secret de produção ausente");
    expect(workflow).toContain("steps.target.outputs.enabled == 'true'");
  });
});
