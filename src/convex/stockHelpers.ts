/**
 * SIGESGD — Helpers puros de estoque (sem dependência do runtime Convex)
 *
 * Mantidos fora dos arquivos de função para permitir testes unitários
 * e reutilização entre backend e frontend.
 */

export interface LotLike {
  active?: boolean;
  entryId?: string;
}

/**
 * Verifica se um produto já possui carga inicial confirmada.
 *
 * Uma carga inicial é caracterizada por um lote ATIVO vinculado a uma entrada
 * com originType === "initial_inventory". Lotes de compras normais (purchase),
 * doações etc. NÃO caracterizam carga inicial e não bloqueiam a implantação.
 */
export async function hasInitialInventoryLot(
  lots: LotLike[],
  getEntry: (entryId: string) => Promise<any | null | undefined>
): Promise<boolean> {
  for (const lot of lots) {
    if (!lot.active || !lot.entryId) continue;
    const entry = await getEntry(lot.entryId);
    if (entry?.originType === "initial_inventory") return true;
  }
  return false;
}