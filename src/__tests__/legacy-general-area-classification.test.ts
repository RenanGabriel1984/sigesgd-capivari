import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INITIAL_STOCK_MANIFEST } from "../lib/stock-regularization-manifest";
import { LEGACY_GENERAL_AREA_CLASSIFICATION_TARGETS as targets } from "../lib/legacy-general-area-classification";

const stockSetup = readFileSync(
  resolve(__dirname, "../convex/stockSetup.ts"),
  "utf-8",
);
const start = stockSetup.indexOf("export const applyLegacyGeneralAreaClassification = internalMutation({");
const end = stockSetup.indexOf("export const applyLotLocationMetadataBackfill", start);
const mutation = stockSetup.slice(start, end);

describe("classificação documental dos 36 itens de TI Geral", () => {
  it("corresponde exatamente a 36 linhas e 1.919 unidades do manifesto original", () => {
    const generalRows = INITIAL_STOCK_MANIFEST.filter((row) => row.areaName === "TI Geral");
    expect(targets).toHaveLength(36);
    expect(generalRows).toHaveLength(36);
    expect(targets.reduce((sum, row) => sum + row.quantity, 0)).toBe(1919);
    expect(generalRows.reduce((sum, row) => sum + row.quantity, 0)).toBe(1919);
  });

  it("confere produto, marca, quantidade e armário de cada alvo com a planilha", () => {
    for (const target of targets) {
      const matching = INITIAL_STOCK_MANIFEST.filter((row) =>
        row.productName === target.productName &&
        row.areaName === "TI Geral" &&
        row.brand === target.brand &&
        row.quantity === target.quantity &&
        row.locationName === target.locationName
      );
      expect(matching, target.productName).toHaveLength(1);
    }
  });

  it("mantém IDs de lote, produto e saldo local únicos e respeita os dois armários", () => {
    expect(new Set(targets.map((row) => row.lotId)).size).toBe(36);
    expect(new Set(targets.map((row) => row.productId)).size).toBe(36);
    expect(new Set(targets.map((row) => row.rowId)).size).toBe(36);

    const cabinet1 = targets.filter((row) => row.locationName === "Armário TI 01");
    const cabinet2 = targets.filter((row) => row.locationName === "Armário TI 02");
    expect(cabinet1).toHaveLength(33);
    expect(cabinet1.reduce((sum, row) => sum + row.quantity, 0)).toBe(1897);
    expect(cabinet2).toHaveLength(3);
    expect(cabinet2.reduce((sum, row) => sum + row.quantity, 0)).toBe(22);
  });

  it("exige mutation interna e confirmação literal específica", () => {
    expect(mutation).toContain("internalMutation({");
    expect(mutation).toContain(
      'v.literal("CONFIRMAR_CLASSIFICACAO_36_SALDOS_TI_GERAL_FIRST_HERRING")',
    );
    expect(mutation).toContain('entryNumber", "ENT-2026-000001"');
  });

  it("revalida entrada, lotes, saldos, localização, reservas e movimento antes da primeira escrita", () => {
    const firstWrite = mutation.indexOf("await ctx.db.patch(");
    expect(firstWrite).toBeGreaterThan(0);
    for (const evidence of [
      "initialItems.length !== 53",
      "initialLots.length !== 53",
      "initialMovements.length !== 53",
      "lot.quantityAvailable",
      "lot.quantityReceived",
      "lotBalances.length !== 1",
      "localScopeRows.length !== 1",
      "reservationsByLot.get",
      "movementMatches.length !== 1",
      "metadataStates",
      "Classificação parcial detectada",
    ]) {
      expect(mutation.indexOf(evidence)).toBeGreaterThan(-1);
      expect(mutation.indexOf(evidence)).toBeLessThan(firstWrite);
    }
  });

  it("altera somente metadados de área e registra auditoria, sem tocar em quantidades globais", () => {
    expect(mutation).toContain("{ areaId: area._id }");
    expect(mutation).toContain('entity: "stock"');
    expect(mutation).toContain("auditLogs");
    expect(mutation).toContain("physicalQuantitiesChanged: false");
    expect(mutation).toContain("movementQuantitiesChanged: false");
    expect(mutation).not.toContain("physicalQuantity:");
    expect(mutation).not.toContain("reservedQuantity:");
    expect(mutation).not.toContain("quantityAvailable:");
    expect(mutation).not.toContain("quantityReceived:");
    expect(mutation).not.toContain("ctx.db.delete(");
  });
});
