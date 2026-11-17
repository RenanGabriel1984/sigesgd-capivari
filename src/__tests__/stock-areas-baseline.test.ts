import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BASELINE_STOCK_AREAS,
  AREA_TI_GERAL,
  AREA_IMPRESSORAS,
  AREA_LIMPEZA,
  AREA_COPA_COZINHA,
  AREA_AGUA_MINERAL,
} from "@/lib/stock-areas";

const stockAreasBackend = readFileSync(resolve(__dirname, "../convex/stockAreas.ts"), "utf8");

describe("áreas oficiais de estoque", () => {
  it("define as cinco áreas aprovadas pela Secretaria", () => {
    expect(BASELINE_STOCK_AREAS.map((area) => area.name)).toEqual([
      AREA_TI_GERAL,
      AREA_IMPRESSORAS,
      AREA_LIMPEZA,
      AREA_COPA_COZINHA,
      AREA_AGUA_MINERAL,
    ]);
  });

  it("mantém áreas independentes de fornecedor, categoria e local físico", () => {
    for (const area of BASELINE_STOCK_AREAS) {
      expect(area.name).not.toMatch(/gomaq|fornecedor|armário|armario/i);
      expect(area.description.length).toBeGreaterThan(10);
    }
  });

  it("garante criação idempotente sem alterar lotes ou saldos", () => {
    const block = stockAreasBackend.slice(
      stockAreasBackend.indexOf("export const ensureBaselineAreas"),
      stockAreasBackend.indexOf("export const create = mutation"),
    );
    expect(block).toContain("export const ensureBaselineAreas = internalMutation");
    expect(block).toContain('.withIndex("by_name"');
    expect(block).toContain('ctx.db.insert("stockAreas"');
    expect(block).not.toContain('ctx.db.insert("lots"');
    expect(block).not.toContain('ctx.db.patch("stock"');
    expect(block).not.toContain('ctx.db.insert("stockMovements"');
  });

  it("oferece criação explícita e idempotente das áreas oficiais sem tocar no estoque", () => {
    const block = stockAreasBackend.slice(
      stockAreasBackend.indexOf("export const createMissingBaselineAreas"),
      stockAreasBackend.indexOf("export const create = mutation"),
    );
    const page = readFileSync(resolve(__dirname, "../pages/StockAreas.tsx"), "utf8");
    expect(block).toContain("export const createMissingBaselineAreas = mutation");
    expect(block).toContain("requireStockManagerOrAdmin");
    expect(block).toContain("normalizedName(candidate.name)");
    expect(block).not.toContain('ctx.db.insert("lots"');
    expect(block).not.toContain('ctx.db.patch("stock"');
    expect(page).toContain("Adicionar");
    expect(page).toContain("api.stockAreas.createMissingBaselineAreas");
  });

  it("mantém água mineral como área de estoque e módulo com regras específicas", () => {
    const water = BASELINE_STOCK_AREAS.find((area) => area.name === AREA_AGUA_MINERAL);
    expect(water?.description).toContain("módulo específico");
  });
});
