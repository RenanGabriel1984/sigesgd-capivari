import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/convex/stockSetup.ts"), "utf8");

describe("consulta de preparação da migração lote × armário", () => {
  it("é autenticada e retorna explicitamente diagnóstico somente leitura", () => {
    const start = source.indexOf("export const lotLocationMigrationReadiness = query({");
    const end = source.indexOf("export const stockDimensionOverview = query({", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const querySource = source.slice(start, end);
    expect(querySource).toContain("await requireUser(ctx)");
    expect(querySource).toContain("readOnly: true");
    expect(querySource).toContain("migrationApplied: false");
    expect(querySource).toContain("buildReadonlyLotLocationPlan(report)");
    expect(querySource).toContain("warning:");
    expect(querySource).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
  });

  it("candidate exige item de entrada ligado ao lote, quantidade intacta e ausência de operações posteriores", () => {
    const start = source.indexOf("export const lotLocationMigrationReadiness = query({");
    const end = source.indexOf("export const stockDimensionOverview = query({", start);
    const querySource = source.slice(start, end);
    expect(querySource).toContain("entryItemsForLot.length === 1");
    expect(querySource).toContain("if (!item.lotId) continue");
    expect(querySource).toContain("String(entryItemsForLot[0].entryId) === originalEntryId");
    expect(querySource).toContain("(lot.active === false && lot.quantityAvailable > 1e-9)");
    expect(querySource).toContain("Math.abs(lot.quantityAvailable - lot.quantityReceived)");
    expect(querySource).toContain("laterMovements.length === 0");
    expect(querySource).toContain("laterTransfers.length === 0");
    expect(querySource).toContain("laterReturns.length === 0");
    expect(querySource).toContain("movement.timestamp >= lot.receivedAt");
    expect(querySource).toContain("transfer.createdAt >= lot.receivedAt");
    expect(querySource).toContain("returned.createdAt >= lot.receivedAt");
  });
});
