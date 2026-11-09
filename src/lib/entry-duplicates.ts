/**
 * SIGESGD Capivari — D5: IDENTIDADE FISCAL DA ENTRADA (anti-duplicidade).
 *
 * Módulo PURO (sem React/Convex) com a MESMA regra usada pelo backend em
 * `src/convex/entries.ts` (create/confirm). Ele existe para que a comparação
 * de notas — que antes era só uma dica da interface — seja testável de verdade
 * e não dependa do texto-fonte da mutation.
 *
 * Regras:
 *  • A chave de acesso de 44 dígitos é soberana: quando as duas entradas têm
 *    chave, só o valor dela decide (duas notas reemitidas com o mesmo número e
 *    chaves diferentes continuam sendo documentos distintos).
 *  • Sem chave, a identidade é fornecedor + número + série, normalizados:
 *    número "000002967" = "2967" e série "001" = "1"; pontuação/espaços
 *    não contam.
 *  • Entrada ESTORNADA não bloqueia: a nota pode ser registrada de novo,
 *    preservando o histórico anterior.
 */
import { digitsOnly } from "./br-validators";

export interface EntryInvoiceIdentity {
  _id?: string;
  entryNumber?: string;
  status?: string | null;
  accessKey?: string | null;
  invoiceNumber?: string | null;
  series?: string | null;
  supplierId?: string | null;
}

/** Chave de acesso normalizada (somente dígitos) — vazia quando inválida. */
export function normalizeAccessKey(value?: string | null): string {
  const digits = digitsOnly(value ?? "").slice(0, 44);
  return digits.length === 44 ? digits : "";
}

/**
 * Número da nota normalizado: sem espaços/pontuação, sem zeros à esquerda e
 * em maiúsculas (aceita notas com série alfanumérica).
 */
export function normalizeInvoiceNumber(value?: string | null): string {
  return (value ?? "")
    .replace(/\s+/g, "")
    .replace(/^0+(?=\d)/, "")
    .toUpperCase();
}

/** Série normalizada: "001" e "1" são a mesma série. */
export function normalizeSeries(value?: string | null): string {
  return (value ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");
}

/**
 * Impressão digital usada para localizar rapidamente entradas NOVAS com a
 * mesma nota (índice `by_invoice_fingerprint`). Entradas anteriores a esta
 * correção não têm o campo e continuam cobertas pela varredura por data.
 */
export function entryInvoiceFingerprint(input: {
  supplierId?: string | null;
  invoiceNumber?: string | null;
  series?: string | null;
}): string | undefined {
  const number = normalizeInvoiceNumber(input.invoiceNumber);
  if (!number) return undefined;
  const series = normalizeSeries(input.series);
  const supplier = (input.supplierId ?? "").trim();
  return `nf:${number}|ser:${series}${supplier ? `|sup:${supplier}` : ""}`;
}

/** `true` quando as duas entradas representam a MESMA nota fiscal. */
export function isSameInvoice(
  a: EntryInvoiceIdentity,
  b: EntryInvoiceIdentity,
): boolean {
  if (a.status === "reversed" || b.status === "reversed") return false;

  const keyA = normalizeAccessKey(a.accessKey);
  const keyB = normalizeAccessKey(b.accessKey);
  // Chave de acesso é o identificador fiscal definitivo quando existe nos dois.
  if (keyA && keyB) return keyA === keyB;

  const numberA = normalizeInvoiceNumber(a.invoiceNumber);
  const numberB = normalizeInvoiceNumber(b.invoiceNumber);
  if (!numberA || !numberB || numberA !== numberB) return false;

  const seriesA = normalizeSeries(a.series);
  const seriesB = normalizeSeries(b.series);
  if (seriesA && seriesB && seriesA !== seriesB) return false;

  const supplierA = (a.supplierId ?? "").trim();
  const supplierB = (b.supplierId ?? "").trim();
  if (supplierA && supplierB && supplierA !== supplierB) return false;

  return true;
}

/**
 * Localiza uma entrada que já representa a mesma nota.
 * `reversed` é ignorada (nota estornada pode ser registrada novamente).
 */
export function findDuplicateInvoice<T extends EntryInvoiceIdentity>(
  entries: readonly T[],
  probe: EntryInvoiceIdentity,
  options: { excludeId?: string } = {},
): T | undefined {
  return entries.find(
    (entry) =>
      entry._id !== options.excludeId && isSameInvoice(entry, probe),
  );
}

/** Mensagem única de recusa (mesma no `create` e no `confirm`). */
export function duplicateInvoiceMessage(
  existing: EntryInvoiceIdentity,
  probe: EntryInvoiceIdentity,
): string {
  const label = existing.entryNumber ? ` (entrada ${existing.entryNumber})` : "";
  if (existing.status === "draft") {
    return (
      `Já existe um RASCUNHO desta nota${label}. ` +
      "Confirme o rascunho existente em vez de criar outra entrada."
    );
  }
  if (existing.status === "reversed") {
    // Não deveria acontecer (reversed é ignorada), mas a mensagem é honesta.
    return `Esta nota consta em uma entrada estornada${label}.`;
  }
  const invoice = normalizeInvoiceNumber(probe.invoiceNumber);
  const identificacao = invoice ? `NF-e ${invoice}` : "Esta NF-e";
  return (
    `${identificacao} já foi registrada${label}. ` +
    "Não é possível duplicar o estoque."
  );
}
