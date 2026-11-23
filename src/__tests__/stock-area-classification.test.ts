import { describe, expect, it } from "vitest";
import { buildHistoricalAreaClassificationPlan, type HistoricalAreaLotEvidence } from "@/lib/stock-area-classification";

const areas = [
  { areaId: "area-ti", name: "TI Geral", active: true },
  { areaId: "area-printer", name: "Impressoras", active: true },
];

function initialLot(overrides: Partial<HistoricalAreaLotEvidence> = {}): HistoricalAreaLotEvidence {
  return {
    lotId: "lot-1",
    lotNumber: "LOT-1",
    productName: "Cooler para processador Intel",
    areaId: null,
    sourceEntry: { entryNumber: "ENT-2026-000001", invoiceNumber: null },
    entryItemEvidence: [{
      entryItemId: "entry-item-1",
      productName: "Cooler para processador Intel",
      quantity: 15,
      unitOfMeasure: "un",
      locationId: "location-1",
      locationName: "Armário TI 01",
      lotId: "lot-1",
    }],
    ...overrides,
  };
}

describe("classificação histórica de áreas por evidência documental", () => {
  it("classifica item da carga inicial usando produto, quantidade, unidade e armário", () => {
    const plan = buildHistoricalAreaClassificationPlan([initialLot()], areas);
    expect(plan.patches).toEqual([{
      lotId: "lot-1",
      lotNumber: "LOT-1",
      areaId: "area-ti",
      areaName: "TI Geral",
    }]);
    expect(plan.blockers).toHaveLength(0);
  });

  it("classifica material da NF Gomaq 372043 como Impressoras", () => {
    const lot = initialLot({
      productName: "Kit teclado e mouse",
      sourceEntry: { entryNumber: "ENT-2026-000002", invoiceNumber: "372043" },
      entryItemEvidence: [{
        entryItemId: "entry-item-gomaq",
        productName: "Kit teclado e mouse",
        quantity: 8,
        unitOfMeasure: "kit",
        locationId: "location-2",
        locationName: "Armário TI 02",
        lotId: "lot-1",
      }],
    });
    const plan = buildHistoricalAreaClassificationPlan([lot], areas);
    expect(plan.patches[0]?.areaName).toBe("Impressoras");
    expect(plan.blockers).toHaveLength(0);
  });

  it("não classifica produto desconhecido nem item com quantidade divergente", () => {
    const unknown = initialLot({ productName: "Produto sem manifesto" });
    const mismatch = initialLot({
      entryItemEvidence: [{ ...initialLot().entryItemEvidence[0], quantity: 14 }],
    });
    const plan = buildHistoricalAreaClassificationPlan([unknown, mismatch], areas);
    expect(plan.patches).toHaveLength(0);
    expect(plan.blockers).toHaveLength(2);
  });

  it("bloqueia evidência de item duplicada ou vínculo de lote divergente", () => {
    const base = initialLot();
    const duplicate = initialLot({ entryItemEvidence: [...base.entryItemEvidence, ...base.entryItemEvidence] });
    const wrongLot = initialLot({
      entryItemEvidence: [{ ...base.entryItemEvidence[0], lotId: "another-lot" }],
    });
    const plan = buildHistoricalAreaClassificationPlan([duplicate, wrongLot], areas);
    expect(plan.patches).toHaveLength(0);
    expect(plan.blockers).toHaveLength(2);
  });

  it("não sobrescreve área já classificada em conflito e é idempotente para a mesma área", () => {
    const conflict = initialLot({ areaId: "area-printer" });
    const already = initialLot({ areaId: "area-ti" });
    const plan = buildHistoricalAreaClassificationPlan([conflict, already], areas);
    expect(plan.patches).toHaveLength(0);
    expect(plan.alreadyClassified).toBe(1);
    expect(plan.blockers).toHaveLength(1);
  });

  it("bloqueia quando a área de destino não está ativa", () => {
    const plan = buildHistoricalAreaClassificationPlan([initialLot()], [
      { areaId: "area-ti", name: "TI Geral", active: false },
      areas[1],
    ]);
    expect(plan.patches).toHaveLength(0);
    expect(plan.blockers[0]?.reason).toMatch(/área ativa/i);
  });
});
