/** @license University of São Paulo (CC-BY-SA 4.0) — modifications allowed under LGPL-3.0-or-later. */

// Utilities we reuse from the built browser bundle.

function isValidDanfeItemCandidate(line: string): boolean {
  // Tenta detectar colunas típicas de uma DANFE Modelo 1 / GERAF:
  //   nItem  cProd  xProd  qCom   uCom   vUnCom  vProd
  // Linhas que são cabeçalho ou rodapé da tabela usam nomes normalizados
  // em maiúsculas; rejeitamos explicitamente essas strings.
  const upper = line.toUpperCase();
  // Sem âncoras de início — cabeçalho pode ser "NÍVEL  1  OTA ..." em OCR ruim.
  if (upper.includes("DESCRICAO DOS PRODUTOS") || upper.includes("DESCRICAO DOS SERVICOS")) return false;
  if (upper.includes("DESCRICAO") && upper.includes("SERVICOS")) return false;
  if (upper.includes("QUANT") && upper.includes("VALOR") && upper.includes("UNITARIO")) return false;
  if (upper.includes("NCM") && upper.includes("C.S.T.")) return false;
  if (upper.includes("ALIQ") && (upper.includes("ICMS") || upper.includes("IPI"))) return false;
  if (upper.includes("NOME DO PRODUTO") || upper.includes("DESCRIÇÃO DO PRODUTO")) return false;
  if (upper.includes("NOME DO CLIENTE") || upper.includes("NOME DO DESTINATÁRIO")) return false;
  if (upper.includes("HELLO WORLD") || upper.includes("PARA NOTA FISCAL Nº")) return false;
  if (upper.includes("REMETENTE") && upper.includes("CNPJ")) return false;

  // Não queremos ler qualificadores de campo: textos curtos e puramente
  // numéricos também são descartados (isso evita confundir CEP/chave com itens).
  if (line.length < 8) return false;

  // Número de série 1..4 dígitos; produto com código, descrição, qtd, unid.
  // Permitimos pequenos vazios entre colunas.
  const DANFE_ROW =
    /^\s*(?:\|\s*)?(\d{1,4})\s+([0-9A-Z]{2,16})\s+(.{3,60}?)\s+(\d+(?:[.,]\d{1,4})?)\s+([A-Za-z]{2,4})\s+(\d{1,3}(?:[.,]\d{3})*[.,]\d{2,4})(?:\s+(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}))?\s*(?:\|\s*)?$/i;

  const m = line.match(DANFE_ROW);
  if (!m) return false;
  const [, ?seq, code, desc, qty, unit, unitValue] = m;

  // Validamos: código + descrição com maiúsculas + quantidade comunicável.
  const descricaoOk      = desc && desc.trim().length >= 3 && /[A-ZÀ-Ú]{3,}/i.test(desc);
  const quantidadeValida = qty && /^\d+(?:,\d{1,4})?$/.test(qty) && parseFloat(qty.replace(",", ".")) > 0;
  const unidadePlausivel = unit && /^[A-ZÀ-Ú]{2,4}$/i.test(unit);
  const valorUnitarioOk  = unitValue && /^\d+(?:\.\d{3})*,\d{1,4}$/.test(unitValue) && parseFloat(unitValue.replace(/\./g, "").replace(",", ".")) > 0;

  // Um produto “confiável” tem descrição + qtd + unidade + valor unitário
  // (ou, ao menos, três dos quatro). Relaxamos quando o valor total
  // estiver aparente na mesma linha.
  if (!descricaoOk || !quantidadeValida || !unidadePlausivel) {
    // Permite sem valor unitário somente se houver valor total na linha.
    const vprod = m[7] ?? "";
    if (vprod && !valorUnitarioOk) {
      // Só confia se a unidade estiver presente e a descrição for razoável.
      if (!unidadePlausivel || !descricaoOk) return false;
      // quantidade ok? se não, não aceitamos.
      if (!quantidadeValida) return false;
      return true;
    }
    return false;
  }
  return true;
}

function isAccessKeyStructure44(digits: string): boolean {
  if (digits.length !== 44) return false;
  const uf2  = digits.slice(0, 2);
  const month = parseInt(digits.slice(4,6),10);
  const model = digits.slice(20,22);
  const uf_ok  = ["11","12","13","14","15","16","17","21","22","23","24","25","26","27","28","29","31","32","33","35","41","42","43","50","51","52","53","91"].includes(uf2);
  const month_ok = month >= 1 && month <= 12;
  const model_ok = model === "55" || model === "65";
  return uf_ok && month_ok && model_ok;
}

function checkAccessKeyValidation(digits: string): boolean {
  return isAccessKeyStructure44(digits);
}

function validateAccessKey44(digits: string): boolean {
  return checkAccessKeyValidation(digits);
}

// ─── Nós reconstruímos parte do DOM para montar a imagem e enviar ao OCR ───

function getCanvasFromImageBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const w = Math.max(128, bitmap.width);
  const h = Math.max(128, bitmap.height);
  const cvs = document.createElement("canvas");
  cvs.width  = Math.round(w);
  cvs.height = Math.round(h);
  const ctx = cvs.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality  = "high";
    ctx.drawImage(bitmap, 0, 0, cvs.width, cvs.height);
  }
  return cvs;
}

async function preprocessImageForCanvas(canvas: HTMLCanvasElement): Promise<{ canvas: HTMLCanvasElement; imageData: ImageData }> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
  const processed = new Uint8ClampedArray(imageData.data.length);
  for (let i=0;i<imageData.data.length;i+=4) {
    const r=imageData.data[i], g=imageData.data[i+1], b=imageData.data[i+2];
    const gray = 0.299*r + 0.587*g + 0.114*b;
    processed[i]   = gray;
    processed[i+1] = gray;
    processed[i+2] = gray;
    processed[i+3] = imageData.data[i+3];
  }
  const out = new ImageData(processed, canvas.width, canvas.height);
  const outCanvas = document.createElement("canvas");
  outCanvas.width  = canvas.width;
  outCanvas.height = canvas.height;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas context unavailable");
  outCtx.putImageData(out, 0, 0);
  return { canvas: outCanvas, imageData: out };
}

async function renderPdfPageToCanvas(pdfPage: PDFPageProxy, opts: { width?: number; height?: number }): Promise<HTMLCanvasElement> {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const width  = opts.width  ?? viewport.width;
  const height = opts.height ?? viewport.height;
  const cvs = document.createElement("canvas");
  cvs.width  = Math.round(width);
  cvs.height = Math.round(height);
  const ctx = cvs.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,cvs.width,cvs.height);
  await pdfPage.render({
    canvasContext: ctx,
    viewport: new pdfjsLib.PageViewport({ width, height, scale: 1, rotation: 0 }),
  }).promise;
  return cvs;
}

export async function extractKeyFromPdfPage(worker: TesseractWorker, page: PDFPageProxy): Promise<string | null> {
  const canvas = await renderPdfPageToCanvas(page, { width: 1200, height: 1200 });
  const { canvas: processed, imageData } = await preprocessImageForCanvas(canvas);

  const candidates: string[] = [];
  let mostCommonlyLen44 = "";

  for (let y = 0; y <= processed.height - 24; y += 12) {
    for (let x = 0; x <= processed.width - 24; x += 12) {
      const regionCanvas = document.createElement("canvas");
      regionCanvas.width  = 24;
      regionCanvas.height = 24;
      const rctx = regionCanvas.getContext("2d");
      if (rctx) rctx.drawImage(processed, x, y, 24, 24, 0, 0, 24, 24);
      const blob = await new Promise<Blob | null>(r => regionCanvas.toBlob(r, "image/png"));
      if (!blob) continue;
      const regionFile = new File([blob], "region-key.png", { type: "image/png" });
      const ocrResult = await worker.recognize(regionFile);
      const text = ocrResult.data.text.replace(/\s+/g, "");
      if (text.length === 44) candidates.push(text);
      if (text.length === 44 && !mostCommonlyLen44) mostCommonlyLen44 = text;
    }
  }

  // Se achamos pelo menos um candidato de 44 dígitos, validamos a estrutura
  // (UF, mês, modelo 55/65 — que é o padrão da NF-e).
  const filtered = candidates.filter(t => isAccessKeyStructure44(t));
  if (filtered.length > 0) {
    // Desempate simples por frequência — normalmente só aparece um.
    const byFreq = new Map<string, number>();
    for (const t of filtered) byFreq.set(t, (byFreq.get(t) ?? 0) + 1);
    const best = [...byFreq.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))[0];
    if (best) return best[0];
  }

  return null;
}

export async function extractKeyFromPdfRegions(worker: TesseractWorker, pdfPage: PDFPageProxy): Promise<string | null> {
  // Header region (top 15-20% of the page):
  const headerCanvas = await renderPdfPageToCanvas(pdfPage, { width: 900, height: 160 });
  const { canvas: headerProcessed } = await preprocessImageForCanvas(headerCanvas);
  const regionFile = await new Promise<File>(r => headerProcessed.toBlob(r, "image/png").then(blob => {
    if (!blob) throw new Error("Blob was null");
    return r(new File([blob], "header-key.png", { type: "image/png" }));
  }));
  const ocrResult = await worker.recognize(regionFile);
  const headerText = ocrResult.data.text;
  const keyInHeader = extractAccessKey44(headerText);
  if (keyInHeader) return keyInHeader;

  const cropSize = 220;
  for (let y = 0; y <= pdfPage.getViewport({scale:1}).height - cropSize; y += 32) {
    for (let x = 0; x <= pdfPage.getViewport({scale:1}).width - cropSize; x += 32) {
      const region = await renderPdfPageToCanvas(pdfPage, { width: cropSize, height: cropSize });
      // Offsets locais para recorte na região:
      const ctx = region.getContext("2d");
      if (!ctx) continue;
      const sx = x, sy = y;
      if (sx + cropSize > region.width || sy + cropSize > region.height) continue;
      const cropped = document.createElement("canvas");
      cropped.width  = cropSize;
      cropped.height = cropSize;
      const cctx = cropped.getContext("2d");
      if (cctx) cctx.drawImage(region, sx, sy, cropSize, cropSize, 0, 0, cropSize, cropSize);
      const{ canvas: croppedP } = await preprocessImageForCanvas(cropped);
      const blob = await new Promise<Blob | null>(r => croppedP.toBlob(r, "image/png"));
      if (!blob) continue;
      const file = new File([blob], "region-key.png", { type: "image/png" });
      const ocrRes = await worker.recognize(file);
      const text = ocrRes.data.text.replace(/\s+/g, "");
      const key = extractAccessKey44(text);
      if (key) return key;
    }
  }

  return null;
}

function extractAccessKey44(text: string): string | null {
  // remove espaços, pontuação, e inteligentemente resolve O→0 S→5 B→8 I→1
  const gcr = (s: string): string => {
    let out = "";
    for (const ch of s) {
      if ("OoDdIiLlZzSsGgBbQq".includes(ch)) {
        const map: Record<string, string> = { O:"0", o:"0", D:"0", d:"0", I:"1", i:"1", L:"1", l:"1", Z:"2", z:"2", S:"5", s:"5", G:"6", g:"6", B:"8", b:"8", Q:"0", q:"0" };
        out += map[ch] ?? ch;
      } else {
        out += ch;
      }
    }
    return out.replace(/[^\d]/g, "");
  };

  const digits = gcr(text);
  if (digits.length === 44) {
    if (isAccessKeyStructure44(digits)) return digits;
  }

  // Tenta 11 grupos de 4 dígitos (ex.: "4226 0922 8163 1500 0144 ...")
  const groups = text.match(/\d{4}(?:\s|$)/g);
  if (groups) {
    let buffer = "";
    for (const g of groups) {
      buffer += g.replace(/\s/g, "");
      if (buffer.length === 44) {
        if (isAccessKeyStructure44(buffer)) return buffer;
      }
    }
  }

  // Tenta extrair o cabeçalho da DANFE com uma expressão para sequência de
  // 44 dígitos isolada (provavelmente após "CHAVE DE ACESSO" ou "Nº ...")
  const regexIsolated = /\b\d{44}\b/;
  const isolatedMatch = text.match(regexIsolated);
  if (isolatedMatch) {
    const raw = isolatedMatch[0];
    const d = gcr(raw);
    if (d.length === 44 && isAccessKeyStructure44(d)) return d;
  }

  return null;
}


// ─── Classe auxiliar para rodar OCR em PDF inteiro, pagina a pagina ───

export async function runOcrOnPdfPages(pdfDoc: PDFDocumentProxy, worker: TesseractWorker, maxPages: number = 4): Promise<{ textsByPage: string[], accessKey: string | null }> {
  const pagesCount = Math.min(pdfDoc.numPages, maxPages);
  const textsByPage: string[] = [];

  let accessKey: string | null = null;
  for (let n = 1; n <= pagesCount; n++) {
    const page = await pdfDoc.getPage(n);
    const canvas = await renderPdfPageToCanvas(page, { width: 1200, height: 1200 });
    const { canvas: processed } = await preprocessImageForCanvas(canvas);
    const blob = await new Promise<Blob | null>(r => processed.toBlob(r, "image/png"));
    if (!blob) continue;
    const file = new File([blob], `page-${n}.png`, { type: "image/png" });
    const result = await worker.recognize(file);
    textsByPage.push(result.data.text);
    if (!accessKey) {
      const key = extractAccessKey44(result.data.text);
      if (key) accessKey = key;
    }
  }

  return { textsByPage, accessKey };
}


// ─── Função pública exportada (usada no diálogo) ───

export async function signatureRegionOcr(worker: TesseractWorker, pdfPage: PDFPageProxy): Promise<string | null> {
  const key = await extractKeyFromPdfRegions(worker, pdfPage);
  return key;
}
