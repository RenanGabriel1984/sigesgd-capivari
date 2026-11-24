import { describe, expect, it } from "vitest";
import {
  assertProductLedgerSnapshot,
  inspectProductStockIntegrity,
} from "@/lib/stock-read-integrity";

const validSnapshot = {
  globalRows: [{ physicalQuantity: 10, reservedQuantity: 2 }],
  locationRows: [
    { productId: "p1", locationId: "cabinet-01", quantity: 6 },
    { productId: "p1", locationId: "cabinet-02", quantity: 4 },
  ],
  lots: [
    { lotId: "lot-1", productId: "p1", lotNumber: "L1", quantityAvailable: 7, active: true },
    { lotId: "lot-2", productId: "p1", lotNumber: "L2", quantityAvailable: 3, active: true },
  ],
  lotLocationBalances: [
    { lotId: "lot-1", productId: "p1", locationId: "cabinet-01", quantityAvailable: 5 },
    { lotId: "lot-1", productId: "p1", locationId: "cabinet-02", quantityAvailable: 2 },
    { lotId: "lot-2", productId: "p1", locationId: "cabinet-01", quantityAvailable: 1 },
    { lotId: "lot-2", productId: "p1", locationId: "cabinet-02", quantityAvailable: 2 },
  ],
};

describe("pure stock ledger consistency rules", () => {
  it("accepts a fully reconciled global/cabinet/lot/lot-cabinet snapshot", () => {
    expect(assertProductLedgerSnapshot(validSnapshot, "Produto A")).toEqual(validSnapshot.globalRows[0]);
  });

  it("accepts a legacy product with no lot history without inventing lots", () => {
    expect(assertProductLedgerSnapshot({
      globalRows: [{ physicalQuantity: 4, reservedQuantity: 0 }],
      locationRows: [{ locationId: "cabinet-01", quantity: 4 }],
      lots: [],
      lotLocationBalances: [],
    }, "Legado")).toEqual({ physicalQuantity: 4, reservedQuantity: 0 });
  });

  it("accepts zero-balance lots without requiring artificial cabinet rows", () => {
    expect(assertProductLedgerSnapshot({
      globalRows: [{ physicalQuantity: 0, reservedQuantity: 0 }],
      locationRows: [{ locationId: "cabinet-01", quantity: 0 }],
      lots: [{ lotId: "lot-zero", quantityAvailable: 0, active: true }],
      lotLocationBalances: [],
    }, "Lote zerado")).toEqual({ physicalQuantity: 0, reservedQuantity: 0 });
  });

  it("rejects a global quantity that differs from the cabinet total", () => {
    expect(() => assertProductLedgerSnapshot({
      ...validSnapshot,
      globalRows: [{ physicalQuantity: 11, reservedQuantity: 2 }],
    }, "Produto A")).toThrow(/saldo global/i);
  });

  it("rejects duplicate lot/cabinet rows", () => {
    expect(() => assertProductLedgerSnapshot({
      ...validSnapshot,
      lotLocationBalances: [...validSnapshot.lotLocationBalances, validSnapshot.lotLocationBalances[0]],
    }, "Produto A")).toThrow(/duplicado/i);
  });

  it("rejects an orphan lot/cabinet balance", () => {
    expect(() => assertProductLedgerSnapshot({
      ...validSnapshot,
      lotLocationBalances: [...validSnapshot.lotLocationBalances, {
        lotId: "orphan", productId: "p1", locationId: "cabinet-01", quantityAvailable: 0,
      }],
    }, "Produto A")).toThrow(/órfãos|incompatível/i);
  });

  it("rejects an inactive lot with a positive balance", () => {
    expect(() => assertProductLedgerSnapshot({
      ...validSnapshot,
      lots: validSnapshot.lots.map((lot, index) => index === 0 ? { ...lot, active: false } : lot),
    }, "Produto A")).toThrow(/inativo/i);
  });

  it("rejects a lot whose total is not distributed across cabinets", () => {
    expect(() => assertProductLedgerSnapshot({
      ...validSnapshot,
      lotLocationBalances: validSnapshot.lotLocationBalances.filter((row) => row.lotId !== "lot-2"),
    }, "Produto A")).toThrow(/diverge/i);
  });

  it("marks an incomplete lot/location picture as not fully consistent", () => {
    const result = inspectProductStockIntegrity(
      [{ physicalQuantity: 2, reservedQuantity: 0 }],
      [{ locationId: "cabinet-01", quantity: 2 }],
      [{ lotNumber: "L1", areaId: "area-1", quantityAvailable: 2, active: true }],
      "Produto A",
    );
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.consistent).toBe(false);
  });
});
