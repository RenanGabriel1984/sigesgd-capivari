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
