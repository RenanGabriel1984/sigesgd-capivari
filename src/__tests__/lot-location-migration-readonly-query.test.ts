import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/convex/stockSetup.ts"), "utf8");

describe("consulta de preparação da migração lote × armário", () => {
  const sharedStart = source.indexOf("async function readLotLocationMigrationReadiness(ctx: any) {");
  const publicStart = source.indexOf("export const lotLocationMigrationReadiness = query({", sharedStart);
  const internalStart = source.indexOf("export const lotLocationMigrationReadinessInternal = internalQuery({", publicStart);
  const end = source.indexOf("export const stockDimensionOverview = query({", internalStart);

  it("oferece consulta autenticada ao app e a mesma consulta interna somente para automação administrativa", () => {
    expect(sharedStart).toBeGreaterThan(-1);
    expect(publicStart).toBeGreaterThan(sharedStart);
    expect(internalStart).toBeGreaterThan(publicStart);
    expect(end).toBeGreaterThan(internalStart);
    const publicQuery = source.slice(publicStart, internalStart);
    const internalQuery = source.slice(internalStart, end);
    expect(publicQuery).toContain("await requireUser(ctx)");
    expect(publicQuery).toContain("return readLotLocationMigrationReadiness(ctx)");
    expect(internalQuery).toContain("handler: async (ctx) => readLotLocationMigrationReadiness(ctx)");
  });

  it("compartilha uma única leitura sem inserir, atualizar ou apagar registros", () => {
    const sharedQuery = source.slice(sharedStart, publicStart);
    expect(sharedQuery).toContain('ctx.db.query("products").collect()');
    expect(sharedQuery).toContain("readOnly: true");
    expect(sharedQuery).toContain("migrationApplied: false");
    expect(sharedQuery).toContain("buildReadonlyLotLocationPlan(report)");
    expect(sharedQuery).toContain("warning:");
    expect(sharedQuery).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
  });

  it("inclui produtos legados sem lote para bloquear saldo positivo sem rastreabilidade", () => {
    const sharedQuery = source.slice(sharedStart, publicStart);
    expect(sharedQuery).not.toContain("if (productLots.length === 0) continue");
    expect(sharedQuery).toContain("Há saldo físico ou lote disponível sem registro global de estoque.");
  });

  it("mantém critérios documentais e só aceita retorno completo sem uso ao armário de origem", () => {
    const sharedQuery = source.slice(sharedStart, publicStart);
    expect(sharedQuery).toContain("entryItemsForLot.length === 1");
    expect(sharedQuery).toContain("if (!item.lotId) continue");
    expect(sharedQuery).toContain("String(entryItemsForLot[0].entryId) === originalEntryId");
    expect(sharedQuery).toContain("Math.abs(lot.quantityAvailable - lot.quantityReceived)");
    expect(sharedQuery).toContain("const locationHistoryIsSafe = noPostReceiptMovements || closedUnusedReturnAtSource;");
    expect(sharedQuery).toContain("isClosedUnusedReturnAtSource");
    expect(sharedQuery).toContain("laterTransfers.length === 0");
    expect(sharedQuery).toContain("movement.timestamp >= lot.receivedAt");
    expect(sharedQuery).toContain("transfer.createdAt >= lot.receivedAt");
    expect(sharedQuery).toContain("returned.createdAt >= lot.receivedAt");
  });
});
