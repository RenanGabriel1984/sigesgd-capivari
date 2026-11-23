import { describe, expect, it } from "vitest";
import {
  getOptionalSingleValidGlobalStock,
  inspectProductStockIntegrity,
  requireSingleValidGlobalStock,
  resolveScopedInventoryQuantity,
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

  it("reports a consistent product when global, location and lot totals match", () => {
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
    expect(result.limitations).toEqual([]);
  });

  it("separates area totals from physical cabinet totals when current lot location is not modeled", () => {
    const result = inspectProductStockIntegrity(
      [{ physicalQuantity: 7, reservedQuantity: 0 }],
      [{ locationId: "cabinet-1", quantity: 7 }],
      [
        { lotNumber: "LOT-TI", areaId: "ti", quantityAvailable: 4, active: true },
        { lotNumber: "LOT-PRINT", areaId: "printers", quantityAvailable: 3, active: true },
      ],
      "Mouse",
    );
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.limitations).toContain("O modelo atual não registra a localização atual por lote; não é possível conciliar lote × armário com segurança.");
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
    expect(result.issues).toContain("O saldo global diverge da soma dos saldos por armário.");
    expect(result.issues).toContain("O saldo global diverge da soma dos saldos dos lotes.");
    expect(result.issues).toContain("O saldo físico da área/local (ti|cabinet-1) diverge da soma dos lotes.");
  });

  it("flags missing area classification and inactive positive lots, while reporting the cabinet-link limitation", () => {
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
    expect(result.issues.some((issue) => /não possui área classificada/.test(issue))).toBe(true);
    expect(result.issues.some((issue) => /inativo com saldo positivo/.test(issue))).toBe(true);
    expect(result.limitations.some((issue) => /localização atual por lote/.test(issue))).toBe(true);
  });

  it("flags a legacy wildcard bucket coexisting with area-scoped buckets as ambiguous", () => {
    const result = inspectProductStockIntegrity(
      [{ physicalQuantity: 10, reservedQuantity: 0 }],
      [
        { locationId: "cabinet-1", quantity: 10 },
        { areaId: "ti", locationId: "cabinet-1", quantity: 6 },
        { areaId: "printers", locationId: "cabinet-1", quantity: 4 },
      ],
      [
        { lotNumber: "LOT-TI", areaId: "ti", locationId: "cabinet-1", quantityAvailable: 6, active: true },
        { lotNumber: "LOT-PRINT", areaId: "printers", locationId: "cabinet-1", quantityAvailable: 4, active: true },
      ],
      "Mouse",
    );
    expect(result.consistent).toBe(false);
    expect(result.issues.some((issue) => /mistura saldo legado sem área com buckets por área/.test(issue))).toBe(true);
  });

  it("does not treat an unclassified legacy bucket as an empty area during inventory opening", () => {
    expect(() => resolveScopedInventoryQuantity(
      [
        { locationId: "cabinet-1", quantity: 5 },
        { areaId: "ti", locationId: "cabinet-1", quantity: 5 },
      ],
      [{ lotNumber: "LOT-1", areaId: "ti", locationId: "cabinet-1", quantityAvailable: 5, active: true }],
      "ti",
      "cabinet-1",
      "Mouse",
    )).toThrow(/saldo legado sem área/i);
  });

  it("blocks a positive lot in the selected area when its current location is unknown", () => {
    expect(() => resolveScopedInventoryQuantity(
      [{ areaId: "ti", locationId: "cabinet-1", quantity: 5 }],
      [{ lotNumber: "LOT-LEGACY", areaId: "ti", quantityAvailable: 2, active: true }],
      "ti",
      "cabinet-1",
      "Mouse",
    )).toThrow(/sem área\/local suficiente/i);
  });

  it("blocks a positive lot in the selected location when its area is unknown", () => {
    expect(() => resolveScopedInventoryQuantity(
      [{ areaId: "ti", locationId: "cabinet-1", quantity: 5 }],
      [{ lotNumber: "LOT-LEGACY", locationId: "cabinet-1", quantityAvailable: 2, active: true }],
      "ti",
      "cabinet-1",
      "Mouse",
    )).toThrow(/sem área\/local suficiente/i);
  });

  it("accepts a new product with no stock row or lot balance", () => {
    const result = inspectProductStockIntegrity([], [], [], "New product");
    expect(result.consistent).toBe(true);
    expect(result.globalStock).toBeNull();
  });
});


describe("integridade da abertura de inventário localizado", () => {
  const rows = [{ productId: "mouse", areaId: "ti", locationId: "cabinet-1", quantity: 5 }];
  const lots = [{ lotNumber: "LOT-1", areaId: "ti", locationId: "cabinet-1", quantityAvailable: 5, active: true }];

  it("uses the unique physical balance when it matches the scoped lots", () => {
    expect(resolveScopedInventoryQuantity(rows, lots, "ti", "cabinet-1", "Mouse")).toBe(5);
  });

  it("rejects duplicate physical buckets instead of summing them", () => {
    expect(() => resolveScopedInventoryQuantity(
      [...rows, { ...rows[0], quantity: 2 }],
      lots,
      "ti",
      "cabinet-1",
      "Mouse",
    )).toThrow(/duplicados/i);
  });

  it("rejects a physical balance that diverges from scoped lots", () => {
    expect(() => resolveScopedInventoryQuantity(
      rows,
      [{ ...lots[0], quantityAvailable: 4 }],
      "ti",
      "cabinet-1",
      "Mouse",
    )).toThrow(/diverge dos lotes/i);
  });

  it("rejects invalid or inactive positive lots", () => {
    expect(() => resolveScopedInventoryQuantity(
      rows,
      [{ ...lots[0], quantityAvailable: Number.NaN }],
      "ti",
      "cabinet-1",
      "Mouse",
    )).toThrow(/saldo inválido/i);
    expect(() => resolveScopedInventoryQuantity(
      rows,
      [{ ...lots[0], active: false }],
      "ti",
      "cabinet-1",
      "Mouse",
    )).toThrow(/inativo com saldo positivo/i);
  });

  it("returns zero only when both the scoped bucket and scoped lots are empty", () => {
    expect(resolveScopedInventoryQuantity([], [], "ti", "cabinet-1", "Mouse")).toBe(0);
  });
});
