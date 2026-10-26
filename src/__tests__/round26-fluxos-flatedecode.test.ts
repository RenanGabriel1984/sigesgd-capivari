/**
 * R26 — varredura dos fluxos de conteúdo: cursor do terminador e FlateDecode.
 *
 * Defeito real (diagnóstico da DANFE Incotech): `extractTextFromPdfStreams`
 * reposicionava o cursor da busca em `end`, que é o INÍCIO de `endstream`.
 * Como o terminador CONTÉM a palavra `stream`, a próxima varredura casava o
 * `stream` de dentro dele: o `start` seguinte nascia no dicionário do objeto
 * seguinte, a fatia ficava com `<< /Length … /Filter /FlateDecode >>` na
 * frente, o teste de cabeçalho zlib falhava e o fluxo comprimido seguinte era
 * engolido — o fallback devolvia 0 caracteres / 0 linhas e a importação caía
 * inteira no OCR (6/10 campos, 0 itens).
 *
 * O cenário abaixo falha com o cursor antigo e passa com o corrigido: o
 * PRIMEIRO fluxo não tem texto legível e o SEGUNDO tem `Tj` comprimido com
 * zlib/FlateDecode. Nenhum dado do documento é embutido no extrator — o texto
 * recuperado é literalmente o que está comprimido no arquivo montado aqui.
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";

import { extractTextFromPdfStreams } from "@/lib/pdf-text-layer";

/** Primeiro fluxo: desenho puro, sem nenhum operador de texto. */
const STREAM_1 = "q 1 0 0 1 0 0 cm 40 0 0 40 0 0 cm /Im0 Do Q";

/** Segundo fluxo: texto real que só existe DENTRO do zlib. */
const STREAM_2_TEXT = [
  "BT",
  "/F1 12 Tf",
  "72 760 Td",
  "(INCOTECH COMPANY LTDA) Tj",
  "0 -16 Td",
  "(MUNICIPIO DE CAPIVARI) Tj",
  "0 -16 Td",
  "(231071 KIT TECLADO E MOUSE USB SLIM CHOCO) Tj",
  "0 -16 Td",
  "[ (25,0000 52,94 1.323,50) ] TJ",
  "ET",
].join("\n");

/** Linhas esperadas — o texto de cada operador `Tj`/`TJ` do segundo fluxo. */
const EXPECTED_LINES = [
  "INCOTECH COMPANY LTDA",
  "MUNICIPIO DE CAPIVARI",
  "231071 KIT TECLADO E MOUSE USB SLIM CHOCO",
  "25,0000 52,94 1.323,50",
];

function buildPdfWithTwoStreams(eol: string, blankLineAfterStream: boolean): Uint8Array {
  const flate = deflateSync(Buffer.from(STREAM_2_TEXT, "latin1"));
  const head =
    [
      "%PDF-1.4",
      "1 0 obj",
      `<< /Length ${STREAM_1.length} >>`,
      "stream",
      STREAM_1,
      "endstream",
      "endobj",
      "2 0 obj",
      `<< /Length ${flate.length} /Filter /FlateDecode >>`,
      "stream",
    ].join(eol) +
    eol +
    (blankLineAfterStream ? eol : "");
  const tail = eol + ["endstream", "endobj", "trailer", "<< >>", "%%EOF", ""].join(eol);

  return Buffer.concat([Buffer.from(head, "latin1"), flate, Buffer.from(tail, "latin1")]);
}

describe("R26 — varredura dos fluxos PDF (cursor do terminador + FlateDecode)", () => {
  it("o fluxo comprimido seguinte não é engolido: o texto Tj do 2º fluxo é recuperado", async () => {
    const bytes = buildPdfWithTwoStreams("\n", false);
    const text = await extractTextFromPdfStreams(bytes);

    // Sem a correção o extrator devolve vazio: o cursor parava em `end` e a
    // varredura seguinte casava o `stream` de dentro de `endstream`.
    expect(text.trim(), "fluxo comprimido não pode ser engolido").not.toBe("");
    const lines = text.split("\n");
    expect(lines).toHaveLength(EXPECTED_LINES.length);
    for (const expected of EXPECTED_LINES) expect(lines).toContain(expected);

    // O primeiro fluxo não tem texto legível e não pode vazar para a saída.
    expect(text).not.toContain("/Im0");

    // O texto só existe DENTRO do zlib: não está cru no arquivo.
    expect(Buffer.from(bytes).includes(Buffer.from("INCOTECH COMPANY LTDA", "latin1"))).toBe(
      false,
    );
  });

  it("delimitação aceita EOL do gerador: CRLF, linha em branco e EOL antes de endstream", async () => {
    const bytes = buildPdfWithTwoStreams("\r\n", true);
    const text = await extractTextFromPdfStreams(bytes);

    const lines = text.split("\n");
    expect(lines).toHaveLength(EXPECTED_LINES.length);
    for (const expected of EXPECTED_LINES) expect(lines).toContain(expected);
    expect(text).not.toContain("/Im0");
  });
});
