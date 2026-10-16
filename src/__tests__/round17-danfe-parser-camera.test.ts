/**
 * RODADA 17 — PARSER DANFE TOLERANTE A OCR + CÂMERA NO MOBILE
 *
 * Cobre os critérios da rodada:
 *  §A/§B  campos extraídos a partir de rótulos e contexto (linha do rótulo ou
 *         linha adjacente), sem posição fixa de pixels e sem gabarito injetado;
 *         comparação com o gabarito da DANFE Incotech (2967 / 001 / 28-09-2026 /
 *         INCOTECH COMPANY LTDA / 22.816.315-0001-44 / MUNICÍPIO DE CAPIVARI /
 *         44.723.674-0001-90 / 231071 / 52,94 / 1.323,50 / AF 2223-2026);
 *  §C     linha do produto reconhecida em variações de espaçamento, de colunas
 *         (NCM/CST/CFOP/ICMS) e de ordem (QUANT UNID e UNID QUANT);
 *  §D     captura por câmera restaurada no mobile, sem remover PDF/imagem;
 *  §E     nada é criado/confirmado por OCR (conferência humana obrigatória);
 *  §F     chave segue validada pelos 44 dígitos + dígito verificador.
 *
 * Testes PUROS: leem fontes e exercitam o parser — NÃO escrevem no banco,
 * NÃO criam entradas e NÃO confirmam nenhuma DANFE.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  danfeFieldSummary,
  extractAccessKey44,
  isValidDanfeItemCandidate,
  parseDanfeText,
  validateAccessKey44,
} from "@/lib/danfe-ocr";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

const DIALOG = read("src/components/DanfeImportDialog.tsx");
const PARSER = read("src/lib/danfe-ocr.ts");
const ENTRIES = read("src/pages/Entries.tsx");

/** Gabarito da DANFE de teste Incotech — usado SOMENTE para comparar. */
const GABARITO = {
  numero: "2967",
  serie: "001",
  emissao: "2026-09-28",
  chave: "42260922816315000144550010000029671515440064",
  emitente: "INCOTECH COMPANY LTDA",
  cnpjEmitente: "22.816.315/0001-44",
  cidadeEmitente: "Tubarão",
  ufEmitente: "SC",
  cepEmitente: "88701-600",
  destinatario: "MUNICÍPIO DE CAPIVARI",
  cnpjDestinatario: "44.723.674/0001-90",
  produto: {
    codigo: "231071",
    descricao: "KIT TECLADO E MOUSE USB SLIM CHOCO",
    ncm: "84716053",
    unidade: "PC",
    quantidade: 25,
    valorUnitario: 52.94,
    valorTotal: 1323.5,
  },
  totalNf: 1323.5,
  af: "2223/2026",
} as const;

/**
 * Layout em que o OCR devolve CADA rótulo em uma linha e o valor na linha
 * seguinte (o caso que falhava: `pageOcrText` com os dados e `parsedOcr` vazio).
 * Também usa as colunas reais da DANFE na linha do produto.
 */
const OCR_ROTULO_VALOR = [
  "DANFE",
  "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
  "0 - ENTRADA",
  "1 - SAIDA",
  "Nº",
  "000002967",
  "SÉRIE",
  "001",
  "CHAVE DE ACESSO",
  "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
  "INCOTECH COMPANY LTDA",
  "CNPJ",
  "22.816.315/0001-44",
  "RUA JUSCELINO KUBISTCHEK, 310",
  "TUBARAO",
  "SC",
  "CEP: 88701-600",
  "DATA DE EMISSÃO",
  "28/09/2026",
  "DESTINATARIO / REMETENTE",
  "MUNICIPIO DE CAPIVARI",
  "CNPJ: 44.723.674/0001-90",
  "DADOS DOS PRODUTOS / SERVICOS",
  "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 52,94 1.323,50",
  "VALOR TOTAL DA NF",
  "R$ 1.323,50",
  "DADOS ADICIONAIS",
  "AF: 2223/2026",
  "EMPENHO: 7718/2026",
].join("\n");

/** Mesmo documento com o item quebrado em duas linhas pelo OCR. */
const OCR_ITEM_EM_DUAS_LINHAS = [
  "DANFE",
  "Nº 002.967  SÉRIE 001",
  "CHAVE DE ACESSO",
  "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
  "INCOTECH COMPANY LTDA",
  "CNPJ: 22.816.315/0001-44",
  "Tubarão / SC",
  "CEP 88701-600",
  "DATA DE EMISSÃO 28/09/2026",
  "DESTINATÁRIO",
  "MUNICÍPIO DE CAPIVARI",
  "44.723.674/0001-90",
  "DADOS DOS PRODUTOS / SERVICOS",
  "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO",
  "84716053 000 5102 PC 25,0000 52,94 1.323,50",
  "VALOR TOTAL DA NF R$ 1.323,50",
  "AF 2223/2026 EMPENHO 7718/2026",
].join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// A/B — Campos reconhecidos por rótulo (mesma linha ou linha adjacente)
// ═══════════════════════════════════════════════════════════════════════════

describe("R17 §A/§B — extração dos campos com rótulo e valor separados", () => {
  const parsed = parseDanfeText(OCR_ROTULO_VALOR);

  it("identifica número, série, emissão e chave (44 dígitos + DV)", () => {
    expect(parsed.nfeNumber).toBe(GABARITO.numero);
    expect(parsed.series).toBe(GABARITO.serie);
    expect(parsed.emissionDate).toBe(GABARITO.emissao);
    expect(parsed.accessKey).toBe(GABARITO.chave);
    expect(validateAccessKey44(parsed.accessKey ?? "")).toBe(true);
    expect(extractAccessKey44(parsed.accessKey ?? "")?.length).toBe(44);
  });

  it("identifica o emitente (CNPJ, razão social, cidade/UF e CEP)", () => {
    expect(parsed.emitterCnpj).toBe(GABARITO.cnpjEmitente);
    expect(parsed.emitterName).toBe(GABARITO.emitente);
    expect(parsed.emitterCity).toBe("TUBARAO");
    expect(parsed.emitterState).toBe(GABARITO.ufEmitente);
    expect(parsed.emitterPostalCode).toBe(GABARITO.cepEmitente);
  });

  it("identifica o destinatário (razão social e CNPJ) sem trocar com o emitente", () => {
    expect(parsed.receiverCnpj).toBe(GABARITO.cnpjDestinatario);
    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(parsed.receiverCnpj).not.toBe(parsed.emitterCnpj);
    // "REMETENTE" é rótulo, nunca razão social.
    expect(parsed.receiverName).not.toBe("REMETENTE");
  });

  it("identifica o total da NF com o valor na linha seguinte ao rótulo", () => {
    expect(parsed.totalValue).toBe(GABARITO.totalNf);
  });

  it("lê AF e Empenho exatamente como o OCR devolveu (sem corrigir para o gabarito)", () => {
    expect(parsed.afNumber).toBe(GABARITO.af);
    // O empenho do documento é conferido manualmente: o parser preserva o que
    // leu (7718/2026) e NUNCA substitui pelo valor esperado.
    expect(parsed.empenhoNumber).toBe("7718/2026");
    expect(parsed.empenhoNumber).not.toBe("778/2026");

    const outro = parseDanfeText("EMPENHO: 9912/2026\nAF: 2223/2026");
    expect(outro.empenhoNumber).toBe("9912/2026");
    expect(outro.afNumber).toBe("2223/2026");
  });

  it("o contador reflete a leitura real (9 de 10; só o expedidor não existe na DANFE)", () => {
    const summary = danfeFieldSummary(parsed);
    expect(summary.total).toBe(10);
    expect(summary.found).toBeGreaterThanOrEqual(9);
    expect(summary.missing).not.toContain("Número da NF-e");
    expect(summary.missing).not.toContain("Chave de acesso");
    expect(summary.missing).not.toContain("Itens da NF-e");
    expect(summary.missing).not.toContain("CNPJ emitente");
    expect(summary.missing).not.toContain("Razão social destinatário");
  });

  it("a leitura não depende de posição/ordem fixa das linhas", () => {
    // As mesmas linhas em outra ordem (mantendo a ordem relativa das seções):
    // o resultado dos campos permanece o mesmo.
    const reordenado = [
      "AF: 2223/2026",
      "DANFE",
      "EMPENHO: 7718/2026",
      "Nº",
      "000002967",
      "INCOTECH COMPANY LTDA",
      "SÉRIE",
      "001",
      "CNPJ",
      "22.816.315/0001-44",
      "TUBARAO",
      "SC",
      "CEP: 88701-600",
      "CHAVE DE ACESSO",
      "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
      "DATA DE EMISSÃO",
      "28/09/2026",
      "DESTINATARIO / REMETENTE",
      "MUNICIPIO DE CAPIVARI",
      "CNPJ: 44.723.674/0001-90",
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 52,94 1.323,50",
      "VALOR TOTAL DA NF",
      "R$ 1.323,50",
    ].join("\n");

    const outro = parseDanfeText(reordenado);
    expect(outro.nfeNumber).toBe(GABARITO.numero);
    expect(outro.series).toBe(GABARITO.serie);
    expect(outro.emissionDate).toBe(GABARITO.emissao);
    expect(outro.emitterCnpj).toBe(GABARITO.cnpjEmitente);
    expect(outro.receiverCnpj).toBe(GABARITO.cnpjDestinatario);
    expect(outro.items).toHaveLength(1);
    expect(outro.totalValue).toBe(GABARITO.totalNf);
  });

  it("nada do gabarito está embutido no parser (§A: nada de valor fixo)", () => {
    expect(PARSER).not.toContain("2967");
    expect(PARSER).not.toContain("22816315000144");
    expect(PARSER).not.toContain("231071");
    expect(PARSER).not.toContain("1.323,50");
    expect(PARSER).not.toContain("Incotech");
    // ...ou seja: os campos vêm do texto lido, nunca de constante.
    const outroDoc = parseDanfeText(
      ["Nº 4242", "SÉRIE 007", "EMISSÃO 05/01/2027", "CNPJ: 61.457.941/0001-43"].join("\n"),
    );
    expect(outroDoc.nfeNumber).toBe("4242");
    expect(outroDoc.series).toBe("007");
    expect(outroDoc.emissionDate).toBe("2027-01-05");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C — Linha do produto: espaçamento, colunas e ordem variáveis
// ═══════════════════════════════════════════════════════════════════════════

describe("R17 §C — linha do produto com colunas e espaçamentos variáveis", () => {
  it("extrai o item do documento real (código, descrição, NCM, unidade, quantidades e valores)", () => {
    const parsed = parseDanfeText(OCR_ROTULO_VALOR);
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;
    expect(item.code).toBe(GABARITO.produto.codigo);
    expect(item.description).toBe(GABARITO.produto.descricao);
    expect(item.ncm).toBe(GABARITO.produto.ncm);
    expect(item.unit).toBe(GABARITO.produto.unidade);
    expect(item.quantity).toBe(GABARITO.produto.quantidade);
    expect(item.unitValue).toBeCloseTo(GABARITO.produto.valorUnitario, 2);
    expect(item.totalValue).toBeCloseTo(GABARITO.produto.valorTotal, 2);
  });

  it("reconhece o item com o OCR quebrando a linha em duas", () => {
    const parsed = parseDanfeText(OCR_ITEM_EM_DUAS_LINHAS);
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;
    expect(item.code).toBe(GABARITO.produto.codigo);
    expect(item.description).toBe(GABARITO.produto.descricao);
    expect(item.ncm).toBe(GABARITO.produto.ncm);
    expect(item.quantity).toBe(GABARITO.produto.quantidade);
    expect(item.unitValue).toBeCloseTo(GABARITO.produto.valorUnitario, 2);
    expect(item.totalValue).toBeCloseTo(GABARITO.produto.valorTotal, 2);
  });

  it("tolera espaçamento irregular, caixa e ordem UNID/QUANT", () => {
    const variacoes = [
      "1  231071   KIT TECLADO E MOUSE USB SLIM CHOCO      25   PC   52,94   1.323,50",
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 000 5102 PC 25,0000 52,94 1.323,50 0,00 0,00 0,00",
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 25,0000 PC 52,94 1.323,50",
      "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO NCM 84716053 CST 000 CFOP 5102 UNID PC QUANT 25 VU 52,94 VT 1.323,50",
    ];

    for (const linha of variacoes) {
      expect(isValidDanfeItemCandidate(linha, { regionKey: "produtos" }), linha).toBe(true);
      const parsed = parseDanfeText(linha);
      expect(parsed.items, linha).toHaveLength(1);
      expect(parsed.items[0].code, linha).toBe(GABARITO.produto.codigo);
      expect(parsed.items[0].description, linha).toBe(GABARITO.produto.descricao);
      expect(parsed.items[0].quantity, linha).toBe(GABARITO.produto.quantidade);
      expect(parsed.items[0].unitValue, linha).toBeCloseTo(GABARITO.produto.valorUnitario, 2);
      expect(parsed.items[0].totalValue, linha).toBeCloseTo(GABARITO.produto.valorTotal, 2);
    }
  });

  it("extrai vários itens e nunca duplica a linha repetida pelo OCR/regiões", () => {
    const item = "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 1.323,50";
    const segundo = "2 200200 MOUSE OPTICO USB PRETO 10 PC 25,00 250,00";
    const parsed = parseDanfeText([item, item, segundo].join("\n"));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.map((i) => i.code)).toEqual(["231071", "200200"]);
  });

  it("mantém o item PENDENTE quando a linha não traz valores confiáveis (§C)", () => {
    const semValores = parseDanfeText(
      [
        "Nº 2967",
        "DADOS DOS PRODUTOS / SERVICOS",
        "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO PC",
      ].join("\n"),
    );
    expect(semValores.items).toHaveLength(0);
    expect(danfeFieldSummary(semValores).missing).toContain("Itens da NF-e");

    // Cabeçalho de coluna nunca vira produto.
    expect(isValidDanfeItemCandidate("DESCRIÇÃO DOS PRODUTOS / SERVICOS")).toBe(false);
    expect(isValidDanfeItemCandidate("VALOR UNITÁRIO")).toBe(false);
  });

  it("não inventa item a partir do cabeçalho nem aceita número+código sem descrição", () => {
    expect(parseDanfeText("1 231071").items).toHaveLength(0);
    expect(parseDanfeText("Cód. IGO").items).toHaveLength(0);
    expect(
      parseDanfeText(
        ["DADOS DOS PRODUTOS", "DESCRICAO DOS PRODUTOS NCM CST CFOP UNID QUANT VU VT"].join("\n"),
      ).items,
    ).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F — Chave de acesso: 44 dígitos + dígito verificador (não relaxar)
// ═══════════════════════════════════════════════════════════════════════════

describe("R17 §F — chave continua exigindo 44 dígitos com DV válido", () => {
  it("aceita a chave do documento real em formatos de OCR diferentes", () => {
    const formatos = [
      GABARITO.chave,
      "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
      "4226.0922.8163.1500.0144.5500.1000.0029.6715.1544.0064",
      "4226 O922 8163 15OO O144 55OO 1OOO OO29 6715 1544 OO64",
    ];
    for (const formato of formatos) {
      expect(extractAccessKey44(formato), formato).toBe(GABARITO.chave);
      expect(validateAccessKey44(GABARITO.chave)).toBe(true);
    }
  });

  it("rejeita 44 dígitos com DV errado, UF impossível e a chave truncada", () => {
    const dvErrado = GABARITO.chave.slice(0, 43) + "9";
    expect(validateAccessKey44(dvErrado)).toBe(false);
    expect(extractAccessKey44(dvErrado)).toBeUndefined();
    expect(validateAccessKey44("9".repeat(44))).toBe(false);
    expect(validateAccessKey44(GABARITO.chave.slice(0, 43))).toBe(false);
  });

  it("a chave do documento é validada pelo parser (não apenas exibida)", () => {
    const parsed = parseDanfeText(OCR_ROTULO_VALOR);
    expect(parsed.accessKey).toBe(GABARITO.chave);
    expect(validateAccessKey44(parsed.accessKey ?? "")).toBe(true);
    expect((parsed.accessKey ?? "").replace(/\D/g, "")).toHaveLength(44);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D — Câmera no mobile (sem remover PDF/imagem do desktop)
// ═══════════════════════════════════════════════════════════════════════════

describe("R17 §D — câmera do aparelho restaurada no mobile", () => {
  it("o diálogo tem input de câmera com capture=environment e galeria/PDF", () => {
    expect(DIALOG).toContain('accept=".pdf,image/*"');
    expect(DIALOG).toContain('capture="environment"');
    expect(DIALOG).toContain('accept="image/*"');
    expect(DIALOG).toContain("Tirar foto da DANFE");
    expect(DIALOG).toContain("Anexar DANFE (PDF ou imagem)");
  });

  it("a câmera é oferecida em dispositivo móvel/viewport estreito, com fallback", () => {
    expect(DIALOG).toContain("supportsCameraCapture");
    expect(DIALOG).toContain("/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i");
    expect(DIALOG).toContain('window.matchMedia("(max-width: 640px)")');
    // Se o navegador não permitir captura direta, o mesmo botão cai no seletor
    // de imagens (input file) e o anexo continua disponível:
    expect(DIALOG).toContain('use "Anexar DANFE" para escolher uma foto da galeria');
    expect(DIALOG).toContain("cameraInputRef.current?.click()");
  });

  it("câmera usa o MESMO fluxo de importação e conferência (sem componente novo)", () => {
    expect(DIALOG).toContain("const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>)");
    expect(DIALOG).toContain("void startRead(file)");
    expect(DIALOG).toContain("readDanfeFile(file, setStatus)");
    // Um único diálogo de leitura — nada duplicado:
    expect(DIALOG.match(/function readDanfeFile\(/g) ?? []).toHaveLength(1);
    expect(ENTRIES).toContain("<DanfeImportDialog");
    expect(ENTRIES.match(/<DanfeImportDialog/g) ?? []).toHaveLength(1);
  });

  it("OCR/câmera não cria nada: a entrada continua exigindo confirmação humana", () => {
    expect(DIALOG).not.toContain("useMutation");
    expect(DIALOG).not.toContain("api.entries");
    expect(DIALOG).toContain("Conferir na Entrada");
    expect(DIALOG).toContain("nada é criado sem a sua confirmação");
    expect(ENTRIES).toContain("handleDanfeImport");
    expect(ENTRIES).toContain("setNfeOpen(true)");
    expect(ENTRIES).toContain("confirmEntry({ entryId: entryId as any })");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E — Verificação somente-leitura das entradas (nenhuma mutation aqui)
// ═══════════════════════════════════════════════════════════════════════════

describe("R17 §E — esta rodada não altera dados persistidos", () => {
  it("nenhum módulo da rodada chama mutation de entrada/estoque", () => {
    for (const fonte of [DIALOG, PARSER]) {
      expect(fonte).not.toContain("useMutation");
      expect(fonte).not.toContain("ctx.db.insert");
      expect(fonte).not.toContain("ctx.db.patch");
      expect(fonte).not.toContain("ctx.db.delete");
    }
    // O parser continua puro (sem I/O):
    expect(PARSER).not.toContain("fetch(");
    expect(PARSER).not.toContain("localStorage");
  });
});
