/**
 * Camada de texto de PDF com tolerância a DANFEs malformadas.
 *
 * Dois problemas REAIS do fluxo de importação (DANFE Incotech, rodada de
 * regressão):
 *
 *  1. O `getTextContent()` do pdfjs devolve os fragmentos em ORDEM DE
 *     INSERÇÃO, não em ordem de leitura. O diálogo antigo colava todos os
 *     fragmentos da página com " " — UMA linha por página — e o parser (que é
 *     orientado a linhas) perdia as razões sociais, as seções e os itens,
 *     mantendo só os campos numéricos. A reconstrução por coordenada Y
 *     (`reconstructPdfTextLines`) restaura as linhas visuais do documento.
 *
 *  2. DANFEs geradas com operadores de conteúdo inválidos (`Tm` com 2 operandos
 *     em vez de 6, texto sem `Tf` de fonte) fazem o pdfjs devolver ZERO itens
 *     de texto — mesmo com uma camada de texto COMPLETA no arquivo. Nesse caso
 *     `extractTextFromPdfStreams` lê os próprios operadores de texto
 *     (`Tj`/`TJ`) dos fluxos de conteúdo do PDF, sem inventar conteúdo: só o
 *     que estiver literalmente no arquivo é devolvido.
 *
 * Nada aqui executa OCR nem decide qual leitura é melhor — a escolha continua
 * sendo do diálogo (`hasUsableTextLayer` + `isDanfeParseBetter`).
 */

/** Fragmento posicional de texto devolvido pelo `getTextContent()` do pdfjs. */
export interface PdfTextPositionItem {
  str: string;
  /** Coordenada X do início do fragmento (transform[4]). */
  x: number;
  /** Coordenada Y da linha de base (transform[5]). */
  y: number;
}

/** Tolerância de baseline (em pontos) para considerar o mesmo fragmento na linha visual. */
const ROW_Y_TOLERANCE = 3;

/**
 * Reconstrói as LINHAS visuais de uma página: agrupa fragmentos por coordenada
 * Y (com tolerância), ordena linhas de cima para baixo e fragmentos da linha
 * da esquerda para a direita. Devolve UMA linha visual por linha de texto.
 */
export function reconstructPdfTextLines(items: readonly PdfTextPositionItem[]): string {
  const rows: Array<{ y: number; parts: Array<{ x: number; s: string }> }> = [];

  for (const item of items) {
    if (!item.str) continue;
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= ROW_Y_TOLERANCE);
    if (!row) {
      row = { y: item.y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x: item.x, s: item.str });
  }

  rows.sort((a, b) => b.y - a.y); // maior Y (topo da página) primeiro
  return rows
    .map((row) =>
      row.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** Decodifica bytes como Latin-1 (mantém 1 byte = 1 caractere para varredura). */
function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** Desescapa um literal de texto PDF (parênteses, barra, octal, quebra de linha). */
function decodePdfStringLiteral(raw: string): string {
  const withoutContinuation = raw.replace(/\\\r?\n/g, "");
  const withOctal = withoutContinuation.replace(/\\([0-7]{1,3})/g, (_match, oct: string) =>
    String.fromCharCode(parseInt(oct, 8) & 0xff),
  );
  const decoded = withOctal
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1");
  // UTF-16BE sem BOM costuma sair como "\0X\0Y…" — detectado e convertido.
  if (decoded.length >= 4 && decoded.charCodeAt(0) === 0 && decoded.charCodeAt(2) === 0) {
    let be = "";
    for (let i = 0; i + 1 < decoded.length; i += 2) {
      be += String.fromCharCode((decoded.charCodeAt(i) << 8) | decoded.charCodeAt(i + 1));
    }
    return be;
  }
  return decoded;
}

const PAREN_STRING = String.raw`\((?:\\[\s\S]|[^\\()])*\)`;

/**
 * Extrai as linhas de texto de um fluxo de conteúdo PDF: um `(...) Tj` por
 * linha e cada `[ (...)... ] TJ` como uma linha consolidada. A ordem do
 * documento é preservada — é a mesma ordem em que o gerador imprimiu.
 */
function extractOperatorsFromContent(content: string): string[] {
  const lines: string[] = [];

  const tjArrayRe = new RegExp(String.raw`\[((?:[^\[\]\\]|\\.)*)\]\s*TJ`, "g");
  const tjRe = new RegExp(PAREN_STRING + String.raw`\s*Tj`, "g");
  const parenRe = new RegExp(PAREN_STRING, "g");

  const masked = new Uint8Array(content.length); // quais trechos já foram consumidos
  let match: RegExpExecArray | null;

  while ((match = tjArrayRe.exec(content)) !== null) {
    let piece = "";
    let inner: RegExpExecArray | null;
    parenRe.lastIndex = 0;
    while ((inner = parenRe.exec(match[1])) !== null) {
      piece += decodePdfStringLiteral(inner[0].slice(1, -1));
    }
    if (piece.trim()) lines.push(piece);
    masked.fill(1, match.index, tjArrayRe.lastIndex);
  }

  while ((match = tjRe.exec(content)) !== null) {
    if (masked[match.index]) continue; // já consumido por um TJ
    const literal = match[0].slice(0, match[0].lastIndexOf(")") + 1);
    const value = decodePdfStringLiteral(literal.slice(1, -1));
    if (value.trim()) lines.push(value);
  }

  return lines;
}

/** Limite de bytes inflados por fluxo (proteção contra payloads absurdos). */
const MAX_FLATE_PAYLOAD = 2_000_000;

/** Comprimento do terminador `endstream`. */
const ENDSTREAM_LENGTH = "endstream".length;

/**
 * Cabeçalho zlib válido — é o que o `FlateDecode` do PDF empacota (RFC 1950):
 * CM = 8 (deflate) no primeiro byte e `(CMF<<8|FLG) % 31 === 0` no FCHECK.
 * Aceita qualquer CINFO (janela 256B…32K), não só o 0x78 mais comum.
 */
function hasZlibHeader(bytes: Uint8Array, offset: number): boolean {
  if (offset + 1 >= bytes.length) return false;
  const cmf = bytes[offset];
  const flg = bytes[offset + 1];
  return (cmf & 0x0f) === 8 && ((cmf << 8) | flg) % 31 === 0;
}

function isStreamBoundaryByte(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20;
}

/**
 * Posição do cabeçalho zlib dentro do fluxo. O EOL/ESPAÇO inicial é do
 * delimitador `stream\n` (geradores escrevem linha em branco antes dos bytes)
 * e nenhum byte inicial desse tipo pode abrir um stream zlib legítimo — CM
 * com baixo nibble 8 nunca é 0x09/0x0A/0x0D/0x20.
 */
function zlibHeaderOffset(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length && isStreamBoundaryByte(bytes[i])) i += 1;
  return hasZlibHeader(bytes, i) ? i : -1;
}

/** Infla um fluxo zlib (FlateDecode) para texto Latin-1; sem suporte nativo, devolve null. */
async function inflateToLatin1(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    const buffer = await new Response(stream).arrayBuffer();
    return bytesToLatin1(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

/**
 * Fallback de leitura: recupera os operadores de texto dos fluxos de conteúdo
 * do PDF (com inflação FlateDecode quando aplicável). Usada SOMENTE quando o
 * pdfjs não devolve texto utilizável — nunca substitui a leitura normal.
 *
 * Cuidados de delimitação (defeito real da DANFE Incotech):
 *  - `end` é o início do terminador `endstream`, e o terminador CONTÉM a
 *    palavra `stream`. Repositionar o cursor em `end` faz a próxima varredura
 *    casar o `stream` de dentro do próprio terminador: o `start` seguinte nasce
 *    no dicionário do próximo objeto, o conteúdo fica com `<< /Length … >>`
 *    na frente, o teste de cabeçalho zlib falha e o fluxo comprimido seguinte
 *    é engolido (0 caracteres). O cursor avança `end + "endstream".length`.
 *  - O keyword `stream` só é aceito precedido de espaço/quebra de linha ou de
 *    `>>` (fim do dicionário) — em `endstream` o caractere anterior é `d`,
 *    então o terminador nunca vira início de fluxo.
 *  - Um fluxo truncado (`endstream` ausente) interrompe a varredura sem
 *    lançar: o que já foi lido é preservado e o chamador segue para o OCR.
 */
export async function extractTextFromPdfStreams(bytes: Uint8Array): Promise<string> {
  const latin = bytesToLatin1(bytes);
  const streamRe = /(?:^|[\s>])stream[ \t]*\r?\n?/g;
  const lines: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = streamRe.exec(latin)) !== null) {
    // `stream` de `endstream` não é início de fluxo (defesa extra ao cursor).
    if (match.index >= 3 && latin.slice(match.index - 3, match.index) === "end") continue;

    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;

    let content = latin.slice(start, end);
    // Cabeçalho zlib (FlateDecode) ⇒ infla antes de varrer; sem suporte nativo
    // ou inflação inválida, mantém os bytes crus (fluxo sem compressão).
    const payload = bytes.subarray(start, Math.min(end, start + MAX_FLATE_PAYLOAD));
    const headerAt = zlibHeaderOffset(payload);
    if (headerAt >= 0) {
      const zstream = headerAt > 0 ? payload.subarray(headerAt) : payload;
      let inflated = await inflateToLatin1(zstream);
      if (inflated === null) {
        // O EOL que separa os bytes do `endstream` não pertence ao stream zlib:
        // os infladores rejeitam "trailing junk". Só então tenta sem o EOL final.
        let tail = zstream.length;
        while (tail > 0 && isStreamBoundaryByte(zstream[tail - 1])) tail -= 1;
        if (tail < zstream.length) inflated = await inflateToLatin1(zstream.subarray(0, tail));
      }
      if (inflated !== null) content = inflated;
    }

    lines.push(...extractOperatorsFromContent(content));
    // `end` marca o INÍCIO do terminador: parar em `end` reencontraria o
    // `stream` interno e faria a próxima fatia engolir o fluxo seguinte.
    streamRe.lastIndex = end + ENDSTREAM_LENGTH;
  }

  return lines.join("\n");
}
