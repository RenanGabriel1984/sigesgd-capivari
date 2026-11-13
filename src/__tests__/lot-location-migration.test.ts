import { describe, expect, it } from "vitest";
import {
  buildLotLocationMigrationPlan,
  type LotLocationMigrationReport,
} from "@/lib/lot-location-migration";

function report(overrides: Partial<LotLocationMigrationReport> = {}): LotLocationMigrationReport {
  const lots = Array.from({ length: 61 }, (_, index) => ({
    lotId: `lot-${index + 1}`,
    lotNumber: `LOT-${String(index + 1).padStart(6, "0")}`,
    quantityAvailable: index === 0 ? 3278 : 1,
    status: "candidate",
    candidateLocationId: index < 40 ? "loc-1" : "loc-2",
    mappedLocations: [],
  }));
  return {
    readOnly: true,
    migrationApplied: false,
    summary: {
      lots: { withAvailableQuantity: 61, quantityAvailableTotal: 3338 },
      globalStock: { physicalQuantityTotal: 3338, reservedQuantityTotal: 0, invalidRecords: 0 },
      stockByLocation: { physicalQuantityTotal: 3338, invalidRecords: 0 },
      lotLocationBalances: { records: 0, quantityAvailableTotal: 0, invalidRecords: 0 },
      storageLocations: { locations: [{ locationId: "loc-1", name: "Armário TI 01", active: true }, { locationId: "loc-2", name: "Armário TI 02", active: true }] },
    },
    products: [{
      productId: "product-1",
      productName: "Produto de teste",
      globalPhysical: 3338,
      globalReserved: 0,
      globalError: null,
      localPhysicalTotal: 3338,
      lotsAvailableTotal: 3338,
      mappedLotTotal: 0,
      candidateLotTotal: 3338,
      candidateTotalsAlign: true,
      invalidLotCount: 0,
      invalidBalanceCount: 0,
      duplicateBalanceScopeCount: 0,
      orphanBalanceCount: 0,
      localComparison: [
        { locationId: "loc-1", physicalQuantity: 3317, mappedLotQuantity: 0, candidateLotQuantity: 3317, duplicatePhysicalRows: 0 },
        { locationId: "loc-2", physicalQuantity: 21, mappedLotQuantity: 0, candidateLotQuantity: 21, duplicatePhysicalRows: 0 },
      ],
      lots,
    }],
    ...overrides,
  };
}

describe("planejamento da migração lote × armário", () => {
  it("monta 61 vínculos sem escrever dados e preserva o total de 3.338", () => {
    const plan = buildLotLocationMigrationPlan(report());
    expect(plan.totalLots).toBe(61);
    expect(plan.totalQuantity).toBe(3338);
    expect(plan.insertions).toHaveLength(61);
    expect(plan.alreadyMapped).toBe(0);
  });

  it("é idempotente: reconhece os 61 vínculos já mapeados e não propõe inserções", () => {
    const base = report();
    const mappedLots = base.products[0].lots.map((lot) => ({
      ...lot,
      status: "mapped",
      candidateLocationId: null,
      mappedLocations: [{
        locationId: lot.candidateLocationId!,
        quantity: lot.quantityAvailable,
      }],
    }));
    const mappedReport = {
      ...base,
      summary: {
        ...base.summary,
        lotLocationBalances: { records: 61, quantityAvailableTotal: 3338, invalidRecords: 0 },
        storageLocations: base.summary.storageLocations,
      },
      products: [{
        ...base.products[0],
        mappedLotTotal: 3338,
        candidateLotTotal: 0,
        localComparison: base.products[0].localComparison.map((row) => ({
          ...row,
          mappedLotQuantity: row.candidateLotQuantity,
          candidateLotQuantity: 0,
        })),
        lots: mappedLots,
      }],
    } as LotLocationMigrationReport;
    const plan = buildLotLocationMigrationPlan(mappedReport);
    expect(plan.insertions).toHaveLength(0);
    expect(plan.alreadyMapped).toBe(61);
  });

  it.each([
    ["diagnóstico não read-only", { readOnly: false }],
    ["saldo global divergente", { summary: { ...report().summary, globalStock: { ...report().summary.globalStock, physicalQuantityTotal: 3337 } } }],
    ["registro global inválido", { summary: { ...report().summary, globalStock: { ...report().summary.globalStock, invalidRecords: 1 } } }],
    ["quantidade de lotes divergente", { summary: { ...report().summary, lots: { ...report().summary.lots, withAvailableQuantity: 60 } } }],
  ])("bloqueia quando há %s", (_name, override) => {
    expect(() => buildLotLocationMigrationPlan(report(override as Partial<LotLocationMigrationReport>))).toThrow(/Migração lote × armário bloqueada/);
  });

  it("bloqueia lote ambíguo", () => {
    const base = report();
    const changed = {
      ...base,
      products: [{
        ...base.products[0],
        lots: base.products[0].lots.map((lot, index) => index === 0 ? { ...lot, status: "ambiguous" } : lot),
      }],
    };
    expect(() => buildLotLocationMigrationPlan(changed)).toThrow(/estado "ambiguous"/);
  });

  it("bloqueia quantidade mapeada divergente", () => {
    const base = report();
    const mapped = {
      ...base,
      summary: {
        ...base.summary,
        lotLocationBalances: { records: 1, quantityAvailableTotal: 3277, invalidRecords: 0 },
        storageLocations: base.summary.storageLocations,
      },
      products: [{
        ...base.products[0],
        lots: base.products[0].lots.map((lot, index) => index === 0 ? {
          ...lot,
          status: "mapped",
          candidateLocationId: null,
          mappedLocations: [{ locationId: "loc-1", quantity: 3277 }],
        } : lot),
        localComparison: base.products[0].localComparison.map((row) => ({
          ...row,
          mappedLotQuantity: row.locationId === "loc-1" ? 3277 : 0,
          candidateLotQuantity: row.locationId === "loc-1" ? 40 : 21,
        })),
      }],
    } as LotLocationMigrationReport;
    expect(() => buildLotLocationMigrationPlan(mapped)).toThrow(/quantidade mapeada divergente/);
  });
});
