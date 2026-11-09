/**
 * R32 — D2: reconhecimento dos CÓDIGOS de produto na DANFE.
 *
 * Defeito corrigido (auditoria operacional): o parser só aceitava código
 * numérico de 3 a 7 dígitos. Códigos reais do catálogo dos fornecedores
 * (`006R01647`, `CX-735`, `006R016470`, `0110000735`) faziam a LINHA INTEIRA
 * ser descartada — a DANFE abria com zero itens mesmo com o texto perfeito.
 *
 * Este teste exercita o parser REAL (`parseDanfeText` / `isValidDanfeItemCandidate`),
 * não uma reimplementação da regra.
 */
import { describe, expect, it } from "vitest";

import { isValidDanfeItemCandidate, parseDanfeText } from "@/lib/danfe-ocr";

const LINHAS = [
  "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 PC 25,0000 52,94 1.323,50",
  "2 006R01647 TONER PRETO XEROX 84439990 UN 2,0000 100,00 200,00",
  "3 CX-735 CARTUCHO AMARELO LEXMARK 84439990 UN 1,0000 50,00 50,00",
  "4 006R016470 CARTUCHO CIANO XEROX 84439990 UN 1,0000 40,00 40,00",
  "5 0110000735 CARTUCHO TONER PRETO 28K BROTHER 84439990 UN 1,0000 200,00 200,00",
];

const TEXTO_DANFE = [
  "DANFE — DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA",
  "DADOS DOS PRODUTOS / SERVIÇOS",
  "CÓDIGO DESCRIÇÃO NCM/SH UNID QUANT V.UNIT V.TOTAL",
  ...LINHAS,
].join("\n");

describe("R32/D2 — códigos de item aceitos pelo parser real", () => {
  it.each([
    ["006R01647", "2 006R01647 TONER PRETO XEROX 84439990 UN 2,0000 100,00 200,00"],
    ["CX-735", "3 CX-735 CARTUCHO AMARELO LEXMARK 84439990 UN 1,0000 50,00 50,00"],
    ["006R016470", "4 006R016470 CARTUCHO CIANO XEROX 84439990 UN 1,0000 40,00 40,00"],
    ["0110000735", "5 0110000735 CARTUCHO TONER PRETO 28K BROTHER 84439990 UN 1,0000 200,00 200,00"],
    ["231071", "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 PC 25,0000 52,94 1.323,50"],
  ])("aceita a linha do item com código %s", (_code, linha) => {
    expect(isValidDanfeItemCandidate(linha)).toBe(true);
  });

  it("reconhece os cinco itens no texto da DANFE, com código, quantidade e total", () => {
    const parsed = parseDanfeText(TEXTO_DANFE);

    expect(parsed.items.map((item) => item.code)).toEqual([
      "231071",
      "006R01647",
      "CX-735",
      "006R016470",
      "0110000735",
    ]);

    expect(parsed.items[0]).toMatchObject({
      description: "KIT TECLADO E MOUSE USB SLIM CHOCO",
      quantity: 25,
      unit: "PC",
      unitValue: 52.94,
      totalValue: 1323.5,
      ncm: "84716053",
    });

    expect(parsed.items[1]).toMatchObject({
      description: "TONER PRETO XEROX",
      quantity: 2,
      unitValue: 100,
      totalValue: 200,
      ncm: "84439990",
    });

    // Nenhum item extra ou inventado além dos cinco do documento.
    expect(parsed.items).toHaveLength(5);
  });

  it("não cria item falso a partir de rótulos, NCM, datas e chave de acesso", () => {
    const ruido = [
      "DADOS DOS PRODUTOS / SERVIÇOS",
      "CÓDIGO DESCRIÇÃO NCM/SH CST CFOP UNID QUANT V.UNIT V.TOTAL",
      "NCM/SH 84439990 0102 5102 UN 25 52,94 1.323,50",
      "28/09/2026 42260922816315000144550010000029671515440064",
      "VALOR TOTAL DA NOTA 1.323,50",
      "84716053",
      "25,0000 52,94 1.323,50",
    ];

    for (const linha of ruido) {
      expect(isValidDanfeItemCandidate(linha), `linha: ${linha}`).toBe(false);
    }
    expect(parseDanfeText(ruido.join("\n")).items).toHaveLength(0);
  });

  it("mantém as validações de quantidade e valores (nada de item sem preço real)", () => {
    // Código alfanumérico válido, mas sem janela de valores completa.
    expect(
      isValidDanfeItemCandidate("2 006R01647 TONER PRETO XEROX 84439990 UN"),
    ).toBe(false);
    // Descrição ausente continua rejeitada.
    expect(
      isValidDanfeItemCandidate("1 006R01647 84439990 UN 2,0000 100,00 200,00"),
    ).toBe(false);
  });

  it("código numérico de 8 dígitos no início da linha consolidada é NCM, não código", () => {
    // Sem o número do item, um NCM de 8 dígitos não pode ser confundido com o
    // código do fornecedor (associaria o produto errado por alias).
    expect(
      isValidDanfeItemCandidate("84439990 TONER PRETO XEROX UN 2,0000 100,00 200,00"),
    ).toBe(false);
  });
});
