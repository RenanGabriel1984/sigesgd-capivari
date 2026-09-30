/**
 * Gestão de Estoque SGGD — CATEGORIAS DE EQUIPAMENTOS (estrutura do sistema).
 *
 *   Equipamentos
 *   ├── Impressoras
 *   ├── Computadores
 *   ├── Redes
 *   └── Telefonia
 *
 * Cada categoria é apenas um agrupamento de NAVEGAÇÃO sobre os tipos de
 * equipamento já existentes (assets.assetType).
 *
 * IMPORTANTE — dimensões que NÃO se misturam:
 *   - categoria de equipamento NÃO é fornecedor;
 *   - categoria de equipamento NÃO é área/subestoque;
 *   - fornecedor NÃO determina categoria, área nem localização.
 *
 * Por isso o fornecedor NUNCA aparece no nome estrutural do menu: se uma nova
 * licitação trocar a empresa contratada, a estrutura continua idêntica e o
 * histórico permanece com o fornecedor de cada entrada.
 *
 * ─── PRODUTO × EQUIPAMENTO ────────────────────────────────────────────────
 *   PRODUTO     = material existente no estoque (products/stock/lots).
 *   EQUIPAMENTO = ativo individual cadastrado em `assets`.
 *
 * Um produto de estoque NUNCA vira equipamento automaticamente:
 *   - "Switch TP-Link 8 portas" com saldo 3 é PRODUTO (estoque = 3);
 *   - "Switch TP-Link" com patrimônio 12345 é EQUIPAMENTO.
 *
 * As funções `matchesEquipmentStockProduct` / `buildRelatedStockProducts`
 * são somente LEITURA: elas apenas APONTAM onde estão os produtos parecidos,
 * nunca criam assets, nunca movem saldo e nunca duplicam estoque.
 */

export interface EquipmentCategory {
  /** identificador usado em /assets?categoria=<slug> */
  slug: string;
  label: string;
  description: string;
  /** tipos de equipamento (assets.assetType) que compõem a categoria */
  types: string[];
}

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = [
  {
    slug: "impressoras",
    label: "Impressoras",
    description: "Impressoras e multifuncionais — parque instalado e suprimentos de impressão",
    types: ["printer"],
  },
  {
    slug: "computadores",
    label: "Computadores",
    description: "Desktops, notebooks, monitores, servidores, armazenamento e nobreaks",
    types: ["desktop", "notebook", "monitor", "server", "storage", "ups"],
  },
  {
    slug: "redes",
    label: "Redes",
    description: "Switches, roteadores e access points",
    types: ["switch", "router", "access_point"],
  },
  {
    slug: "telefonia",
    label: "Telefonia",
    description: "Telefones e equipamentos de comunicação",
    types: ["phone"],
  },
];

/** Rótulos de tipo de equipamento exibidos na interface. */
export const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  notebook: "Notebook",
  monitor: "Monitor",
  server: "Servidor",
  printer: "Impressora",
  switch: "Switch",
  router: "Roteador",
  access_point: "Access Point",
  ups: "UPS",
  storage: "Armazenamento",
  phone: "Telefone",
  other: "Outro",
};

/* ─── Parâmetro de URL da categoria ───────────────────────────────────────── */

/** Chave canônica lida/escrita por /assets (mantém os links já publicados). */
export const EQUIPMENT_CATEGORY_PARAM = "categoria";

/** Chave alternativa aceita na leitura (links antigos / especificação externa). */
export const EQUIPMENT_CATEGORY_PARAM_ALIAS = "category";

/** Todas as chaves reconhecidas como "categoria de equipamento". */
export const EQUIPMENT_CATEGORY_PARAM_KEYS = [
  EQUIPMENT_CATEGORY_PARAM,
  EQUIPMENT_CATEGORY_PARAM_ALIAS,
] as const;

/** Qualquer objeto compatível com a leitura de query string (`URLSearchParams`). */
export interface CategoryParamsReader {
  get(key: string): string | null;
}

/**
 * Lê o slug da categoria da URL sem validar e sem silenciar a escolha.
 * Retorna `null` quando NENHUMA chave está presente — a ausência de parâmetro
 * significa a visão independente "Todos os equipamentos", nunca um fallback.
 */
export function readEquipmentCategorySlug(params: CategoryParamsReader | null | undefined): string | null {
  if (!params) return null;
  for (const key of EQUIPMENT_CATEGORY_PARAM_KEYS) {
    const raw = params.get(key);
    if (raw == null) continue;
    const slug = raw.trim().toLowerCase();
    if (slug) return slug;
  }
  return null;
}

/**
 * Categoria efetivamente selecionada na URL.
 *
 * Um slug INVÁLIDO ("/assets?categoria=licencas") resolve para `null` — a tela
 * volta ao recorte de todos os assets sem apagar o parâmetro da URL.
 */
export function resolveEquipmentCategory(
  params: CategoryParamsReader | null | undefined
): EquipmentCategory | null {
  return findEquipmentCategory(readEquipmentCategorySlug(params));
}

/** Query string da categoria, preservando os demais parâmetros existentes. */
export function equipmentCategoryHref(
  slug: string | null,
  current?: URLSearchParams
): string {
  const params = new URLSearchParams(current?.toString() ?? "");
  for (const key of EQUIPMENT_CATEGORY_PARAM_KEYS) params.delete(key);
  if (slug) params.set(EQUIPMENT_CATEGORY_PARAM, slug);
  const query = params.toString();
  return query ? `/assets?${query}` : "/assets";
}

/** Resolve a categoria pelo slug da URL. Retorna null quando ausente/inválido. */
export function findEquipmentCategory(slug?: string | null): EquipmentCategory | null {
  if (!slug) return null;
  const normalized = slug.trim().toLowerCase();
  return EQUIPMENT_CATEGORIES.find((category) => category.slug === normalized) ?? null;
}

/** Um equipamento pertence à categoria quando seu tipo está na lista da categoria. */
export function matchesEquipmentCategory(
  assetType: string | undefined | null,
  category: EquipmentCategory
): boolean {
  if (!assetType) return false;
  return category.types.includes(assetType);
}

/* ─── Palavras-chave de ESTOQUE relacionadas a cada categoria ────────────── */

/**
 * Nomes de CATEGORIA de produto (tabela `categories`) cujo conteúdo pertence à
 * categoria de equipamento. Sinal mais forte: o item já está classificado como
 * rede/telefonia/etc. pelo catálogo.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  impressoras: ["suprimentos de impressão", "impressao", "impressão"],
  computadores: ["periféricos", "perifericos", "armazenamento e hardware", "hardware"],
  redes: ["redes e conectividade", "rede", "conectividade"],
  telefonia: ["telefonia e comunicação", "telefonia", "comunicação", "comunicacao"],
};

/**
 * Palavras-chave do NOME/MARCA/MODELO do produto. Complementam a categoria do
 * catálogo quando o item foi cadastrado em uma categoria genérica.
 * Termos deliberadamente específicos para não capturar itens vizinhos
 * (ex.: "fita" NÃO entra em impressoras — "Fita isolante" é material elétrico).
 */
const NAME_KEYWORDS: Record<string, string[]> = {
  impressoras: [
    "toner",
    "impressora",
    "multifuncional",
    "cartucho",
    "ribbon",
    "papel",
    "etiqueta",
    "crachá",
    "cartao pvc",
    "cartão pvc",
    "protetor de crachá",
  ],
  computadores: [
    "desktop",
    "notebook",
    "monitor",
    "servidor",
    "armazenamento",
    "nobreak",
    "ups",
    "teclado",
    "mouse",
    "cooler",
    "processador",
    "memória",
    "memoria",
    "placa de vídeo",
    "placa de video",
    "gabinete",
    "leitor de dvd",
    "hd externo",
    "disco rigido",
    "disco rígido",
    "ssd",
    "nvme",
  ],
  redes: [
    "switch",
    "roteador",
    "router",
    "routerboard",
    "access point",
    "jetstream",
    "rj45",
    "cat5",
    "cat6",
    "patch panel",
    "mikrotik",
    "cabo de rede",
    "poe",
  ],
  telefonia: ["telefone", "ramal", "voip", "headset", "fone de ouvido", "atendimento automatico"],
};

function normalizeForMatch(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

/** Remove acentos para casar "impressão"/"impressao", "módem"/"modem" etc. */
function deaccent(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function haystackOf(p: {
  name: string;
  brand?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}): string {
  return deaccent(
    normalizeForMatch(p.name) + " " +
      normalizeForMatch(p.brand) + " " +
      normalizeForMatch(p.manufacturer) + " " +
      normalizeForMatch(p.model)
  );
}

/**
 * O PRODUTO de estoque é relacionado à categoria de equipamento?
 *
 * Regra OR entre (a) categoria do catálogo e (b) palavras-chave do nome.
 * Retorna false quando a categoria é nula — sem categoria não há relação.
 */
export function matchesEquipmentStockProduct(
  product: {
    name: string;
    brand?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    categoryName?: string | null;
  },
  category: EquipmentCategory | null
): boolean {
  if (!category) return false;

  const categoryName = deaccent(normalizeForMatch(product.categoryName));
  for (const keyword of CATEGORY_KEYWORDS[category.slug] ?? []) {
    if (categoryName.includes(deaccent(keyword))) return true;
  }

  const haystack = haystackOf(product);
  for (const keyword of NAME_KEYWORDS[category.slug] ?? []) {
    if (haystack.includes(deaccent(keyword))) return true;
  }
  return false;
}

export interface RelatedStockProduct {
  productId: string;
  productName: string;
  brand: string | null;
  model: string | null;
  unitOfMeasure: string;
  /** Saldo físico REAL do produto (nunca calculado, nunca inventado). */
  physicalQuantity: number;
  reservedQuantity: number;
  /** físico − reservado, nunca negativo. */
  availableQuantity: number;
}

export interface RelatedStockProductInput {
  _id: string;
  name: string;
  brand?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  unitOfMeasure: string;
  categoryName?: string | null;
  stock?: { physicalQuantity?: number; reservedQuantity?: number } | null;
}

/**
 * Lista de produtos de estoque relacionados a uma categoria de equipamento.
 * SOMENTE LEITURA e somente apresentação: devolve os registros ORIGINAIS de
 * `products`/`stock` — nenhuma linha nova de estoque é criada.
 *
 * Só entram produtos com saldo físico > 0 (produto sem saldo não é "estoque
 * relacionado"); a ordenação é alfabética para ser estável.
 */
export function buildRelatedStockProducts(
  products: RelatedStockProductInput[],
  category: EquipmentCategory | null
): RelatedStockProduct[] {
  if (!category) return [];
  const out: RelatedStockProduct[] = [];
  for (const p of products) {
    const physical = p.stock?.physicalQuantity ?? 0;
    if (physical <= 0) continue;
    if (!matchesEquipmentStockProduct(p, category)) continue;
    const reserved = p.stock?.reservedQuantity ?? 0;
    out.push({
      productId: p._id,
      productName: p.name,
      brand: p.brand ?? p.manufacturer ?? null,
      model: p.model ?? null,
      unitOfMeasure: p.unitOfMeasure,
      physicalQuantity: physical,
      reservedQuantity: reserved,
      availableQuantity: Math.max(physical - reserved, 0),
    });
  }
  return out.sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR"));
}

/* ─── Cópia dos estados vazios (explicativa, nunca "erro de estoque") ──────── */

/** Título da visão independente que mostra todos os assets. */
export const ALL_EQUIPMENTS_TITLE = "Todos os equipamentos";

/** Exibida quando /assets (Todos os equipamentos) não tem nenhum asset. */
export const NO_ASSETS_TITLE = "Nenhum equipamento cadastrado.";

/** Explicita que produto de estoque não entra automaticamente em equipment. */
export const NO_ASSETS_DESCRIPTION =
  "Os itens de estoque não aparecem aqui automaticamente. Esta área controla equipamentos/ativos individualmente.";

/** Título do estado vazio de uma categoria específica. */
export function emptyCategoryTitle(categoryLabel: string): string {
  return `Nenhum equipamento cadastrado nesta categoria${categoryLabel ? ` (${categoryLabel})` : ""}.`;
}

/** Título exato exigido para categoria vazia (sem sufixo redundante). */
export const EMPTY_CATEGORY_TITLE = "Nenhum equipamento cadastrado nesta categoria.";

/** Explicação de que a categoria está vazia por falta de cadastro patrimonial. */
export function emptyCategoryDescription(category: EquipmentCategory): string {
  return EMPTY_CATEGORY_DESCRIPTION;
}

/**
 * Complemento fixo exigido para toda categoria vazia: o motivo de não haver
 * equipamentos NÃO é falta de produto no estoque.
 */
export const EMPTY_CATEGORY_DESCRIPTION =
  "Os produtos de estoque não aparecem automaticamente como equipamentos. Cadastre o equipamento individualmente quando aplicável.";

/** Cabeçalho exato do bloco de produtos de estoque relacionados. */
export const RELATED_STOCK_SECTION_TITLE = "Produtos relacionados no estoque";

/** Cabeçalho do bloco de produtos de estoque relacionados, com a categoria. */
export function relatedStockTitle(categoryLabel: string): string {
  return `${RELATED_STOCK_SECTION_TITLE} (${categoryLabel})`;
}

/** Explica que são PRODUTOS, não equipamentos — evita confusão. */
export const RELATED_STOCK_HINT =
  "Estes são produtos de ESTOQUE, não equipamentos: nenhum item vira equipamento automaticamente.";

/** Rótulo do atalho para a tela de estoque. */
export const RELATED_STOCK_ACTION = "Ver estoque";

/**
 * Query string do atalho "Ver estoque" — leva a categoria para /stock.
 * A tela de estoque aplica o MESMO filtro (`matchesEquipmentStockProduct`),
 * de modo que a lista é sempre a mesma: nenhum estoque é duplicado.
 */
export function stockHrefForEquipmentCategory(category: EquipmentCategory): string {
  return `/stock?equipamentos=${category.slug}`;
}

/** Parâmetro de URL lido por /stock para filtrar por categoria de equipamento. */
export const EQUIPMENT_STOCK_PARAM = "equipamentos";
