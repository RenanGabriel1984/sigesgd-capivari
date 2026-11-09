/**
 * R32/D3 — a correção feita na conferência precisa CHEGAR ao rascunho.
 *
 * O componente editava a linha da tela, mas `buildEntryDraftFromNfe` lia
 * `nfe.items` (valores originais do OCR). Sem `nfeWithReviewedItems` a
 * correção do usuário seria descartada na criação da entrada.
 *
 * Teste de INTEGRAÇÃO entre os dois módulos de produção (edição + rascunho),
 * sem réplica de regra.
 */
import { describe, expect, it } from "vitest";

import {
  nfeWithReviewedItems,
  reconcileItemTotal,
} from "@/lib/nfe-item-edit";
import { buildEntryDraftFromNfe, mapNfeUnit, type NfeData } from "@/lib/nfe";

const NFE: NfeData = {
  accessKey: "",
  number: "2967",
  series: "001",
  emissionDate: "2026-09-28",
  totalValue: 1323.5,
  items: [
    {
      lineNumber: 1,
      code: "231071",
      description: "KIT TECLADO E MOUSE USB SLIM CHOCO",
      unit: "PC",
      quantity: 25,
      unitValue: 52.94,
      totalValue: 1323.5,
    },
  ],
};

describe("R32/D3 — valores revisados chegam ao rascunho", () => {
  it("quantidade corrigida substitui o valor do OCR e recalcula o total", () => {
    const edited = reconcileItemTotal(NFE.items[0], { quantity: 10 });
    const draft = buildEntryDraftFromNfe(
      nfeWithReviewedItems(NFE, [{ item: edited }]),
      [{ productId: "product-1" }],
    );

    expect(draft.items[0]).toMatchObject({
      productId: "product-1",
      quantity: 10,
      unitCost: 52.94,
      totalCost: 529.4,
    });
  });

  it("unidade e valor unitário corrigidos também são preservados", () => {
    const edited = reconcileItemTotal(NFE.items[0], {
      unitValue: 50,
      totalValue: 500,
    });
    const withUnit = { ...edited, unit: "CX" };

    const draft = buildEntryDraftFromNfe(
      nfeWithReviewedItems(NFE, [{ item: withUnit }]),
      [{ productId: "product-1" }],
    );

    expect(draft.items[0].unitOfMeasure).toBe(mapNfeUnit("CX"));
    expect(draft.items[0].unitCost).toBe(50);
    expect(draft.items[0].totalCost).toBe(500);
  });

  it("os dados fiscais da nota continuam intactos", () => {
    const draft = buildEntryDraftFromNfe(
      nfeWithReviewedItems(NFE, [{ item: reconcileItemTotal(NFE.items[0], { quantity: 1 }) }]),
      [{ productId: "product-1" }],
    );

    expect(draft.invoiceNumber).toBe("2967");
    expect(draft.series).toBe("001");
    expect(draft.totalValue).toBe(1323.5);
    expect(draft.accessKey).toBe("");
  });
});
