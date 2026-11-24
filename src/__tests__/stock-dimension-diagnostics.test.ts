import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const backend = readFileSync(resolve(__dirname, "../convex/stockSetup.ts"), "utf8");
const reportsPage = readFileSync(resolve(__dirname, "../pages/Reports.tsx"), "utf8");
const stockPage = readFileSync(resolve(__dirname, "../pages/Stock.tsx"), "utf8");

describe("diagnóstico dimensional do estoque", () => {
  const start = backend.indexOf("export const stockDimensionDiagnostics = query({");
  const end = backend.indexOf("\nexport const lotLocationReadiness", start);
  const block = backend.slice(start, end < 0 ? undefined : end);

  it("expõe uma consulta autenticada e somente leitura", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain("await requireUser(ctx)");
    expect(block).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
  });

  it("reúne saldos globais, por localização e por lote/área", () => {
    expect(block).toContain('ctx.db.query("stock")');
    expect(block).toContain('ctx.db.query("stockByLocation")');
    expect(block).toContain('ctx.db.query("lots")');
    expect(block).toContain("areaId");
    expect(block).toContain("locationId");
    expect(block).toContain("quantityAvailable");
    expect(block).toContain("globalVsLocationDifference");
    expect(block).toContain("globalVsLotsDifference");
  });

  it("identifica referências históricas de lote sem presumir uma chave única", () => {
    expect(block).toContain("lotById");
    expect(block).toContain("lotByNumber");
    expect(block).toContain("unresolved");
    expect(block).toContain("ambiguous_requires_review");
  });

  it("só classifica evidência completa em cenário legado conservador", () => {
    expect(block).toContain("evidence_complete_candidate");
    expect(block).toContain("productTransfers.length > 0");
    expect(block).toContain("productReturns.length > 0");
    expect(block).toContain("postEntryMovements.length > 0");
    expect(block).toContain("productInventoryCount > 0");
    expect(block).toContain("ainda exige conferência antes de qualquer migração");
  });
});


describe("visão dimensional consolidada do estoque", () => {
  const start = backend.indexOf("export const stockDimensionOverview = query({");
  const block = backend.slice(start);

  it("é uma consulta autenticada e somente leitura", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain("await requireUser(ctx)");
    expect(block).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
  });

  it("retorna a distribuição por área, armário e lote", () => {
    expect(block).toContain('ctx.db.query("lotLocationBalances")');
    expect(block).toContain('ctx.db.query("lots")');
    expect(block).toContain('ctx.db.query("stockAreas")');
    expect(block).toContain('ctx.db.query("storageLocations")');
    expect(block).toContain("lotNumber");
    expect(block).toContain("areaName");
    expect(block).toContain("locationName");
    expect(block).toContain("unmappedLotQuantity");
    expect(block).toContain("globalVsLocationDifference");
    expect(block).toContain("if (areaId && (!area || area.active === false)) invalidBalanceCount++");
    expect(block).toContain("if (!location || location.active === false) invalidBalanceCount++");
  });

  it("mantém saldos legados sem lote visíveis por armário sem inventar área", () => {
    expect(block).toContain("untrackedLocations");
    expect(reportsPage).toContain('"Sem classificação por lote"');
    expect(stockPage).toContain("dimension?.untrackedLocations?.length");
    expect(stockPage).toContain("Saldo legado sem lote classificado");
    expect(stockPage).toContain("location.locationName");
    expect(stockPage).toContain("location.quantityAvailable");
  });

  it("relatório filtra e exporta área, armário e lote em consulta somente leitura", () => {
    expect(reportsPage).toContain("api.stockSetup.stockDimensionOverview");
    expect(reportsPage).toContain("dimensionAreaFilter");
    expect(reportsPage).toContain("dimensionLocationFilter");
    expect(reportsPage).toContain("dimensionSearch");
    expect(reportsPage).toContain("exportLotLocationCSV");
    expect(reportsPage).toContain("rastreabilidade_area_armario_lote.csv");
  });
});
