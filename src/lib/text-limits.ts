/**
 * Gestão de Estoque SGGD — LIMITES DE CAMPOS DE TEXTO LIVRE (hardening §17).
 *
 * Motivo: campos livres (`reason`, `observation`, `description`, …) são
 * Attack-Surface de armazenamento sem limite. Um valor de megabytes submitted
 * por um usuário autenticado consome cota do deployment, polui o histórico e
 * — no caso de campos livres — pode receber dados pessoais desnecessários
 * (LGPD, minimização).
 *
 * Regras:
 *  - NUNCA truncar silenciosamente: o excedente é REJEITADO com mensagem
 *    amigável, para que o usuário entenda e ajuste o texto.
 *  - Os limites são compatíveis com o uso real: nenhuma linha existente no
 *    histórico é inválida (ver `src/__tests__/text-limits.test.ts`).
 */

/** Limite padrão de um texto livre descritivo. */
export const MAX_TEXT = 1000;
/** Limite padrão de um campo de observação (aceita texto mais longo). */
export const MAX_OBSERVATION = 2000;
/** Limite padrão de um identificador curto (código, número de OS, patrimônio). */
export const MAX_SHORT_TEXT = 120;

/**
 * Aviso exibido ao usuário nos campos livres (LGPD art. 6º — minimização).
 * Não é apenas texto: define o comportamento esperado do servidor.
 */
export const LGPD_FREE_FIELD_NOTICE =
  "Não informe CPF, RG, telefone, endereço, dados de saúde ou outros dados pessoais desnecessários neste campo.";

/** Rótulos amigáveis por nome de campo, para mensagens de erro. */
const FIELD_LABELS: Record<string, string> = {
  reason: "Motivo",
  observation: "Observação",
  osNumber: "Número da OS",
  patrimony: "Patrimônio",
  name: "Nome",
  description: "Descrição",
  legalName: "Razão social",
  tradeName: "Nome fantasia",
  contact: "Contato",
  address: "Endereço",
  specification: "Especificação",
  brand: "Marca",
  model: "Modelo",
};

/**
 * Valida o tamanho de um campo de texto livre.
 *
 * @param label  Rótulo amigável exibido na mensagem de erro.
 * @param max    Limite máximo em caracteres.
 * @throws Error  Quando o valor excede o limite (nunca trunca).
 */
export function assertMaxLength(label: string, value: string | undefined | null, max: number): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") return;
  if (value.length <= max) return;
  throw new Error(
    `${label} muito longo: máximo de ${max} caracteres (recebido: ${value.length}). Reduza o texto e tente novamente.`,
  );
}

/**
 * Valida um conjunto de campos de texto livre de uma só vez.
 * Ignora campos ausentes — apenas rejeita os que excedem.
 */
export function assertTextLimits(
  fields: Record<string, string | undefined | null>,
  max: number = MAX_TEXT,
): void {
  for (const [field, value] of Object.entries(fields)) {
    assertMaxLength(FIELD_LABELS[field] ?? field, value, max);
  }
}

/** Atalho para o limite padrão de campos curtos (códigos/identificadores). */
export function assertShortTextLimits(
  fields: Record<string, string | undefined | null>,
): void {
  for (const [field, value] of Object.entries(fields)) {
    assertMaxLength(FIELD_LABELS[field] ?? field, value, MAX_SHORT_TEXT);
  }
}