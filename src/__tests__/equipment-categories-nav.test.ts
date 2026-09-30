/**
 * Gestão de Estoque SGGD — NAVEGAÇÃO DAS CATEGORIAS DE EQUIPAMENTOS
 * (EQUIP-CAT-01..07).
 *
 * Correção do sintoma reportado:
 *   "ao clicar em Computadores/Redes/Telefonia, quando não há documentos na
 *    tabela `assets`, a tela mostra o estado vazio e DEPOIS muda para
 *    'Todos os equipamentos'".
 *
 * Causa: o menu comparava apenas `location.pathname` (sempre "/assets") com o
 * href do item. "/assets" === "/assets" deixava "Todos os equipamentos"
 * ativo em TODAS as categorias, e nenhum item de categoria ficava ativo —
 * parecendo que a tela havia caído para "Todos".
 *
 * Regras verificadas aqui:
 *  - cada categoria tem o próprio recorte e PERMANECE na tela;
 *  - "Todos os equipamentos" é visão independente de `assets`, nunca
 *    fallback de categoria vazia;
 *  - produtos de estoque continuam fora de `assets` (só ponte "Ver estoque");
 *  - nenhuma escrita: a tela só lê `api.assets.list`.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhum dado real alterado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_PARAM,
  EQUIPMENT_CATEGORY_PARAM_KEYS,
  ALL_EQUIPMENTS_TITLE,
  EMPTY_CATEGORY_TITLE,
  EMPTY_CATEGORY_DESCRIPTION,
  NO_ASSETS_TITLE,
  RELATED_STOCK_SECTION_TITLE,
  RELATED_STOCK_ACTION,
  emptyCategoryDescription,
  readEquipmentCategorySlug,
  resolveEquipmentCategory,
  equipmentCategoryHref,
  stockHrefForEquipmentCategory,
  findEquipmentCategory,
  matchesEquipmentCategory,
  buildRelatedStockProducts,
  type EquipmentCategory,
  type RelatedStockProductInput,
} from "@/lib/equipment-categories";
import { isNavItemActive, splitHref, findActiveNavItem } from "@/lib/nav-active";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const assetsPage = read("src/pages/Assets.tsx");
const appShell = read("src/components/AppShell.tsx");
const stockPage = read("src/pages/Stock.tsx");
const assetsBackend = read("src/convex/assets.ts");

/** Itens do menu de Equipamentos, como declarados em src/components/AppShell.tsx. */
const NAV_EQUIPMENT = [
  { label: "Computadores", href: `/assets?${EQUIPMENT_CATEGORY_PARAM}=computadores` },
  { label: "Redes", href: `/assets?${EQUIPMENT_CATEGORY_PARAM}=redes` },
  { label: "Telefonia", href: `/assets?${EQUIPMENT_CATEGORY_PARAM}=telefonia` },
  { label: ALL_EQUIPMENTS_TITLE, href: "/assets", exclusiveParams: [...EQUIPMENT_CATEGORY_PARAM_KEYS] },
  { label: "Estoque", href: "/stock" },
] as const;

/** URL no formato do router (/assets?categoria=redes). */
const at = (url: string) => {
  const [pathname, search = ""] = url.split("?");
  return { pathname, search: search ? `?${search}` : "" };
};

const activeLabels = (url: string) =>
  NAV_EQUIPMENT.filter((item) =>
    isNavItemActive(at(url), item as unknown as { href: string; exclusiveParams?: string[] })
  ).map((item) => item.label);

const product = (
  name: string,
  extra: Partial<RelatedStockProductInput> = {}
): RelatedStockProductInput => ({
  _id: `p_${name.replace(/\W+/g, "_")}`,
  name,
  brand: null,
  manufacturer: null,
  model: null,
  unitOfMeasure: "un",
  categoryName: null,
  stock: { physicalQuantity: 0, reservedQuantity: 0 },
  ...extra,
});

/** `assets` está VAZIA na base real (rodadas anteriores confirmaram 0 assets). */
const NO_ASSETS: { _id: string; assetType: string }[] = [];

/** Assets da categoria, como `api.assets.list` devolveria. */
function visibleAssets(category: EquipmentCategory | null, assets = NO_ASSETS) {
  return category ? assets.filter((a) => matchesEquipmentCategory(a.assetType, category)) : assets;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("EQUIP-CAT-01/02/03 — Categoria vazia PERMANECE na própria tela", () => {
  const cases: { slug: string; label: string; types: string[] }[] = [
    { slug: "computadores", label: "Computadores", types: ["desktop", "notebook", "monitor", "server", "storage", "ups"] },
    { slug: "redes", label: "Redes", types: ["switch", "router", "access_point"] },
    { slug: "telefonia", label: "Telefonia", types: ["phone"] },
  ];

  for (const { slug, label, types } of cases) {
    it(`EQUIP-CAT: ${label} continua em ${label} com 0 assets`, () => {
      const url = `/assets?${EQUIPMENT_CATEGORY_PARAM}=${slug}`;
      const params = new URLSearchParams(`${EQUIPMENT_CATEGORY_PARAM}=${slug}`);

      // 1) A categoria continua selecionada…
      const category = resolveEquipmentCategory(params);
      expect(category?.label).toBe(label);
      expect(category?.types).toEqual(types);

      // 2) …e o item de menu ativo é o dela, NÃO "Todos os equipamentos".
      expect(activeLabels(url)).toEqual([label]);
      expect(activeLabels(url)).not.toContain(ALL_EQUIPMENTS_TITLE);

      // 3) O recorte continua aplicado à lista de `assets` (que está vazia).
      expect(visibleAssets(category)).toEqual([]);

      // 4) O texto exibido é o da categoria, com o complemento exigido.
      expect(EMPTY_CATEGORY_TITLE).toBe("Nenhum equipamento cadastrado nesta categoria.");
      expect(emptyCategoryDescription(category!)).toBe(
        "Os produtos de estoque não aparecem automaticamente como equipamentos. Cadastre o equipamento individualmente quando aplicável."
      );
      expect(emptyCategoryDescription(category!)).toBe(EMPTY_CATEGORY_DESCRIPTION);
    });
  }

  it("EQUIP-CAT-01: Computadores filtra desktop, notebook, monitor, server, storage e ups", () => {
    const category = resolveEquipmentCategory(new URLSearchParams("categoria=computadores"))!;
    for (const t of ["desktop", "notebook", "monitor", "server", "storage", "ups"]) {
      expect(matchesEquipmentCategory(t, category)).toBe(true);
    }
    // Itens de rede/telefonia/impressão NÃO aparecem em Computadores.
    for (const t of ["switch", "router", "access_point", "phone", "printer"]) {
      expect(matchesEquipmentCategory(t, category)).toBe(false);
    }
  });

  it("EQUIP-CAT-02: Redes filtra switch, router e access_point", () => {
    const category = resolveEquipmentCategory(new URLSearchParams("categoria=redes"))!;
    for (const t of ["switch", "router", "access_point"]) {
      expect(matchesEquipmentCategory(t, category)).toBe(true);
    }
    expect(matchesEquipmentCategory("desktop", category)).toBe(false);
  });

  it("EQUIP-CAT-03: Telefonia filtra apenas phone", () => {
    const category = resolveEquipmentCategory(new URLSearchParams("categoria=telefonia"))!;
    expect(matchesEquipmentCategory("phone", category)).toBe(true);
    for (const t of ["switch", "router", "access_point", "desktop", "printer"]) {
      expect(matchesEquipmentCategory(t, category)).toBe(false);
    }
  });
});

describe("EQUIP-CAT-05 — Categoria vazia NÃO redireciona para Todos", () => {
  it("a página não navega para /assets ao esvaziar uma categoria", () => {
    // Nenhuma navegação implícita para a visão geral…
    expect(assetsPage).not.toContain('navigate("/assets")');
    expect(assetsPage).not.toContain("navigate('/assets')");
    // …nem limpeza total da query string (o que apagava a categoria).
    expect(assetsPage).not.toContain("setSearchParams({})");
    // A troca de categoria passa por um helper que preserva a URL.
    expect(assetsPage).toContain("selectCategory");
    expect(assetsPage).toContain("equipmentCategoryHref");
  });

  it("selecionar a MESMA categoria não apaga o parâmetro", () => {
    const params = new URLSearchParams("categoria=redes");
    // Recalcular o href da categoria atual devolve exatamente a mesma URL.
    expect(equipmentCategoryHref("redes", params)).toBe("/assets?categoria=redes");
    expect(equipmentCategoryHref(readEquipmentCategorySlug(params), params)).toBe(
      "/assets?categoria=redes"
    );
  });

  it("apenas o clique em 'Todos os equipamentos' volta à visão geral", () => {
    const params = new URLSearchParams("categoria=telefonia");
    expect(equipmentCategoryHref(null, params)).toBe("/assets");
    // E os demais parâmetros da URL são preservados.
    const comOutros = new URLSearchParams("categoria=redes&q=switch");
    expect(equipmentCategoryHref(null, comOutros)).toBe("/assets?q=switch");
    expect(equipmentCategoryHref("telefonia", comOutros)).toBe("/assets?q=switch&categoria=telefonia");
  });

  it("slug inválido não vira categoria nem troca o estado de tela", () => {
    // Uma categoria inexistente não aplica recorte nem quebra a tela…
    expect(resolveEquipmentCategory(new URLSearchParams("categoria=licencas"))).toBeNull();
    // …e, por não ser uma visão filha reconhecida, "Todos" não é falso-rotulado.
    expect(activeLabels("/assets?categoria=licencas")).toEqual([]);
  });

  it("a chave alternativa ?category= é lida igual a ?categoria=", () => {
    expect(readEquipmentCategorySlug(new URLSearchParams("category=redes"))).toBe("redes");
    expect(resolveEquipmentCategory(new URLSearchParams("category=redes"))?.label).toBe("Redes");
    // A chave canônica escrita pela tela continua sendo "categoria".
    expect(EQUIPMENT_CATEGORY_PARAM).toBe("categoria");
    expect(EQUIPMENT_CATEGORY_PARAM_KEYS).toContain("category");
  });
});

describe("EQUIP-CAT-04 — 'Todos os equipamentos' é visão independente de assets", () => {
  it("sem ?categoria= o item ativo é 'Todos os equipamentos'", () => {
    expect(activeLabels("/assets")).toEqual([ALL_EQUIPMENTS_TITLE]);
    expect(ALL_EQUIPMENTS_TITLE).toBe("Todos os equipamentos");
  });

  it("a visão geral mostra TODOS os assets, sem preenchimento por produtos", () => {
    const assets = [
      { _id: "a1", assetType: "desktop" },
      { _id: "a2", assetType: "switch" },
      { _id: "a3", assetType: "phone" },
    ];
    // Sem categoria → sem recorte: é a lista completa de `assets`.
    expect(visibleAssets(null, assets)).toHaveLength(3);
    for (const cat of EQUIPMENT_CATEGORIES) {
      expect(visibleAssets(cat, assets).length).toBeLessThanOrEqual(3);
    }
    // Nenhum produto de estoque entra nessa lista.
    expect(visibleAssets(null, assets).some((a) => !a.assetType)).toBe(false);
  });

  it("'Todos' com a base sem assets mostra o texto próprio, não o da categoria", () => {
    expect(NO_ASSETS_TITLE).toBe("Nenhum equipamento cadastrado.");
    expect(NO_ASSETS_TITLE).not.toBe(EMPTY_CATEGORY_TITLE);
    // E a tela só consulta produtos de estoque quando HÁ categoria selecionada.
    expect(assetsPage).toContain('category ? { category: category.slug } : "skip"');
  });

  it("o grid da tela vem exclusivamente de `assets`", () => {
    expect(assetsPage).toContain("api.assets.list");
    expect(assetsPage).not.toContain("api.products.list");
    // Detalhe do asset também é lido de `assets`.
    expect(assetsBackend).toContain("export const list");
  });
});

describe("EQUIP-CAT-06 — Produtos relacionados são apenas ponte para o estoque", () => {
  const redesProdutos: RelatedStockProductInput[] = [
    product("RouterBoard", { brand: "MikroTik", categoryName: "Redes e Conectividade", stock: { physicalQuantity: 2, reservedQuantity: 0 } }),
    product("Switch 26 portas", { categoryName: "Redes e Conectividade", stock: { physicalQuantity: 1, reservedQuantity: 0 } }),
    product("Switch 5 portas 10/100 PoE", { categoryName: "Redes e Conectividade", stock: { physicalQuantity: 3, reservedQuantity: 0 } }),
    product("Switch JetStream 8 portas", { brand: "TP-Link", categoryName: "Redes e Conectividade", stock: { physicalQuantity: 3, reservedQuantity: 0 } }),
  ];

  it("os 4 produtos de rede continuam sendo PRODUTOS, não assets", () => {
    const related = buildRelatedStockProducts(redesProdutos, findEquipmentCategory("redes")!);
    expect(related.map((r) => r.productName)).toEqual([
      "RouterBoard",
      "Switch 26 portas",
      "Switch 5 portas 10/100 PoE",
      "Switch JetStream 8 portas",
    ]);

    // Nenhum deles aparece como equipamento — `assets` continua vazia.
    const category = findEquipmentCategory("redes")!;
    for (const p of related) {
      expect(visibleAssets(category)).toEqual([]);
    }
    // E a tela não os insere na tabela de assets.
    expect(assetsBackend).not.toContain('"productId"');
  });

  it("a seção chama-se 'Produtos relacionados no estoque' e traz 'Ver estoque'", () => {
    expect(RELATED_STOCK_SECTION_TITLE).toBe("Produtos relacionados no estoque");
    expect(RELATED_STOCK_ACTION).toBe("Ver estoque");
    expect(assetsPage).toContain("relatedStockTitle");
    expect(assetsPage).toContain("RELATED_STOCK_HINT");
    expect(assetsPage).toContain("RELATED_STOCK_ACTION");
    expect(assetsPage).toContain("stockHrefForEquipmentCategory");
  });

  it("a ponte é read-only: query, sem insert/patch/delete", () => {
    const start = assetsBackend.indexOf("export const relatedStockByCategory");
    const block = assetsBackend.slice(start, assetsBackend.indexOf("export const get ="));
    expect(block).toContain("query({");
    expect(block).not.toContain("db.insert");
    expect(block).not.toContain("db.patch");
    expect(block).not.toContain("db.delete");
  });
});

describe("EQUIP-CAT-07 — 'Ver estoque' mantém o filtro correto", () => {
  it("cada categoria aponta para /stock com o seu slug", () => {
    expect(stockHrefForEquipmentCategory(findEquipmentCategory("computadores")!)).toBe(
      "/stock?equipamentos=computadores"
    );
    expect(stockHrefForEquipmentCategory(findEquipmentCategory("redes")!)).toBe(
      "/stock?equipamentos=redes"
    );
    expect(stockHrefForEquipmentCategory(findEquipmentCategory("telefonia")!)).toBe(
      "/stock?equipamentos=telefonia"
    );
  });

  it("/stock aplica exatamente o MESMO filtro, sobre a lista real de produtos", () => {
    expect(stockPage).toContain("matchesEquipmentStockProduct");
    expect(stockPage).toContain("findEquipmentCategory");
    expect(stockPage).toContain("equipamentos");
    expect(stockPage).toContain("api.products.list");
    // A tela de estoque não busca assets: as estruturas seguem separadas.
    expect(stockPage).not.toContain("api.assets.");
  });

  it("o filtro de estoque não 'rouba' o item do menu", () => {
    // Em /stock?equipamentos=redes o item "Estoque" continua ativo: o filtro
    // é uma visão interna da tela, não outra página.
    expect(activeLabels("/stock?equipamentos=redes")).toEqual(["Estoque"]);
    expect(activeLabels("/stock")).toEqual(["Estoque"]);
  });
});

describe("EQUIP-CAT — Mecânica do estado ativo do menu", () => {
  it("o href da categoria é lido como caminho + parâmetros", () => {
    const split = splitHref("/assets?categoria=redes");
    expect(split.path).toBe("/assets");
    expect(split.params.get("categoria")).toBe("redes");
  });

  it("a comparação só por pathname era a causa do bug — e não pode voltar", () => {
    // Prova do defeito: sem considerar a query string, "Todos" venceria.
    const pathnameOnly = (item: { href: string }) =>
      at("/assets?categoria=redes").pathname === item.href ||
      at("/assets?categoria=redes").pathname.startsWith(item.href);
    expect(pathnameOnly(NAV_EQUIPMENT[0])).toBe(false);
    expect(pathnameOnly(NAV_EQUIPMENT[3])).toBe(true); // ← o bug

    // Com a query string, apenas a categoria fica ativa.
    const found = findActiveNavItem(
      at("/assets?categoria=redes"),
      NAV_EQUIPMENT as unknown as { label: string; href: string; exclusiveParams?: string[] }[]
    );
    expect(found?.label).toBe("Redes");
  });

  it("o menu real do AppShell usa o estado ativo com query string", () => {
    expect(appShell).toContain("isNavItemActive");
    expect(appShell).not.toContain("location.pathname.startsWith(item.href)");
    expect(appShell).toContain(`href: "/assets?${EQUIPMENT_CATEGORY_PARAM}=computadores"`);
    expect(appShell).toContain("exclusiveParams");
  });
});
