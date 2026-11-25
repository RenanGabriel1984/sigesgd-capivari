import { describe, expect, it } from "vitest";
import {
  buildReadonlyLotLocationPlan,
  isClosedUnusedReturnAtSource,
  type LotLocationReadinessReport,
} from "@/lib/lot-location-readonly-plan";

function fixture(overrides: Partial<LotLocationReadinessReport> = {}): LotLocationReadinessReport {
  return {
    readOnly: true,
    migrationApplied: false,
    locations: [
      { locationId: "cabinet-1", name: "Armário TI 01", active: true },
      { locationId: "cabinet-2", name: "Armário TI 02", active: true },
    ],
    products: [{
      productId: "product-1",
      productName: "Produto de teste",
      globalPhysical: 10,
      globalReserved: 2,
      globalError: null,
      localPhysicalTotal: 10,
      lotsAvailableTotal: 10,
      candidateTotalsAlign: true,
      invalidLotCount: 0,
      invalidBalanceCount: 0,
      duplicateBalanceScopeCount: 0,
      orphanBalanceCount: 0,
      localComparison: [
        { locationId: "cabinet-1", physicalQuantity: 6, mappedLotQuantity: 0, candidateLotQuantity: 6, duplicatePhysicalRows: 0 },
        { locationId: "cabinet-2", physicalQuantity: 4, mappedLotQuantity: 0, candidateLotQuantity: 4, duplicatePhysicalRows: 0 },
      ],
      lots: [
        { lotId: "lot-1", lotNumber: "LOT-1", quantityAvailable: 6, status: "candidate", candidateLocationId: "cabinet-1", mappedLocations: [] },
        { lotId: "lot-2", lotNumber: "LOT-2", quantityAvailable: 4, status: "candidate", candidateLocationId: "cabinet-2", mappedLocations: [] },
      ],
    }],
    ...overrides,
  };
}

describe("planner read-only da migração lote × armário", () => {
  it("propose inserts without altering quantities or implying execution", () => {
    const plan = buildReadonlyLotLocationPlan(fixture());
    expect(plan.insertions).toHaveLength(2);
    expect(plan.totalLotsToTrace).toBe(2);
    expect(plan.totalQuantityToTrace).toBe(10);
    expect(plan.safeToApply).toBe(false);
    expect(plan.blockedProducts).toEqual([]);
  });

  it("accepts existing mapped lots idempotently and proposes no duplicate insertion", () => {
    const f = fixture();
    f.products[0].lots = f.products[0].lots.map((lot) => ({
      ...lot,
      status: "mapped",
      candidateLocationId: null,
      mappedLocations: [{ locationId: lot.lotNumber === "LOT-1" ? "cabinet-1" : "cabinet-2", quantity: lot.quantityAvailable }],
    }));
    f.products[0].localComparison = [
      { locationId: "cabinet-1", physicalQuantity: 6, mappedLotQuantity: 6, candidateLotQuantity: 0, duplicatePhysicalRows: 0 },
      { locationId: "cabinet-2", physicalQuantity: 4, mappedLotQuantity: 4, candidateLotQuantity: 0, duplicatePhysicalRows: 0 },
    ];
    const plan = buildReadonlyLotLocationPlan(f);
    expect(plan.insertions).toEqual([]);
    expect(plan.alreadyMapped).toBe(2);
  });

  it("accepts an already-mapped lot split across multiple cabinets when quantities reconcile", () => {
    const f = fixture();
    f.products[0].lots[0] = {
      ...f.products[0].lots[0],
      status: "mapped",
      candidateLocationId: null,
      mappedLocations: [
        { locationId: "cabinet-1", quantity: 3 },
        { locationId: "cabinet-2", quantity: 3 },
      ],
    };
    f.products[0].localComparison = [
      { locationId: "cabinet-1", physicalQuantity: 3, mappedLotQuantity: 3, candidateLotQuantity: 0, duplicatePhysicalRows: 0 },
      { locationId: "cabinet-2", physicalQuantity: 7, mappedLotQuantity: 3, candidateLotQuantity: 4, duplicatePhysicalRows: 0 },
    ];
    const plan = buildReadonlyLotLocationPlan(f);
    expect(plan.insertions).toHaveLength(1);
    expect(plan.alreadyMapped).toBe(1);
    expect(plan.totalQuantityToTrace).toBe(10);
  });

  it("blocks divergent product without proposing any row for it", () => {
    const f = fixture();
    f.products[0].globalPhysical = 11;
    const plan = buildReadonlyLotLocationPlan(f);
    expect(plan.insertions).toEqual([]);
    expect(plan.blockedProducts[0].reasons).toContain("saldo global diverge dos lotes disponíveis");
  });

  it("blocks ambiguous lot and inactive destination", () => {
    const f = fixture();
    f.products[0].lots[0].status = "ambiguous";
    f.products[0].lots[1].candidateLocationId = "inactive";
    f.locations.push({ locationId: "inactive", name: "Local inativo", active: false });
    const plan = buildReadonlyLotLocationPlan(f);
    expect(plan.insertions).toEqual([]);
    expect(plan.blockedProducts[0].reasons).toContain("lote LOT-1 está ambiguous e requer conferência");
    expect(plan.blockedProducts[0].reasons).toContain("lote LOT-2 candidato a local inexistente/inativo");
  });

  it("blocks duplicates, orphan rows and invalid numbers", () => {
    const f = fixture();
    f.products[0].invalidBalanceCount = 1;
    f.products[0].orphanBalanceCount = 1;
    f.products[0].duplicateBalanceScopeCount = 1;
    f.products[0].lots[0].quantityAvailable = Number.NaN;
    const plan = buildReadonlyLotLocationPlan(f);
    expect(plan.insertions).toEqual([]);
    expect(plan.blockedProducts[0].reasons).toEqual(expect.arrayContaining([
      "saldo lote/armário inválido",
      "escopo lote/armário duplicado",
      "saldo lote/armário órfão",
      "quantidade inválida no lote LOT-1",
    ]));
  });

  it("rejects report unless it explicitly states read-only and unapplied", () => {
    expect(() => buildReadonlyLotLocationPlan({ ...fixture(), readOnly: false } as unknown as LotLocationReadinessReport))
      .toThrow(/somente leitura/);
    expect(() => buildReadonlyLotLocationPlan({ ...fixture(), migrationApplied: true } as unknown as LotLocationReadinessReport))
      .toThrow(/somente leitura/);
  });

  it("keeps zero-quantity lots out of proposed writes", () => {
    const f = fixture();
    f.products[0].lots.push({
      lotId: "lot-zero",
      lotNumber: "LOT-ZERO",
      quantityAvailable: 0,
      status: "candidate",
      candidateLocationId: "cabinet-1",
      mappedLocations: [],
    });
    const plan = buildReadonlyLotLocationPlan(f);
    expect(plan.insertions).toHaveLength(2);
    expect(plan.totalLotsToTrace).toBe(2);
  });
});


describe("evidência histórica de saída devolvida sem uso", () => {
  const evidence = {
    lotId: "lot-cooler",
    sourceLocationId: "cabinet-01",
    movements: [
      {
        id: "exit-1",
        type: "exit",
        lotId: "lot-cooler",
        quantity: 1,
        locationId: "cabinet-01",
        canceled: false,
      },
      {
        id: "return-movement-1",
        type: "return",
        lotId: "lot-cooler",
        quantity: 1,
        exitMovementId: "exit-1",
        locationId: "cabinet-01",
        canceled: false,
      },
    ],
    returns: [{
      lotId: "lot-cooler",
      exitMovementId: "exit-1",
      quantity: 1,
      locationId: "cabinet-01",
      condition: "unused",
    }],
  };

  it("accepts only a full unused return linked to the same lot, exit and source cabinet", () => {
    expect(isClosedUnusedReturnAtSource(evidence)).toBe(true);
  });

  it("rejects a partial return", () => {
    expect(isClosedUnusedReturnAtSource({
      ...evidence,
      movements: evidence.movements.map((movement) =>
        movement.type === "return" ? { ...movement, quantity: 0.5 } : movement
      ),
      returns: [{ ...evidence.returns[0], quantity: 0.5 }],
    })).toBe(false);
  });

  it("rejects a used, quarantined or disposed return", () => {
    for (const condition of ["used", "quarantine", "disposed", null]) {
      expect(isClosedUnusedReturnAtSource({
        ...evidence,
        returns: [{ ...evidence.returns[0], condition }],
      })).toBe(false);
    }
  });

  it("rejects a return to another cabinet", () => {
    expect(isClosedUnusedReturnAtSource({
      ...evidence,
      returns: [{ ...evidence.returns[0], locationId: "cabinet-02" }],
    })).toBe(false);
  });

  it("rejects missing lot or exit linkage", () => {
    expect(isClosedUnusedReturnAtSource({
      ...evidence,
      movements: evidence.movements.map((movement) =>
        movement.type === "exit" ? { ...movement, lotId: null } : movement
      ),
    })).toBe(false);
    expect(isClosedUnusedReturnAtSource({
      ...evidence,
      returns: [{ ...evidence.returns[0], exitMovementId: "other-exit" }],
    })).toBe(false);
  });

  it("rejects any additional movement, transfer-like or canceled history", () => {
    expect(isClosedUnusedReturnAtSource({
      ...evidence,
      movements: [...evidence.movements, {
        id: "extra-adjustment",
        type: "adjustment",
        lotId: "lot-cooler",
        quantity: 1,
      }],
    })).toBe(false);
    expect(isClosedUnusedReturnAtSource({
      ...evidence,
      movements: evidence.movements.map((movement) =>
        movement.type === "exit" ? { ...movement, canceled: true } : movement
      ),
    })).toBe(false);
  });
});
