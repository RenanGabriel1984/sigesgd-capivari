import { v } from "convex/values";

/**
 * Validadores e normalizadores de campos brasileiros para o SIGESGD.
 *
 * Regra geral: o backend armazena valores normalizados; a UI pode aplicar
 * máscaras visuais. Buscas por CNPJ/telefone/CEP são feitas em dígitos.
 */

/** Usa apenas dígitos de uma string. */
export const digitsOnly = (s: string | undefined | null): string =>
  (s ?? "").replace(/\D/g, "");

const MAX_CNPJ_LENGTH = 14;
const MAX_PHONE_LENGTH = 11;
const MAX_CEP_LENGTH = 8;

/**
 * Valida um CNPJ brasileiro pela soma de verificadores.
 * Aceita somente 14 dígitos.
 */
export const isValidCnpj = (raw: string): boolean => {
  const d = digitsOnly(raw);
  if (d.length !== MAX_CNPJ_LENGTH) return false;
  // Sequências repetidas ("00000000000000", "11111111111111", ...) não são CNPJ.
  if (/^(\d)\1{13}$/.test(d)) return false;

  const checkDigits = (base: string, weights: number[]): number => {
    const sum = base.split("").reduce((acc, digit, idx) => acc + Number(digit) * weights[idx], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base = d.slice(0, 12);
  const first = checkDigits(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigits(base + String(first), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d[12] === String(first) && d[13] === String(second);
};

/**
 * Formata CNPJ como 00.000.000/0000-00.
 * Valores não padronizados voltam como estão (legado/visual).
 */
export const formatCnpj = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw);
  if (d.length !== MAX_CNPJ_LENGTH) return raw ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
};

const PHONE_WEIGHTS_10 = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3];
const PHONE_WEIGHTS_11 = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4];

/**
 * Valida telefone brasileiro:
 *  - 10 dígitos: (XX) XXXXX-XXXX → DDD 11..99, os 8 últimos contendo digito verificador implícito
 *    no padrão de algum provedor; aceitamos somente DDD válido e 8 dígitos restantes.
 *  - 11 dígitos: (XX) 9XXXX-XXXX → DDD + 9 + 8 dígitos.
 *
 * Não aplicamos validação pesada de DDD/teledense para não bloquear
 * números de fixo celular antigos. Validação de DDD 11-99 e tamanho é suficiente.
 */
export const isValidPhone = (raw: string): boolean => {
  const d = digitsOnly(raw);
  if (d.length !== 10 && d.length !== MAX_PHONE_LENGTH) return false;
  if (d.length === 11 && d[2] !== "9") return false;
  // Sanity: DDD 11..99
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  return true;
};

/**
 * Formata telefone:
 *  - 11 dígitos: (XX) 9XXXX-XXXX
 *  - 10 dígitos: (XX) XXXXX-XXXX
 *  - outros: retorna como estão.
 */
export const formatPhone = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw);
  if (!isValidPhone(d)) return raw ?? "";
  if (d.length === MAX_PHONE_LENGTH) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6, 10)}`;
};

/**
 * Normaliza telefone para dígitos (sem perder o valor original caso
 * não seja um formato brasileiro reconhecido).
 */
export const normalizePhone = (raw: string | undefined | null): string | undefined => {
  const d = digitsOnly(raw);
  return (d.length === 10 || d.length === MAX_PHONE_LENGTH) ? d : (raw?.trim() || undefined);
};

/**
 * Valida CEP (8 dígitos).
 */
export const isValidCep = (raw: string): boolean => digitsOnly(raw).length === MAX_CEP_LENGTH;

/**
 * Formata CEP: XXXXX-XXX.
 */
export const formatCep = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw);
  if (d.length !== MAX_CEP_LENGTH) return raw ?? "";
  return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
};

/**
 * Máscaras VISUAIS progressivas (digitção → exibição).
 * O valor gravado continua sendo só dígitos; estas funções servem ao `value`
 * do input, aplicando a pontuação enquanto o usuário digita:
 *   22816315000144 → 22.816.315/0001-44
 *   8330530760      → (83) 3053-0760
 *   11987654321     → (11) 98765-4321
 *   88701600        → 88701-600
 * Os separadores só aparecem quando já existe dígito depois deles — assim o
 * Backspace apaga sempre o dígito certo, sem "lutar" com a máscara.
 */
export const maskCnpj = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw).slice(0, MAX_CNPJ_LENGTH);
  if (d.length <= 2) return d;
  let out = d.slice(0, 2);
  if (d.length > 2) out += `.${d.slice(2, 5)}`;
  if (d.length > 5) out += `.${d.slice(5, 8)}`;
  if (d.length > 8) out += `/${d.slice(8, 12)}`;
  if (d.length > 12) out += `-${d.slice(12, 14)}`;
  return out;
};

export const maskPhone = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw).slice(0, MAX_PHONE_LENGTH);
  if (d.length <= 2) return d;
  const rest = d.slice(2);
  // 11 dígitos → (XX) 9XXXX-XXXX (5+4); 10 → (XX) XXXX-XXXX (4+4).
  const split = d.length === MAX_PHONE_LENGTH ? 5 : 4;
  const body = rest.length > split ? `${rest.slice(0, split)}-${rest.slice(split)}` : rest;
  return `(${d.slice(0, 2)}) ${body}`;
};

export const maskCep = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw).slice(0, MAX_CEP_LENGTH);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
};

/**
 * Formata a chave de acesso de NF-e em grupos para facilitar conferência:
 *   xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx
 * (11 grupos de 4 dígitos). O valor no banco continua sendo os 44 dígitos.
 */
export const formatAccessKeyGrouped = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw);
  if (d.length !== 44) return raw ?? "";
  const groups: string[] = [];
  for (let i = 0; i < d.length; i += 4) {
    groups.push(d.slice(i, i + 4));
  }
  return groups.join(" ");
};

// ═══════════════════════════════════════════════════════════════════════════
// CPF — máscara visual + validação dos dígitos verificadores
// ═══════════════════════════════════════════════════════════════════════════

const MAX_CPF_LENGTH = 11;

/** Valida CPF pelos dois dígitos verificadores (somente 11 dígitos). */
export const isValidCpf = (raw: string): boolean => {
  const d = digitsOnly(raw);
  if (d.length !== MAX_CPF_LENGTH) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const checkDigit = (base: string): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * (base.length + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return (
    Number(d[9]) === checkDigit(d.slice(0, 9)) &&
    Number(d[10]) === checkDigit(d.slice(0, 10))
  );
};

/** Formata CPF completo como 000.000.000-00 (valor não padronizado volta como está). */
export const formatCpf = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw);
  if (d.length !== MAX_CPF_LENGTH) return raw ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
};

/** Máscara progressiva de CPF (digitção → exibição; o valor gravado é só dígitos). */
export const maskCpf = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw).slice(0, MAX_CPF_LENGTH);
  if (d.length <= 3) return d;
  let out = d.slice(0, 3);
  if (d.length > 3) out += `.${d.slice(3, 6)}`;
  if (d.length > 6) out += `.${d.slice(6, 9)}`;
  if (d.length > 9) out += `-${d.slice(9, 11)}`;
  return out;
};

// ═══════════════════════════════════════════════════════════════════════════
// Normalização — o BANCO guarda sempre o valor normalizado (sem máscara)
// ═══════════════════════════════════════════════════════════════════════════

/** CNPJ → 14 dígitos (valores legados que não são 14 dígitos voltam como estão). */
export const normalizeCnpj = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw);
  return d.length === MAX_CNPJ_LENGTH ? d : (raw?.trim() ?? "");
};

/** CEP → 8 dígitos. */
export const normalizeCep = (raw: string | undefined | null): string => {
  const d = digitsOnly(raw);
  return d.length === MAX_CEP_LENGTH ? d : (raw?.trim() ?? "");
};

/**
 * Chave de acesso NF-e → somente dígitos, independentemente de espaços,
 * pontos, hífens ou quebras de linha inseridos pelo OCR.
 */
export const normalizeAccessKey = (raw: string | undefined | null): string =>
  digitsOnly(raw);

/** Códigos de UF usados nos 2 primeiros dígitos da chave de acesso NF-e. */
const NF_ACCESS_KEY_UF_CODES = new Set([
  "11", "12", "13", "14", "15", "16", "17", "21", "22", "23", "24",
  "25", "26", "27", "28", "29", "31", "32", "33", "35", "41", "42",
  "43", "50", "51", "52", "53", "91",
]);

/**
 * Valida a ESTRUTURA de uma chave de acesso de 44 dígitos:
 *  • 44 dígitos;  • UF (2) válida;  • AAMM com mês plausível;
 *  • modelo da NF-e (55 = NF-e, 65 = NFC-e).
 * Não é criptografia — apenas evita aceitar uma sequência de 44 dígitos que
 * não faz sentido como chave (ex.: número de série lido por engano).
 */
export const isValidAccessKey = (raw: string | undefined | null): boolean => {
  const d = digitsOnly(raw);
  if (d.length !== 44) return false;
  if (!NF_ACCESS_KEY_UF_CODES.has(d.slice(0, 2))) return false;
  const month = Number(d.slice(4, 6));
  if (!(month >= 1 && month <= 12)) return false;
  const model = d.slice(20, 22);
  return model === "55" || model === "65";
};

// ═══════════════════════════════════════════════════════════════════════════
// Moeda — exibição "R$ 0,00" na tela; valor numérico normalizado no banco
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Token monetário no padrão brasileiro: opcionalmente "R$", milhar com ponto
 * e decimais com vírgula ("R$ 1.323,50") ou número com ponto decimal legado
 * ("12.5").
 */
export const currencyRe = /^R?\$?\s*-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^R?\$?\s*-?\d+(?:[.,]\d{1,2})?$/;

/**
 * Converte qualquer representação monetária digitada/extraída para um número
 * utilizável pelo banco (string com ponto decimal, ex.: "1323.5").
 *  • "R$ 1.323,50" → "1323.5"  (vírgula = decimal, ponto = milhar)
 *  • "12.5"        → "12.5"    (sem vírgula → ponto é decimal)
 *  • "1.323"       → "1323"    (padrão de milhar brasileiro)
 */
export const normalizeCurrency = (raw: string | number | undefined | null): string => {
  if (raw == null) return "";
  if (typeof raw === "number") return String(raw);
  const clean = raw.replace(/R\$\s?/gi, "").trim();
  if (!clean) return "";
  if (clean.includes(",")) {
    const value = Number(clean.replace(/\./g, "").replace(",", "."));
    return isFinite(value) ? String(value) : "";
  }
  if (/^-?\d{1,3}(?:\.\d{3})+$/.test(clean)) {
    return clean.replace(/\./g, "");
  }
  const value = Number(clean.replace(/[^\d.-]/g, ""));
  return isFinite(value) ? String(value) : "";
};

/** Formata um valor numérico/decimal como moeda brasileira: R$ 1.323,50. */
export const formatCurrency = (value: number | string | undefined | null): string => {
  if (value == null || value === "") return "";
  const normalized = normalizeCurrency(value);
  if (!normalized) return typeof value === "string" ? value : "";
  const n = Number(normalized);
  if (!isFinite(n)) return typeof value === "string" ? value : "";
  const [intPart, decPart] = n.toFixed(2).split(".");
  const int = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${int},${decPart ?? "00"}`;
};

/**
 * Máscara VISUAL progressiva de moeda para o campo em digitação:
 * 1323,5 → R$ 1.323,5 · 1323 → R$ 1.323 · 12.5 → R$ 12,5
 * Não inventa casas decimais: o que foi digitado é o que aparece, separador a
 * separador, para que o Backspace apague sempre o dígito certo.
 * O valor gravado continua sendo o original (normalizeCurrency no submit).
 */
export const maskCurrency = (raw: string | undefined | null): string => {
  const s = (raw ?? "").replace(/R\$\s?/gi, "");
  if (!s) return "";
  const hasComma = s.includes(",");
  const parts = s.split(",");
  const intRaw = parts[0] ?? "";
  const decRaw = hasComma ? (parts.slice(1).join("").replace(/\D/g, "").slice(0, 2)) : "";
  // Com vírgula, o ponto é separador de milhar; sem vírgula, o último ponto é
  // decimal legado ("12.5") e os demais são milhar.
  let intDigits: string;
  if (hasComma) {
    intDigits = digitsOnly(intRaw);
  } else {
    const lastDot = intRaw.lastIndexOf(".");
    if (lastDot >= 0 && intRaw.length - lastDot - 1 !== 3) {
      intDigits = digitsOnly(intRaw.slice(0, lastDot)) || "0";
      const legacyDec = digitsOnly(intRaw.slice(lastDot + 1)).slice(0, 2);
      return `R$ ${groupThousands(intDigits)}${legacyDec ? `,${legacyDec}` : ""}`;
    }
    intDigits = digitsOnly(intRaw);
  }
  const grouped = groupThousands(intDigits);
  return `R$ ${grouped}${hasComma ? `,${decRaw}` : ""}`;
};

const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
