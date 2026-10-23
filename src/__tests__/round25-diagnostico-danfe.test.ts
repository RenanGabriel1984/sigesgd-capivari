/**
 * R25 — “Diagnóstico técnico” da importação DANFE (DanfeImportDialog).
 *
 * O diagnóstico precisa ser montado a partir das etapas REAIS executadas pelo
 * código da tela (não por reimplementação no teste) e precisa representar
 * fielmente o resultado: os itens do diagnóstico são exatamente os itens do
 * parse final — nunca itens inventados — e o texto integral do documento não
 * pode ser embutido (somente trechos limitados).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DanfeReadError,
  extractPdfTextLayer,
  readDanfeFile,
} from "@/components/DanfeImportDialog";
import {
  APP_VERSION,
  DIAGNOSTICO_TRECHO_MAX,
  buildDanfeDiagnostic,
  countTextLines,
  describeDanfeParse,
  trechoDe,
} from "@/lib/danfe-diagnostics";
import { parseDanfeText } from "@/lib/danfe-ocr";

const PDF_FIXTURE = resolve(__dirname, "fixtures", "danfe-incotech-2967-original.pdf");

describe("R25 — diagnóstico técnico da importação (PDF real)", () => {
  it("registra cada etapa real: pdf.js, buffer, fallback, decisão de OCR e parses", async () => {
    const file = new File([readFileSync(PDF_FIXTURE)], "Incotech Company.pdf", {
      type: "application/pdf",
    });

    const { parsed, diagnostic } = await readDanfeFile(file, () => {});

    // ── Etapa 1: camada de texto ────────────────────────────────────────────
    expect(diagnostic.arquivo.nome).toBe("Incotech Company.pdf");
    expect(diagnostic.arquivo.formato).toBe("pdf");
    expect(diagnostic.arquivo.tamanhoBytes).toBeGreaterThan(0);
    // No vitest (node) o worker do pdf.js não monta e o erro real fica registrado
    // no estágio; no navegador/bun o pdf.js executa. O que não pode faltar é o
    // fallback dos fluxos de conteúdo, que é quem recupera o texto deste PDF.
    expect(
      diagnostic.etapas.pdf?.pdfjsExecutado || Boolean(diagnostic.etapas.pdf?.erroPdfjs),
      "pdf.js executado ou erro real registrado",
    ).toBe(true);
    expect(diagnostic.etapas.pdf?.paginas ?? 1, "1 página").toBe(1);
    expect(diagnostic.etapas.pdf?.itensTextoPdfjs ?? 0, "pdf.js devolve 0 itens aqui").toBe(0);
    expect(typeof diagnostic.etapas.pdf?.bufferDisponivelAposPdfjs).toBe("boolean");
    expect(diagnostic.etapas.pdf?.fallbackExecutado, "fallback dos fluxos executado").toBe(true);
    expect(diagnostic.etapas.pdf?.fallbackCaracteres ?? 0).toBeGreaterThan(1000);
    expect(diagnostic.etapas.pdf?.fallbackLinhas ?? 0).toBeGreaterThan(50);
    expect(diagnostic.etapas.pdf?.fonteDoTexto).toBe("fluxos-de-conteudo");

    // ── Decisão de OCR e fontes ─────────────────────────────────────────────
    expect(diagnostic.etapas.decisaoOcr.executado, "camada boa ⇒ sem OCR").toBe(false);
    expect(diagnostic.etapas.textoUtilizadoPor).toBe("camada");
    const fonteCamada = diagnostic.etapas.fontesTexto[0];
    expect(fonteCamada.caracteres).toBeGreaterThan(1000);
    expect(fonteCamada.linhas).toBeGreaterThan(50);
    expect(fonteCamada.trecho.length).toBeLessThanOrEqual(DIAGNOSTICO_TRECHO_MAX);

    // ── Parses antes e depois da comparação (sem descartar alternativas) ───
    expect(diagnostic.parses.camada.executado).toBe(true);
    expect(diagnostic.parses.camada.camposIdentificados).toBeGreaterThanOrEqual(9);
    expect(diagnostic.parses.ocr.executado).toBe(true);
    expect(diagnostic.parses.escolhido).toBe("camada");

    // ── Resultado final = o que a tela exibe ───────────────────────────────
    expect(diagnostic.resultadoFinal.camposIdentificados).toBeGreaterThanOrEqual(9);
    expect(diagnostic.resultadoFinal.camposAusentes).toEqual(["CNPJ expedidor"]);
    expect(diagnostic.estadoInterface.itensNoObjetoFinal).toBe(parsed.items.length);
    expect(diagnostic.resultadoFinal.itensDetectados).toBe(parsed.items.length);
    expect(diagnostic.resultadoFinal.itens).toHaveLength(1);
    expect(diagnostic.resultadoFinal.itens[0].codigo).toContain("231071");
    expect(diagnostic.resultadoFinal.itens[0].descricao).toContain("KIT TECLADO E MOUSE");

    // ── Financeiro: total da nota × soma dos itens ──────────────────────────
    expect(diagnostic.resultadoFinal.valorTotalNota).toBe(1323.5);
    expect(diagnostic.resultadoFinal.somaDosItens).toBe(1323.5);
    expect(diagnostic.resultadoFinal.conferenciaTotalVsItens).toBe("coerente");

    // ── Pendências com motivo exato ────────────────────────────────────────
    expect(diagnostic.pendencias.map((p) => p.campo)).toEqual(["issuerCnpj"]);
    expect(diagnostic.pendencias[0].motivo.length).toBeGreaterThan(10);

    // ── Data: a chave nunca valida o dia ───────────────────────────────────
    expect(diagnostic.dataDeEmissao.valor).toBe("2026-09-28");
    expect(diagnostic.dataDeEmissao.diaValidadoPelaChave).toBe(false);
    expect(diagnostic.dataDeEmissao.chaveConfereApenasAnoMes).toBe(true);

    // ── Identificação da execução/build ────────────────────────────────────
    expect(diagnostic.identificacao.versaoApp).toBe(APP_VERSION);
    expect(diagnostic.identificacao.diagnosticoId).toMatch(/^danfe-/);
    expect(diagnostic.erros).toEqual([]);
  });

  it("o JSON do diagnóstico não embute o texto integral do documento", async () => {
    const bytes = readFileSync(PDF_FIXTURE);
    const file = new File([bytes], "Incotech Company.pdf", { type: "application/pdf" });

    const { text } = await extractPdfTextLayer(file);
    const { diagnostic } = await readDanfeFile(file, () => {});
    const json = JSON.stringify(diagnostic);

    expect(text.length).toBeGreaterThan(DIAGNOSTICO_TRECHO_MAX);
    expect(json, "texto integral ausente do JSON").not.toContain(text);
    for (const fonte of diagnostic.etapas.fontesTexto) {
      expect(fonte.trecho.length).toBeLessThanOrEqual(DIAGNOSTICO_TRECHO_MAX);
    }
    // Binário do arquivo também fica de fora.
    expect(json).not.toContain("%PDF-1.4");
  });

  it("falha na leitura preserva o diagnóstico parcial com o erro real", async () => {
    const broken = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "quebrado.pdf", {
      type: "application/pdf",
    });

    let diagnostic: unknown = null;
    await readDanfeFile(broken, () => {}).catch((err: unknown) => {
      if (err instanceof DanfeReadError) diagnostic = err.diagnostic;
    });

    expect(diagnostic, "DanfeReadError carrega o diagnóstico").not.toBeNull();
    const diag = diagnostic as Awaited<ReturnType<typeof readDanfeFile>>["diagnostic"];
    expect(diag.erros.length, "erro real registrado, sem máscara").toBeGreaterThan(0);
    expect(diag.erros[0].length, "mensagem real preservada").toBeGreaterThan(10);
    // Zero itens: nada é atribuído ao parse.
    expect(diag.resultadoFinal.itensDetectados).toBe(0);
    expect(diag.resultadoFinal.itens).toEqual([]);
    expect(diag.estadoInterface.itensNoObjetoFinal).toBe(0);
    expect(diag.resultadoFinal.conferenciaTotalVsItens).toBe("sem-itens");
  });
});

describe("R25 — montador puro do diagnóstico", () => {
  it("parse sem itens nunca recebe itens inexistentes", () => {
    const vazio = parseDanfeText("");
    const resumo = describeDanfeParse("vazio", vazio);
    expect(resumo.itensDetectados).toBe(0);
    expect(resumo.itens).toEqual([]);
    expect(resumo.camposEncontrados).toEqual([]);

    const diagnostic = buildDanfeDiagnostic({
      identificacao: {
        diagnosticoId: "danfe-teste",
        geradoEm: "2026-01-01T00:00:00.000Z",
        versaoApp: APP_VERSION,
        modo: "producao",
        bundleEntrada: null,
        userAgent: null,
      },
      arquivo: { nome: "vazio.pdf", tipo: "application/pdf", tamanhoBytes: 0, formato: "pdf" },
      decisaoOcr: { executado: true, motivo: "sem camada" },
      fontesTexto: [],
      textoUtilizadoPor: "nenhuma",
      final: vazio,
      estadoInterface: { transformacoes: ["nenhuma"] },
      erros: [],
    });

    expect(diagnostic.resultadoFinal.itens).toEqual([]);
    expect(diagnostic.resultadoFinal.conferenciaTotalVsItens).toBe("sem-itens");
    expect(diagnostic.pendencias.length, "todos os campos pendentes listados").toBe(10);
  });

  it("describeDanfeParse de parse não executado mantém tudo ausente", () => {
    const resumo = describeDanfeParse("não executado", undefined);
    expect(resumo.executado).toBe(false);
    expect(resumo.camposIdentificados).toBe(0);
    expect(resumo.camposAusentes.length).toBe(10);
  });

  it("trechoDe limita o contexto e countTextLines conta linhas reais", () => {
    const longo = "x".repeat(DIAGNOSTICO_TRECHO_MAX + 50);
    const { trecho, trechoTruncado } = trechoDe(longo);
    expect(trecho.length).toBe(DIAGNOSTICO_TRECHO_MAX);
    expect(trechoTruncado).toBe(true);
    expect(countTextLines("a\nb\nc")).toBe(3);
    expect(countTextLines("")).toBe(0);
  });
});
