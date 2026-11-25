import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

describe("validação transacional isolada no Convex DEV", () => {
  it("bloqueia fixture fora do deployment first-herring-264", () => {
    const fixture = source("convex/stockDevTransactionTests.ts");
    expect(fixture).toContain('const DEPLOYMENT_HOST = "first-herring-264.convex.cloud"');
    expect(fixture).toContain("process.env.CONVEX_CLOUD_URL");
    expect(fixture).toContain("Fixture transacional bloqueada");
    expect(fixture).toContain('const PREFIX = "__SIGESGD_DEV_TXN__"');
  });

  it("usa produto, lote, área, armários e entrada exclusivos por execução", () => {
    const fixture = source("convex/stockDevTransactionTests.ts");
    expect(fixture).toContain("fixtureName(args.runId, \"PRODUCT\")");
    expect(fixture).toContain("fixtureName(args.runId, \"AREA\")");
    expect(fixture).toContain("fixtureName(args.runId, \"CABINET_A\")");
    expect(fixture).toContain("fixtureName(args.runId, \"CABINET_B\")");
    expect(fixture).toContain("fixtureName(args.runId, \"ENTRY\")");
    expect(fixture).toContain("operator.isAnonymous === true");
  });

  it("remove movimentos, alocações, devoluções, transferências e saldos da fixture", () => {
    const fixture = source("convex/stockDevTransactionTests.ts");
    const cleanup = fixture.slice(fixture.indexOf("export const cleanup = internalMutation"));
    for (const table of [
      "returnLotAllocations", "stockMovementLotAllocations", "returns",
      "stockTransfers", "stockMovements", "lotLocationBalances",
      "lots", "stockByLocation", "stock", "products", "entries",
      "storageLocations", "stockAreas", "auditLogs",
    ]) {
      expect(cleanup).toContain(`"${table}"`);
    }
  });

  it("exige a chave dev:first-herring-264 e nunca seleciona produção", () => {
    const runner = source("../scripts/convex-dev-stock-transactions.mjs");
    expect(runner).toContain('const DEPLOYMENT = "first-herring-264"');
    expect(runner).toContain("dev:first-herring-264");
    expect(runner).toContain("CONVEX_DEPLOYMENT");
    expect(runner).not.toContain("--prod");
  });

  it("inclui limpeza idempotente mesmo quando um cenário falha", () => {
    const runner = source("../scripts/convex-dev-stock-transactions.mjs");
    expect(runner).toContain("finally");
    expect(runner).toContain('internal("stockDevTransactionTests:cleanup"');
    expect(runner).toContain("fixtureRemaining: false");
  });
});
