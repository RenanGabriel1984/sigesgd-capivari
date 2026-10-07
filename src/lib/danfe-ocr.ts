/**
 * Parser de texto extraído via OCR para preencher os campos mais comuns de
 * uma DANFE / DANFE-e / DANFE Modelo 1 / GERAF / DANFE 4 / DANFE 5.
 *
 * Não substitui o XML; apenas alimenta a tela de conferência.
 */

export type DanfeParsed =
  | {
      ok: true;
      nfeNumber?: string;
      series?: string;
      emissionDate?: string;
      accessKey?: string;
      emitterCnpj?: string;
      emitterName?: string;
      emitterPhone?: string;
      emitterEmail?: string;
      emitterAddress?: string;
      emitterCity?: string;
      emitterState?: string;
      emitterPostalCode?: string;
      receiverCnpj?: string;
      receiverName?: string;
      totalValue?: number;
      items: DanfeParsedItem[];
    }
  | { ok: false };

export type DanfeParsedItem = {
  code?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitValue?: number;
  totalValue?: number;
};

/**
 * Extrai dados provisórios da DANFE a partir do texto OCR.
 * Tenta detectar os campos mais comuns de uma DANFE (Modelo 1, GERAF, DANFE 4,
 * DANFE 5) usando expressões regulares no texto.
 *
 * A implementação é heurística; resulta em dados incompletos quando o OCR
 * falha em alguns campos. O usuário pode editar tudo na tela de conferência.
 */
export function parseDanfeText(text: string): DanfeParsed {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

  // 1) Chave de acesso (44 dígitos)
  const accessKeyMatch = normalized.match(/\b(\d{44})\b/);
  const accessKey = accessKeyMatch?.[1] ?? undefined;

  // 2) Número da NF-e (busca padrão "Nº NF: 00000" ou "Nota: 00000" ou "NF-e Nº 00000")
  const nfeNumberMatch = normalized.match(/(?:N[ºo]\.?\s*(?:NF|NF-e)\s*:?\s*|NF-e\s*N[ºo]\.?\s*|N[ºo]\s*Nota\s*(?:Fiscal)?\s*:?\s*)(\d{1,7})/i);
  const nfeNumber = nfeNumberMatch?.[1] ?? undefined;

  // 3) Série (comum em DANFE Modelo 1: "Série: 001" ou "Série 001")
  const seriesMatch = normalized.match(/(?:S[ée]rie\s*:?\s*)(\d{2,3})/i);
  const series = seriesMatch?.[1] ?? undefined;

  // 4) Data de emissão (MM/DD/AAAA ou DD/MM/AAAA ou AAAA-MM-DD)
  const dateMatches = normalized.matchAll(/(?:Data\s*(?:de\s*Emiss[ãa]o)?\s*:?\s*|Emiss[ãa]o\s*:?\s*)(?:(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})|(?:(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})))/gi);
  let emissionDate: string | undefined;
  for (const m of dateMatches) {
    if (m[3]) {
      emissionDate = `${m[3]}-${m[2]?.padStart(2, "0")}-${m[1]?.padStart(2, "0")}`;
    } else if (m[4]) {
      emissionDate = `${m[4]}-${m[5]?.padStart(2, "0")}-${m[6]?.padStart(2, "0")}`;
    }
    if (emissionDate) break;
  }

  // 5) CNPJ do emitente
  const emitterCnpj = extractCnpj(normalized, /(?:CNPJ\s*(?:do\s*)?Emitente\s*:?\s*|(?:emitente|emissor)[^0-9]{0,30})(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
  const emitterCnpjDigits = emitterCnpj ? digitsOnly(emitterCnpj) : undefined;

  // 6) Razão social do emitente (após CNPJ)
  const emitterName = extractAfter(normalized, /(?:Nome\s*(?:de\s*)?(?:Raz[ãa]o\s*)?(?:Social\s*)?(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|Raz[ãa]o\s*Social\s*:?\s*|Empresa\s*:?\s*)/i);

  // 7) Telefone do emitente
  const emitterPhone = extractPhone(normalized, /(?:Telefone|Tel|Fone|Phone|T [eE]l)[^0-9]{0,30}?\(?(\d{2})\)?\s?(\d{4,5}[- ]?\d{4})/i);

  // 8) E-mail do emitente
  const emitterEmail = extractEmail(normalized, /(?:E-mail|Email|e-mail|Mail)[^@\s]{0,30}?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

  // 9) Endereço do emitente
  const emitterAddress = extractAfter(normalized, /(?:Endere[çc]o\s*(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|Endere[çc]o\s*:?\s*)/i);

  // 10) Cidade do emitente
  const emitterCity = extractAfter(normalized, /(?:Cidade\s*(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|Cidade\s*:?\s*)/i);

  // 11) UF do emitente (busca estado por sigla após cidade ou na linha de endereço)
  const emitterState = extractState(normalized);

  // 12) CEP do emitente
  const emitterPostalCode = extractCep(normalized, /(?:CEP\s*(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|CEP\s*:?\s*)/i);

  // 13) CNPJ do destinatário/receptor
  const receiverCnpj = extractCnpj(normalized, /(?:CNPJ\s*(?:do\s*)?(?:Destinat[áa]rio|Respons[áa]vel|Cliente|Receptor)|CNPJ\s*do\s*Cliente\s*:?\s*|(?:destinat[áa]rio|receptor)[^0-9]{0,30})(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
  const receiverCnpjDigits = receiverCnpj ? digitsOnly(receiverCnpj) : undefined;

  // 14) Razão social do destinatário
  const receiverName = extractAfter(normalized, /(?:Nome\s*(?:de\s*)?(?:Raz[ãa]o\s*)?(?:Social\s*)?(?:do\s*)?(?:Destinat[áa]rio|Respons[áa]vel|Cliente|Receptor)|Raz[ãa]o\s*Social\s*do\s*Cliente\s*:?\s*)/i);

  // 15) Valor total da NF (formato R$ XXX.XXX,XX ou Número com vírgula)
  const totalValue = extractTotalValue(normalized);

  // 16) Itens da NF (descrição, quantidade, unidade, valor unitário, valor total, código)
  const items = extractItems(normalized);

  return {
    ok: true,
    nfeNumber,
    series,
    emissionDate,
    accessKey: accessKeyDigits?.[0] === undefined ? accessKey : undefined,
    emitterCnpj: emitterCnpj ?? undefined,
    emitterName: emitterName?.trim() ?? undefined,
    emitterPhone,
    emitterEmail,
    emitterAddress: emitterAddress?.trim() ?? undefined,
    emitterCity: emitterCity?.trim() ?? undefined,
    emitterState,
    emitterPostalCode: emitterPostalCode ?? undefined,
    receiverCnpj: receiverCnpj ?? undefined,
    receiverName: receiverName?.trim() ?? undefined,
    totalValue,
    items: items.length > 0 ? items : [],
  };
}

/**
 * Extrai CNPJ dos dígitos com máscara esperada 00.000.000/0000-00.
 */
function extractCnpj(text: string, prefix?: RegExp): string | undefined {
  const match = (prefix ? text.match(prefix) : null) ?? text.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  return match?.[1]?.trim() ?? undefined;
}

/**
 * Extrai texto após um ponto de referência (ex.: "Razão Social: XYZ S/A").
 */
function extractAfter(text: string, regex: RegExp): string | undefined {
  const match = text.match(regex);
  if (!match) return undefined;
  const start = match.index! + match[0].length;
  const remainder = text.slice(start).trim();
  return remainder.length > 0 ? remainder : undefined;
}

/**
 * Extrai telefone no formato (XX) XXXXX-XXXX ou (XX) 9XXXX-XXXX.
 */
function extractPhone(text: string, prefix?: RegExp): string | undefined {
  const regex = prefix ?? /(?:Telefone|Tel|Fone|Phone|T [eE]l)[^0-9]{0,30}?\(?(\d{2})\)?\s?(\d{4,5}[- ]?\d{4})/i;
  const match = text.match(regex);
  if (!match) return undefined;
  const ddd = match[1] ?? match[2]?.slice(0, 2);
  const body = match[2] ?? match[1]?.slice(2);
  if (!ddd || !body) return undefined;
  return digitsOnly(`${ddd}${body}`);
}

/**
 * Extrai e-mail.
 */
function extractEmail(text: string, prefix?: RegExp): string | undefined {
  const regex = prefix ?? /(?:E-mail|Email|e-mail|Mail)[^@\s]{0,30}?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const match = text.match(regex);
  return match?.[1]?.trim() ?? undefined;
}

/**
 * Extrai CEP.
 */
function extractCep(text: string, prefix?: RegExp): string | undefined {
  const regex = prefix ?? /(?:CEP|Postal)[^0-9]{0,30}?(\d{5})[- ](\d{3})/i;
  const match = text.match(regex);
  if (!match) return undefined;
  return `${match[1]}${match[2]}`;
}

/**
 * Extrai estado (sigla de 2 letras maiúsculas) a partir de texto que contenha
 * o estado ou a cidade+estado no padrão brasileiro.
 */
function extractState(text: string): string | undefined {
  const stateMatch = text.match(/(?:UF|Estado|Estado\s*:?\s*)\s*:?\s*([A-Z]{2})\b/i) ?? text.match(/\b([A-Z]{2})\s*,?\s*(?:CEP|Cidade|Novo|Belo|Paulo|RJ|MG|SP|PE|BA|RS|PR|SC|GO|DF|MS|MT|RO|AC|AM|PA|RR|TO|MA|PI|CE|PB|RN|AL|SE|ES)\b/i);
  if (stateMatch?.[1]) return stateMatch[1].toUpperCase();
  return undefined;
}

/**
 * Extrai valor total da NF.
 */
function extractTotalValue(text: string): number | undefined {
  const matches = text.matchAll(/(?:valor\s*total|Total|Valor\s*NF|NF\s*Total|Valor\s*da\s*NF)[^0-9R$\s]{0,20}?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:[,.]\d{2})?)/gi);
  for (const m of matches) {
    const raw = m[1];
    if (!raw) continue;
    let cleaned = raw.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    if (isFinite(n) && n > 0) return n;
  }
  // fallback: último valor monetário plausível
  const fallbackMatches = [...text.matchAll(/\b(R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:[,.]\d{2})?)\b/g)];
  if (fallbackMatches.length > 0) {
    const last = fallbackMatches[fallbackMatches.length - 1];
    const raw = last[2];
    if (raw) {
      const cleaned = raw.replace(/\./g, "").replace(",", ".");
      const n = parseFloat(cleaned);
      if (isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

/**
 * Extrai itens da NF.
 */
function extractItems(text: string): DanfeParsedItem[] {
  const items: DanfeParsedItem[] = [];
  // Padrão comum: linha item, descrição, qtd, unid, valor unit, valor total
  const lines = text.split("\n").map((l) => l.trim());
  let currentItem: Partial<DanfeParsedItem> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Detecção de início de item por padrões comuns
    if (/^\s*(?:Item|N[ºo]|Qtd|Quantidade|Descri[cç][ãa]|Desc|Produ[cç]to|XProd|C[dD]igesto)/i.test(line) || /\bItem\s*\d+/.test(line)) {
      currentItem = {};
    }

    if (currentItem) {
      // Tenta detectar quantidade
      const qtyMatch = line.match(/(?:Qtd(?:e)?|Quantidade|Quant|Qtde|Qt)[^0-9]{0,15}?(\d{1,7}(?:,\d{3})*(?:[.,]\d{1,2})?)/i);
      if (qtyMatch?.[1]) {
        currentItem.quantity = parseBrazilianNumber(qtyMatch[1]);
      }

      // Tenta detectar unidade (2-4 letras)
      const unitMatch = line.match(/(?:Un(?:idade)?|U\.?|Uni\.?)[^A-Za-z]{0,15}?([A-Za-z]{2,4})\b/i);
      if (unitMatch?.[1]) {
        currentItem.unit = unitMatch[1].toUpperCase();
      }

      // Tenta detectar valor unitário
      const unitValueMatch = line.match(/(?:Valor\s*(?:Unit(?:ário)?)?|V\.?U\.?|V\.?Unit)[^0-9R$\s]{0,15}?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:[.,]\d{2})?)/i);
      if (unitValueMatch?.[1]) {
        currentItem.unitValue = parseBrazilianNumber(unitValueMatch[1]);
      }

      // Tenta detectar valor total
      const totalValueMatch = line.match(/(?:Total|Valor\s*Total|V\.?T\.?|V\.?Total)[^0-9R$\s]{0,15}?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:[.,]\d{2})?)/i);
      if (totalValueMatch?.[1]) {
        currentItem.totalValue = parseBrazilianNumber(totalValueMatch[1]);
      }

      // Tenta detectar código (XXX-XXXX, XXXXXX, etc.)
      const codeMatch = line.match(/(?:C[dD](?:ifigo)?\s*(?:do\s*)?(?:Prod(?:uto)?)?|C[óo]d(?:igo)?|Cód|Cod)[^A-Za-z0-9]{0,15}?([A-Z0-9]{3,15}(?:[- ]?[A-Z0-9]{3,7})?)/i);
      if (codeMatch?.[1]) {
        currentItem.code = codeMatch[1].replace(/[- ]/g, "").toUpperCase();
      }

      // Tenta detectar descrição
      const descMatch = line.match(/(?:Descri[cç][ãa]|Desc|XProd|X[dD]escription|Produto)[^A-Za-z]{0,15}?(.+)/i);
      if (descMatch?.[1]) {
        currentItem.description = descMatch[1].trim();
      } else if (currentItem.description && !/[A-Za-z]{5,}/.test(line) && /^\d/.test(line)) {
        // linha começa com número ou muito curta; pode ser informação extra do item
        // mantém
      }
    }

    // Se encontrou campo de fechamento de item (nova linha com número após item)
    if (currentItem?.quantity && line.match(/^\s*Item\s*\d+/i) && items.length > 0) {
      items.push(currentItem as DanfeParsedItem);
      currentItem = {};
    }
  }

  if (currentItem && currentItem.description) {
    items.push(currentItem as DanfeParsedItem);
  }

  return items;
}

/**
 * Converte número no formato brasileiro (ex.: "1.234,56" ou "1234,56") em número.
 */
function parseBrazilianNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : undefined;
}

const digitsOnly = (s: string): string => s.replace(/\D/g, "");

/**
 * Acess key com 44 dígitos (detectado via OCR).
 */
function accessKeyDigits(accessKey: string | undefined): string | undefined {
  if (!accessKey) return undefined;
  const digits = digitsOnly(accessKey);
  return digits.length === 44 ? digits : undefined;
}
