/**
 * Numeração global dos lotes de estoque.
 *
 * O número LOT-AAAA-NNNNNN identifica um lote no sistema inteiro, não apenas
 * dentro de um produto. Por isso, a próxima sequência é calculada sobre todos
 * os números existentes no ano, preservando lacunas e evitando reutilização.
 */
export function nextLotNumber(
  existingLotNumbers: readonly string[],
  year: number = new Date().getFullYear(),
): string {
  if (!Number.isSafeInteger(year) || year < 1000 || year > 9999) {
    throw new Error("Ano inválido para numeração de lote.");
  }

  const prefix = `LOT-${year}-`;
  let maxSequence = 0;

  for (const lotNumber of existingLotNumbers) {
    if (!lotNumber.startsWith(prefix)) continue;

    const suffix = lotNumber.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;

    const sequence = Number(suffix);
    if (Number.isSafeInteger(sequence) && sequence > maxSequence) {
      maxSequence = sequence;
    }
  }

  if (maxSequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Limite seguro da numeração de lotes atingido.");
  }

  return `${prefix}${String(maxSequence + 1).padStart(6, "0")}`;
}
