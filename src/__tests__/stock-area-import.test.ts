import { describe, expect, it } from "vitest";
import { parseSheetText } from "../convex/stockHelpers";

describe("importação de estoque com área independente do armário", () => {
  it("preserva o formato antigo e a observação com ponto e vírgula", () => {
    const rows = parseSheetText([
      "Localização; Produto; Marca; Quantidade; Unidade; Observação",
      "Armário TI 01; Conector RJ45; Atek; 500; un; Cat5E; 5 caixas com 100",
    ].join("\n"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      locationName: "Armário TI 01",
      productName: "Conector RJ45",
      quantity: 500,
      unitOfMeasure: "un",
      areaName: "",
      observation: "Cat5E; 5 caixas com 100",
    });
  });

  it("lê a área por linha somente quando o cabeçalho declara a coluna", () => {
    const rows = parseSheetText([
      "Localização; Produto; Marca; Quantidade; Unidade; Área; Observação",
      "Armário TI 02; Toner VersaLink — Preto; Xerox; 1; un; Impressoras; Parte do kit; conferir",
      "Armário TI 01; Cooler para processador Intel; DEX-DX; 15; un; TI Geral;",
    ].join("\n"));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      locationName: "Armário TI 02",
      areaName: "Impressoras",
      observation: "Parte do kit; conferir",
    });
    expect(rows[1]).toMatchObject({
      locationName: "Armário TI 01",
      areaName: "TI Geral",
      observation: "",
    });
  });

  it("não usa a localização como critério para inferir a área", () => {
    const rows = parseSheetText([
      "Localização; Produto; Marca; Quantidade; Unidade; Observação",
      "Armário TI 02; Toner; Xerox; 1; un; Material de impressão",
    ].join("\n"));

    expect(rows[0].areaName).toBe("");
  });
});
