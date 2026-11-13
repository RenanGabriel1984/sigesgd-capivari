import { describe, expect, it } from "vitest";
import {
  planFifoLotLocationConsumption,
  planLotLocationTransfer,
} from "@/lib/lot-location-rules";

const lots = [
  { lotId: "lot-new", lotNumber: "LOT-2026-000002", receivedAt: 200, quantityAvailable: 5, active: true },
  { lotId: "lot-old", lotNumber: "LOT-2026-000001", receivedAt: 100, quantityAvailable: 4, active: true },
];
const balances = [
  { balanceId: "bal-old-01", lotId: "lot-old", locationId: "cabinet-01", quantityAvailable: 3 },
  { balanceId: "bal-old-02", lotId: "lot-old", locationId: "cabinet-02", quantityAvailable: 1 },
  { balanceId: "bal-new-01", lotId: "lot-new", locationId: "cabinet-01", quantityAvailable: 5 },
];

describe("lot location FIFO rules", () => {
  it("consumes the oldest lot first at the selected cabinet", () => {
    const plan = planFifoLotLocationConsumption({
      lots,
      balances,
      locationId: "cabinet-01",
      quantity: 4,
    });
    expect(plan.availableAtLocation).toBe(8);
    expect(plan.allocations).toEqual([
      {
        lotId: "lot-old",
        lotNumber: "LOT-2026-000001",
        locationId: "cabinet-01",
        balanceId: "bal-old-01",
        quantity: 3,
        lotQuantityAfter: 1,
        locationQuantityAfter: 0,
      },
      {
        lotId: "lot-new",
        lotNumber: "LOT-2026-000002",
        locationId: "cabinet-01",
        balanceId: "bal-new-01",
        quantity: 1,
        lotQuantityAfter: 4,
        locationQuantityAfter: 4,
      },
    ]);
  });

  it("does not consume stock stored in another cabinet", () => {
    expect(() => planFifoLotLocationConsumption({
      lots,
      balances,
      locationId: "cabinet-02",
      quantity: 2,
    })).toThrow(/armário selecionado/i);
  });

  it("allows a partial withdrawal from one lot", () => {
    const plan = planFifoLotLocationConsumption({
      lots,
      balances,
      locationId: "cabinet-01",
      quantity: 2,
    });
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]).toMatchObject({
      lotId: "lot-old",
      quantity: 2,
      lotQuantityAfter: 2,
      locationQuantityAfter: 1,
    });
  });

  it("rejects lots that are not fully mapped to cabinets", () => {
    expect(() => planFifoLotLocationConsumption({
      lots,
      balances: balances.filter((balance) => balance.lotId !== "lot-new"),
      locationId: "cabinet-01",
      quantity: 1,
    })).toThrow(/não está totalmente conciliado/i);
  });

  it("rejects duplicate lot/cabinet balances", () => {
    expect(() => planFifoLotLocationConsumption({
      lots,
      balances: [...balances, balances[0]],
      locationId: "cabinet-01",
      quantity: 1,
    })).toThrow(/duplicados/i);
  });

  it("rejects negative, non-finite and inactive lot balances", () => {
    expect(() => planFifoLotLocationConsumption({
      lots: [{ lotId: "bad", lotNumber: "BAD", receivedAt: 1, quantityAvailable: -1 }],
      balances: [],
      locationId: "cabinet-01",
      quantity: 1,
    })).toThrow(/inválido/i);

    expect(() => planFifoLotLocationConsumption({
      lots,
      balances,
      locationId: "cabinet-01",
      quantity: Number.POSITIVE_INFINITY,
    })).toThrow(/positiva e finita/i);

    expect(() => planFifoLotLocationConsumption({
      lots: [{ lotId: "inactive", lotNumber: "INACTIVE", receivedAt: 1, quantityAvailable: 1, active: false }],
      balances: [{ lotId: "inactive", locationId: "cabinet-01", quantityAvailable: 1 }],
      locationId: "cabinet-01",
      quantity: 1,
    })).toThrow(/inativo/i);
  });

  it("requires the user to identify a source cabinet", () => {
    expect(() => planFifoLotLocationConsumption({
      lots,
      balances,
      locationId: " ",
      quantity: 1,
    })).toThrow(/armário de origem/i);
  });
});

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
