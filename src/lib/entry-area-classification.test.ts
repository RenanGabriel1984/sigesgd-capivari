import { describe, expect, it } from "vitest";

import { buildEntryDraftFromNfe, type NfeData } from "@/lib/nfe";
import { buildNfeEntrySummary } from "@/lib/nfe-summary";

const parsedNfe: NfeData = {
  accessKey: "",
  number: "123",
  series: "1",
  emissionDate: "2026-11-18",
  items: [
    {
      lineNumber: 1,
      code: "A1",
      description: "Material de teste",
      unit: "UN",
      quantity: 2,
    },
  ],
};

describe("classificação de área por item na entrada", () => {
  it("preserva a área individual ao montar o rascunho da NF-e", () => {
    const draft = buildEntryDraftFromNfe(parsedNfe, [
      {
        productId: "products:item-1",
        locationId: "storageLocations:armario-1",
        areaId: "stockAreas:limpeza",
      },
    ]);

    expect(draft.items[0].areaId).toBe("stockAreas:limpeza");
  });

  it("mantém a área individual ausente para herdar a área padrão", () => {
    const draft = buildEntryDraftFromNfe(parsedNfe, [
      {
        productId: "products:item-1",
        locationId: "storageLocations:armario-1",
      },
    ]);

    expect(draft.items[0].areaId).toBeUndefined();
  });

  it("mostra a área individual no resumo e usa a área do cabeçalho como fallback", () => {
    const summary = buildNfeEntrySummary({
      nfe: {
        number: "123",
        series: "1",
        emissionDate: "2026-11-18",
      },
      rows: [
        {
          item: parsedNfe.items[0],
          productId: "products:item-1",
          matchStatus: "found",
          areaId: "stockAreas:limpeza",
        },
        {
          item: { ...parsedNfe.items[0], lineNumber: 2 },
          productId: "products:item-1",
          matchStatus: "found",
        },
      ],
      products: [{ _id: "products:item-1", name: "Material de teste" }],
      areas: [
        { _id: "stockAreas:limpeza", name: "Limpeza" },
        { _id: "stockAreas:ti", name: "TI Geral" },
      ],
      defaultAreaId: "stockAreas:ti",
    });

    expect(summary.items.map((item) => item.areaName)).toEqual([
      "Limpeza",
      "TI Geral",
    ]);
  });
});
