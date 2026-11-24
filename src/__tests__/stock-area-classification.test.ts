import { describe, expect, it } from "vitest";
import { buildHistoricalAreaClassificationPlan, type HistoricalAreaLotEvidence } from "@/lib/stock-area-classification";
import { INITIAL_STOCK_MANIFEST } from "@/lib/stock-regularization-manifest";

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


  it("reconcilia integralmente os 53 itens da carga inicial do manifesto", () => {
    const lots = INITIAL_STOCK_MANIFEST.map((row, index) => ({
      lotId: `lot-${index + 1}`,
      lotNumber: `LOT-${index + 1}`,
      productName: row.productName,
      areaId: null,
      sourceEntry: { entryNumber: "ENT-2026-000001", invoiceNumber: null },
      entryItemEvidence: [{
        entryItemId: `entry-item-${index + 1}`,
        productName: row.productName,
        quantity: row.quantity,
        unitOfMeasure: row.unitOfMeasure,
        locationId: row.locationName === "Armário TI 01" ? "location-1" : "location-2",
        locationName: row.locationName,
        lotId: `lot-${index + 1}`,
      }],
    }));
    const plan = buildHistoricalAreaClassificationPlan(lots, areas);
    expect(plan.blockers).toHaveLength(0);
    expect(plan.patches).toHaveLength(53);
    expect(plan.patches.filter((row) => row.areaName === "TI Geral")).toHaveLength(36);
    expect(plan.patches.filter((row) => row.areaName === "Impressoras")).toHaveLength(17);
    expect(INITIAL_STOCK_MANIFEST.reduce((sum, row) => sum + row.quantity, 0)).toBe(2803);
  });

  it("classifica material da NF Gomaq 372043 como Impressoras", () => {
    const lot = initialLot({
      productName: "Kit teclado e mouse",
      sourceEntry: { entryNumber: "ENT-2026-000002", invoiceNumber: "372043" },
      entryItemEvidence: [{
        entryItemId: "entry-item-gomaq",
        productName: "Kit teclado e mouse",
        quantity: 25,
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

  it("bloqueia NF Gomaq quando produto, quantidade ou unidade não coincidem com a evidência", () => {
    const base = initialLot({
      productName: "Kit teclado e mouse",
      sourceEntry: { entryNumber: "ENT-2026-000002", invoiceNumber: "372043" },
      entryItemEvidence: [{
        entryItemId: "entry-item-gomaq",
        productName: "Kit teclado e mouse",
        quantity: 25,
        unitOfMeasure: "kit",
        locationId: "location-2",
        locationName: "Armário TI 02",
        lotId: "lot-1",
      }],
    });
    const wrongQuantity = initialLot({
      ...base,
      entryItemEvidence: [{ ...base.entryItemEvidence[0], quantity: 24 }],
    });
    const wrongProduct = initialLot({
      ...base,
      entryItemEvidence: [{ ...base.entryItemEvidence[0], productName: "Mouse" }],
    });
    const plan = buildHistoricalAreaClassificationPlan([wrongQuantity, wrongProduct], areas);
    expect(plan.patches).toHaveLength(0);
    expect(plan.blockers).toHaveLength(2);
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
    expect(plan.alreadyClassified).toBe(2);
    expect(plan.blockers).toHaveLength(0);
  });

  it("bloqueia área previamente atribuída que não existe ou está inativa", () => {
    const plan = buildHistoricalAreaClassificationPlan([initialLot({ areaId: "missing-area" })], areas);
    expect(plan.patches).toHaveLength(0);
    expect(plan.blockers[0]?.reason).toMatch(/inexistente ou inativa/i);
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
