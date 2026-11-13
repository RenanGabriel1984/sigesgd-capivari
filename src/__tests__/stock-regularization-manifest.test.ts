import { describe, expect, it } from "vitest";
import {
  INITIAL_ENTRY_UOM_REPAIRS,
  INITIAL_STOCK_MANIFEST,
  summarizeInitialStockManifest,
} from "../lib/stock-regularization-manifest";

describe("manifesto de regularização da carga inicial", () => {
  it("preserva a contagem, quantidades e distribuição física da planilha de origem", () => {
    expect(summarizeInitialStockManifest()).toEqual({
      totalRows: 53,
      totalQuantity: 2803,
      printerRows: 17,
      printerQuantity: 884,
      generalRows: 36,
      generalQuantity: 1919,
      cabinet1Rows: 34,
      cabinet1Quantity: 2597,
      cabinet2Rows: 19,
      cabinet2Quantity: 206,
    });
  });

  it("não usa o armário como critério para classificar a área", () => {
    const cabinet2 = INITIAL_STOCK_MANIFEST.filter(
      (row) => row.locationName === "Armário TI 02",
    );
    expect(cabinet2.some((row) => row.areaName === "TI Geral")).toBe(true);
    expect(cabinet2.some((row) => row.areaName === "Impressoras")).toBe(true);
  });

  it("limita correções de unidade aos dez itens identificados na entrada inicial", () => {
    expect(Object.keys(INITIAL_ENTRY_UOM_REPAIRS)).toHaveLength(10);
    for (const [name, unit] of Object.entries(INITIAL_ENTRY_UOM_REPAIRS)) {
      const row = INITIAL_STOCK_MANIFEST.find((item) => item.productName === name);
      expect(row?.unitOfMeasure).toBe(unit);
    }
  });
});
