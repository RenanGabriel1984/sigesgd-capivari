import { describe, expect, it, vi } from "vitest";
import { recordLotMovementAllocations } from "@/convex/lotLocationLedger";

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
