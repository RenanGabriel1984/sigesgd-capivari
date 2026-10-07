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
  // Preserva as QUEBRAS DE LINHA (a leitura de itens é linha a linha) e
  // apenas normaliza espaços duplicados dentro de cada linha.
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // 1) Chave de acesso (44 dígitos) — contínua OU agrupada em 11 grupos de 4
  //    (a DANFE impressa costuma imprimir a chave em grupos de 4 dígitos).
  const accessKey = extractAccessKey(normalized);

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

  // 5) CNPJ do emitente (com ou sem máscara — o OCR pode perder a pontuação)
  const emitterCnpj = extractCnpj(normalized, /(?:CNPJ\s*(?:do\s*)?Emitente\s*:?\s*|CNPJ\s*:?\s*|(?:emitente|emissor)[^0-9]{0,30})(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14})/i);

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

  // 13) CNPJ do destinatário/receptor — rótulo específico; sem rótulo,
  //     considera apenas um SEGUNDO CNPJ distinto do documento (nunca repete
  //     o CNPJ do emitente como se fosse do destinatário).
  const receiverCnpj = extractReceiverCnpj(normalized, emitterCnpj);

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
    accessKey,
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
 * Extrai a chave de acesso de 44 dígitos, tolerando o formato agrupado em
 * 11 grupos de 4 dígitos usado pelas DANFEs impressas (ex.:
 * "3524 0622 8163 1500 0144 ..."). O valor devolvido é SEMPRE só dígitos.
 */
function extractAccessKey(text: string): string | undefined {
  // a) 44 dígitos contíguos
  const contiguous = text.match(/\b(\d{44})\b/);
  if (contiguous?.[1]) return contiguous[1];

  // b) 11 grupos de 4 dígitos separados por espaço/quebra de linha (DANFE impressa)
  const grouped = text.match(/(?:\d{4}[\s]?){11}/);
  if (grouped) {
    const d = digitsOnly(grouped[0]);
    if (d.length === 44) return d;
  }

  // c) tolerância a perda de separadores do OCR: sequência de dígitos com
  //    espaços opcionais totalizando exatamente 44
  const loose = text.match(/\d(?:[ \t\n]?\d){43,}/);
  if (loose) {
    const d = digitsOnly(loose[0]);
    if (d.length === 44) return d;
  }
  return undefined;
}

/**
 * CNPJ do destinatário: rótulo específico ("CNPJ do Destinatário", "receptor",…)
 * ou, na ausência de rótulo, o segundo CNPJ distinto do documento.
 */
function extractReceiverCnpj(text: string, emitterCnpj?: string): string | undefined {
  const labeled = text.match(
    /(?:CNPJ\s*(?:do\s*)?(?:Destinat[áa]rio|Respons[áa]vel|Cliente|Receptor)|CNPJ\s*do\s*Cliente\s*:?\s*|(?:destinat[áa]rio|receptor)[^0-9]{0,30})(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14})/i,
  );
  if (labeled?.[1]) return labeled[1];

  const all = text.match(/(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\b\d{14}\b)/g) ?? [];
  const emitterDigits = emitterCnpj ? digitsOnly(emitterCnpj) : "";
  for (const candidate of all) {
    if (digitsOnly(candidate) !== emitterDigits) return candidate;
  }
  return undefined;
}

/**
 * Extrai CNPJ: aceita a máscara 00.000.000/0000-00 OU os 14 dígitos
 * consecutivos (o OCR frequentemente perde a pontuação).
 */
function extractCnpj(text: string, prefix?: RegExp): string | undefined {
  const match =
    (prefix ? text.match(prefix) : null) ??
    text.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/) ??
    text.match(/\b(\d{14})\b/);
  return match?.[1]?.trim() ?? undefined;
}

/**
 * Extrai texto após um ponto de referência (ex.: "Razão Social: XYZ S/A").
 * Para no fim da LINHA — sem isso, o valor engoliria o resto do documento.
 */
function extractAfter(text: string, regex: RegExp): string | undefined {
  const match = text.match(regex);
  if (!match) return undefined;
  const start = match.index! + match[0].length;
  const line = text.slice(start).split("\n", 1)[0] ?? "";
  const remainder = line.trim();
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
 * Extrai CEP após o rótulo ("CEP:", "CEP do Emitente"), na MESMA linha.
 * O rótulo é apenas o ponto de partida — os dígitos são capturados à parte,
 * aceitando com ou sem hífen (01001-000 ou 01001000).
 */
function extractCep(text: string, prefix?: RegExp): string | undefined {
  let scope = text;
  if (prefix) {
    const label = text.match(prefix);
    if (!label || label.index === undefined) return undefined;
    scope = text.slice(label.index + label[0].length).split("\n", 1)[0] ?? "";
  }
  const match = scope.match(/\b(\d{5})[-\s]?(\d{3})\b/);
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
 * Extrai valor total da NF. O gap entre o rótulo e o número pode conter
 * espaços ("VALOR TOTAL R$ 1.323,50") — por isso a classe ignora espaço.
 */
function extractTotalValue(text: string): number | undefined {
  const parse = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const n = parseFloat(raw.replace(/\./g, "").replace(",", "."));
    return isFinite(n) && n > 0 ? n : undefined;
  };

  const labeled = text.matchAll(
    /(?:valor\s*total|Total|Valor\s*NF|NF\s*Total|Valor\s*da\s*NF)[^0-9R$]{0,20}?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:[,.]\d{2})?)/gi,
  );
  for (const m of labeled) {
    const n = parse(m[1]);
    if (n !== undefined) return n;
  }

  // fallback 1: último valor monetário precedido de R$
  const withSymbol = [...text.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:[,.]\d{2})?)/gi)];
  if (withSymbol.length > 0) {
    const n = parse(withSymbol[withSymbol.length - 1]?.[1]);
    if (n !== undefined) return n;
  }

  // fallback 2: último número com casas decimais plausível
  const anyNumber = [...text.matchAll(/\b(\d{1,3}(?:\.\d{3})*(?:[,.]\d{2})?)\b/g)];
  if (anyNumber.length > 0) {
    const n = parse(anyNumber[anyNumber.length - 1]?.[1]);
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * Linha tabular típica da DANFE:
 *   001 KIT TECLADO E MOUSE USB SLIM CHOCO 25 UN 12,50 312,50
 * colunas: nItem, cProd, xProd, qCom, uCom, vUnCom, vProd (vProd opcional).
 */
const DANFE_ROW =
  /^\s*(?:\|\s*)?(\d{1,3})\s+(\S+)\s+(.{3,}?)\s+(\d{1,7}(?:[.,]\d{1,4})?)\s+([A-Za-z]{2,4})\s+(\d{1,3}(?:[.,]\d{3})*[.,]\d{2,4})(?:\s+(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}))?\s*(?:\|\s*)?$/;

/**
 * Extrai itens pela leitura das linhas da tabela de produtos.
 * Retorna vazio quando o layout não combina (aí vale o parser heurístico).
 */
function extractItemRows(text: string): DanfeParsedItem[] {
  const items: DanfeParsedItem[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(DANFE_ROW);
    if (!m) continue;
    const [, _seq, code, desc, qty, unit, unitValue, totalValue] = m;
    if (!desc || desc.trim().length < 3) continue;
    const quantity = parseBrazilianNumber(qty ?? "");
    if (quantity === undefined || !(quantity > 0)) continue;
    items.push({
      code: code?.replace(/[-\s]/g, "").toUpperCase() || undefined,
      description: desc.trim(),
      quantity,
      unit: (unit ?? "").toUpperCase(),
      unitValue: parseBrazilianNumber(unitValue ?? ""),
      totalValue: totalValue ? parseBrazilianNumber(totalValue) : undefined,
    });
  }
  return items;
}

/**
 * Extrai itens da NF.
 */
function extractItems(text: string): DanfeParsedItem[] {
  // Caminho preferencial: linhas da tabela de produtos (layout DANFE).
  const rows = extractItemRows(text);
  if (rows.length > 0) return rows;

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
export function accessKeyDigits(accessKey: string | undefined): string | undefined {
  if (!accessKey) return undefined;
  const digits = digitsOnly(accessKey);
  return digits.length === 44 ? digits : undefined;
}
