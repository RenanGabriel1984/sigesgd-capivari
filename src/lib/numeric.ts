/**
 * Normalização numérica do Gestão de Estoque SGGD.
 *
 * Por quê: o validador `v.number()` do Convex aceita Int64 (bigint) quando uma
 * função é invocada fora do browser (ex.: `convex run` com literais JSON), e o
 * schema roda com `schemaValidation: false`. Valores Int64 gravados quebram
 * qualquer aritmética ("Cannot mix BigInt and other types") e qualquer
 * `new Date(ts)` ("Cannot convert a BigInt value to a number").
 *
 * Estratégia:
 *  1. Causa raiz no banco: internalMutation `normalizeNumericFieldsInternal`
 *     regrava todo Int64 como number (diagnostics.ts).
 *  2. Defesa nos pontos de escrita sem validação estrita: normalização
 *     explícita com `toNumber` antes de qualquer aritmética/persistência.
 *  3. Conversão SEMPRE explícita e confirmada campo a campo — nunca casts
 *     aleatórios: só campos semanticamente numéricos são convertidos.
 */

/** Detecta valores Int64 (bigint) vindos do banco/CLI. */
export function isInt64(value: unknown): value is bigint {
  return typeof value === "bigint";
}

/**
 * Converte um valor para number JS com segurança:
 *  - bigint → number (preserva o valor exato dentro do intervalo seguro);
 *  - number → number (idempotente, valida finitude);
 *  - string numérica → number (parseFloat, para args de formulário);
 *  - null/undefined/inválido → 0 (neutro para quantidades/saldos).
 * Lança erro se o valor exceder o intervalo seguro de number.
 */
export function toNumber(value: unknown): number {
  if (isInt64(value)) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`Valor Int64 fora do intervalo seguro: ${value}`);
    }
    return n;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Valor numérico inválido: ${value}`);
    }
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  if (value === null || value === undefined) return 0;
  throw new Error(`Valor não numérico: ${String(value)}`);
}

/**
 * Normaliza os campos listados de um documento, retornando o patch com os
 * valores convertidos. Só inclui campos cujo valor era Int64 ou string
 * numérica — campos já numéricos NÃO entram no patch (idempotente).
 */
export function normalizeNumericPatch(
  doc: Record<string, unknown>,
  fields: readonly string[]
): Record<string, number> {
  const patch: Record<string, number> = {};
  for (const field of fields) {
    const value = doc[field];
    if (isInt64(value) || typeof value === "string") {
      patch[field] = toNumber(value);
    }
  }
  return patch;
}
