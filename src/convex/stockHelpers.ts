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
 * Observação padrão dos toners que fazem parte de um kit original de 4 cores.
 * Aplica-se a: Xerox VersaLink, Xerox AltaLink, Lexmark CX735 e Lexmark XM5365.
 * É apenas informação relacional/observacional — NÃO altera estoque físico e
 * NÃO agrupa os toners em um produto "kit".
 */
export const TONER_KIT_OBSERVATION = "Parte do kit original e 4 cores";

/**
 * Detecta se um item pertence a uma família de toner de kit de 4 cores e
 * retorna a observação padrão. Retorna null quando não se aplica.
 *
 * A detecção usa marca/modelo/especificação (nunca apenas "toner") para não
 * agrupar produtos diferentes — ex.: "TONER" genérico não corresponde.
 */
export function tonerKitObservation(input: {
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
}): string | null {
  const text = [input.name, input.brand, input.model, input.specification]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(" ")
    .toLowerCase();

  // As famílias são identificadas pelo modelo característico (como ocorre nas
  // descrições reais de NF-e, que nem sempre citam a marca): VersaLink,
  // AltaLink, CX-735 (Lexmark) e XM5365 (Lexmark).
  if (/versalink/.test(text)) return TONER_KIT_OBSERVATION;
  if (/altalink/.test(text)) return TONER_KIT_OBSERVATION;
  if (/cx\s*-?\s*735/.test(text)) return TONER_KIT_OBSERVATION;
  if (/xm\s*5365/.test(text)) return TONER_KIT_OBSERVATION;
  return null;
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