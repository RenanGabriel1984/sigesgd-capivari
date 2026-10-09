/**
 * Gestão de Estoque SGGD — parser PURO de DANFE / OCR (sem DOM).
 *
 * Núcleo testável compartilhado pelo diálogo de importação DANFE/PDF/imagem:
 *  - parseDanfeText: extrai os campos estruturados de um texto DANFE;
 *  - isValidDanfeItemCandidate: rejeita cabeçalhos/rodapés da tabela de
 *    produtos ANTES de criar um item (nunca "cabeçalho vira produto");
 *  - extractAccessKey44 / validateAccessKey44: reconhecem a chave de acesso
 *    com espaços, pontos, hífens, quebras de linha e glifos trocados, e
 *    validam ESTRUTURA (UF, mês, modelo) + dígito verificador módulo 11;
 *  - danfeFieldSummary: "X de 10 campos" contando SOMENTE campos válidos.
 *
 * REGRA FUNDAMENTAL: o parser apenas LÊ dados. Nada aqui cria entrada,
 * estoque, lote ou movimentação — a efetivação é exclusiva de entries.confirm
 * após confirmação humana na tela de conferência.
 */
import {
  digitsOnly,
  formatCnpj,
  isValidAccessKey,
  isValidCnpj,
} from "./br-validators";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface DanfeItem {
  /** Nº do item na DANFE (quando identificado) */
  lineNumber?: number;
  /** Código do produto (cProd) */
  code?: string;
  description: string;
  quantity?: number;
  unit?: string;
  unitValue?: number;
  totalValue?: number;
}

export interface DanfeParseResult {
  ok: boolean;
  nfeNumber?: string;
  series?: string;
  /** Data de emissão em "yyyy-mm-dd" */
  emissionDate?: string;
  accessKey?: string;
  /** CNPJ formatado (61.457.941/0001-43) */
  emitterCnpj?: string;
  emitterName?: string;
  emitterAddress?: string;
  emitterCity?: string;
  emitterState?: string;
  emitterPostalCode?: string;
  receiverCnpj?: string;
  receiverName?: string;
  totalValue?: number;
  afNumber?: string;
  processNumber?: string;
  empenhoNumber?: string;
  items: DanfeItem[];
}

// ─── Regiões clássicas da DANFE (normalizadas 0..1) ──────────────────────────

export interface DanfeRegion {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DANFE_REGIONS: DanfeRegion[] = [
  { key: "cabecalho", x: 0.02, y: 0.01, w: 0.96, h: 0.1 },
  { key: "chave", x: 0.02, y: 0.09, w: 0.66, h: 0.06 },
  { key: "emitente", x: 0.02, y: 0.14, w: 0.96, h: 0.15 },
  { key: "destinatario", x: 0.02, y: 0.29, w: 0.96, h: 0.13 },
  { key: "produtos", x: 0.02, y: 0.42, w: 0.96, h: 0.28 },
  { key: "totais", x: 0.02, y: 0.7, w: 0.96, h: 0.06 },
  { key: "dadosAdicionais", x: 0.02, y: 0.77, w: 0.96, h: 0.2 },
];

// ─── Campos rastreados ("X de 10 campos") ────────────────────────────────────

export const DANFE_TRACKED_FIELDS = [
  "Número da NF-e",
  "Série",
  "Chave de acesso",
  "CNPJ do emitente",
  "Razão social do emitente",
  "Data de emissão",
  "Valor total da NF",
  "Itens da NF-e",
  "CEP do emitente",
  "UF do emitente",
] as const;

const VALID_UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const stripAccents = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Converte "1.323,50" / "12,50" / "1323.50" em número. */
function parseNumberBR(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s.replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : undefined;
}

// ─── Chave de acesso ─────────────────────────────────────────────────────────

/** Glifos que o OCR frequentemente confunde com dígitos. */
const GLYPH_MAP: Record<string, string> = {
  O: "0", o: "0", D: "0", d: "0", Q: "0", q: "0",
  I: "1", i: "1", L: "1", l: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6", g: "6",
  B: "8", b: "8",
};

const KEY_TOKEN_RE = /^[0-9OoDdQqIiLlZzSsGgBb]{4}$/;

function normalizeKeyToken(token: string): string | null {
  if (!KEY_TOKEN_RE.test(token)) return null;
  let out = "";
  for (const ch of token) out += GLYPH_MAP[ch] ?? ch;
  return /^\d{4}$/.test(out) ? out : null;
}

/**
 * Valida a chave de 44 dígitos: estrutura (UF, mês, modelo 55/65) +
 * dígito verificador módulo 11 (último dígito da chave NF-e).
 * Não aceita qualquer sequência de 44 caracteres.
 */
export function validateAccessKey44(raw: string | undefined | null): boolean {
  const d = digitsOnly(raw ?? "");
  if (d.length !== 44) return false;
  if (!isValidAccessKey(d)) return false;
  // Dígito verificador módulo 11: pesos 2..9 da direita para a esquerda
  // sobre os 43 primeiros dígitos.
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(d[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = 11 - rest;
  const expected = dv >= 10 ? 0 : dv;
  return expected === Number(d[43]);
}

/**
 * Reconhece a chave de acesso em texto OCR: sequência direta de 44 dígitos,
 * blocos de 4 dígitos separados por espaço/ponto/hífen/quebra de linha e
 * normalização de glifos (O→0, S→5, B→8, I→1…).
 * Retorna SOMENTE chaves que passam na validação estrutural + DV.
 */
export function extractAccessKey44(text: string | undefined | null): string | undefined {
  if (!text) return undefined;

  // 1) Sequência direta de 44 dígitos.
  const direct = text.match(/\d{44}/);
  if (direct && validateAccessKey44(direct[0])) return direct[0];

  // 2) Blocos de 4 caracteres "semelhantes a dígitos" acumulados em ordem.
  const tokens = text.split(/[^0-9A-Za-z]+/).filter(Boolean);
  let buffer = "";
  for (const token of tokens) {
    const normalized = normalizeKeyToken(token);
    if (normalized) {
      buffer += normalized;
      if (buffer.length === 44) {
        if (validateAccessKey44(buffer)) return buffer;
        buffer = "";
      } else if (buffer.length > 44) {
        buffer = "";
      }
    } else {
      buffer = "";
    }
  }

  return undefined;
}

/** Mantido por compatibilidade com o diálogo (validação estrutural + DV). */
export const validateAccessKey = validateAccessKey44;

// ─── Validação de itens (NUNCA cabeçalho vira produto) ───────────────────────

/** Palavras/títulos que caracterizam cabeçalho, rodapé ou paginação. */
const HEADER_MARKERS = [
  "DESCRICAO DOS PRODUTOS",
  "DESCRIÇÃO DOS PRODUTOS",
  "DESCRICAO DOS SERVICOS",
  "DESCRIÇÃO DOS SERVIÇOS",
  "DADOS DOS PRODUTOS",
  "DADOS DOS SERVICOS",
  "DADOS DOS PROD",
  "NOME DO PRODUTO",
  "DESCRICAO DO PRODUTO",
  "VALOR UNITARIO",
  "VALOR UNITÁRIO",
  "VALOR TOTAL",
  "ALIQ",
  "ICMS",
  "CHAVE DE ACESSO",
  "DADOS ADICIONAIS",
  "DADOS GERAIS",
  "NOTA FISCAL ELETRONICA",
  "NOTA FISCAL ELETRÔNICA",
  "DANFE",
  "DESTINATARIO",
  "REMETENTE",
  "INSCRICAO",
  "PROTOCOLO DE USO",
  "FOLHA",
  "PAGINA",
  "PÁGINA",
];

/** Linhas de item da DANFE: nItem cProd xProd qCom uCom vUnCom vProd. */
const DANFE_ITEM_ROW =
  /^\s*(?:\|\s*)?(\d{1,4})\s+([0-9A-Z]{2,16})\s+(.{3,80}?)\s+(\d+(?:[.,]\d{1,4})?)\s+([A-Za-z]{2,4})\s+(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+[.,]\d{1,4})(?:\s+(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+[.,]\d{1,4}))?\s*(?:\|\s*)?$/;

/** Unidades que NUNCA são unidade de produto (são colunas do cabeçalho). */
const BAD_UNITS = new Set(["NCM", "CST", "CFOP", "UNID", "QTDE", "ALIQ", "ICMS", "IPI", "ST"]);

/**
 * Valida estruturalmente uma linha como candidata a ITEM da DANFE.
 * Rejeita explicitamente cabeçalhos/rodapés/títulos/paginação e exige
 * evidências suficientes: descrição, quantidade numérica válida, unidade
 * plausível e valor unitário ou total numérico.
 */
export function isValidDanfeItemCandidate(line: string | undefined | null): boolean {
  const raw = (line ?? "").trim();
  if (raw.length < 10 || raw.length > 200) return false;

  const upper = stripAccents(raw.toUpperCase());
  for (const marker of HEADER_MARKERS) {
    if (upper.includes(marker)) return false;
  }

  const m = raw.match(DANFE_ITEM_ROW);
  if (!m) return false;
  const [, , , desc, qty, unit, unitValue, totalValue] = m;

  // Descrição: ao menos 3 letras seguidas (não serves para "2 EPP", "Cód. IGO").
  if (!desc || !/[A-Za-zÀ-Ú]{3,}/.test(desc)) return false;

  // Quantidade numérica > 0.
  const q = parseNumberBR(qty);
  if (q === undefined || q <= 0) return false;

  // Unidade plausível (2 a 4 letras, não é nome de coluna).
  if (!unit || !/^[A-Za-zÀ-Ú]{2,4}$/.test(unit)) return false;
  if (BAD_UNITS.has(unit.toUpperCase())) return false;

  // Ao menos um valor numérico > 0 (unitário ou total).
  const vu = parseNumberBR(unitValue);
  const tv = parseNumberBR(totalValue);
  const hasValue = (vu !== undefined && vu > 0) || (tv !== undefined && tv > 0);
  if (!hasValue) return false;

  return true;
}

// ─── Parse linha a linha ─────────────────────────────────────────────────────

function parseItemLine(line: string, index: number): DanfeItem | null {
  if (!isValidDanfeItemCandidate(line)) return null;
  const m = line.trim().match(DANFE_ITEM_ROW);
  if (!m) return null;
  const [, seq, code, desc, qty, unit, unitValue, totalValue] = m;
  return {
    lineNumber: Number(seq) || index + 1,
    code,
    description: desc.trim(),
    quantity: parseNumberBR(qty),
    unit: unit.toUpperCase(),
    unitValue: parseNumberBR(unitValue),
    totalValue: parseNumberBR(totalValue),
  };
}

/**
 * Lê um texto de DANFE (camada de texto ou OCR) e devolve os campos
 * estruturados. O parser NUNCA falha por completo: sem chave identificada a
 * conferência continua possível (chave pode ser informada manualmente).
 */
export function parseDanfeText(text: string | undefined | null): DanfeParseResult {
  const result: DanfeParseResult = { ok: false, items: [] };
  if (!text || !text.trim()) return result;

  const lines = text.split(/\r?\n/);
  let inReceiverSection = false;
  let prevLine = "";
  let prevCnpjLineIdx = -1;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const upper = stripAccents(line.toUpperCase());

    // Seção do destinatário/remetente (o CNPJ ali é o DO DESTINATÁRIO).
    if (/DESTINAT[AÁ]RIO|REMETENTE/.test(upper) && upper.length < 60) {
      inReceiverSection = true;
    }

    // ── Número da NF-e ──
    if (!result.nfeNumber) {
      const mNum =
        line.match(/NF-?E?\s*N[ºo°]\s*:?\s*0*(\d{1,9})/i) ||
        line.match(/\bN[ºo°]\s*:?\s*0*(\d{1,9})/i);
      if (mNum) result.nfeNumber = mNum[1];
    }

    // ── Série (preserva zeros à esquerda) ──
    if (!result.series) {
      const mSeries = line.match(/S[ÉE]RIE\s*:?\s*(\d{1,3})/i);
      if (mSeries) result.series = mSeries[1];
    }

    // ── Data de emissão ──
    if (!result.emissionDate) {
      const mDate = upper.match(/EMISS[AÃ]O[^0-9]{0,12}?(\d{2})\/(\d{2})\/(\d{4})/);
      if (mDate) result.emissionDate = `${mDate[3]}-${mDate[2]}-${mDate[1]}`;
    }

    // ── CNPJ (emitente ou destinatário conforme a seção) ──
    const mCnpjLabel = line.match(
      /CNPJ\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i,
    );
    const mCnpjBare = line.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
    const mCnpjDigits = line.match(/(?<!\d)(\d{14})(?!\d)/);
    const cnpjRaw =
      mCnpjLabel?.[1] ?? mCnpjBare?.[1] ?? mCnpjDigits?.[1] ?? null;
    if (cnpjRaw) {
      const cnpjFormatted = formatCnpj(digitsOnly(cnpjRaw));
      if (inReceiverSection) {
        if (!result.receiverCnpj) {
          result.receiverCnpj = cnpjFormatted;
          // Nome do destinatário: linha imediatamente anterior, se parecer nome.
          const nm = stripAccents(prevLine.toUpperCase());
          if (
            prevLine &&
            prevLine.length >= 5 &&
            !prevLine.includes(":") &&
            /[A-ZÀ-Ú]{3,}/.test(nm) &&
            !/CHAVE|DANFE|DADOS|NOTA/.test(nm)
          ) {
            result.receiverName = prevLine;
          }
        }
      } else if (!result.emitterCnpj) {
        result.emitterCnpj = cnpjFormatted;
        prevCnpjLineIdx = idx;
      }
    }

    // ── Razão social do emitente ──
    if (!inReceiverSection && !result.emitterName) {
      const mName = line.match(/RAZ[ÃA]O\s+SOCIAL\s*:?\s*(.+)/i);
      if (mName) result.emitterName = mName[1].trim();
    }

    // ── Endereço / cidade / UF / CEP do emitente ──
    if (!inReceiverSection) {
      if (!result.emitterAddress) {
        const mAddr = line.match(/ENDERE[ÇC]O\s*:?\s*(.+)/i);
        if (mAddr) result.emitterAddress = mAddr[1].trim();
        else if (
          result.emitterCnpj &&
          idx === prevCnpjLineIdx + 1 &&
          /^(RUA|AV\.?|AVENIDA|AL\.?|ALAMEDA|TRAVESSA|ESTRADA|RODOVIA)\b/i.test(line)
        ) {
          result.emitterAddress = line;
        }
      }
      if (!result.emitterCity) {
        const mCity = line.match(/CIDADE\s*:?\s*(.+)/i);
        if (mCity) result.emitterCity = mCity[1].trim();
        else if (
          result.emitterAddress &&
          idx > 0 &&
          lines[idx - 1]?.trim() === result.emitterAddress &&
          /^[A-Za-zÀ-Ú]{3,30}$/.test(line)
        ) {
          result.emitterCity = line;
        }
      }
      if (!result.emitterState) {
        const mUf = line.match(/\bUF\s*:?\s*([A-Za-z]{2})\b/i);
        if (mUf && VALID_UFS.has(mUf[1].toUpperCase())) {
          result.emitterState = mUf[1].toUpperCase();
        } else if (
          result.emitterCity &&
          idx > 0 &&
          lines[idx - 1]?.trim() === result.emitterCity &&
          VALID_UFS.has(line.toUpperCase()) &&
          /^[A-Za-z]{2}$/.test(line)
        ) {
          result.emitterState = line.toUpperCase();
        }
      }
      if (!result.emitterPostalCode) {
        const mCep = line.match(/CEP\s*:?\s*(\d{5}-?\d{3})/i);
        if (mCep) result.emitterPostalCode = mCep[1];
      }
    }

    // ── Valor total da NF (rótulo específico; nunca pega valor de item) ──
    if (result.totalValue === undefined) {
      const mTotal = upper.match(
        /VALOR\s+TOTAL\s+DA\s+NF\D{0,12}?R?\$?\s*([\d.,]+)/,
      );
      if (mTotal) {
        const v = parseNumberBR(mTotal[1]);
        if (v !== undefined && v > 0) result.totalValue = v;
      }
    }

    // ── AF / Empenho / Processo (campos distintos; um nunca preenche outro) ──
    if (!result.afNumber) {
      const mAf = line.match(/\bAF\s*:?\s*(\d{3,6}\/\d{4})\b/i);
      if (mAf) result.afNumber = mAf[1];
    }
    if (!result.empenhoNumber) {
      const mEmp = line.match(/\bEMPENHO\s*:?\s*([\d]{1,6}\/\d{4})\b/i);
      if (mEmp) result.empenhoNumber = mEmp[1];
    }
    if (!result.processNumber) {
      const mProc = line.match(
        /\bPROCESSO(?:\s+ADMINISTRATIVO)?\s*:?\s*([\w/-]{3,20})\b/i,
      );
      if (mProc && !/USO/i.test(mProc[1])) result.processNumber = mProc[1];
    }

    // ── Itens ( SOMENTE linhas que passam na validação estrutural ) ──
    const item = parseItemLine(line, idx);
    if (item) result.items.push(item);

    prevLine = line;
  });

  // ── Chave de acesso (página inteira + blocos + glifos) ──
  result.accessKey = extractAccessKey44(text);

  const foundAny =
    result.nfeNumber ||
    result.series ||
    result.accessKey ||
    result.emitterCnpj ||
    result.emitterName ||
    result.afNumber ||
    result.empenhoNumber ||
    result.items.length > 0;
  result.ok = Boolean(foundAny);
  return result;
}

// ─── Resumo "X de 10 campos" (somente campos VÁLIDOS contam) ─────────────────

export interface DanfeFieldSummary {
  total: number;
  found: number;
  missing: string[];
}

export function danfeFieldSummary(parsed: DanfeParseResult): DanfeFieldSummary {
  const validity: Record<(typeof DANFE_TRACKED_FIELDS)[number], boolean> = {
    "Número da NF-e": Boolean(parsed.nfeNumber),
    Série: Boolean(parsed.series),
    "Chave de acesso": validateAccessKey44(parsed.accessKey),
    "CNPJ do emitente": Boolean(parsed.emitterCnpj) && isValidCnpj(parsed.emitterCnpj ?? ""),
    "Razão social do emitente": Boolean(parsed.emitterName),
    "Data de emissão": Boolean(parsed.emissionDate),
    "Valor total da NF": parsed.totalValue !== undefined && parsed.totalValue > 0,
    "Itens da NF-e": parsed.items.length > 0,
    "CEP do emitente": digitsOnly(parsed.emitterPostalCode ?? "").length === 8,
    "UF do emitente": VALID_UFS.has((parsed.emitterState ?? "").toUpperCase()),
  };
  const missing: string[] = [];
  let found = 0;
  for (const field of DANFE_TRACKED_FIELDS) {
    if (validity[field]) found++;
    else missing.push(field);
  }
  return { total: DANFE_TRACKED_FIELDS.length, found, missing };
}

// ─── Utilitários de OCR multi-região ─────────────────────────────────────────

export function hasUsableTextLayer(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length >= 100;
}

export function mergeDanfeTexts(pageText: string, regionTexts: string[]): string {
  return [pageText, ...regionTexts].filter((t) => t && t.trim()).join("\n");
}

/**
 * Compara dois resultados de parse de forma SEMÂNTICA: prefere o resultado
 * com MAIS campos estruturados válidos. Nunca usa apenas quantidade de
 * caracteres — um texto maior não é automaticamente melhor.
 */
export function isDanfeParseBetter(
  candidate: DanfeParseResult,
  current: DanfeParseResult,
): boolean {
  return danfeFieldSummary(candidate).found > danfeFieldSummary(current).found;
}
