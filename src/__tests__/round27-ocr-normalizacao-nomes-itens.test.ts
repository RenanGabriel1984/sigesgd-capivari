/**
 * RODADA 27 — NORMALIZAÇÃO DOS RESULTADOS DO OCR
 *
 * Defeitos reais cobertos (texto de OCR de DANFE escaneada, sem dados do
 * documento embutidos no parser):
 *
 *  1. A linha do emitente sai do OCR com ruído numérico colado
 *     ("INCOTECH COMPANY LTDA 00002267 dt 28/09/26") e a regra antiga
 *     rejeitava a linha INTEIRA por conter dígitos — a razão social ficava em
 *     branco. Agora só o PREFIXO claramente identificável como nome é aceito,
 *     e somente com evidência textual suficiente.
 *  2. A linha do destinatário vem com várias colunas coladas
 *     ("NOME MUNICIPIO DE CAPIVARI MUNICIPIO Capivari - SP CEP 13360-023"):
 *     o valor do campo NOME precisa ser separado das outras colunas ANTES da
 *     validação (o CEP/UF da coluna vizinha derrubava o candidato).
 *  3. Tokens numéricos com pontuação residual de OCR ("1.323,50]")
 *     invalidavam PRICE_TOKEN_RE e o item não era identificado.
 *  4. Item sem coluna UN reconhecida: unidade fica VAZIA (pendente de
 *     conferência) e é sinalizada — nunca inventada.
 *
 * Nenhum valor esperado é regra de produção: os textos são leituras realistas
 * de OCR usadas apenas para validar esta DANFE de teste. Nenhuma mutation,
 * nenhum banco, nenhum registro de estoque.
 */
import { describe, expect, it } from "vitest";

import { isValidDanfeItemCandidate, parseDanfeText } from "@/lib/danfe-ocr";

const CHAVE = "42260922816315000144550010000029671515440064";

const LINHA_ITEM_OCR =
  "231071 KIT TECLADO E MOUSE USB SLIM CHOCO | 84716053 25,0000 52,94 1.323,50] 00,00";

/** Texto reconhecido da DANFE escaneada — leitura realista de OCR. */
const OCR_DANFE = [
  "DANFE N Fe0012967 NOTA FISCAL ELETRONICA SAO PAULO 1 28/09/26",
  CHAVE,
  "IDENTIFICAÇÃO DO EMITENTE",
  "NOME / RAZÃO SOCIAL: INCOTECH COMPANY LTDA 00002267 dt 28/09/26",
  "CNPJ: 22.816.315/0001-44",
  "RUA RUI BARBOSA, 263 - SALA 01",
  "TUBARÃO/SC - CEP: 88701-600",
  "DESTINATÁRIO / REMETENTE",
  "NOME MUNICIPIO DE CAPIVARI MUNICIPIO Capivari - SP CEP 13360-023",
  "CNPJ: 44.723.674/0001-90",
  "DADOS DOS PRODUTOS",
  LINHA_ITEM_OCR,
  "VALOR TOTAL DA NOTA 1.323,50",
].join("\n");

describe("R27 — nome corporativo com ruído numérico na mesma linha", () => {
  it("extrai só o prefixo corporativo quando números e data vêm depois do nome", () => {
    const parsed = parseDanfeText(
      [
        "IDENTIFICAÇÃO DO EMITENTE",
        "NOME / RAZÃO SOCIAL: INCOTECH COMPANY LTDA 00002267 dt 28/09/26",
        "CNPJ: 22.816.315/0001-44",
      ].join("\n"),
    );

    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    // Nome aprovado não pode voltar como pendência (contaria como campo não
    // identificado na conferência).
    expect(parsed.emitterPendingName).toBeUndefined();
  });

  it("funciona também sem rótulo, apenas com a linha dentro da seção", () => {
    const parsed = parseDanfeText(
      [
        "IDENTIFICAÇÃO DO EMITENTE",
        "INCOTECH COMPANY LTDA 00002267 dt 28/09/26",
        "CNPJ: 22.816.315/0001-44",
      ].join("\n"),
    );

    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.emitterPendingName).toBeUndefined();
  });

  it("não aprova prefixo sem evidência suficiente de nome", () => {
    const parsed = parseDanfeText(
      [
        "IDENTIFICAÇÃO DO EMITENTE",
        "CNPJ: 22.816.315/0001-44",
        "CENTRO 00002267 dt 28/09/26",
      ].join("\n"),
    );

    expect(parsed.emitterName).toBeUndefined();
  });
});

describe("R27 — destinatário em linha de múltiplas colunas", () => {
  it("separa o campo NOME das demais colunas (incluindo CEP) antes de validar", () => {
    const parsed = parseDanfeText(
      [
        "DESTINATÁRIO / REMETENTE",
        "NOME MUNICIPIO DE CAPIVARI MUNICIPIO Capivari - SP CEP 13360-023",
        "CNPJ: 44.723.674/0001-90",
      ].join("\n"),
    );

    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.receiverPendingName).toBeUndefined();
    // O CEP da coluna vizinha NÃO entra na razão social.
    expect(parsed.receiverName).not.toMatch(/13360|CEP|Capivari - SP/);
  });

  it("sem CNPJ próprio da seção o nome fica pendente (contexto não sustenta)", () => {
    const parsed = parseDanfeText(
      [
        "DESTINATÁRIO / REMETENTE",
        "NOME MUNICIPIO DE CAPIVARI MUNICIPIO Capivari - SP CEP 13360-023",
      ].join("\n"),
    );

    expect(parsed.receiverName).toBeUndefined();
    expect(parsed.receiverPendingName).toBeTruthy();
  });
});

describe("R27 — tokens numéricos com pontuação residual", () => {
  it("reconhece o item mesmo com ']' colado ao total do item", () => {
    expect(isValidDanfeItemCandidate(LINHA_ITEM_OCR)).toBe(true);

    const parsed = parseDanfeText(LINHA_ITEM_OCR);
    expect(parsed.items).toHaveLength(1);

    const [item] = parsed.items;
    expect(item.code).toBe("231071");
    expect(item.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(item.ncm).toBe("84716053");
    expect(item.quantity).toBe(25);
    expect(item.unitValue).toBeCloseTo(52.94, 5);
    expect(item.totalValue).toBeCloseTo(1323.5, 5);
    // Coerência quantidade × valor unitário ≈ total continua exigida.
    expect(item.quantity * item.unitValue).toBeCloseTo(item.totalValue, 2);
  });

  it("unidade não reconhecida fica vazia e é sinalizada — nunca inventada", () => {
    const parsed = parseDanfeText(LINHA_ITEM_OCR);
    expect(parsed.items[0].unit).toBe("");
    expect(parsed.notes?.items).toMatch(/unidade/i);
  });

  it("preço legível com outros resíduos também é lido", () => {
    const parsed = parseDanfeText(
      "231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 25,0000 52,94: 1.323,50)",
    );
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].unitValue).toBeCloseTo(52.94, 5);
    expect(parsed.items[0].totalValue).toBeCloseTo(1323.5, 5);
  });
});

describe("R27 — falsos positivos nunca viram razão social", () => {
  const casos = [
    "NOME / RAZÃO SOCIAL: CONTROLE DO FISCO",
    `CHAVE DE ACESSO ${CHAVE}`,
    "CENTRO 123",
    "BAIRRO 100",
    "1.323,50",
    "UNICIPIO DE CAPTVART",
    "DESCRIÇÃO DOS PRODUTOS VALOR UNITÁRIO",
    "NOME / RAZÃO SOCIAL: DANFE 001",
  ];

  for (const candidato of casos) {
    it(`não adota "${candidato.slice(0, 32)}" como nome`, () => {
      const parsed = parseDanfeText(
        ["IDENTIFICAÇÃO DO EMITENTE", "CNPJ: 22.816.315/0001-44", candidato].join("\n"),
      );
      expect(parsed.emitterName).toBeUndefined();
    });
  }
});

describe("R27 — falsos positivos nunca viram produto", () => {
  const casos = [
    "DESCRIÇÃO DOS PRODUTOS VALOR UNITÁRIO",
    "VALOR TOTAL DA NOTA 1.323,50",
    "84716053",
    "25,0000 52,94 1.323,50",
    "CENTRO",
    "|||| ||||",
    "NOME / RAZÃO SOCIAL: INCOTECH COMPANY LTDA",
  ];

  for (const linha of casos) {
    it(`não aceita "${linha.slice(0, 32)}" como item`, () => {
      expect(isValidDanfeItemCandidate(linha)).toBe(false);
    });
  }
});

describe("R27 — regressão da DANFE a partir do texto OCR realista", () => {
  const parsed = parseDanfeText(OCR_DANFE);

  it("recupera emitente e destinatário", () => {
    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    expect(parsed.emitterPendingName).toBeUndefined();
    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.receiverPendingName).toBeUndefined();
    // Expedidor não consta no documento: o CNPJ dele não pode ser inventado.
    expect(parsed.issuerCnpj).toBeUndefined();
  });

  it("recupera número, série, chave e data", () => {
    expect(parsed.nfeNumber).toBe("2967");
    expect(parsed.series).toBe("001");
    expect(parsed.accessKey).toBe(CHAVE);
    expect(parsed.emissionDate).toBe("2026-09-28");
    // A chave confere APENAS ano e mês — o dia nunca é declarado validado por ela.
    expect(parsed.notes?.emissionDate ?? "").toMatch(/apenas ano e mês/);
  });

  it("recupera o item e os valores", () => {
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;
    expect(item.code).toBe("231071");
    expect(item.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(item.ncm).toBe("84716053");
    expect(item.quantity).toBe(25);
    expect(item.unitValue).toBeCloseTo(52.94, 5);
    expect(item.totalValue).toBeCloseTo(1323.5, 5);
    expect(item.unit).toBe("");
    expect(parsed.totalValue).toBeCloseTo(1323.5, 2);
    expect(parsed.notes?.totalValue ?? "").not.toMatch(/Diverg/i);
  });
});
