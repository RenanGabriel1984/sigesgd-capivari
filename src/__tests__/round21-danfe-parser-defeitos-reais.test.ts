/**
 * RODADA 21 — CORREÇÃO DOS DEFEITOS REAIS DO PARSER (relatórios do laboratório)
 *
 * Os relatórios JSON dos documentos originais (Incotech Company.pdf/.png)
 * NÃO estão versionados no repositório — o laboratório não gravava o conteúdo
 * colado. Os textos abaixo são RECONSTRUÇÕES dos SINTOMAS relatados na Rodada
 * 21 §1 (emitente "Centro", destinatário vindo da legenda "IPJICPF =
 * INSCRICAO ESTADUAL", data ausente no PDF, nenhum item, total truncado em
 * "323,50"), produzidas pelo parser ANTIGO e corrigidas nesta rodada.
 *
 * A validação com os DOIS RELATÓRIOS REAIS segue PENDENTE: ela acontece em
 * `round20-danfe-fixture-ocr.test.ts` no momento em que
 *   src/__tests__/fixtures/incotech-company-{pdf,png}.report.json
 * existirem (exportáveis pelo botão "Exportar relatório (.json)" do próprio
 * /dev/danfe-lab). Este arquivo NÃO declara cumpridos os critérios de
 * aceitação do documento original.
 *
 * Segurança: testes puros sobre texto — nenhuma mutation, nenhum banco.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { digitsOnly } from "@/lib/br-validators";
import {
  danfeFieldSummary,
  parseDanfeText,
  validateDanfeFields,
} from "@/lib/danfe-ocr";

const CHAVE = "42260922816315000144550010000029671515440064";

const norm = (value: string | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

/**
 * Reconstrução do PDF real com os sintomas relatados:
 *   • a razão social fica 6 linhas acima do CNPJ (fora da janela antiga de 5)
 *     e o bairro "CENTRO" vencia por proximidade → emitente "Centro";
 *   • a legenda "IPJICPF = INSCRICAO ESTADUAL" está mais perto do CNPJ do
 *     destinatário que "MUNICIPIO DE CAPIVARI" → destinatário errado;
 *   • entre o rótulo "DATA DE EMISSÃO" e a data existe a linha "CHAVE DE
 *     ACESSO" → a busca antiga parava e a data ficava ausente;
 *   • a linha do item traz "R$" entre os valores → a janela antiga não casava
 *     e nenhum item era identificado;
 *   • o total chegou partido ("1." + "323,50") → truncava para 323,50.
 */
const OCR_PDF_RECONSTRUIDO = [
  "DANFE",
  "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
  "IDENTIFICACAO DO EMITENTE",
  "INCOTECH COMPANY LTDA",
  "RUA RUI BARBOSA, 263 - SALA 01",
  "CENTRO",
  "Tubarao - SC - CEP: 88701-600",
  "FONE: (48) 3053-0760",
  "INSCRICAO ESTADUAL",
  "CNPJ: 22.816.315/0001-44",
  "Nº 000002967",
  "SÉRIE 001",
  "DATA DE EMISSÃO",
  "CHAVE DE ACESSO",
  "28/09/2026",
  "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
  "DESTINATARIO / REMETENTE",
  "MUNICIPIO DE CAPIVARI",
  "RUA PADRE ANCHIETA, 100",
  "CENTRO",
  "CAPIVARI - SP",
  "CEP: 13360-023",
  "FONE: (19) 3406-2000",
  "IPJICPF = INSCRICAO ESTADUAL",
  "CNPJ/CPF: 44,723.674/0001-90",
  "TRANSPORTADOR",
  "CNPJ: 38.306.164/0001-14",
  "DADOS DO PRODUTO/SERVICO",
  "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 R$ 52,94 R$ 1.323,50",
  "VALOR TOTAL DA NOTA",
  "1. 323,50",
  "AF: 2223/2026",
  "EMPENHO: 7718/2026",
].join("\n");

/**
 * Reconstrução do PNG real: mesmos defeitos de emitente/destinatário/itens,
 * com total e data corretos (como relatado) e o item SEM nº, com preço de
 * 4 decimais ("52,9400") — a janela antiga exigia 2 e perdia o item.
 */
const OCR_PNG_RECONSTRUIDO = [
  "DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
  "IDENTIFICACAO DO EMITENTE",
  "INCOTECH COMPANY LTDA",
  "RUA RUI BARBOSA, 263 - SALA 01",
  "CENTRO",
  "Tubarao - SC - CEP: 88701-600",
  "FONE: (48) 3053-0760",
  "CNPJ: 22.816.315/0001-44",
  "Nº 000002967",
  "SÉRIE 001",
  "DATA DE EMISSÃO 28/09/2026",
  "CHAVE DE ACESSO",
  "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
  "DESTINATARIO / REMETENTE",
  "MUNICIPIO DE CAPIVARI",
  "RUA PADRE ANCHIETA, 100",
  "CENTRO",
  "CAPIVARI - SP",
  "CEP: 13360-023",
  "FONE: (19) 3406-2000",
  "IPJICPF = INSCRICAO ESTADUAL",
  "CNPJ/CPF: 44,723.674/0001-90",
  "TRANSPORTADOR",
  "CNPJ: 38.306.164/0001-14",
  "DADOS DO PRODUTO/SERVICO",
  "231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 52,9400 1.323,50",
  "VALOR TOTAL DA NOTA",
  "1.323,50",
  "AF: 2223/2026",
  "EMPENHO: 7718/2026",
].join("\n");

/** Critérios do documento (item 2 da Rodada 21) aplicados aos DOIS formatos. */
function assertDocumentoCorrigido(parsed: ReturnType<typeof parseDanfeText>, origem: string): void {
  // Emitente e destinatário por contexto de rótulos — nunca "Centro"/legenda.
  expect(norm(parsed.emitterName), `${origem}: emitente`).toBe(norm("INCOTECH COMPANY LTDA"));
  expect(parsed.emitterName, `${origem}: emitente ≠ bairro`).not.toBe("Centro");
  expect(digitsOnly(parsed.emitterCnpj ?? "")).toBe("22816315000144");
  expect(norm(parsed.receiverName), `${origem}: destinatário`).toBe(norm("MUNICIPIO DE CAPIVARI"));
  expect(parsed.receiverName, `${origem}: destinatário ≠ legenda`).not.toMatch(/IPJICPF|INSCRICAO/i);
  expect(digitsOnly(parsed.receiverCnpj ?? "")).toBe("44723674000190");

  // Data de emissão nos dois formatos.
  expect(parsed.emissionDate, `${origem}: emissão`).toBe("2026-09-28");

  // Item com os campos e valores de referência.
  expect(parsed.items, `${origem}: itens`).toHaveLength(1);
  const [item] = parsed.items;
  expect(item.code, `${origem}: código`).toBe("231071");
  expect(norm(item.description), `${origem}: descrição`).toBe(
    norm("KIT TECLADO E MOUSE USB SLIM CHOCO"),
  );
  expect(item.ncm, `${origem}: NCM`).toBe("84716053");
  expect(item.unit, `${origem}: unidade`).toBe("PC");
  expect(item.quantity, `${origem}: quantidade`).toBe(25);
  expect(item.unitValue, `${origem}: valor unitário`).toBeCloseTo(52.94, 2);
  expect(item.totalValue, `${origem}: total do item`).toBeCloseTo(1323.5, 2);

  // Total da nota sem truncar o primeiro dígito.
  expect(parsed.totalValue, `${origem}: total da nota`).toBeCloseTo(1323.5, 2);

  // Número, série e chave preservados.
  expect(parsed.nfeNumber, `${origem}: número`).toBe("2967");
  expect(parsed.series, `${origem}: série`).toBe("001");
  expect(parsed.accessKey, `${origem}: chave`).toBe(CHAVE);

  // Os TRÊS CNPJs permanecem distintos (transportadora nunca = emitente/destinatário).
  const emitente = digitsOnly(parsed.emitterCnpj ?? "");
  const destinatario = digitsOnly(parsed.receiverCnpj ?? "");
  const transportadora = digitsOnly(parsed.transporterCnpj ?? "");
  expect(transportadora, `${origem}: transportadora`).toBe("38306164000114");
  expect(new Set([emitente, destinatario, transportadora]).size, `${origem}: CNPJs distintos`).toBe(3);

  // Validação estrutural: itens e campos contam apenas com evidência coerente.
  expect(validateDanfeFields(parsed).find((f) => f.campo === "items")?.ok).toBe(true);
  expect(danfeFieldSummary(parsed).found).toBeGreaterThanOrEqual(9);
}

describe("R21 §1/§4 — defeitos do PDF real reconstruídos e corrigidos", () => {
  const parsed = parseDanfeText(OCR_PDF_RECONSTRUIDO);

  it("documento completo confere (emitente, destinatário, data, item, total, CNPJs)", () => {
    assertDocumentoCorrigido(parsed, "PDF");
  });

  it("bairro CENTRO sozinho nunca vira razão social", () => {
    const soBairro = parseDanfeText(
      ["IDENTIFICACAO DO EMITENTE", "CENTRO", "CNPJ: 22.816.315/0001-44"].join("\n"),
    );
    expect(soBairro.emitterName).toBeUndefined();
    expect(soBairro.emitterCnpj).toBe("22.816.315/0001-44");
  });

  it("legenda da coluna (IPJICPF = INSCRICAO ESTADUAL) nunca vira destinatário", () => {
    const soLegenda = parseDanfeText(
      [
        "DESTINATARIO / REMETENTE",
        "IPJICPF = INSCRICAO ESTADUAL",
        "CNPJ/CPF: 44,723.674/0001-90",
      ].join("\n"),
    );
    expect(soLegenda.receiverName).toBeUndefined();
    expect(soLegenda.receiverCnpj).toBe("44.723.674/0001-90");
  });

  it("total partido em duas linhas (\"1.\" + \"323,50\") é reconstruído, nunca truncado", () => {
    const partido = parseDanfeText(["VALOR TOTAL DA NOTA 1.", "323,50"].join("\n"));
    expect(partido.totalValue).toBeCloseTo(1323.5, 2);
    expect(partido.notes?.totalValue).toMatch(/milhar reconstru[íi]do/i);
  });

  it("total do PNG (\"1.323,50\" inteiro) segue correto — a reconstrução não o quebra", () => {
    const inteiro = parseDanfeText(["VALOR TOTAL DA NOTA", "1.323,50"].join("\n"));
    expect(inteiro.totalValue).toBeCloseTo(1323.5, 2);
    const naLinha = parseDanfeText("VALOR TOTAL DA NOTA 1.323,50");
    expect(naLinha.totalValue).toBeCloseTo(1323.5, 2);
  });
});

describe("R21 §1/§4 — defeitos do PNG real reconstruídos e corrigidos", () => {
  const parsed = parseDanfeText(OCR_PNG_RECONSTRUIDO);

  it("documento completo confere (emitente, destinatário, data, item, total, CNPJs)", () => {
    assertDocumentoCorrigido(parsed, "PNG");
  });

  it("item sem nº e com preço de 4 decimais (52,9400) é identificado", () => {
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].unitValue).toBeCloseTo(52.94, 2);
    expect(parsed.items[0].quantity).toBe(25);
  });

  it("janela de valores coerente vence a falsa janela do CFOP (5102 PC 25,0000 …)", () => {
    // Sem a escolha por coerência, "5102 PC 25,0000 52,94" casava primeiro e o
    // item saía com quantidade 5102 e total 52,94 (incoerente → descartado).
    expect(parsed.items[0].quantity).not.toBe(5102);
    expect(parsed.items[0].totalValue).toBeCloseTo(1323.5, 2);
  });
});

describe("R21 §7 — data de emissão no PDF sem quebrar o PNG", () => {
  it("linha de rótulo entre o rótulo e a data não encerra a busca (PDF)", () => {
    const parsed = parseDanfeText(
      ["DATA DE EMISSÃO", "CHAVE DE ACESSO", "28/09/2026", CHAVE].join("\n"),
    );
    expect(parsed.emissionDate).toBe("2026-09-28");
    expect(parsed.notes?.emissionDate).toMatch(/AAMM/);
  });

  it("glifos trocados em posição numérica (28/O9/2O26) são tolerados", () => {
    const parsed = parseDanfeText(
      ["DATA DE EMISSÃO 28/O9/2O26", "CHAVE DE ACESSO", CHAVE].join("\n"),
    );
    expect(parsed.emissionDate).toBe("2026-09-28");
  });

  it("data isolada sem rótulo adjacente só é aceita com AAMM confere com a chave", () => {
    const parsed = parseDanfeText(
      ["DANFE", "CHAVE DE ACESSO", CHAVE, "28/09/2026", "DESTINATARIO / REMETENTE"].join("\n"),
    );
    expect(parsed.emissionDate).toBe("2026-09-28");
    expect(parsed.notes?.emissionDate).toMatch(/AAMM/);

    // Data de outro mês, sem rótulo: NUNCA é assumida como emissão.
    const outroMes = parseDanfeText(
      ["DANFE", "CHAVE DE ACESSO", CHAVE, "28/10/2026", "DESTINATARIO / REMETENTE"].join("\n"),
    );
    expect(outroMes.emissionDate).toBeUndefined();
  });

  it("a data da SAÍDA nunca vira emissão", () => {
    const parsed = parseDanfeText(
      ["DATA DE EMISSÃO", "DATA DA SAÍDA 29/09/2026", "28/09/2026", CHAVE].join("\n"),
    );
    expect(parsed.emissionDate).toBe("2026-09-28");
  });
});

describe("R21 §5 — itens: ruído de OCR não quebra a janela de valores", () => {
  it("R$ entre os valores não impede o reconhecimento do item", () => {
    const parsed = parseDanfeText(
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 R$ 52,94 R$ 1.323,50",
    );
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].quantity).toBe(25);
    expect(parsed.items[0].unitValue).toBeCloseTo(52.94, 2);
    expect(parsed.items[0].totalValue).toBeCloseTo(1323.5, 2);
  });

  it("itens sem coerência continuam preservados para conferência (não passam como válidos)", () => {
    const incoerente = parseDanfeText(
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 9.999,99",
    );
    expect(incoerente.items).toHaveLength(1);
    expect(validateDanfeFields(incoerente).find((f) => f.campo === "items")?.ok).toBe(false);
  });

  it("continua rejeitando tralha numérica como item (chave, colunas soltas)", () => {
    expect(parseDanfeText("5500 1000 0029 6715 1544 0064").items).toHaveLength(0);
    expect(
      parseDanfeText("84716053 000 5102 PC 25,0000 52,94 1.323,50").items,
    ).toHaveLength(0);
    expect(parseDanfeText("8471 6053 PC 25,0000 52,94 1.323,50").items).toHaveLength(0);
  });
});

describe("R21 — bloqueio declarado: relatórios reais ainda não versionados", () => {
  it("sem fixtures, os critérios de aceitação do documento real NÃO são declarados cumpridos", () => {
    const fixtures = [
      "src/__tests__/fixtures/incotech-company-pdf.report.json",
      "src/__tests__/fixtures/incotech-company-png.report.json",
    ].filter((rel) => existsSync(resolve(__dirname, "..", "..", rel)));

    if (fixtures.length === 0) {
      console.warn(
        "[R21] Relatórios reais AUSENTES — correções validadas apenas contra " +
          "reconstruções dos sintomas. Exporte-os em /dev/danfe-lab (botão " +
          "\"Exportar relatório (.json)\") para src/__tests__/fixtures/.",
      );
      expect(fixtures).toHaveLength(0);
    } else {
      expect(fixtures.length).toBe(2);
    }
  });
});
