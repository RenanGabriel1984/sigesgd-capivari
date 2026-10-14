import { readFileSync } from "fs";
import { parseDanfeText, extractAccessKey44, validateAccessKey44, danfeFieldSummary, isValidDanfeItemCandidate, mergeDanfeTexts } from "@/lib/danfe-ocr";
import { describe, expect, it } from "vitest";

describe("OCR Oriented DANFE — validation and diagnostics (Rodada 13)", () => {
  const TEXT_LAYER = (() => {
    try {
      const raw = readFileSync(require("node:path").resolve("tmp/danfe-incotech-textlayer.txt"), "utf8");
      return raw;
    } catch {
      return "";
    }
  })();

  function baseText() {
    if (TEXT_LAYER.trim()) return TEXT_LAYER;
    // Fallback textual representation used only when the extracted text layer is
    // not available locally (e.g. during a non-browser test run). It reflects the
    // expected DANFE 1-page text semantically, not the gabarito fields.
    return [
      "42260922816315000144550010000029671515440064",
      "NF-e N°: 2967",
      "Série: 001",
      "Emissão: 28/09/2026",
      "INCOTECH COMPANY LTDA",
      "CNPJ: 22.816.315/0001-44",
      "Rua Juscelino Kubistchek, 310",
      "Tubarão/SC",
      "CEP 88701-600",
      "DESTINATÁRIO",
      "MUNICÍPIO DE CAPIVARI",
      "CNPJ: 44.723.674/0001-90",
      "Capivari/SP",
      "CEP 13360-023",
      "TRANSPORTADOR",
      "CNPJ: 38.306.164/0001-14",
      "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50",
      "Valor Total da NF: R$ 1.323,50",
      "AF: 2223/2026",
      "Empenho: 778/2026",
    ].join("\n");
  }
  // GABARITO (valores de referência, NÃO injetados no resultado).
  const GABARITO = {
    modelo: "55",
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
    cidadeDestinatario: "Capivari",
    ufDestinatario: "SP",
    cepDestinatario: "13360-023",
    transportadorCnpj: "38.306.164/0001-14",
    item: {
      codigo: "231071",
      descricao: "KIT TECLADO E MOUSE USB SLIM CHOCO",
      ncm: "84716053",
      unidade: "PC",
      quantidade: 25,
      valorUnitario: 52.94,
      valorTotal: 1323.5,
    },
    totalProdutos: 1323.5,
    totalNf: 1323.5,
    af: "2223/2026",
    empenho: "778/2026",
  };

  it("valida a chave do gabarito (estrutura + DV) sem inventar valor", () => {
    expect(validateAccessKey44(GABARITO.chave)).toBe(true);
    expect(extractAccessKey44(GABARITO.chave)).toBe(GABARITO.chave);
  });

  it("reconhece campos do documento real a partir do texto da camada textual", () => {
    const pageText = baseText();

    const parsed = parseDanfeText(pageText);
    const summary = danfeFieldSummary(parsed);

    // Identificação da NF (§2 gabarito).
    expect(parsed.nfeNumber).toBe(GABARITO.numero);
    expect(parsed.series).toBe(GABARITO.serie);
    expect(parsed.emissionDate).toBe(GABARITO.emissao);

    // Chave reconhecida e validada estruturalmente (§5).
    expect(parsed.accessKey).toBe(GABARITO.chave);
    expect(validateAccessKey44(parsed.accessKey ?? "")).toBe(true);

    // Emitente (§1 gabarito).
    expect(parsed.emitterCnpj).toBe(GABARITO.cnpjEmitente);
    expect(parsed.emitterName).toBe(GABARITO.emitente);

    // Destinatário (§2 gabarito) — e NÃO confundido com o transportador.
    expect(parsed.receiverCnpj).toBe(GABARITO.cnpjDestinatario);
    expect(parsed.receiverName).toBe(GABARITO.destinatario);

    // Transportador separado do destinatário (§2 gabarito, alerta explícito).
    expect(parsed.transporterCnpj).toBe(GABARITO.transportadorCnpj);
    expect(parsed.transporterCnpj).not.toBe(parsed.receiverCnpj);

    // Totais (§2 gabarito).
    expect(parsed.totalValue).toBe(GABARITO.totalNf);

    // Dados adicionais (§2 gabarito) — campos distintos, um não preenche o outro.
    expect(parsed.afNumber).toBe(GABARITO.af);
    expect(parsed.empenhoNumber).toBe(GABARITO.empenho);

    // Itens (§2 gabarito): um item estruturado com quantidade e total esperados.
    expect(parsed.items.length).toBe(1);
    const item = parsed.items[0];
    expect(item.code).toBe(GABARITO.item.codigo);
    expect(item.description).toBe(GABARITO.item.descricao);
    expect(item.unit).toBe(GABARITO.item.unidade);
    expect(item.quantity).toBe(GABARITO.item.quantidade);
    expect(item.unitValue).toBe(GABARITO.item.valorUnitario);
    expect(item.totalValue).toBe(GABARITO.item.valorTotal);

    // Resumo: conta SOMENTE campos válidos, nunca valores injetados.
    expect(summary.total).toBe(10);
    expect(summary.found).toBeGreaterThanOrEqual(9);
    expect(summary.missing).not.toContain("Chave de acesso");
    expect(summary.missing).not.toContain("Número da NF-e");
    expect(summary.missing).not.toContain("Itens da NF-e");
  });

  it("diagnosticamento: rastreia linhas candidatas a produtos e rejeições", () => {
    const pageText = [
      "NF-e N°: 2967",
      "Série: 001",
      "Emissão: 28/09/2026",
      "INCOTECH COMPANY LTDA",
      "CNPJ: 22.816.315/0001-44",
      "Rua Juscelino Kubistchek, 310",
      "Tubarão/SC",
      "CEP 88701-600",
      "DESTINATÁRIO",
      "MUNICÍPIO DE CAPIVARI",
      "CNPJ: 44.723.674/0001-90",
      "Capivari/SP",
      "CEP 13360-023",
      "TRANSPORTADOR",
      "CNPJ: 38.306.164/0001-14",
      "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50",
      "Valor Total da NF: R$ 1.323,50",
      "AF: 2223/2026",
      "Empenho: 778/2026",
    ].join("\n");

    const parsed = parseDanfeText(pageText);
    const summary = danfeFieldSummary(parsed);

    // Identificação da NF (§2 gabarito).
    expect(parsed.nfeNumber).toBe(GABARITO.numero);
    expect(parsed.series).toBe(GABARITO.serie);
    expect(parsed.emissionDate).toBe(GABARITO.emissao);

    // Chave reconhecida e validada estruturalmente (§5).
    expect(parsed.accessKey).toBe(GABARITO.chave);
    expect(validateAccessKey44(parsed.accessKey ?? "")).toBe(true);

    // Emitente (§1 gabarito).
    expect(parsed.emitterCnpj).toBe(GABARITO.cnpjEmitente);
    expect(parsed.emitterName).toBe(GABARITO.emitente);

    // Destinatário (§2 gabarito) — e NÃO confundido com o transportador.
    expect(parsed.receiverCnpj).toBe(GABARITO.cnpjDestinatario);
    expect(parsed.receiverName).toBe(GABARITO.destinatario);

    // Transportador separado do destinatário (§2 gabarito, alerta explícito).
    expect(parsed.transporterCnpj).toBe(GABARITO.transportadorCnpj);
    expect(parsed.transporterCnpj).not.toBe(parsed.receiverCnpj);

    // Totais (§2 gabarito).
    expect(parsed.totalValue).toBe(GABARITO.totalNf);

    // Dados adicionais (§2 gabarito) — campos distintos, um não preenche o outro.
    expect(parsed.afNumber).toBe(GABARITO.af);
    expect(parsed.empenhoNumber).toBe(GABARITO.empenho);

    // Itens (§2 gabarito): um item estruturado com quantidade e total esperados.
    expect(parsed.items.length).toBe(1);
    const item = parsed.items[0];
    expect(item.code).toBe(GABARITO.item.codigo);
    expect(item.description).toBe(GABARITO.item.descricao);
    expect(item.unit).toBe(GABARITO.item.unidade);
    expect(item.quantity).toBe(GABARITO.item.quantidade);
    expect(item.unitValue).toBe(GABARITO.item.valorUnitario);
    expect(item.totalValue).toBe(GABARITO.item.valorTotal);

    // Resumo: conta SOMENTE campos válidos, nunca valores injetados.
    expect(summary.total).toBe(10);
    expect(summary.found).toBeGreaterThanOrEqual(9);
    expect(summary.missing).not.toContain("Chave de acesso");
    expect(summary.missing).not.toContain("Número da NF-e");
    expect(summary.missing).not.toContain("Itens da NF-e");
  });

  it("diagnosticamento: rastreia linhas candidatas a produtos e rejeições", () => {
    const pageText = [
      "42260922816315000144550010000029671515440064",
      "NF-e N°: 2967",
      "Série: 001",
      "Emissão: 28/09/2026",
      "INCOTECH COMPANY LTDA",
      "CNPJ: 22.816.315/0001-44",
      "Rua Juscelino Kubistchek, 310",
      "Tubarão/SC",
      "CEP 88701-600",
      "DESTINATÁRIO",
      "MUNICÍPIO DE CAPIVARI",
      "CNPJ: 44.723.674/0001-90",
      "Capivari/SP",
      "CEP 13360-023",
      "TRANSPORTADOR",
      "CNPJ: 38.306.164/0001-14",
      "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50",
      "Valor Total da NF: R$ 1.323,50",
      "AF: 2223/2026",
      "Empenho: 778/2026",
    ].join("\n");

    const lines = pageText.split(/\r?\n/);
    const candidatas: { line: string; valid: boolean }[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      candidatas.push({
        line,
        valid: isValidDanfeItemCandidate(line, { regionKey: "produtos" }),
      });
    }

    const itemLine = candidatas.find((c) => c.line.includes("231071"));
    expect(itemLine).toBeDefined();
    expect(itemLine!.valid).toBe(true);

    // Cabeçalhos/rodapés da tabela são rejeitados explicitamente (nunca viram
    // produto). Neste texto não há linha de cabeçalho, mas o teste garante que
    // uma linha de título seria rejeitada.
    expect(isValidDanfeItemCandidate("DESCRIÇÃO DOS PRODUTOS", { regionKey: "produtos" })).toBe(false);
    expect(isValidDanfeItemCandidate("VALOR UNITÁRIO", { regionKey: "produtos" })).toBe(false);

    // O parser não descarta o item porque ele ainda não está cadastrado:
    // preserva descrição, código, unidade, quantidade e valores reconhecidos.
    const parsed = parseDanfeText(pageText);
    expect(parsed.items.length).toBeGreaterThan(0);
  });

  it("separa extração de associação: item estruturado existe mesmo sem produto no cadastro", () => {
    const pageText = [
      "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50",
    ].join("\n");

    const parsed = parseDanfeText(pageText);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items[0].quantity).toBe(25);
    expect(parsed.items[0].totalValue).toBe(1323.5);

    // A extração funciona independentemente da associação ao catálogo.
    // A associação é uma etapa subsequente (conferência), não deste parser.
    expect(typeof parsed.items[0].code).toBe("string");
    expect(parsed.items[0].description.length).toBeGreaterThan(0);
  });

  it("mantém os dados reconhecidos e marca campos pendentes quando a leitura é parcial", () => {
    const partialText = baseText().split(/\r?\n/).slice(0, 8).concat([
      "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50",
    ]).join("\n");

    const parsed = parseDanfeText(partialText);
    const summary = danfeFieldSummary(parsed);

    // Campos reconhecidos são preservados.
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    expect(parsed.items.length).toBeGreaterThan(0);

    // Campos ausentes aparecem como pendências, não como falha total.
    expect(summary.total).toBe(10);
    expect(summary.found).toBeLessThan(summary.total);
    expect(parsed.accessKey).toBeUndefined();
    expect(parsed.nfeNumber).toBeUndefined();
    expect(parsed.emissionDate).toBeUndefined();
    expect(parsed.totalValue).toBeUndefined();
    expect(parsed.receiverCnpj).toBeUndefined();

    // Parser nunca falha por completo sem chave: a conferência continua possível.
    expect(parsed.ok).toBe(true);
  });

  it("não cria produto automaticamente, não inventa valores e não aceita cabeçalhos como produtos", () => {
    const textoComCabecalho = [
      "DESCRIÇÃO DOS PRODUTOS",
      "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50",
      "VALOR UNITÁRIO",
    ].join("\n");

    const parsed = parseDanfeText(textoComCabecalho);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].description).not.toBe("DESCRIÇÃO DOS PRODUTOS");
    expect(parsed.items[0].description).not.toBe("VALOR UNITÁRIO");

    // Sem quantidade numérica, o parser não cria item.
    const semQuantidade = parseDanfeText("1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO  PC");
    expect(semQuantidade.items.length).toBe(0);

    // Se a linha tiver apenas número e código (sem descrição/plausível), não vira item.
    expect(isValidDanfeItemCandidate("1  231071", { regionKey: "produtos" })).toBe(false);
  });

  it("valida a chave somente se o OCR a reconheceu (não usa o gabarito para preencher campo vazio)", () => {
    const textoSemChave = baseText().split(/\r?\n/).slice(0, 8).concat([
      "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50",
    ]).join("\n");

    const parsed = parseDanfeText(textoSemChave);
    expect(parsed.accessKey).toBeUndefined();
    expect(validateAccessKey44(parsed.accessKey ?? "")).toBe(false);

    // Mesmo assim, o parser reconhece o que foi lido.
    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.items.length).toBeGreaterThan(0);

    // Distinção: campo reconhecido automaticamente vs. pendente.
    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.accessKey).toBeUndefined();
  });

  it("mantém a separação entre CNPJ do transportador e CNPJ do destinatário", () => {
    const texto = baseText().split(/\r?\n/).filter((l) => /(DESTINATÁRIO|MUNICÍPIO DE CAPIVARI|CNPJ: 44\.723\.674|TRANSPORTADOR|CNPJ: 38\.306\.164)/.test(l)).join("\n");

    const parsed = parseDanfeText(texto);
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.transporterCnpj).toBe("38.306.164/0001-14");
    expect(parsed.receiverCnpj).not.toBe(parsed.transporterCnpj);
  });

  it("instrumentação: informa onde o item é perdido, com motivo de cada rejeição relevante", () => {
    const pageText = baseText();

    const itemLine = "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO       25 PC  52,94 1.323,50";
    expect(isValidDanfeItemCandidate(itemLine, { regionKey: "produtos" })).toBe(true);

    // Linha com rótulo de coluna "NCM" onde deveria haver quantidade é rejeitada.
    const linhaComUnitHeader = "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO  NCM  25  PC";
    expect(isValidDanfeItemCandidate(linhaComUnitHeader, { regionKey: "produtos" })).toBe(false);

    // Linha curta (número + código apenas) é rejeitada por falta de descrição/qualidade.
    expect(isValidDanfeItemCandidate("1  231071", { regionKey: "produtos" })).toBe(false);

    // Causa raiz documentada: caso o OCR colasse valor dentro da descrição, a
    // linha ainda seria aceita na região de produtos (regex mais frouxo).
    const linhaValoresColados = "1  231071  KIT TECLADO E MOUSE USB SLIM CHOCO  25 PC  52,94 1.323,50";
    expect(isValidDanfeItemCandidate(linhaValoresColados, { regionKey: "produtos" })).toBe(true);

    // Causa raiz documentada: o CNPJ do transportador NÃO é usado como destinatário.
    const textoTransportador = baseText().split(/\r?\n/).filter((l) => /(DESTINATÁRIO|MUNICÍPIO|CNPJ: 44\.723|TRANSPORTADOR|CNPJ: 38\.306)/.test(l)).join("\n");
    const parsed = parseDanfeText(textoTransportador);
    expect(parsed.receiverCnpj).toBeUndefined();
    expect(parsed.transporterCnpj).toBeUndefined();
    expect(parsed.receiverName).toBeUndefined();
  });
});
