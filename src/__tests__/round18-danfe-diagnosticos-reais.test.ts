/**
 * RODADA 18 — CORREÇÃO ESTRUTURAL DO PARSER DANFE (DIAGNÓSTICOS REAIS)
 *
 * Estes fixtures reproduzem os SINTOMAS registrados nos relatórios reais de
 * diagnóstico de `Incotech Company.pdf` e `Incotech Company.png`:
 *   • número da NF-e 7000/49 e série 55 (leitura ambígua de header);
 *   • CNPJ do emitente 55.001.000/0029-67 (dígitos da própria chave);
 *   • razão social do emitente vinda do cabeçalho da tabela;
 *   • UF RR (sigla isolada em região de baixa confiança);
 *   • destinatário "REMETENTE ne" e CNPJ ausente com "44,723.674/0001-90";
 *   • nenhum item identificado, apesar de a linha do produto existir;
 *   • valor total 0, apesar de o OCR conter 1.323,50.
 *
 * Regras exercitadas (Rodada 18):
 *   §2 chave válida é fonte autoritativa de número/série; data consistente;
 *   §3 emitente/destinatário por contexto (rótulos NOME e CNPJ/CPF);
 *   §4 UF/endereço/CEP por contexto (nunca sigla isolada);
 *   §5 itens do texto consolidado (sem depender do nº do item);
 *   §6 total com origem registrada, nunca 0 por ruído;
 *   §7 validação de campo + contador apenas com campos válidos.
 *
 * Testes PUROS: nenhuma mutation, nenhum dado de produção é tocado.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildOcrTrace,
  danfeFieldNotes,
  danfeFieldSummary,
  danfeFieldWarnings,
  isDanfeParseBetter,
  mergeDanfeTexts,
  parseAccessKey44,
  parseDanfeText,
  validateAccessKey44,
  validateDanfeFields,
} from "@/lib/danfe-ocr";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");
const DIALOG = read("src/components/DanfeImportDialog.tsx");

const CHAVE = "42260922816315000144550010000029671515440064";

/** Relatório do PDF: campos lidos do documento, mas associados errado. */
const OCR_PDF = [
  "DANFE",
  "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
  "0 - ENTRADA",
  "1 - SAIDA",
  "INCOTECH COMPANY LTDA",
  "RUA RUI BARBOSA, 263 - SALA 01",
  "CENTRO",
  "Tubarao - SC - CEP: 88701-600",
  "FONE: (48) 3053-0760",
  "CNPJ: 22.816.315/0001-44",
  "Nº 000002967",
  "SÉRIE 001",
  "CHAVE DE ACESSO",
  "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
  "DATA DE EMISSÃO 28/09/2026",
  "DESTINATARIO / REMETENTE",
  "NOME/RAZAO SOCIAL",
  "MUNICIPIO DE CAPIVARI",
  "CNPJ/CPF: 44,723.674/0001-90",
  "ENDERECO",
  "RUA PADRE ANCHIETA, 100",
  "CAPIVARI - SP",
  "CEP: 13360-023",
  "DADOS DO PRODUTO/SERVICO",
  "CODIGO DESCRICAO NCM/SH CST CFOP UNID QUANT VU VT",
  "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 52,94 1.323,50",
  "VALOR TOTAL DA NOTA",
  "BASE DE CALCULO DO ICMS 0,00",
  "VALOR DO ICMS 0,00",
  "1.323,50",
  "CONTROLE DO FISCO",
  "DADOS ADICIONAIS",
  "AF: 2223/2026",
  "EMPENHO: 7718/2026",
].join("\n");

/** Relatório do PNG: cabeçalho ambíguo, CNPJ falso da chave, UF RR, item sem nº. */
const OCR_PNG = [
  "DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
  "Nº 49",
  "SÉRIE 55",
  "CHAVE DE ACESSO",
  "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
  "55.001.000/0029-67",
  "RR",
  "DESCRICAO DOS PRODUTOS NCM CST CFOP UNID QUANT VU VT",
  "INCOTECH COMPANY LTDA",
  "RUA RUI BARBOSA, 263",
  "Tubarao - SC - CEP: 88701-600",
  "CNPJ: 22.816.315/0001-44",
  "DADOS DA NOTA",
  "DATA DE EMISSAO 28/09/26",
  "DESTINATARIO / REMETENTE ne",
  "MUNICIPIO DE CAPIVARI",
  "CNPJ/CPF 44,723.674/0001-90",
  "DADOS DO PRODUTO/SERVICO",
  "231071 KIT TECLADO E MOUSE USB SLIM CHOCO | 84716053 000 5102 PC 25,0000 52,94 1.323,50",
  "VALOR TOTAL DA NOTA",
  "BASE DE CALCULO DO ICMS 0,00",
  "1.323,50",
  "AF 2223/2026 EMPENHO 7718/2026",
].join("\n");

/** Região "produtos" do OCR: perdeu os primeiros dígitos do código. */
const REGIAO_PRODUTOS_PNG =
  "071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 52,94 1.323,50";

describe("R18 §1 — sintomas reais do PDF", () => {
  const parsed = parseDanfeText(OCR_PDF);

  it("número 2967, série 001 e emissão 28/09/2026 (conferidos com a chave)", () => {
    expect(parsed.nfeNumber).toBe("2967");
    expect(parsed.series).toBe("001");
    expect(parsed.emissionDate).toBe("2026-09-28");
    expect(parsed.accessKey).toBe(CHAVE);
    expect(validateAccessKey44(parsed.accessKey ?? "")).toBe(true);
  });

  it("emitente: CNPJ, razão social, cidade/UF e CEP corretos (sem cabeçalho de tabela)", () => {
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.emitterCity).toBe("Tubarao");
    expect(parsed.emitterState).toBe("SC");
    expect(parsed.emitterPostalCode).toBe("88701-600");
    // Endereço não incorpora o rótulo "CONTROLE DO FISCO".
    expect(parsed.emitterAddress).toBe("RUA RUI BARBOSA, 263 - SALA 01");
    expect(parsed.emitterAddress).not.toMatch(/CONTROLE|FISCO/i);
  });

  it("destinatário: MUNICÍPIO DE CAPIVARI + CNPJ 44.723.674/0001-90 (seção própria)", () => {
    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.receiverName).not.toBe("REMETENTE ne");
    expect(parsed.receiverCnpj).not.toBe(parsed.emitterCnpj);
  });

  it("item reconhecido com código, descrição, NCM, unidade, quantidade e valores", () => {
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;
    expect(item.code).toBe("231071");
    expect(item.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(item.ncm).toBe("84716053");
    expect(item.unit).toBe("PC");
    expect(item.quantity).toBe(25);
    expect(item.unitValue).toBeCloseTo(52.94, 2);
    expect(item.totalValue).toBeCloseTo(1323.5, 2);
  });

  it("total da NF = 1.323,50 com origem registrada (nunca 0)", () => {
    expect(parsed.totalValue).toBeCloseTo(1323.5, 2);
    expect(parsed.notes?.totalValue).toMatch(/Origem:/);
  });

  it("contador reflete 9 de 10 campos válidos (só o expedidor não existe)", () => {
    const summary = danfeFieldSummary(parsed);
    expect(summary.total).toBe(10);
    expect(summary.found).toBe(9);
    expect(summary.missing).toEqual(["CNPJ expedidor"]);
  });
});

describe("R18 §1/§2 — sintomas reais do PNG (header ambíguo e ruído)", () => {
  const parsed = parseDanfeText(OCR_PNG);

  it("número/série do OCR (49 / 55) NÃO prevalecem sobre a chave válida", () => {
    expect(parsed.nfeNumber).toBe("2967");
    expect(parsed.series).toBe("001");
    expect(parsed.notes?.nfeNumber).toMatch(/49/);
    expect(parsed.notes?.nfeNumber).toMatch(/chave de acesso/i);
    expect(parsed.notes?.series).toMatch(/55/);
    expect(parsed.nfeNumber).not.toBe("49");
    expect(parsed.nfeNumber).not.toBe("7000");
    expect(parsed.series).not.toBe("55");
  });

  it("data curta (28/09/26) é aceita e conferida com o AAMM da chave", () => {
    expect(parsed.emissionDate).toBe("2026-09-28");
    expect(parsed.notes?.emissionDate).toMatch(/AAMM/);
  });

  it("CNPJ-fantasma 55.001.000/0029-67 (dígitos da chave) é rejeitado", () => {
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    expect(parsed.emitterCnpj).not.toBe("55.001.000/0029-67");
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    // O CNPJ falso tem DV inválido: mesmo aparecendo sozinho no texto, não entra.
    const soFalso = parseDanfeText("CNPJ: 55.001.000/0029-67");
    expect(soFalso.emitterCnpj).toBeUndefined();
  });

  it("UF RR isolada não é aceita; SC vem do bloco cidade/UF/CEP", () => {
    expect(parsed.emitterState).toBe("SC");
    expect(parsed.emitterState).not.toBe("RR");
    expect(parsed.emitterCity).toBe("Tubarao");
    expect(parsed.emitterPostalCode).toBe("88701-600");

    // Sigla solta, sem bloco cidade/CEP: não vira UF.
    const soSigla = parseDanfeText(["RR", "CNPJ: 61.457.941/0001-43"].join("\n"));
    expect(soSigla.emitterState).toBeUndefined();
  });

  it('destinatário não é "REMETENTE ne" e o CNPJ com vírgula é reconhecido', () => {
    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(parsed.receiverName).not.toMatch(/REMETENTE/i);
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
  });

  it("item vem da linha consolidada (sem nº do item) com o código completo", () => {
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].code).toBe("231071");
    expect(parsed.items[0].description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(parsed.items[0].quantity).toBe(25);
    expect(parsed.items[0].unitValue).toBeCloseTo(52.94, 2);
    expect(parsed.items[0].totalValue).toBeCloseTo(1323.5, 2);
  });

  it("total da NF = 1.323,50 (o texto contém 0,00 antes, que é ignorado)", () => {
    expect(parsed.totalValue).toBeCloseTo(1323.5, 2);
    expect(parsed.totalValue).not.toBe(0);
  });
});

describe("R18 §5 — texto consolidado × região truncada", () => {
  it("a região com código truncado não cria item; o consolidado fornece o item completo", () => {
    const doConsolidado = parseDanfeText(OCR_PNG);
    const daRegiao = parseDanfeText(REGIAO_PRODUTOS_PNG);

    expect(daRegiao.items).toHaveLength(0); // "071" sem nº do item: pendente
    expect(doConsolidado.items).toHaveLength(1);

    const merged = mergeDanfeTexts(OCR_PNG, [REGIAO_PRODUTOS_PNG]);
    const parsedOcr = parseDanfeText(merged);
    const parsedLayer = parseDanfeText("");
    const best = isDanfeParseBetter(parsedOcr, parsedLayer) ? parsedOcr : parsedLayer;
    expect(best.items).toHaveLength(1);
    expect(best.items[0].code).toBe("231071");
  });

  it("código truncado na região é unificado no mais completo, sem duplicar item", () => {
    const truncada = "1071 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 1.323,50";
    const completa = "231071 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 1.323,50";
    const parsed = parseDanfeText([truncada, completa].join("\n"));
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].code).toBe("231071");
    expect(parsed.items[0].totalValue).toBeCloseTo(1323.5, 2);
  });

  it("linhas de continuação e tralha numérica da chave não viram item", () => {
    // Linha de continuação do item (só NCM/valores): nunca vira produto.
    expect(parseDanfeText("84716053 000 5102 PC 25,0000 52,94 1.323,50").items).toHaveLength(0);
    // Cauda da chave de acesso (blocos de 4 dígitos): nunca vira produto.
    expect(parseDanfeText("5500 1000 0029 6715 1544 0064").items).toHaveLength(0);
    // Código falso de 4 dígitos seguido de tralha numérica: rejeitado sem descrição.
    expect(parseDanfeText("8471 6053 PC 25,0000 52,94 1.323,50").items).toHaveLength(0);
  });

  it("a seleção do melhor resultado prioriza quem tem item reconhecido", () => {
    const comItem = parseDanfeText(OCR_PDF);
    const semItem = parseDanfeText("Nº 000002967\nSÉRIE 001");
    expect(isDanfeParseBetter(comItem, semItem)).toBe(true);
    expect(isDanfeParseBetter(semItem, comItem)).toBe(false);
  });

  it("registra a chave, o emitente da chave e a comparação no rastreio", () => {
    const merged = mergeDanfeTexts(OCR_PDF, [REGIAO_PRODUTOS_PNG]);
    const parsedOcr = parseDanfeText(merged);
    const trace = buildOcrTrace(
      undefined,
      OCR_PDF,
      [REGIAO_PRODUTOS_PNG],
      merged,
      parseDanfeText(""),
      parsedOcr,
      parsedOcr,
      "ocr",
      null,
    );
    expect(trace.pageOcrText).toBe(OCR_PDF);
    expect(trace.regionTexts).toEqual([REGIAO_PRODUTOS_PNG]);
    expect(parseAccessKey44(trace.best.accessKey)?.number).toBe("2967");
    expect(parseAccessKey44(trace.best.accessKey)?.series).toBe("001");
    expect(parseAccessKey44(trace.best.accessKey)?.emitterCnpjDigits).toBe("22816315000144");
    const nfeTrace = trace.fieldTraces.find((field) => field.field === "nfeNumber");
    expect(nfeTrace?.isValid).toBe(true);
  });
});

describe("R18 §7 — validação e confiança (campos inválidos não contam)", () => {
  it("número/série em conflito com a chave ficam PENDENTES quando não vêm da chave", () => {
    const parsed = parseDanfeText("Nº 49\nSÉRIE 55");
    const fields = validateDanfeFields(parsed);
    const number = fields.find((field) => field.campo === "nfeNumber");
    const series = fields.find((field) => field.campo === "series");
    expect(number?.ok).toBe(true); // sem chave no texto, o valor lido é aceito com ressalva
    expect(series?.ok).toBe(true);
    // Porém, com chave presente e conflito, prevalece a chave e a nota explica.
    const comChave = parseDanfeText(
      ["Nº 49", "SÉRIE 55", `CHAVE DE ACESSO`, CHAVE].join("\n"),
    );
    expect(comChave.nfeNumber).toBe("2967");
    expect(comChave.series).toBe("001");
    expect(danfeFieldWarnings(comChave).map((field) => field.campo)).toEqual(
      expect.arrayContaining(["nfeNumber", "series"]),
    );
  });

  it("CNPJ com DV inválido não é marcado como válido", () => {
    const parsed = parseDanfeText("CNPJ: 12.345.678/0001-90");
    expect(parsed.emitterCnpj).toBeUndefined();
    const validations = validateDanfeFields(parsed);
    expect(validations.find((field) => field.campo === "emitterCnpj")?.ok).toBe(false);
    expect(danfeFieldSummary(parsed).missing).toContain("CNPJ emitente");
  });

  it("item sem coerência (total ≠ quantidade × valor unitário) não conta como válido", () => {
    const incoerente = parseDanfeText(
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 9.999,99",
    );
    expect(incoerente.items).toHaveLength(1); // preservado para conferência
    const validations = validateDanfeFields(incoerente);
    expect(validations.find((field) => field.campo === "items")?.ok).toBe(false);
    expect(danfeFieldSummary(incoerente).missing).toContain("Itens da NF-e");

    const coerente = parseDanfeText(
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 1.323,50",
    );
    expect(validateDanfeFields(coerente).find((field) => field.campo === "items")?.ok).toBe(true);
  });

  it("data em conflito com a chave fica pendente em vez de aceita", () => {
    const conflito = parseDanfeText(
      ["DATA DE EMISSÃO 29/09/2016", "CHAVE DE ACESSO", CHAVE].join("\n"),
    );
    expect(conflito.emissionDate).toBeUndefined();
    expect(conflito.notes?.emissionDate).toMatch(/conflita/i);
    const validations = validateDanfeFields(conflito);
    expect(validations.find((field) => field.campo === "emissionDate")?.ok).toBe(false);
    expect(danfeFieldSummary(conflito).missing).toContain("Data de emissão");
  });

  it("o expedidor nunca é inventado e a pendência é explicada na interface", () => {
    const parsed = parseDanfeText(OCR_PDF);
    expect(parsed.issuerCnpj).toBeUndefined();
    expect(parsed.issuerName).toBeUndefined();
    const pendencias = danfeFieldNotes(parsed);
    expect(pendencias.map((field) => field.campo)).toEqual(["issuerCnpj"]);
    expect(pendencias[0].note).toMatch(/expedidor/i);
    expect(DIALOG).toContain("Pendente de conferência manual:");
    expect(DIALOG).toContain("danfeFieldNotes(parsed)");
    expect(DIALOG).toContain("danfeFieldWarnings(parsed)");
  });

  it("não captura rótulos (MODELO/SÉRIE/NÚMERO/DATA) como razão social", () => {
    const parsed = parseDanfeText(
      [
        "MODELO 55 SERIE 001 NUMERO 000002967",
        "DATA DE EMISSAO 28/09/2026",
        "MODELO",
        "SÉRIE",
        "NÚMERO",
        "DATA DE EMISSÃO",
      ].join("\n"),
    );
    expect(parsed.emitterName).toBeUndefined();
  });

  it("não captura o CNPJ do transportador como destinatário", () => {
    const parsed = parseDanfeText(
      [
        "DESTINATARIO / REMETENTE",
        "CNPJ/CPF: 44,723.674/0001-90",
        "TRANSPORTADOR",
        "CNPJ: 38.306.164/0001-14",
      ].join("\n"),
    );
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.transporterCnpj).toBe("38.306.164/0001-14");
    expect(parsed.receiverCnpj).not.toBe(parsed.transporterCnpj);
  });
});

describe("R18 §9 — nenhuma mutation nesta rodada", () => {
  it("o parser e o diálogo não escrevem nada", () => {
    const PARSER = read("src/lib/danfe-ocr.ts");
    expect(PARSER).not.toContain("useMutation");
    expect(PARSER).not.toContain("ctx.db.");
    expect(DIALOG).not.toContain("useMutation");
    expect(DIALOG).toContain("Conferir na Entrada");
  });
});
