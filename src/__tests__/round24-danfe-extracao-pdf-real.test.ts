/**
 * R24 — regressão do FLUXO REAL de extração do diálogo (DanfeImportDialog).
 *
 * Defeito comprovado (rodada anterior): o pdf.js TRANSFERE o ArrayBuffer para
 * o worker e o buffer original fica desanexado (byteLength 0). O fallback
 * `extractTextFromPdfStreams` lia esse buffer vazio, devolvia 0 caracteres e a
 * camada de texto do PDF era descartada — a importação caía toda no OCR, que
 * devolvia só os campos numéricos: 6/10, razões sociais em branco e zero
 * itens, exatamente o sintoma reportado na tela.
 *
 * Por isso o teste importa a função EXPORTADA do próprio diálogo (não uma
 * reimplementação). Ele valida o caminho de produção com o pdf.js REAL,
 * ponta a ponta: camada → rachuras → parse → resumo da tela.
 *
 * O cenário de desanexo do buffer (que em node o pdf.js daqui NÃO provoca —
 * por isso os testes antigos passavam enquanto a tela mostrava 6/10) está
 * coberto de forma determinística em round24b-danfe-buffer-desanexado.test.ts,
 * com um double do pdf.js que faz o que o worker do navegador faz.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractPdfTextLayer } from "@/components/DanfeImportDialog";
import { parseDanfeText, danfeFieldSummary } from "@/lib/danfe-ocr";

const PDF_FIXTURE = resolve(__dirname, "fixtures", "danfe-incotech-2967-original.pdf");

describe("R24 — extração real do diálogo sobre o PDF da DANFE Incotech", () => {
  it("lê a camada mesmo após o pdf.js desanexar o ArrayBuffer", async () => {
    const bytes = readFileSync(PDF_FIXTURE);
    const file = new File([bytes], "Incotech Company.pdf", { type: "application/pdf" });

    const text = await extractPdfTextLayer(file);

    // Camada recuperada (antes da correção: 0 caracteres — buffer desanexado).
    expect(text.length, "camada de texto não pode ser descartada").toBeGreaterThan(100);
    expect(text, "emitente no texto").toMatch(/INCOTECH/i);
    expect(text, "destinatário no texto").toMatch(/MUNICIPIO DE CAPIVARI/i);
    expect(text, "descrição do item no texto").toMatch(/KIT TECLADO/i);

    const parsed = parseDanfeText(text);
    const summary = danfeFieldSummary(parsed);

    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.emitterCnpj).toBe("22.816.315/0001-44");
    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(parsed.receiverCnpj).toBe("44.723.674/0001-90");
    expect(parsed.nfeNumber).toBe("2967");
    expect(parsed.series).toBe("001");
    expect(parsed.emissionDate).toBe("2026-09-28");
    expect(parsed.accessKey).toBe("42260922816315000144550010000029671515440064");

    expect(parsed.items, "um item identificado").toHaveLength(1);
    expect(parsed.items[0].code).toContain("231071");
    expect(parsed.items[0].description).toContain("KIT TECLADO E MOUSE USB SLIM CHOCO");

    // CNPJ do expedidor não consta do documento: continua pendente (não inventado).
    expect(summary.found).toBeGreaterThanOrEqual(9);
    expect(summary.missing, "só o expedidor segue pendente").toEqual(["CNPJ expedidor"]);
  });

  it("um arquivo PDF ilegível não lança: devolve camada vazia para seguir ao OCR", async () => {
    const broken = new File([new Uint8Array([1, 2, 3, 4])], "quebrado.pdf", {
      type: "application/pdf",
    });
    await expect(extractPdfTextLayer(broken)).resolves.toBe("");
  });
});
