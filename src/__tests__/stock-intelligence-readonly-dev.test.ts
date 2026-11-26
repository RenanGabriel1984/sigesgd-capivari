import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

describe("stock intelligence read-only DEV runner", () => {
  it("identity helper is restricted to first-herring DEV and is read-only", () => {
    const module = source("convex/stockIntelligenceDevTests.ts");
    expect(module).toContain("first-herring-264.convex.cloud");
    expect(module).toContain("internalQuery");
    expect(module).not.toContain("internalMutation");
  });

  it("guards the exact DEV deployment and runs only read-only reports", () => {
    const runner = source("../scripts/convex-dev-stock-intelligence-readonly.mjs");
    expect(runner).toContain('const DEPLOYMENT = "first-herring-264"');
    expect(runner).toContain('`dev:${DEPLOYMENT}`');
    expect(runner).toContain("stockIntelligence:replenishment");
    expect(runner).toContain("stockIntelligence:consumption");
    expect(runner).toContain("stockIntelligence:consumptionByOrganization");
    expect(runner).toContain("stockSetup:lotLocationMigrationReadinessInternal");
    expect(runner).toContain("ledgerBefore");
    expect(runner).toContain("ledgerAfter");
  });

  it("validates both current and previous organization windows for every UI period", () => {
    const runner = source("../scripts/convex-dev-stock-intelligence-readonly.mjs");
    expect(runner).toContain('const periods = ["15d", "30d", "90d", "6m", "12m"]');
    expect(runner).toContain("validateOrganizationWindow(organization.current");
    expect(runner).toContain("validateOrganizationWindow(organization.previous");
    for (const field of [
      "bySecretaria",
      "byDepartment",
      "byUnit",
      "byProduct",
      "byCategory",
      "hierarchy",
      "totalQuantity",
      "totalExitCount",
    ]) {
      expect(runner).toContain(`"${field}"`);
    }
  });
});
