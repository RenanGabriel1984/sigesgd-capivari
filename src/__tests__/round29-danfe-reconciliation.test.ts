/**
 * RODADA 29 — RECONCILIAÇÃO DE ITENS E NOMES (OCR real)
 *
 * Correções validadas com as linhas reais do relatório de OCR da DANFE Incotech:
 *
 *   Linha da página inteira (OCR tesseract.js):
 *     231071 KIT TECLADO E MOUSE USB SLIM CHOCO | 84716053 25,0000 52,94 1.323,50] 00,00
 *
 *   Linha da região (OCR por região):
 *     1071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 [0102] PC 25,0000 52,94 1.323,50] 00,0
 *
 * Defeitos corrigidos:
 *   1. Item duplicado: mergeTruncatedItems exigia descrição literal idêntica —
 *      falhou com NCM/CST colados na descrição. Agora normaliza antes de comparar.
 *   2. Nome com sufixo "Z": cutAtNumericNoise cortava antes do dígito mas não
 *      removia a letra isolada entre "LTDA" e a data/coluna. Agora trata o caso.
 *
 * Nenhum valor fixo da Incotech é regra de produção — os textos são leituras
 * realistas usadas apenas para validar esta correção. Nenhum banco, estoque ou
 * registro é criado/modificado.
 */
import { describe, expect, it } from "vitest";

import {
  parseDanfeText,
  type DanfeParseResult,
} from "@/lib/danfe-ocr";

// ─── Textos de OCR real (duplicata por código truncado + descrição contaminada) ─

/** Linha da página inteira (OCR tesseract.js) — código completo, sem unidade. */
const LINHA_PAGINA_INTEGRAL =
  "231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 25,0000 52,94 1.323,50] 00,00";

/** Linha da região (OCR por região) — código truncado, com NCM, CST e unidade. */
const LINHA_REGIAO =
  "1071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 [0102] PC 25,0000 52,94 1.323,50] 00,0";

/** Ambos os textos merged: o parser deve produzir 1 item, não 2. */
const MERGED_COM_DUPLICATA = [LINHA_PAGINA_INTEGRAL, LINHA_REGIAO].join("\n");

// ─── Itens legítimos distintos (não devem ser fundidos) ─

const TEXTO_ITEM_A = "100001 TECLADO USB 10 52,94 529,40";
const TEXTO_ITEM_B = "200002 MOUSE USB 10 52,94 529,40";

describe("R29 — reconciliação de itens (OCR real com código truncado e descrição contaminada)", () => {
  it("funde código truncado + descrição com NCM/CST colados em um único item", () => {
    const parsed: DanfeParseResult = parseDanfeText(MERGED_COM_DUPLICATA);

    // Um único item, não dois.
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;

    // Código completo preservado.
    expect(item.code).toBe("231071");

    // Descrição limpa (sem NCM nem CST).
    expect(item.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");

    // NCM identificado.
    expect(item.ncm).toBe("84716053");

    // Unidade "PC" aproveitada da segunda leitura.
    expect(item.unit).toBe("PC");

    // Quantidade e valores preservados (não somados).
    expect(item.quantity).toBe(25);
    expect(item.unitValue).toBeCloseTo(52.94, 5);
    expect(item.totalValue).toBeCloseTo(1323.5, 5);

    // Soma dos itens coerente com o total da nota — sem duplicação.
    const soma = parsed.items.reduce((acc, i) => acc + i.totalValue, 0);
    expect(soma).toBeCloseTo(1323.5, 2);
  });

  it("mantém itens distintos mesmo com valores iguais e códigos não relacionados", () => {
    const parsed: DanfeParseResult = parseDanfeText([TEXTO_ITEM_A, TEXTO_ITEM_B].join("\n"));

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].code).toBe("100001");
    expect(parsed.items[1].code).toBe("200002");
  });

  it(
    "não funde itens com mesmo código-suffixo mas quantidade diferente",
    () => {
      const texto = [
        "231071 TECLADO A 84716053 25,0000 52,94 1.323,50",
        "1071 TECLADO A 84716053 [0102] PC 10,0000 52,94 529,40",
      ].join("\n");
      const parsed: DanfeParseResult = parseDanfeText(texto);

      expect(parsed.items).toHaveLength(2);
    },
  );

  it(
    "não funde itens com mesmo código-suffixo mas valor unitário diferente",
    () => {
      const texto = [
        "231071 TECLADO A 84716053 25,0000 52,94 1.323,50",
        "1071 TECLADO A 84716053 [0102] PC 25,0000 30,00 750,00",
      ].join("\n");
      const parsed: DanfeParseResult = parseDanfeText(texto);

      expect(parsed.items).toHaveLength(2);
    },
  );

  it(
    "não funde itens com descrições diferentes após normalização",
    () => {
      const texto = [
        "231071 TECLADO A 84716053 25,0000 52,94 1.323,50",
        "1071 TECLADO B 84716053 [0102] PC 25,0000 52,94 1.323,50",
      ].join("\n");
      const parsed: DanfeParseResult = parseDanfeText(texto);

      expect(parsed.items).toHaveLength(2);
    },
  );

  it("preserva a unidade do principal quando a segunda leitura não tem unidade", () => {
    // O item principal tem unidade "UN" reconhecida; a região não tem.
    const texto = [
      "231071 TECLADO A 84716053 UN 25,0000 52,94 1.323,50",
      "1071 TECLADO A 84716053 [0102] 25,0000 52,94 1.323,50",
    ].join("\n");
    const parsed: DanfeParseResult = parseDanfeText(texto);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].unit).toBe("UN");
  });

  it(
    "aproveita a unidade da região quando o principal não tem",
    () => {
      // O item da página integral vem sem unidade (como no OCR real).
      const texto = [
        "231071 TECLADO A 84716053 25,0000 52,94 1.323,50",
        "1071 TECLADO A 84716053 [0102] PC 25,0000 52,94 1.323,50",
      ].join("\n");
      const parsed: DanfeParseResult = parseDanfeText(texto);

      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].unit).toBe("PC");
    },
  );
});

describe("R29 — nome do emitente: resíduo 'Z' entre LTDA e data/coluna", () => {
  it(
    "corrige o caso real: INCOTECH COMPANY LTDA Z [09/26 → INCOTECH COMPANY LTDA",
    () => {
      // Linha real do OCR da página inteira:
      // "INCOTECH COMPANY LTDA Z [09/26 - CONTROLE DO FISCO"
      const parsed: DanfeParseResult = parseDanfeText(
        [
          "IDENTIFICAÇÃO DO EMITENTE",
          "NOME / RAZÃO SOCIAL: INCOTECH COMPANY LTDA Z [09/26 - CONTROLE DO FISCO",
          "CNPJ: 22.816.315/0001-44",
        ].join("\n"),
      );

      expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
      expect(parsed.emitterName).not.toContain(" Z");
      expect(parsed.emitterName).not.toContain("[");
    },
  );

  it(
    "não remove letra isolada válida de nome empresarial (ex.: 'I' em sigla)",
    () => {
      const parsed: DanfeParseResult = parseDanfeText(
        [
          "IDENTIFICAÇÃO DO EMITENTE",
          "NOME / RAZÃO SOCIAL: ABC LTDA I",
          "CNPJ: 22.816.315/0001-44",
        ].join("\n"),
      );

      // A letra "I" deve ser preservada (não há padrão de coluna/data).
      expect(parsed.emitterName).toBe("ABC LTDA I");
    },
  );

  it(
    "não remove palavra de uma letra quando não há padrão de coluna adjacente",
    () => {
      const parsed: DanfeParseResult = parseDanfeText(
        [
          "IDENTIFICAÇÃO DO EMITENTE",
          "NOME / RAZÃO SOCIAL: EXEMPLO LTDA X",
          "CNPJ: 22.816.315/0001-44",
        ].join("\n"),
      );

      // "X" é preservada (não há padrão de data/coluna).
      expect(parsed.emitterName).toBe("EXEMPLO LTDA X");
    },
  );
});
