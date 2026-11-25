/**
 * Resolve a classificação efetiva para um item de entrada.
 * Área do item tem precedência; item legado ou sem sobrescrita herda o cabeçalho.
 * A localização física permanece independente desta classificação.
 */
export function resolveEntryItemAreaId<T extends string>(
  itemAreaId: T | null | undefined,
  defaultAreaId: T | null | undefined,
): T | undefined {
  return itemAreaId ?? defaultAreaId ?? undefined;
}
