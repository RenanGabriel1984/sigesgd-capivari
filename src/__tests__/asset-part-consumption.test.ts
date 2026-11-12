import { describe, expect, it } from "vitest";
import {
  groupAssetPartConsumptionByLocation,
  planAssetPartFifoConsumption,
  type AssetPartLotCandidate,
} from "@/lib/asset-part-consumption";

const lots: AssetPartLotCandidate[] = [
  { id: "lot-b", lotNumber: "B", receivedAt: 200, quantityAvailable: 5, locationId: "cabinet-2", areaId: "general" },
  { id: "lot-a", lotNumber: "A", receivedAt: 100, quantityAvailable: 2, locationId: "cabinet-1", areaId: "general" },
  { id: "lot-c", lotNumber: "C", receivedAt: 300, quantityAvailable: 8, locationId: "cabinet-1", areaId: "printers" },
];

describe("rastreabilidade FIFO de peças instaladas", () => {
  it("consome primeiro os lotes mais antigos e mantém cada origem", () => {
    expect(planAssetPartFifoConsumption(lots, 4)).toEqual([
      { lotId: "lot-a", lotNumber: "A", quantity: 2, locationId: "cabinet-1", areaId: "general" },
      { lotId: "lot-b", lotNumber: "B", quantity: 2, locationId: "cabinet-2", areaId: "general" },
    ]);
  });

  it("agrupa consumo por local e área sem misturar subestoques", () => {
    const allocations = planAssetPartFifoConsumption(lots, 10);
    expect(groupAssetPartConsumptionByLocation(allocations)).toEqual([
      { locationId: "cabinet-1", areaId: "general", quantity: 2 },
      { locationId: "cabinet-2", areaId: "general", quantity: 5 },
      { locationId: "cabinet-1", areaId: "printers", quantity: 3 },
    ]);
  });

  it("não permite consumir lotes sem localização física", () => {
    expect(() =>
      planAssetPartFifoConsumption(
        [{ id: "legacy", lotNumber: "LEGACY", receivedAt: 1, quantityAvailable: 2 }],
        1,
      ),
    ).toThrow(/não possui local físico/);
  });

  it("não altera candidatos nem produz plano quando os lotes são insuficientes", () => {
    const input = lots.map((lot) => ({ ...lot }));
    expect(() => planAssetPartFifoConsumption(input, 99)).toThrow(/Lotes insuficientes/);
    expect(input).toEqual(lots);
  });

  it("ignora lotes inativos e rejeita quantidade inválida", () => {
    expect(
      planAssetPartFifoConsumption(
        [
          { id: "inactive", lotNumber: "X", receivedAt: 1, quantityAvailable: 10, active: false, locationId: "cabinet-1" },
          { id: "active", lotNumber: "Y", receivedAt: 2, quantityAvailable: 2, active: true, locationId: "cabinet-2" },
        ],
        1,
      ),
    ).toEqual([
      { lotId: "active", lotNumber: "Y", quantity: 1, locationId: "cabinet-2", areaId: undefined },
    ]);
    expect(() => planAssetPartFifoConsumption(lots, 0)).toThrow(/número positivo/);
    expect(() => planAssetPartFifoConsumption(lots, Number.NaN)).toThrow(/número positivo/);
  });
});
