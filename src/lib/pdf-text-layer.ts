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
 */
export async function extractTextFromPdfStreams(bytes: Uint8Array): Promise<string> {
  const latin = bytesToLatin1(bytes);
  const streamRe = /stream[ \t]*\r?\n?/g;
  const lines: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = streamRe.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;

    let content = latin.slice(start, end);
    // Cabeçalho zlib (0x78) ⇒ fluxo comprimido — infla antes de varrer.
    if (content.length > 2 && content.charCodeAt(0) === 0x78) {
      const inflated = await inflateToLatin1(
        bytes.subarray(start, Math.min(end, start + 2_000_000)),
      );
      if (inflated !== null) content = inflated;
    }

    lines.push(...extractOperatorsFromContent(content));
    streamRe.lastIndex = end;
  }

  return lines.join("\n");
}
