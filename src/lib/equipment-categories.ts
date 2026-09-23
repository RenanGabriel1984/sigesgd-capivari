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
