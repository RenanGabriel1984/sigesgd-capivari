import { describe, expect, it } from "vitest";
import { serializeSemicolonCsv } from "@/lib/csv-export";

describe("exportação CSV delimitada por ponto e vírgula", () => {
  it("preserva delimitadores, aspas e quebras de linha dentro de uma célula", () => {
    expect(serializeSemicolonCsv(
      ["Nome", "Observação"],
      [["Toner; preto", 'Comentário "urgente"\nsegunda linha']],
    )).toBe('"Nome";"Observação"\r\n"Toner; preto";"Comentário ""urgente""\nsegunda linha"');
  });

  it("neutraliza fórmulas em texto sem alterar valores numéricos", () => {
    expect(serializeSemicolonCsv(
      ["Descrição", "Quantidade"],
      [['=HYPERLINK("https://exemplo.invalid")', -2]],
    )).toBe('"Descrição";"Quantidade"\r\n"\'=HYPERLINK(""https://exemplo.invalid"")";"-2"');
  });
});
