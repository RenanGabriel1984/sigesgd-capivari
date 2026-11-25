import { describe, expect, it } from "vitest";
import { permissionForRoute } from "@/lib/rbac";
import {
  calculateWaterBalances,
  remainingWaterShare,
  splitWaterCost,
} from "@/lib/water-management";

describe("water mineral accounting", () => {
  it("protects the water management route through the central RBAC matrix", () => {
    expect(permissionForRoute("/water")).toBe("stock.mutate");
  });
  it("calculates full and empty gallon balances from signed movements", () => {
    expect(calculateWaterBalances([
      { fullDelta: 12, emptyDelta: 4 },
      { fullDelta: -5, emptyDelta: 5 },
      { fullDelta: 6, emptyDelta: -8 },
    ])).toEqual({ full: 13, empty: 1 });
  });

  it("rejects negative balances and non-finite movement values", () => {
    expect(() => calculateWaterBalances([{ fullDelta: -1, emptyDelta: 0 }])).toThrow(/saldo negativo/i);
    expect(() => calculateWaterBalances([{ fullDelta: Number.NaN, emptyDelta: 0 }])).toThrow(/inválida/i);
  });

  it("splits costs exactly to the cent, assigning rounding remainder deterministically", () => {
    const shares = splitWaterCost(10, ["a", "b", "c"]);
    expect(shares.map((row) => row.shareAmount)).toEqual([3.33, 3.33, 3.34]);
    expect(shares.reduce((sum, row) => sum + row.shareAmount, 0)).toBe(10);
  });

  it("rejects empty and duplicate participant lists", () => {
    expect(() => splitWaterCost(10, [])).toThrow(/participantes/i);
    expect(() => splitWaterCost(10, ["a", "a"])).toThrow(/participantes/i);
  });

  it("supports partial payments and never returns a negative outstanding balance", () => {
    expect(remainingWaterShare(30, [10, 5])).toBe(15);
    expect(remainingWaterShare(30, [10, 20])).toBe(0);
  });
});
