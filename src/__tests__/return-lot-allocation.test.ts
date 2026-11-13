import { describe, expect, it } from "vitest";
import { planLotReturnAllocations } from "@/lib/return-lot-allocation";

const sourceAllocations = [
  { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 3 },
  { lotId: "lot-b", sourceLocationId: "cabinet-01", quantity: 2 },
];

describe("return lot allocation rules", () => {
  it("allows partial returns explicitly distributed over multiple lots", () => {
    expect(planLotReturnAllocations({
      requestedQuantity: 3,
      sourceAllocations,
      previouslyReturned: [],
      requestedAllocations: [
        { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 2 },
        { lotId: "lot-b", sourceLocationId: "cabinet-01", quantity: 1 },
      ],
    })).toEqual([
      { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 2 },
      { lotId: "lot-b", sourceLocationId: "cabinet-01", quantity: 1 },
    ]);
  });

  it("subtracts prior partial returns from the exact source lot and cabinet", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 2,
      sourceAllocations,
      previouslyReturned: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 2 }],
      requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 2 }],
    })).toThrow(/excede o saldo disponível/i);
  });

  it("does not allow returning from a different lot or cabinet allocation", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 1,
      sourceAllocations,
      previouslyReturned: [],
      requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-02", quantity: 1 }],
    })).toThrow(/não participou da saída/i);
  });

  it("requires explicit lot quantities to reconcile with the return total", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 2,
      sourceAllocations,
      previouslyReturned: [],
      requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 }],
    })).toThrow(/soma das quantidades/i);
  });

  it("rejects duplicate and invalid allocations", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 2,
      sourceAllocations,
      previouslyReturned: [],
      requestedAllocations: [
        { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 },
        { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 },
      ],
    })).toThrow(/mais de uma vez/i);

    expect(() => planLotReturnAllocations({
      requestedQuantity: 1,
      sourceAllocations,
      previouslyReturned: [],
      requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 0 }],
    })).toThrow(/inválida/i);
  });
});
