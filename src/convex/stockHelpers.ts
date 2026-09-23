/**
 * Gestão de Estoque SGGD — Helpers puros de estoque (sem dependência do runtime Convex)
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
 * A Observação é a ÚLTIMA coluna: tudo após o 5º separador é preservado
 * integralmente (inclusive separadores internos e espaços), pois observações
 * reais contêm `;` — ex.: "Parte do kit original e 4 cores; CX735",
 * "Cat5E; 5 caixas com 100".
 *
 * Linhas sem produto são ignoradas; quantidade inválida vira 0.
 */
/** Divide a linha nos 5 primeiros campos; o restante vira o 6º (observação). */
function splitWithRest(line: string, sep: string): string[] {
  const out: string[] = [];
  let rest = line;
  for (let k = 0; k < 5; k++) {
    const idx = rest.indexOf(sep);
    if (idx === -1) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + sep.length);
  }
  out.push(rest);
  return out;
}

const clean = (s: string) => s.trim().replace(/^"|"$/g, "");

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
    const cols = splitWithRest(line, sep).map(clean);
    if (isFirstLine) {
      const first = (cols[0] ?? "").toLowerCase();
      if (["local", "localização", "localizacao", "location", "localidade"].includes(first)) {
        isFirstLine = false;
        continue;
      }
      isFirstLine = false;
    }
    if (!cols[1]) continue;
    // splitWithRest garante no máximo 6 campos: cols[5] é a observação
    // integral (com separadores internos preservados).
    const observation = cols[5] ?? "";
    const [locationName, productName, brand, quantity, unitOfMeasure] = cols;
    rows.push({
      locationName: locationName ?? "",
      productName,
      brand: brand ?? "",
      quantity: Math.max(0, Number((quantity ?? "").replace(",", ".")) || 0),
      unitOfMeasure: unitOfMeasure || "un",
      observation,
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
 * Busca de estoque: casa o termo com nome, marca, modelo, especificação,
 * fabricante e códigos internos (case-insensitive). Usada na tela de Estoque
 * para que o usuário encontre um item mesmo sem saber o nome exato.
 */
export function matchesStockSearch(
  product: {
    name: string;
    internalCode?: string | null;
    manufacturer?: string | null;
    brand?: string | null;
    model?: string | null;
    specification?: string | null;
  },
  term: string
): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const haystack = [
    product.name,
    product.internalCode,
    product.manufacturer,
    product.brand,
    product.model,
    product.specification,
  ]
    .filter((v): v is string => !!v)
    .join(" ")
    .toLowerCase();
  return haystack.includes(t);
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
 * Gestão de Estoque SGGD — Estoque de Implantação (data 15/09/2026)
 *
 * A carga inicial (entrada ENT-2026-000001, originType "initial_inventory",
 * 53 itens) representa o estoque físico EXISTENTE na data de implantação.
 * A partir da implantação o Gestão de Estoque SGGD opera normalmente sobre esse estoque:
 * saídas consomem os lotes normalmente e novos recebimentos entram como
 * Entrada de Material. O carimbo é APENAS de metadados/auditoria — nunca
 * altera quantidades, lotes, saldos ou movimentações.
 */
export const IMPLEMENTATION_STOCK_DATE = "15/09/2026";

/**
 * Marcador canônico gravado na observação da entrada de implantação.
 *
 * ATENÇÃO: este texto é HISTÓRICO — já está gravado nas entradas reais de
 * carga inicial (ENT-2026-000001). Renomear o aplicativo NÃO reescreve dados
 * já registrados: o marco permanece para preservar a rastreabilidade.
 */
export const IMPLEMENTATION_STOCK_STAMP =
  `ESTOQUE DE IMPLANTAÇÃO DO SIGESGD — data de implantação ${IMPLEMENTATION_STOCK_DATE} ` +
  `(estoque físico existente na implantação; saídas e entradas posteriores operam normalmente sobre este saldo)`;

/**
 * Variante atual do marco — permite reconhecer a carga inicial pelo nome
 * vigente do sistema, sem perder a compatibilidade com o texto histórico.
 */
export const IMPLEMENTATION_STOCK_STAMP_ALT =
  `ESTOQUE DE IMPLANTAÇÃO DO Gestão de Estoque SGGD`;

/**
 * Verifica se um texto já contém o marcador de implantação.
 * Usado para idempotência: aplicar o carimbo duas vezes não duplica.
 * Aceita o marco histórico e a variante com o nome atual.
 */
export function isImplementationStockStamped(observation?: string | null): boolean {
  if (!observation) return false;
  return (
    observation.includes("ESTOQUE DE IMPLANTAÇÃO DO SIGESGD") ||
    observation.includes(IMPLEMENTATION_STOCK_STAMP_ALT)
  );
}

/**
 * Aplica o carimbo de implantação a uma observação existente, preservando
 * o texto original. Pure function: retorna a observação final que a mutation
 * gravará. Idempotente — observar duas vezes produz o mesmo resultado.
 */
export function applyImplementationStockStamp(
  observation?: string | null
): string {
  if (isImplementationStockStamped(observation)) return observation as string;
  const prior = (observation ?? "").trim();
  return prior ? `${prior} | ${IMPLEMENTATION_STOCK_STAMP}` : IMPLEMENTATION_STOCK_STAMP;
}

/**
 * Gestão de Estoque SGGD — Numerador sequencial de SAÍDAS: SAI-ANO-SEQUENCIAL.
 * Puro em relação ao formato (número derivado da lista existente).
 * Nunca altera dados — apenas calcula.
 */
export function nextExitNumber(existingExitNumbers: string[], year: number): string {
  const prefix = `SAI-${year}-`;
  const maxNum = existingExitNumbers.reduce((max: number, value: string) => {
    const match = (value ?? "").match(/^SAI-\d{4}-(\d+)$/);
    if (match && value.startsWith(prefix)) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(6, "0")}`;
}

/** Lê as saídas existentes e devolve o próximo número SAI-ANO-SEQ. */
export async function generateExitNumber(ctx: any): Promise<string> {
  const exits = await ctx.db
    .query("stockMovements")
    .withIndex("by_type", (q: any) => q.eq("type", "exit"))
    .collect();
  const numbers = exits
    .map((m: any) => m.exitNumber as string | undefined)
    .filter((n: string | undefined): n is string => !!n);
  return nextExitNumber(numbers, new Date().getFullYear());
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