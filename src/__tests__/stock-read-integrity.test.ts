import { describe, expect, it } from "vitest";
import {
  getOptionalSingleValidGlobalStock,
  inspectProductStockIntegrity,
  requireSingleValidGlobalStock,
  validateUniqueScopedStockRows,
} from "@/lib/stock-read-integrity";

describe("stock read integrity", () => {
  it("returns null for a product without a global stock row", () => {
    expect(getOptionalSingleValidGlobalStock([], "Mouse")).toBeNull();
  });

  it("accepts exactly one valid global stock row", () => {
    const row = { physicalQuantity: 12, reservedQuantity: 3 };
    expect(getOptionalSingleValidGlobalStock([row], "Mouse")).toBe(row);
  });

  it("rejects duplicate global rows instead of choosing an arbitrary first row", () => {
    expect(() =>
      getOptionalSingleValidGlobalStock(
        [
          { physicalQuantity: 12, reservedQuantity: 0 },
          { physicalQuantity: 8, reservedQuantity: 0 },
        ],
        "Mouse",
      ),
    ).toThrow(/duplicados/i);
  });

  it("requires a global stock row when the operation depends on one", () => {
    expect(() => requireSingleValidGlobalStock([], "Mouse")).toThrow(/não encontrado/i);
    const row = { physicalQuantity: 5, reservedQuantity: 1 };
    expect(requireSingleValidGlobalStock([row], "Mouse")).toBe(row);
    expect(() => requireSingleValidGlobalStock(
      [
        { physicalQuantity: 5, reservedQuantity: 0 },
        { physicalQuantity: 6, reservedQuantity: 0 },
      ],
      "Mouse",
    )).toThrow(/duplicados/i);
  });

  it.each([
    [{ physicalQuantity: Number.NaN, reservedQuantity: 0 }],
    [{ physicalQuantity: Number.POSITIVE_INFINITY, reservedQuantity: 0 }],
    [{ physicalQuantity: -1, reservedQuantity: 0 }],
    [{ physicalQuantity: 3, reservedQuantity: -1 }],
    [{ physicalQuantity: 3, reservedQuantity: 4 }],
  ])("rejects invalid global balances: %o", (row) => {
    expect(() => getOptionalSingleValidGlobalStock([row], "Mouse")).toThrow(/inconsistente/i);
  });

  it("rejects duplicate rows for the same product, area and physical location", () => {
    const rows = [
      { areaId: "ti", locationId: "cabinet-1", quantity: 5 },
      { areaId: "ti", locationId: "cabinet-1", quantity: 2 },
    ];
    expect(() => validateUniqueScopedStockRows(rows, "Mouse")).toThrow(/duplicados/i);
  });

  it("allows different products to occupy the same area and physical location", () => {
    expect(() =>
      validateUniqueScopedStockRows(
        [
          { productId: "mouse", areaId: "ti", locationId: "cabinet-1", quantity: 4 },
          { productId: "keyboard", areaId: "ti", locationId: "cabinet-1", quantity: 6 },
        ],
        "different products",
      ),
    ).not.toThrow();
  });

  it("rejects non-finite, negative and unlocated physical balances", () => {
    expect(() =>
      validateUniqueScopedStockRows([{ areaId: "ti", locationId: "cabinet-1", quantity: Number.NaN }], "Mouse"),
    ).toThrow(/inválido/i);
    expect(() =>
      validateUniqueScopedStockRows([{ areaId: "ti", locationId: "cabinet-1", quantity: -1 }], "Mouse"),
    ).toThrow(/inválido/i);
    expect(() =>
      validateUniqueScopedStockRows([{ areaId: "ti", quantity: 1 }], "Mouse"),
    ).toThrow(/local físico/i);
  });

  it("reports a consistent product when global, area/location and lot balances match", () => {
    const result = inspectProductStockIntegrity(
      [{ physicalQuantity: 7, reservedQuantity: 2 }],
      [{ areaId: "ti", locationId: "cabinet-1", quantity: 4 }, { areaId: "printers", locationId: "cabinet-2", quantity: 3 }],
      [
        { lotNumber: "LOT-1", areaId: "ti", locationId: "cabinet-1", quantityAvailable: 4, active: true },
        { lotNumber: "LOT-2", areaId: "printers", locationId: "cabinet-2", quantityAvailable: 3, active: true },
      ],
      "Mouse",
    );
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.globalStock?.physicalQuantity).toBe(7);
    expect(result.locationQuantity).toBe(7);
    expect(result.lotQuantity).toBe(7);
  });

  it("reconciles a legacy physical cabinet bucket against lots split across multiple areas", () => {
    const result = inspectProductStockIntegrity(
      [{ physicalQuantity: 7, reservedQuantity: 1 }],
      [{ locationId: "cabinet-1", quantity: 7 }],
      [
        { lotNumber: "LOT-TI", areaId: "ti", locationId: "cabinet-1", quantityAvailable: 4, active: true },
        { lotNumber: "LOT-PRINT", areaId: "printers", locationId: "cabinet-1", quantityAvailable: 3, active: true },
      ],
      "Mouse",
    );
    expect(result.consistent).toBe(true);
    expect(result.locationQuantity).toBe(7);
    expect(result.lotQuantity).toBe(7);
    expect(result.issues).toEqual([]);
  });

  it("reports global, location and lot discrepancies instead of hiding them", () => {
    const result = inspectProductStockIntegrity(
      [{ physicalQuantity: 10, reservedQuantity: 0 }],
      [{ areaId: "ti", locationId: "cabinet-1", quantity: 8 }],
      [{ lotNumber: "LOT-1", areaId: "ti", locationId: "cabinet-1", quantityAvailable: 9, active: true }],
      "Mouse",
    );
    expect(result.consistent).toBe(false);
    expect(result.issues).toContain("O saldo global diverge da soma dos saldos por área/local.");
    expect(result.issues).toContain("O saldo global diverge da soma dos saldos dos lotes.");
    expect(result.issues).toContain("O saldo físico da área/local (ti|cabinet-1) diverge da soma dos lotes.");
  });

  it("flags positive lots that have no area/location classification and inactive positive lots", () => {
    const result = inspectProductStockIntegrity(
      [{ physicalQuantity: 4, reservedQuantity: 0 }],
      [],
      [
        { lotNumber: "LOT-LEGADO", quantityAvailable: 2, active: true },
        { lotNumber: "LOT-INATIVO", areaId: "ti", locationId: "cabinet-1", quantityAvailable: 2, active: false },
      ],
      "Mouse",
    );
    expect(result.consistent).toBe(false);
    expect(result.issues.some((issue) => /não possui área e\/ou local físico/.test(issue))).toBe(true);
    expect(result.issues.some((issue) => /inativo com saldo positivo/.test(issue))).toBe(true);
  });

  it("accepts a new product with no stock row or lot balance", () => {
    const result = inspectProductStockIntegrity([], [], [], "New product");
    expect(result.consistent).toBe(true);
    expect(result.globalStock).toBeNull();
  });
});
