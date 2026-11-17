import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const maintenance = readFileSync(
  resolve(__dirname, "../convex/stockMovementLocationMaintenance.ts"),
  "utf-8",
);

describe("correção histórica de localização de movimentos", () => {
  it("é exclusivamente interna e exige confirmação específica", () => {
    expect(maintenance).toContain("internalMutation({");
    expect(maintenance).toContain(
      'confirmation: v.string()',
    );
    expect(maintenance).toContain(
      'const REQUIRED_CONFIRMATION = "APLICAR-61-CORRECOES-LOCALIZACAO"',
    );
    expect(maintenance).toContain(
      "if (args.confirmation !== REQUIRED_CONFIRMATION)",
    );
  });

  it("exige exatamente os 61 IDs e 63 movimentos sem localização", () => {
    expect(maintenance).toContain("const EXPECTED_COUNT = 61");
    expect(maintenance).toContain("const EXPECTED_UNLOCATED_COUNT = 63");
    expect(maintenance).toContain(
      "args.expectedMovementIds.length !== EXPECTED_COUNT",
    );
    expect(maintenance).toContain("new Set(expectedIds).size !== EXPECTED_COUNT");
    expect(maintenance).toContain(
      "unlocatedMovements.length !== EXPECTED_UNLOCATED_COUNT",
    );
    expect(maintenance).toContain("actualIds.some((id, index) => id !== expectedIds[index])");
  });

  it("revalida toda a evidência documental antes da primeira escrita", () => {
    const firstWrite = maintenance.indexOf("await ctx.db.patch(");
    expect(firstWrite).toBeGreaterThan(0);

    for (const evidence of [
      'movement.type !== "entry" && movement.type !== "adjustment"',
      "movement.canceled",
      "String(lot.productId) !== String(movement.productId)",
      "matchingItems.length !== 1",
      "Number(item.quantity) !== Number(movement.quantity)",
      "uniqueLocationIds.length !== 1 || lotBalances.length !== 1",
      "uniqueLocationIds[0] !== String(item.locationId)",
      "allocationsByMovement.get(String(movement._id))",
      "actualIds.some((id, index) => id !== expectedIds[index])",
    ]) {
      const index = maintenance.indexOf(evidence);
      expect(index, evidence).toBeGreaterThan(-1);
      expect(index, evidence).toBeLessThan(firstWrite);
    }
  });

  it("altera somente locationId e cria um log de auditoria por movimento", () => {
    expect(maintenance.match(/ctx\.db\.patch\(/g)).toHaveLength(1);
    expect(maintenance).toContain(
      "ctx.db.patch(candidate.movement._id, {\n        locationId: candidate.locationId,",
    );
    expect(maintenance.match(/ctx\.db\.insert\("auditLogs"/g)).toHaveLength(1);
    expect(maintenance).toContain('entity: "stockMovement"');
    expect(maintenance).toContain('operation: "historical_location_backfill"');
    expect(maintenance).toContain("actorUserId: null");
    expect(maintenance).toContain(
      ".map(([location, count]) => ({ location, count }))",
    );
    expect(maintenance).toContain(
      "correctedByLocation: correctedByLocationSummary",
    );
    expect(maintenance).not.toContain("ctx.db.replace(");
    expect(maintenance).not.toContain("ctx.db.delete(");
    expect(maintenance).not.toContain("physicalQuantity:");
    expect(maintenance).not.toContain("reservedQuantity:");
    expect(maintenance).not.toContain("quantityAvailable:");
    expect(maintenance).not.toContain("quantityReceived:");
  });
});


describe("classificação de movimentos históricos de teste", () => {
  it("usa mutation interna, IDs fixos e confirmação explícita", async () => {
    const source = readFileSync(
      resolve(__dirname, "../convex/historicalTestMovementMaintenance.ts"),
      "utf-8",
    );
    expect(source).toContain("internalMutation({");
    expect(source).toContain('"CLASSIFICAR-2-MOVIMENTOS-DE-TESTE"');
    expect(source).toContain("expectedMovementIds.length !== 2");
    expect(source).toContain("isTest: true");
    expect(source).toContain("testReason:");
    expect(source).toContain('operation: "historical_test_movement_classification"');
  });

  it("restringe a operação aos dois registros de cooler e não altera quantidades", async () => {
    const source = readFileSync(
      resolve(__dirname, "../convex/historicalTestMovementMaintenance.ts"),
      "utf-8",
    );
    expect(source).toContain('"kx70n82skp2ph9wq5d75020wp58ez5ag"');
    expect(source).toContain('"kx758yrsbatdw2yc4m09ytfapn8en7mn"');
    expect(source).toContain('"Armário TI 01"');
    expect(source).toContain("movement.quantity !== 1");
    expect(source).toContain("movement.type !== expected.type");
    expect(source).not.toContain("ctx.db.delete(");
    expect(source).not.toContain("physicalQuantity:");
    expect(source).not.toContain("reservedQuantity:");
  });
});
