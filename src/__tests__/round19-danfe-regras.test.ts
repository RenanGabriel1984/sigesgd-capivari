/**
 * RODADA 19 — REGRESSÃO DAS REGRAS DE ASSOCIAÇÃO DO PARSER DANFE
 *
 * Exercita o MESMO parser usado pelo diálogo de importação
 * (`DanfeImportDialog` → `parseDanfeText`), sem implementação paralela:
 * as importações vêm de `@/lib/danfe-ocr`, o módulo carregado pelo diálogo.
 *
 * Cobertura:
 *   §2 campos esperados do documento (número, série, emissão, chave, emitente,
 *      endereço/CEP, destinatário, item, total, AF, empenho);
 *   §3 regras contra associações incorretas (série×modelo, número contextual,
 *      CNPJ emitente × chave, transportadora × emitente/destinatário, UF por
 *      bloco coerente, destinatário por seção, código truncado em recorte,
 *      total nunca zero, pendência sem invenção);
 *   §5 diálogo com revisão humana e sem mutation.
 *
 * FIXTURES LITERAIS (item 1): os relatórios JSON originais de
 * `Incotech Company.pdf`/`Incotech Company.png` (`rastreio.pageOcrText`,
 * `regionTexts`, `mergedOcr`) NÃO estão disponíveis em disco nesta sessão e o
 * texto da mensagem anterior não sobreviveu à compactação — por isso os casos
 * abaixo são as REGRAS exigidas, reconstruídas a partir dos sintomas
 * documentados. O teste com os textos literais segue PENDENTE até a
 * reentrada do conteúdo dos relatórios (ver relatório final da Rodada 19).
 *
 * Testes PUROS: nenhuma mutation, nenhum dado de produção é tocado.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  danfeFieldNotes,
  danfeFieldSummary,
  danfeFieldWarnings,
  parseDanfeText,
  validateDanfeFields,
} from "@/lib/danfe-ocr";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");
const DIALOG = read("src/components/DanfeImportDialog.tsx");
const ENTRIES = read("src/pages/Entries.tsx");

const CHAVE = "42260922816315000144550010000029671515440064";
const GRUPOS = "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064";

/**
 * Canvas consolidado (página + regiões) com o conteúdo do documento real,
 * incluindo rótulos soltos do OCR, coluna de valores com `0,00` e a seção do
 * transportador — forma típica do texto consolidado do importador.
 */
const CANVAS = [
  "DANFE",
  "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
  "Nº 000002967",
  "SÉRIE 001",
  "MODELO 55",
  "DATA DE EMISSÃO 28/09/2026",
  "CHAVE DE ACESSO",
  GRUPOS,
  "INCOTECH COMPANY LTDA",
  "RUA RUI BARBOSA, 263 - SALA 01 - CENTRO",
  "Tubarao - SC - CEP: 88701-600",
  "CNPJ: 22.816.315/0001-44",
  "DESTINATARIO / REMETENTE",
  "NOME/RAZAO SOCIAL",
  "MUNICIPIO DE CAPIVARI",
  "CNPJ/CPF: 44,723.674/0001-90",
  "TRANSPORTADOR / VOLUMES TRANSPORTADOS",
  "NOME / RAZÃO SOCIAL",
  "EXPRESSO EXATA TRANSPORTES LTDA",
  "CNPJ: 38.306.164/0001-14",
  "DADOS DOS PRODUTOS / SERVICOS",
  "CODIGO DESCRICAO NCM/SH CST CFOP UNID QUANT VU VT",
  "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25 52,94 1.323,50",
  "VALOR TOTAL DA NF-e",
  "0,00",
  "0,00",
  "1.323,50",
  "DADOS ADICIONAIS",
  "AF: 2223/2026",
  "EMPENHO: 7718/2026",
].join("\n");

describe("R19 §2 — campos do documento no parser real", () => {
  const parsed = parseDanfeText(CANVAS);
  const validations = validateDanfeFields(parsed);
  const ok = (campo: string) =>
    validations.find((field) => field.campo === campo)?.ok;

  it("número da NF-e e série vêm da chave validada (2967 / 001)", () => {
    expect(parsed.accessKey).toBe(CHAVE);
    expect(parsed.nfeNumber).toBe("2967");
    expect(parsed.series).toBe("001");
    expect(ok("nfeNumber")).toBe(true);
    expect(ok("series")).toBe(true);
  });

  it("data de emissão é 2026-09-28 e confere com o AAMM da chave", () => {
    expect(parsed.emissionDate).toBe("2026-09-28");
    expect(parsed.notes?.emissionDate).toMatch(/confere com o AAMM/i);
    expect(ok("emissionDate")).toBe(true);
  });

  it("emitente: CNPJ, razão social, endereço, cidade/UF e CEP", () => {
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.emitterAddress).toContain("RUA RUI BARBOSA, 263");
    expect(parsed.emitterAddress).toContain("SALA 01");
    expect(parsed.emitterCity).toBe("Tubarao");
    expect(parsed.emitterState).toBe("SC");
    expect(parsed.emitterPostalCode).toBe("88701-600");
    expect(parsed.notes?.emitterCnpj).toMatch(/chave de acesso/i);
  });

  it("destinatário: MUNICIPIO DE CAPIVARI com CNPJ próprio", () => {
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(ok("receiverCnpj")).toBe(true);
    expect(ok("receiverName")).toBe(true);
  });

  it("item: código, descrição, NCM, unidade, quantidade, unitário e total", () => {
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;
    expect(item.code).toBe("231071");
    expect(item.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(item.ncm).toBe("84716053");
    expect(item.unit).toBe("PC");
    expect(item.quantity).toBe(25);
    expect(item.unitValue).toBeCloseTo(52.94, 2);
    expect(item.totalValue).toBeCloseTo(1323.5, 2);
    expect(ok("items")).toBe(true);
  });

  it("total da NF-e é 1323.50, escolhido apesar dos 0,00 da coluna", () => {
    expect(parsed.totalValue).toBeCloseTo(1323.5, 2);
    expect(parsed.notes?.totalValue).toBeTruthy();
  });

  it("AF 2223/2026 e empenho 7718/2026 são extraídos como texto, revogáveis", () => {
    expect(parsed.afNumber).toBe("2223/2026");
    expect(parsed.empenhoNumber).toBe("7718/2026");
    // A revisão humana acontece na tela de Entrada (campos editáveis).
    expect(ENTRIES).toContain("Número da AF");
    expect(ENTRIES).toContain("Número do Empenho");
    expect(ENTRIES).toContain("value={nfeAfNumber}");
    expect(ENTRIES).toContain("value={nfeEmpenhoNumber}");
  });

  it("sem evidência do expedidor, o campo fica pendente (não inventado)", () => {
    expect(parsed.issuerCnpj).toBeUndefined();
    expect(parsed.issuerName).toBeUndefined();
    expect(ok("issuerCnpj")).toBe(false);
    expect(danfeFieldSummary(parsed).missing).toContain("CNPJ expedidor");
    expect(
      danfeFieldNotes(parsed).find((f) => f.campo === "issuerCnpj")?.note,
    ).toMatch(/evidência/i);
  });
});

describe("R19 §3 — regras contra associações incorretas", () => {
  it("série 001 não é confundida com o modelo 55", () => {
    const semChave = parseDanfeText(
      ["MODELO 55", "SÉRIE 001", "NÚMERO 000002967"].join("\n"),
    );
    expect(semChave.series).toBe("001");
    expect(semChave.series).not.toBe("55");
    expect(semChave.nfeNumber).toBe("2967");

    const comChave = parseDanfeText(
      ["MODELO 55", "SÉRIE 001", "NÚMERO 000002967", "CHAVE DE ACESSO", GRUPOS].join("\n"),
    );
    expect(comChave.series).toBe("001");
    expect(comChave.nfeNumber).toBe("2967");
  });

  it("número não sai de cabeçalho/chave/campos fiscais sem validação contextual", () => {
    // Só a chave: número e série são derivados da chave estruturada (válida).
    const soChave = parseDanfeText(["CHAVE DE ACESSO", GRUPOS].join("\n"));
    expect(soChave.nfeNumber).toBe("2967");
    expect(soChave.series).toBe("001");
    expect(soChave.notes?.nfeNumber).toMatch(/derivado da chave/i);

    // Sem chave e sem rótulo: nada é inventado a partir de CFOP/CNPJ/totais.
    const semContexto = parseDanfeText(
      [
        "CFOP 5102",
        "55001000",
        "22.816.315/0001-44",
        "1.323,50",
        "0000029671515440064",
      ].join("\n"),
    );
    expect(semContexto.nfeNumber).toBeUndefined();
    expect(semContexto.series).toBeUndefined();
    const valida = validateDanfeFields(semContexto);
    expect(valida.find((f) => f.campo === "nfeNumber")?.ok).toBe(false);
    expect(valida.find((f) => f.campo === "series")?.ok).toBe(false);
    const resumo = danfeFieldSummary(semContexto);
    expect(resumo.missing).toContain("Número da NF-e");
    expect(resumo.missing).toContain("Série");
  });

  it("CNPJ do emitente não é extraído da chave como campo independente", () => {
    const soChave = parseDanfeText(["CHAVE DE ACESSO", GRUPOS].join("\n"));
    expect(soChave.emitterCnpj).toBeUndefined();
    expect(danfeFieldSummary(soChave).missing).toContain("CNPJ emitente");

    // Com rótulo, o valor é validado contra a chave (e pode divergir).
    const comRotulo = parseDanfeText(
      ["CHAVE DE ACESSO", GRUPOS, "CNPJ: 22.816.315/0001-44"].join("\n"),
    );
    expect(comRotulo.emitterCnpj).toBe("22.816.315/0001-44");
    expect(comRotulo.notes?.emitterCnpj).toMatch(/confere com o emitente da chave/i);
  });

  it("CNPJ da transportadora nunca vira emitente nem destinatário", () => {
    const parsed = parseDanfeText(CANVAS);
    expect(parsed.transporterCnpj).toBe("38.306.164/0001-14");
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.receiverCnpj).not.toBe(parsed.transporterCnpj);

    // Transportador ANTES da seção do destinatário: a seção continua valendo.
    const transportadorPrimeiro = parseDanfeText(
      [
        "CHAVE DE ACESSO",
        GRUPOS,
        "TRANSPORTADOR / VOLUMES TRANSPORTADOS",
        "38.306.164/0001-14",
        "DESTINATARIO / REMETENTE",
        "NOME/RAZAO SOCIAL",
        "MUNICIPIO DE CAPIVARI",
        "CNPJ/CPF: 44,723.674/0001-90",
      ].join("\n"),
    );
    expect(transportadorPrimeiro.receiverCnpj).toBe("44.723.674/0001-90");
    expect(transportadorPrimeiro.transporterCnpj).toBe("38.306.164/0001-14");
    expect(transportadorPrimeiro.emitterCnpj).toBeUndefined();

    // Único CNPJ rotulado é o do transportador: emitente/destinatário vazios.
    const soTransportador = parseDanfeText(
      ["CHAVE DE ACESSO", GRUPOS, "TRANSPORTADOR", "CNPJ: 38.306.164/0001-14"].join("\n"),
    );
    expect(soTransportador.transporterCnpj).toBe("38.306.164/0001-14");
    expect(soTransportador.emitterCnpj).toBeUndefined();
    expect(soTransportador.receiverCnpj).toBeUndefined();
  });

  it("UF do emitente vem do bloco coerente de endereço (SC, nunca RR)", () => {
    const bloco = parseDanfeText(
      [
        "INCOTECH COMPANY LTDA",
        "RUA RUI BARBOSA, 263",
        "Tubarao - SC - CEP: 88701-600",
      ].join("\n"),
    );
    expect(bloco.emitterState).toBe("SC");

    // Sigla isolada (erro clássico de OCR: "RR") não é aceita sem contexto.
    const siglaSolta = parseDanfeText(
      ["INCOTECH COMPANY LTDA", "RUA RUI BARBOSA, 263", "RR", "CEP: 88701-600"].join("\n"),
    );
    expect(siglaSolta.emitterState).toBeUndefined();
    expect(siglaSolta.emitterState).not.toBe("RR");
  });

  it("destinatário vem da seção DESTINATARIO / REMETENTE, não de REMETENTE isolado", () => {
    const comSecao = parseDanfeText(CANVAS);
    expect(comSecao.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(comSecao.receiverCnpj).toBe("44.723.674/0001-90");

    const isolado = parseDanfeText(
      ["CHAVE DE ACESSO", GRUPOS, "REMETENTE", "44.723.674/0001-90"].join("\n"),
    );
    expect(isolado.receiverName).toBeUndefined();
    const valida = validateDanfeFields(isolado);
    expect(valida.find((f) => f.campo === "receiverName")?.ok).toBe(false);
  });

  it("código 231071 é recuperado quando um recorte perde os primeiros dígitos", () => {
    const truncado = parseDanfeText(
      [
        "CHAVE DE ACESSO",
        GRUPOS,
        "DADOS DOS PRODUTOS / SERVICOS",
        "1 31071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25 52,94 1.323,50",
        "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25 52,94 1.323,50",
      ].join("\n"),
    );
    expect(truncado.items).toHaveLength(1); // unificado, não duplicado
    expect(truncado.items[0].code).toBe("231071");
    expect(validateDanfeFields(truncado).find((f) => f.campo === "items")?.ok).toBe(
      true,
    );
  });

  it("valores monetários nunca são aceitos como zero com evidência de 1.323,50", () => {
    const comEvidencia = parseDanfeText(
      [
        "VALOR TOTAL DA NF-e",
        "0,00",
        "0,00",
        "1.323,50",
        "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25 52,94 1.323,50",
      ].join("\n"),
    );
    expect(comEvidencia.totalValue).toBeCloseTo(1323.5, 2);
    expect(comEvidencia.totalValue).not.toBe(0);

    // Só valores zerados: permanece indefinido (pendente), não vira 0.
    const soZero = parseDanfeText(["VALOR TOTAL DA NF-e", "0,00"].join("\n"));
    expect(soZero.totalValue).toBeUndefined();
    expect(soZero.totalValue).not.toBe(0);
  });

  it("campo sem evidência suficiente permanece pendente, sem valor inventado", () => {
    const parsed = parseDanfeText(CANVAS);
    const resumo = danfeFieldSummary(parsed);

    // Campos sem evidência ficam fora do resumo e marcados como inválidos.
    expect(resumo.missing).toContain("CNPJ expedidor");
    for (const pendente of danfeFieldNotes(parsed)) {
      expect(pendente.ok).toBe(false);
      expect(pendente.confidence).toBe(0);
      expect(pendente.note.length).toBeGreaterThan(0);
    }
    // E nenhum "preenchimento" vazio conta como evidência.
    expect(parsed.emitterCnpj).not.toBe("");
    expect(parsed.receiverName).not.toBe("");
    expect(danfeFieldWarnings(parsed).every((w) => w.note.length > 0)).toBe(true);
  });
});

describe("R19 §5 — diálogo e revisão humana (sem mutation)", () => {
  it("o diálogo exibe pendências, avisos e leva à conferência na Entrada", () => {
    expect(DIALOG).toContain("Pendente de conferência manual:");
    expect(DIALOG).toContain("danfeFieldNotes(parsed)");
    expect(DIALOG).toContain("danfeFieldWarnings(parsed)");
    expect(DIALOG).toContain("Conferir na Entrada");
    expect(DIALOG).toContain("Data de emissão");
  });

  it("parser e diálogo não escrevem nada no banco", () => {
    const PARSER = read("src/lib/danfe-ocr.ts");
    expect(PARSER).not.toContain("useMutation");
    expect(PARSER).not.toContain("ctx.db.");
    expect(DIALOG).not.toContain("useMutation");
    expect(ENTRIES).not.toContain("ctx.db.");
  });
});
