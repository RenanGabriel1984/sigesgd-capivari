import { describe, expect, it } from "vitest";
import { planLotLocationTransfer } from "@/lib/lot-location-rules";

describe("lot location transfer rules", () => {
  it("moves a partial quantity between cabinets without changing the lot total", () => {
    const beforeTotal = 8 + 2;
    const plan = planLotLocationTransfer({
      sourceQuantity: 8,
      destinationQuantity: 2,
      quantity: 3,
    });
    expect(plan).toEqual({
      sourceQuantityAfter: 5,
      destinationQuantityAfter: 5,
    });
    expect(plan.sourceQuantityAfter + plan.destinationQuantityAfter).toBe(beforeTotal);
  });

  it("allows moving the entire source balance", () => {
    expect(planLotLocationTransfer({
      sourceQuantity: 4,
      destinationQuantity: 0,
      quantity: 4,
    })).toEqual({
      sourceQuantityAfter: 0,
      destinationQuantityAfter: 4,
    });
  });

  it("rejects a transfer greater than the lot balance at the source cabinet", () => {
    expect(() => planLotLocationTransfer({
      sourceQuantity: 2,
      destinationQuantity: 5,
      quantity: 3,
    })).toThrow(/insuficiente/i);
  });

  it("rejects non-finite, negative and zero quantities", () => {
    for (const input of [
      { sourceQuantity: Number.NaN, destinationQuantity: 0, quantity: 1 },
      { sourceQuantity: 2, destinationQuantity: Number.POSITIVE_INFINITY, quantity: 1 },
      { sourceQuantity: -1, destinationQuantity: 0, quantity: 1 },
      { sourceQuantity: 2, destinationQuantity: 0, quantity: 0 },
    ]) {
      expect(() => planLotLocationTransfer(input)).toThrow(/quantidade/i);
    }
  });
});
