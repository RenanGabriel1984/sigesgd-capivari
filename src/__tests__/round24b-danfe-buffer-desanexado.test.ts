/**
 * R24b — regressão DETERMÍSTICA do defeito que só aparece no navegador.
 *
 * No navegador (e em runtime com worker real) o pdf.js TRANSFERE o ArrayBuffer
 * recebido para o worker: o buffer do chamador fica desanexado (byteLength 0).
 * No vitest/node o pdf.js usa fake-worker e NÃO desanexa — por isso os testes
 * antigos passavam enquanto a tela real mostrava 6/10 com razões sociais em
 * branco e zero itens.
 *
 * Aqui o pdf.js é trocado por um double que faz exatamente o que o worker real
 * faz: desanexa o buffer recebido e (como neste PDF de operadores malformados)
 * devolve ZERO itens de texto. O diálogo continua obrigado a devolver a camada
 * completa — lida dos fluxos de conteúdo a partir da cópia feita ANTES da
 * entrega ao pdf.js.
 *
 * Sem este mock o teste passaria com o código quebrado: em node o pdf.js não
 * desanexa nada, e a cópia de bytes feita pelo próprio teste não sofre o efeito.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("pdfjs-dist", () => {
  /** Transfere o ArrayBuffer para "outro lugar" — o efeito observável é o
   *  desanexo do buffer do chamador, igual ao postMessage com transfer list. */
  const detach = (data: ArrayBuffer | Uint8Array) => {
    const buffer = data instanceof Uint8Array ? data.buffer : data;
    try {
      structuredClone(buffer, { transfer: [buffer] });
    } catch {
      // buffer já desanexado — o efeito desejado já aconteceu
    }
  };

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: (params: { data: ArrayBuffer | Uint8Array }) => {
      detach(params.data); // o worker real consome o buffer imediatamente
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [] }), // PDF malformado: sem itens
          }),
        }),
      };
    },
  };
});

import { extractPdfTextLayer } from "@/components/DanfeImportDialog";
import { parseDanfeText, danfeFieldSummary } from "@/lib/danfe-ocr";

const PDF_FIXTURE = resolve(__dirname, "fixtures", "danfe-incotech-2967-original.pdf");

describe("R24b — buffer desanexado pelo pdf.js", () => {
  it("a camada continua sendo devolvida mesmo com o buffer do chamador desanexado", async () => {
    const file = new File([readFileSync(PDF_FIXTURE)], "Incotech Company.pdf", {
      type: "application/pdf",
    });

    const text = await extractPdfTextLayer(file);

    expect(text.length, "camada não pode ser perdida pelo desanexo").toBeGreaterThan(100);
    expect(text).toMatch(/INCOTECH/i);
    expect(text).toMatch(/MUNICIPIO DE CAPIVARI/i);
    expect(text).toMatch(/KIT TECLADO/i);

    const parsed = parseDanfeText(text);
    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
    expect(parsed.receiverName).toBe("MUNICIPIO DE CAPIVARI");
    expect(parsed.items).toHaveLength(1);
    expect(danfeFieldSummary(parsed).found).toBeGreaterThanOrEqual(9);
  });

  it("PDF ilegível com buffer desanexado devolve vazio (seguir para OCR), sem lançar", async () => {
    const broken = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "quebrado.pdf", {
      type: "application/pdf",
    });
    await expect(extractPdfTextLayer(broken)).resolves.toBe("");
  });
});
