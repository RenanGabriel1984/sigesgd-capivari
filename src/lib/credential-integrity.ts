export type UniqueRecordResolution<T> =
  | { status: "missing" }
  | { status: "unique"; record: T }
  | { status: "ambiguous"; count: number };

/**
 * Never pick an arbitrary user or credential when a supposedly unique key
 * has duplicate rows. Callers decide whether absence is allowed.
 */
export function resolveUniqueRecord<T>(
  records: readonly T[],
): UniqueRecordResolution<T> {
  if (records.length === 0) return { status: "missing" };
  if (records.length > 1) return { status: "ambiguous", count: records.length };
  return { status: "unique", record: records[0] };
}

export function describeDuplicateCredential(count: number): string {
  const safeCount = Number.isSafeInteger(count) && count > 1 ? count : 2;
  return `Foram encontrados ${safeCount} registros para uma chave que deveria ser única. Regularize a duplicidade antes de continuar.`;
}
