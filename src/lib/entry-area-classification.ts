/**
 * Resolve a classificação efetiva para um item de entrada.
 * Área do item tem precedência; item legado ou sem sobrescrita herda o cabeçalho.
 * A localização física permanece independente desta classificação.
 */
export function resolveEntryItemAreaId(
  itemAreaId: string | null | undefined,
  defaultAreaId: string | null | undefined,
): string | undefined {
  return itemAreaId ?? defaultAreaId ?? undefined;
}
