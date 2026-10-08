/**
 * Parser de texto extraído via OCR para preencher os campos mais comuns de
 * uma DANFE / DANFE-e / DANFE Modelo 1 / GERAF / DANFE 4 / DANFE 5.
 *
 * Não substitui o XML; apenas alimenta a tela de conferência.
 */

import { isValidAccessKey } from "@/lib/br-validators";

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
      /**
       * Identificadores de compras públicas — três campos DISTINTOS, todos
       * opcionais (um nunca preenche o outro) e revistos pelo usuário.
       */
      afNumber?: string;
      processNumber?: string;
      empenhoNumber?: string;
      items: DanfeParsedItem[];
    }
  | { ok: false };

/**
 * Regiões clássicas de uma DANFE retrato (frações da página: x/y/largura/altura).
 * O pipeline de OCR recorta cada região do PDF escaneado/imagem e roda o
 * Tesseract nelas, em ADDIÇÃO à página inteira — o parser recebe os dois.
 */
export type DanfeRegion = {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DANFE_REGIONS: DanfeRegion[] = [
  { key: "cabecalho", label: "Cabeçalho (nº e série)", x: 0.42, y: 0.0, w: 0.58, h: 0.1 },
  { key: "chave", label: "Chave de acesso", x: 0.0, y: 0.05, w: 1.0, h: 0.09 },
  { key: "emitente", label: "Emitente", x: 0.0, y: 0.09, w: 0.5, h: 0.22 },
  { key: "destinatario", label: "Destinatário", x: 0.0, y: 0.3, w: 1.0, h: 0.18 },
  { key: "produtos", label: "Produtos", x: 0.0, y: 0.52, w: 1.0, h: 0.24 },
  { key: "totais", label: "Totais", x: 0.0, y: 0.74, w: 1.0, h: 0.08 },
  { key: "dadosAdicionais", label: "Dados adicionais", x: 0.0, y: 0.8, w: 1.0, h: 0.2 },
];

/** Combina a página inteira + regiões para o parser (uma linha por trecho). */
export function mergeDanfeTexts(fullPageText: string, regionTexts: string[]): string {
  return [fullPageText, ...regionTexts].filter((t) => t && t.trim()).join("\n");
}

/**
 * Um PDF com menos de 80 caracteres úteis não tem camada de texto utilizável:
 * é um PDF escaneado e precisa ser rasterizado antes do OCR.
 */
export function hasUsableTextLayer(text: string | null | undefined): boolean {
  return (text ?? "").replace(/\s/g, "").length >= 80;
}

/** Campos acompanhados na conferência parcial (§10 — "X de Y campos"). */
export const DANFE_TRACKED_FIELDS: { key: string; label: string }[] = [
  { key: "nfeNumber", label: "Número da NF-e" },
  { key: "series", label: "Série" },
  { key: "emissionDate", label: "Data de emissão" },
  { key: "accessKey", label: "Chave de acesso" },
  { key: "emitterCnpj", label: "CNPJ do emitente" },
  { key: "emitterName", label: "Razão social do emitente" },
  { key: "emitterAddress", label: "Endereço do emitente" },
  { key: "emitterCity", label: "Cidade do emitente" },
  { key: "totalValue", label: "Valor total" },
  { key: "items", label: "Itens da NF-e" },
];

/**
 * Conferência parcial: quantos campos centrais foram identificados e quais
 * faltam. O OCR é um ASSISTENTE — nunca exige 100% para continuar (§10).
 */
export function danfeFieldSummary(parsed: DanfeParsed): {
  found: number;
  total: number;
  missing: string[];
} {
  const total = DANFE_TRACKED_FIELDS.length;
  if (!parsed.ok) {
    return { found: 0, total, missing: DANFE_TRACKED_FIELDS.map((f) => f.label) };
  }
  const missing: string[] = [];
  let found = 0;
  for (const field of DANFE_TRACKED_FIELDS) {
    const present =
      field.key === "items"
        ? (parsed.items?.length ?? 0) > 0
        : Boolean((parsed as Record<string, unknown>)[field.key]);
    if (present) found += 1;
    else missing.push(field.label);
  }
  return { found, total, missing };
}

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
  //    Tolerante a espaços, pontos, hífens, quebras de linha e OCR trocando
  //    letras por dígitos (O→0, S→5, B→8...).
  const accessKey = extractAccessKey(normalized);

  // 2) Número da NF-e ("Nº NF: 00000", "NF-e Nº 00000", ou apenas "Nº 000002967")
  const nfeNumberMatch = normalized.match(/(?:N[ºo]\.?\s*(?:NF|NF-e)\s*:?\s*|NF-e\s*N[ºo]\.?\s*|N[ºo]\s*Nota\s*(?:Fiscal)?\s*:?\s*)(\d{1,9})/i);
  const looseNumberMatch = normalized.match(/\bN[ºo]\.?\s*0*(\d{3,9})\b/i);
  const fromKey = accessKey ? nfFieldsFromAccessKey(accessKey) : undefined;
  const nfeNumber = nfeNumberMatch?.[1] ?? looseNumberMatch?.[1] ?? fromKey?.number ?? undefined;

  // 3) Série (comum em DANFE Modelo 1: "Série: 001" ou "SÉRIE 001")
  const seriesMatch = normalized.match(/(?:S[ée]rie\s*:?\s*)(\d{2,3})/i);
  const series = seriesMatch?.[1] ?? fromKey?.series ?? undefined;

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

  // O bloco do EMITENTE termina onde começa o destinatário (quando o documento
  // traz esse marcador). Sem isso, o CNPJ/razão social do destinatário podiam
  // ser lidos como se fossem do emitente — exatamente o que derrubou a DANFE
  // escaneada da Incotech no teste real.
  const receiverStart = normalized.search(/\b(DESTINAT[ÁA]RIO|REMETENTE|CLIENTE|ADRESSEE)\b/i);
  const emitenteScope = receiverStart > 0 ? normalized.slice(0, receiverStart) : normalized;

  // 5) CNPJ do emitente (com ou sem máscara — o OCR pode perder a pontuação)
  const emitterCnpj = extractCnpj(emitenteScope, /(?:CNPJ\s*(?:do\s*)?Emitente\s*:?\s*|CNPJ\s*:?\s*|(?:emitente|emissor)[^0-9]{0,30})(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14})/i);

  // 6) Razão social do emitente (após CNPJ; fallback: primeira linha após o CNPJ)
  const emitterName =
    extractAfter(emitenteScope, /(?:Nome\s*(?:de\s*)?(?:Raz[ãa]o\s*)?(?:Social\s*)?(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|Raz[ãa]o\s*Social\s*:?\s*|Empresa\s*:?\s*)/i) ??
    extractNameAfterCnpj(emitenteScope, emitterCnpj);

  // 7) Telefone do emitente
  const emitterPhone = extractPhone(emitenteScope, /(?:Telefone|Tel|Fone|Phone|T [eE]l)[^0-9]{0,30}?\(?(\d{2})\)?\s?(\d{4,5}[- ]?\d{4})/i);

  // 8) E-mail do emitente
  const emitterEmail = extractEmail(emitenteScope, /(?:E-mail|Email|e-mail|Mail)[^@\s]{0,30}?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

  // 9) Endereço do emitente
  const emitterAddress = extractAfter(emitenteScope, /(?:Endere[çc]o\s*(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|Endere[çc]o\s*:?\s*)/i);

  // 10) Cidade do emitente
  const emitterCity = extractAfter(emitenteScope, /(?:Cidade\s*(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|Cidade\s*:?\s*)/i);

  // 11) UF do emitente (busca estado por sigla após cidade ou na linha de endereço)
  const emitterState = extractState(emitenteScope);

  // 12) CEP do emitente
  const emitterPostalCode = extractCep(emitenteScope, /(?:CEP\s*(?:do\s*)?(?:Emitente|Empresa|Instala[çc][ãa]o|Estabelecimento)|CEP\s*:?\s*)/i);

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

  // 17) Compras públicas: AF, Processo Administrativo e Empenho são campos
  //     DISTINTOS, todos opcionais — o que não estiver rotulado fica vazio.
  const afNumber = matchLabelledReference(normalized, AF_LABEL_PATTERN);
  const processNumber = matchLabelledReference(normalized, PROCESSO_LABEL_PATTERN);
  const empenhoNumber = matchLabelledReference(normalized, EMPENHO_LABEL_PATTERN);

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
    afNumber,
    processNumber,
    empenhoNumber,
    items: items.length > 0 ? items : [],
  };
}

// ─── Compras públicas (AF / Processo / Empenho) ───────────────────────────────

const AF_LABEL_PATTERN = /(?:\bAF\b|Autoriza[çc][ãa]o\s+de\s+Fornecimento)\s*[:\-#º.]*\s*([0-9]{1,6}\s*\/\s*[0-9]{4})/i;
const EMPENHO_LABEL_PATTERN = /(?:Nota\s+de\s+Empenho|Empenho|\bNE\b)\s*[:\-#º.]*\s*([0-9]{1,6}\s*\/\s*[0-9]{4})/i;
const PROCESSO_LABEL_PATTERN = /(?:Processo(?:\s+Administrativo)?|Proc\.)\s*[:\-.#º]*\s*([0-9]{4,12}(?:\s*[\/.-]\s*[0-9A-Za-z]{1,8})*)/i;

function matchLabelledReference(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  const value = match?.[1]?.trim().replace(/\s+/g, "");
  return value || undefined;
}

// ─── Derivação de campos a partir da chave de acesso ──────────────────────────

/**
 * Série (dígitos 22–24) e número (dígitos 25–33) são parte da própria chave de
 * acesso NF-e — servem de CONFIRMAÇÃO/fallback quando o OCR não lê o cabeçalho.
 */
function nfFieldsFromAccessKey(accessKey: string): { number?: string; series?: string } {
  const d = accessKey.replace(/\D/g, "");
  if (d.length !== 44) return {};
  const series = d.slice(22, 25);
  const rawNumber = d.slice(25, 34).replace(/^0+/, "");
  return {
    number: rawNumber || undefined,
    series: series || undefined,
  };
}

/**
 * Razão social sem rótulo: a linha seguinte ao CNPJ do emitente costuma ser o
 * nome da empresa (layout canônico da DANFE). Só aceita linhas puramente
 * textuais para não capturar endereço, número ou valor.
 */
function extractNameAfterCnpj(text: string, cnpj: string | undefined): string | undefined {
  if (!cnpj) return undefined;
  const cnpjDigits = digitsOnly(cnpj);
  if (!cnpjDigits) return undefined;
  const lines = text.split("\n");

  const looksLikeCompanyName = (candidate: string): boolean => {
    const value = candidate.trim();
    if (value.length < 4 || value.length > 80) return false;
    if (!/[A-Za-zÀ-ú]{4,}/.test(value)) return false;
    // Nome de empresa não traz dígito (endereço, telefone e CNPJ têm).
    if (/\d/.test(value)) return false;
    return !/^(CEP|CNPJ|Insc|I\.?E|Tel|Fone|E-mail|Endere|Nº|N[úu]m|RUA|AVENIDA|AV\.?|RODOVIA|ESTRADA|TRAVESSA|ALAMEDA|BAIRRO|COMPLEMENTO|X\s*NOME|NOME|DANFE|DOCUMENTO)/i.test(value);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.includes(cnpjDigits) && !line.includes(cnpj)) continue;
    // 1) Layout canônico da DANFE: o nome vem ACIMA do CNPJ.
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const candidate = lines[j] ?? "";
      if (looksLikeCompanyName(candidate)) return candidate.trim();
    }
    // 2) Fallback: primeiras linhas textuais DEPOIS do CNPJ.
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const candidate = lines[j] ?? "";
      if (looksLikeCompanyName(candidate)) return candidate.trim();
    }
  }
  return undefined;
}

/**
 * Extrai a chave de acesso de 44 dígitos, tolerando o formato agrupado em
 * 11 grupos de 4 dígitos usado pelas DANFEs impressas (ex.:
 * "3524 0622 8163 1500 0144 ..."), espaços, pontos, hífens, quebras de linha
 * e trocas clássicas de OCR (O→0, I/l→1, S→5, B→8...).
 * A estrutura é VALIDADA antes de aceitar (UF, mês e modelo da NF-e).
 * O valor devolvido é SEMPRE só dígitos.
 */
function extractAccessKey(text: string): string | undefined {
  const candidates: string[] = [];
  const pushIfComplete = (digits: string) => {
    if (digits.length === 44) candidates.push(digits);
  };

  // a) 44 dígitos contíguos
  const contiguous = text.match(/\b(\d{44})\b/);
  if (contiguous?.[1]) candidates.push(contiguous[1]);

  // b) 11 GRUPOS de 4 dígitos (DANFE impressa), inclusive com quebra de linha
  //    entre os blocos. Todos os alinhamentos são testados — o número da NF
  //    (4 dígitos) imediatamente acima da chave não pode "desalinhar" a leitura.
  const groupTokens = text.match(/\d{4}(?!\d)/g) ?? [];
  for (let i = 0; i + 11 <= groupTokens.length; i++) {
    pushIfComplete(groupTokens.slice(i, i + 11).join(""));
  }

  // c) tolerância a perda de separadores do OCR: espaços, pontos, hífens e
  //    quebras de linha opcionais entre os 44 dígitos (sobreposição incluída).
  const collectLoose = (src: string) => {
    for (const m of src.matchAll(/\d(?=(?:[\s.\-]?\d){43})/g)) {
      const start = m.index ?? 0;
      const window = src.slice(start).match(/\d(?:[\s.\-]?\d){43}/)?.[0];
      if (window) pushIfComplete(digitsOnly(window));
    }
  };
  collectLoose(text);

  // d) OCR confundindo letras com dígitos ("O" por "0", "S" por "5", ...):
  //    reaplica a busca sobre o texto com os glifos corrigidos.
  const digitized = text.replace(/[OoDdIliIZzSsGgBbqQ]/g, (ch) => GLYPH_TO_DIGIT[ch] ?? ch);
  collectLoose(digitized);

  // Primeira sequência com ESTRUTURA válida (§9: validar antes de aceitar).
  for (const candidate of candidates) {
    if (isValidAccessKey(candidate)) return candidate;
  }
  return undefined;
}

/** Correção clássica de OCR: letra que o Tesseract lê no lugar de um dígito. */
const GLYPH_TO_DIGIT: Record<string, string> = {
  O: "0", o: "0", D: "0",
  I: "1", l: "1", i: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6", g: "6",
  B: "8", b: "8",
};

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

  // fallback 1: último valor monetário precedido de R$ (com centavos)
  const withSymbol = [...text.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi)];
  if (withSymbol.length > 0) {
    const n = parse(withSymbol[withSymbol.length - 1]?.[1]);
    if (n !== undefined) return n;
  }

  // fallback 2: último número no padrão brasileiro (vírgula decimal). Exige a
  // vírgula para não confundir CNPJ/CEP/chave ("61.457.941") com valor.
  const anyNumber = [...text.matchAll(/(?:^|[^\d./-])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d/])/gm)];
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
