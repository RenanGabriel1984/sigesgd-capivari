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

export interface SheetRow {
  locationName: string;
  productName: string;
  brand: string;
  quantity: number;
  unitOfMeasure: string;
  observation: string;
}

/**
 * Interpreta o texto colado/importado da planilha de inventário físico.
 *
 * Formato aceito (separador `;` ou `,`, cabeçalho opcional):
 *   Localização; Produto; Marca; Quantidade; Unidade; Observação
 *   Armário TI 01; Cabo HDMI; Exbom; 8; un; Caixa original
 *
 * Linhas sem produto são ignoradas; quantidade inválida vira 0.
 */
export function parseSheetText(text: string): SheetRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  // Detecta separador pelo que aparece mais na primeira linha
  const semicolons = (lines[0].match(/;/g) ?? []).length;
  const commas = (lines[0].match(/,/g) ?? []).length;
  const sep = semicolons >= commas ? ";" : ",";

  const rows: SheetRow[] = [];
  let isFirstLine = true;
  for (const line of lines) {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (isFirstLine) {
      const first = (cols[0] ?? "").toLowerCase();
      if (["local", "localização", "localizacao", "location", "localidade"].includes(first)) {
        isFirstLine = false;
        continue;
      }
      isFirstLine = false;
    }
    const [locationName, productName, brand, quantity, unitOfMeasure, observation] = cols;
    if (!productName) continue;
    rows.push({
      locationName: locationName ?? "",
      productName,
      brand: brand ?? "",
      quantity: Math.max(0, Number((quantity ?? "").replace(",", ".")) || 0),
      unitOfMeasure: unitOfMeasure ?? "un",
      observation: observation ?? "",
    });
  }
  return rows;
}

/**
 * Corresponde uma linha da planilha a um produto existente pelo nome
 * (case-insensitive). Retorna null quando o produto precisa ser cadastrado.
 * Nunca cria duplicatas: a correspondência é exata por nome.
 */
export function matchSheetProduct(
  products: Array<{ _id: string; name: string }>,
  productName: string
): string | null {
  const name = productName.trim().toLowerCase();
  return products.find((p) => p.name.trim().toLowerCase() === name)?._id ?? null;
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