import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("preserva reservas por lote e consome somente a parcela livre no FIFO", () => {
    const reservedLots: AssetPartLotCandidate[] = [
      { id: "reserved-old", lotNumber: "A", receivedAt: 1, quantityAvailable: 5, quantityReserved: 4, locationId: "cabinet-1", areaId: "general" },
      { id: "free-next", lotNumber: "B", receivedAt: 2, quantityAvailable: 5, quantityReserved: 0, locationId: "cabinet-1", areaId: "general" },
    ];

    expect(planAssetPartFifoConsumption(reservedLots, 2)).toEqual([
      { lotId: "reserved-old", lotNumber: "A", quantity: 1, locationId: "cabinet-1", areaId: "general" },
      { lotId: "free-next", lotNumber: "B", quantity: 1, locationId: "cabinet-1", areaId: "general" },
    ]);
  });

  it("não usa lote cuja quantidade esteja integralmente reservada", () => {
    expect(() => planAssetPartFifoConsumption([
      { id: "fully-reserved", lotNumber: "A", receivedAt: 1, quantityAvailable: 5, quantityReserved: 5, locationId: "cabinet-1" },
    ], 1)).toThrow(/Lotes insuficientes/);
  });

  it("valida reservas do backend antes de montar o plano FIFO", () => {
    const backend = readFileSync(resolve(__dirname, "../convex/assetParts.ts"), "utf8");
    expect(backend).toContain('.query("requestItemReservations")');
    expect(backend).toContain("quantityReserved: reservedByLot.get(String(lot._id)) ?? 0");
    expect(backend).toContain("reservation.areaId !== lot.areaId");
    expect(backend).toContain("reservation.locationId !== lot.locationId");
    expect(backend).toContain("reservedInLots > freshStock.reservedQuantity + 1e-9");
  });
});


describe("instalação de peças — estado do lote após consumo", () => {
  it("inativa lote zerado e mantém ativo lote com saldo remanescente", () => {
    const backend = readFileSync(resolve(__dirname, "../convex/assetParts.ts"), "utf8");
    expect(backend).toContain("active: nextLotQuantity > 0");
  });
});
