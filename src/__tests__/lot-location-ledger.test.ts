import { describe, expect, it, vi } from "vitest";
import { recordLotMovementAllocations } from "@/convex/lotLocationLedger";
import { assertProductLedgerSnapshot } from "@/lib/stock-read-integrity";

describe("recordLotMovementAllocations", () => {
  it("persists each consumed lot, cabinet and quantity as a structured row", async () => {
    const insert = vi.fn().mockResolvedValue("allocation-id");
    const ctx = { db: { insert } };

    await recordLotMovementAllocations(ctx, {
      movementId: "movement-1",
      productId: "product-1",
      locationId: "cabinet-01",
      allocations: [
        { lotId: "lot-old", quantity: 3 },
        { lotId: "lot-new", quantity: 2 },
      ],
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(1, "stockMovementLotAllocations", {
      movementId: "movement-1",
      productId: "product-1",
      lotId: "lot-old",
      locationId: "cabinet-01",
      quantity: 3,
      allocationType: "withdrawal",
      createdAt: expect.any(Number),
    });
    expect(insert).toHaveBeenNthCalledWith(2, "stockMovementLotAllocations", {
      movementId: "movement-1",
      productId: "product-1",
      lotId: "lot-new",
      locationId: "cabinet-01",
      quantity: 2,
      allocationType: "withdrawal",
      createdAt: expect.any(Number),
    });
  });

  it("distinguishes package reclassification from actual withdrawal", async () => {
    const insert = vi.fn().mockResolvedValue("allocation-id");
    await recordLotMovementAllocations(
      { db: { insert } },
      {
        movementId: "movement-2",
        productId: "closed-product",
        locationId: "cabinet-02",
        allocations: [{ lotId: "lot-pack", quantity: 1 }],
        allocationType: "reclassification",
      },
    );
    expect(insert).toHaveBeenCalledWith("stockMovementLotAllocations", expect.objectContaining({
      allocationType: "reclassification",
      quantity: 1,
      lotId: "lot-pack",
    }));
  });

  it("rejects every invalid allocation before writing any row", async () => {
    const insert = vi.fn();
    await expect(recordLotMovementAllocations(
      { db: { insert } },
      {
        movementId: "movement-3",
        productId: "product-1",
        locationId: "cabinet-01",
        allocations: [
          { lotId: "lot-good", quantity: 1 },
          { lotId: "lot-bad", quantity: Number.NaN },
        ],
      },
    )).rejects.toThrow(/alocação de lote inválida/i);
    expect(insert).not.toHaveBeenCalled();
  });
});


describe("assertProductLedgerSnapshot", () => {
  const balanced = {
    globalRows: [{ physicalQuantity: 12, reservedQuantity: 3 }],
    locationRows: [
      { productId: "p1", locationId: "cabinet-1", quantity: 7 },
      { productId: "p1", locationId: "cabinet-2", quantity: 5 },
    ],
    lots: [
      { lotId: "lot-1", productId: "p1", lotNumber: "LOT-1", quantityAvailable: 8, active: true },
      { lotId: "lot-2", productId: "p1", lotNumber: "LOT-2", quantityAvailable: 4, active: true },
    ],
    lotLocationBalances: [
      { lotId: "lot-1", productId: "p1", locationId: "cabinet-1", quantityAvailable: 7 },
      { lotId: "lot-1", productId: "p1", locationId: "cabinet-2", quantityAvailable: 1 },
      { lotId: "lot-2", productId: "p1", locationId: "cabinet-2", quantityAvailable: 4 },
    ],
  };

  it("accepts a consistent global × cabinet × lot snapshot", () => {
    expect(assertProductLedgerSnapshot(balanced, "Produto teste")).toEqual({
      physicalQuantity: 12,
      reservedQuantity: 3,
    });
  });

  it("blocks global versus cabinet divergence", () => {
    expect(() => assertProductLedgerSnapshot({
      ...balanced,
      locationRows: [{ productId: "p1", locationId: "cabinet-1", quantity: 11 }],
    }, "Produto teste")).toThrow(/global.*armários/i);
  });

  it("blocks lot total versus lot-location allocation divergence", () => {
    expect(() => assertProductLedgerSnapshot({
      ...balanced,
      lotLocationBalances: balanced.lotLocationBalances.slice(1),
    }, "Produto teste")).toThrow(/lote.*armários/i);
  });

  it("blocks cabinet versus lot allocations divergence", () => {
    expect(() => assertProductLedgerSnapshot({
      ...balanced,
      lotLocationBalances: [
        ...balanced.lotLocationBalances,
        { lotId: "lot-2", productId: "p1", locationId: "cabinet-1", quantityAvailable: 1 },
      ],
      lots: [
        ...balanced.lots,
        { lotId: "lot-3", productId: "p1", lotNumber: "LOT-3", quantityAvailable: 0, active: true },
      ],
      locationRows: [
        { productId: "p1", locationId: "cabinet-1", quantity: 7 },
        { productId: "p1", locationId: "cabinet-2", quantity: 5 },
      ],
    }, "Produto teste")).toThrow(/lote.*armário/i);
  });

  it("blocks duplicate lot-location rows", () => {
    expect(() => assertProductLedgerSnapshot({
      ...balanced,
      lotLocationBalances: [...balanced.lotLocationBalances, balanced.lotLocationBalances[0]],
    }, "Produto teste")).toThrow(/saldo duplicado/i);
  });

  it("allows truly legacy untracked products only when global equals cabinets", () => {
    expect(assertProductLedgerSnapshot({
      globalRows: [{ physicalQuantity: 4, reservedQuantity: 1 }],
      locationRows: [{ productId: "legacy", locationId: "cabinet-1", quantity: 4 }],
      lots: [],
      lotLocationBalances: [],
    }, "Produto legado")).toEqual({ physicalQuantity: 4, reservedQuantity: 1 });
  });

  it("rejects partial lot traceability instead of treating it as legacy", () => {
    expect(() => assertProductLedgerSnapshot({
      globalRows: [{ physicalQuantity: 4, reservedQuantity: 0 }],
      locationRows: [{ productId: "p1", locationId: "cabinet-1", quantity: 4 }],
      lots: [{ lotId: "lot-1", productId: "p1", quantityAvailable: 4 }],
      lotLocationBalances: [],
    }, "Produto teste")).toThrow(/rastreabilidade de lote incompleta/i);
  });
});
