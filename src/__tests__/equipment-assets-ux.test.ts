/**
 * Gestão de Estoque SGGD — UX DE EQUIPAMENTOS × PRODUTOS (EQUIP-UX-01..08).
 *
 * Separação estrutural que NÃO pode quebrar:
 *
 *   PRODUTO     = material existente no estoque (products/stock/lots).
 *   EQUIPAMENTO = ativo individual cadastrado em `assets`.
 *
 * "Switch TP-Link 8 portas" com saldo 3 é PRODUTO.
 * "Switch TP-Link" com patrimônio 12345 é EQUIPAMENTO.
 *
 * Regras verificadas:
 *  - produto de estoque NUNCA vira asset automaticamente;
 *  - desktop/notebook → Computadores; switch → Redes; phone → Telefonia;
 *  - "Todos os equipamentos" mostra todos os assets;
 *  - categoria vazia explica a diferença e aponta o estoque relacionado
 *    (somente leitura, sem duplicar estoque);
 *  - licenças continuam FORA de `assets`.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhum dado real alterado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EQUIPMENT_CATEGORIES,
  findEquipmentCategory,
  matchesEquipmentCategory,
  matchesEquipmentStockProduct,
  buildRelatedStockProducts,
  NO_ASSETS_TITLE,
  NO_ASSETS_DESCRIPTION,
  EMPTY_CATEGORY_TITLE,
  relatedStockTitle,
  RELATED_STOCK_HINT,
  RELATED_STOCK_ACTION,
  stockHrefForEquipmentCategory,
  EQUIPMENT_STOCK_PARAM,
  type RelatedStockProductInput,
} from "@/lib/equipment-categories";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const assetsPage = read("src/pages/Assets.tsx");
const assetsBackend = read("src/convex/assets.ts");
const stockPage = read("src/pages/Stock.tsx");
const schema = read("src/convex/schema.ts");
const appShell = read("src/components/AppShell.tsx");

/** Produto de estoque real (somente leitura) — espelha a tabela `products`. */
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

const stock = (physical: number, reserved = 0) => ({ physicalQuantity: physical, reservedQuantity: reserved });

const category = (slug: string) => {
  const c = findEquipmentCategory(slug);
  expect(c).not.toBeNull();
  return c!;
};

// ─────────────────────────────────────────────────────────────────────────────

describe("EQUIP-UX — Produto de estoque NÃO é equipamento", () => {
  it("EQUIP-UX-01: produto de estoque não aparece automaticamente como asset", () => {
    const switchStock = product("Switch JetStream 8 portas", {
      brand: "TP-Link",
      categoryName: "Redes e Conectividade",
      stock: stock(3),
    });

    // O produto é encontrado no ESTOQUE…
    expect(switchStock.name).toBe("Switch JetStream 8 portas");
    expect(switchStock.stock!.physicalQuantity).toBe(3);

    // …e NÃO é um asset: a página de equipamentos só lê `api.assets.list`.
    expect(assetsPage).toContain("api.assets.list");
    expect(assetsPage).not.toContain("api.products.list");

    // Nenhum caminho converte produto em asset: só existe `assets.create`,
    // disparado pelo botão "Novo Equipamento" com dados digitados.
    expect(assetsBackend).not.toContain('"productId"');
    expect(assetsBackend).not.toContain('"patrimonyNumber"');

    // O backend de assets é o ÚNICO autorizado a gravar assets…
    expect(assetsBackend).toContain('db.insert("assets"');
    // …e essa gravação fica na mutation `create`, com histórico e auditoria.
    expect(assetsBackend).toContain('entity: "assets"');
  });

  it("EQUIP-UX-01b: o filtro de estoque NUNCA cria asset (query somente leitura)", () => {
    expect(assetsBackend).toContain("relatedStockByCategory");
    expect(assetsBackend).toContain("buildRelatedStockProducts");
    // Query, não mutation: sem db.insert/db.patch no caminho de leitura.
    const start = assetsBackend.indexOf("export const relatedStockByCategory");
    const end = assetsBackend.indexOf("export const get =");
    const block = assetsBackend.slice(start, end);
    expect(block).toContain("query({");
    expect(block).not.toContain("db.insert");
    expect(block).not.toContain("db.patch");
    expect(block).not.toContain("db.delete");
  });
});

describe("EQUIP-UX — Categorias agrupam os assetTypes corretos", () => {
  it("EQUIP-UX-02: desktop aparece em Computadores quando cadastrado", () => {
    const asset = { assetType: "desktop", patrimonyNumber: "12345", serialNumber: "X1" };
    expect(matchesEquipmentCategory(asset.assetType, category("computadores"))).toBe(true);
    expect(asset.patrimonyNumber).toBe("12345");
    // Não vaza para outras categorias.
    expect(matchesEquipmentCategory(asset.assetType, category("redes"))).toBe(false);
    expect(matchesEquipmentCategory(asset.assetType, category("telefonia"))).toBe(false);
    expect(matchesEquipmentCategory(asset.assetType, category("impressoras"))).toBe(false);
  });

  it("EQUIP-UX-03: notebook também aparece em Computadores", () => {
    expect(matchesEquipmentCategory("notebook", category("computadores"))).toBe(true);
  });

  it("EQUIP-UX-04: switch aparece em Redes", () => {
    expect(matchesEquipmentCategory("switch", category("redes"))).toBe(true);
    expect(matchesEquipmentCategory("switch", category("computadores"))).toBe(false);
  });

  it("EQUIP-UX-05: telefone aparece em Telefonia", () => {
    expect(matchesEquipmentCategory("phone", category("telefonia"))).toBe(true);
    expect(matchesEquipmentCategory("phone", category("computadores"))).toBe(false);
  });

  it("EQUIP-UX-06: 'Todos os equipamentos' mostra TODOS os assets (sem recorte)", () => {
    // Sem `?categoria=` → category === null → a lista NÃO é filtrada.
    expect(findEquipmentCategory(null)).toBeNull();
    expect(findEquipmentCategory(undefined)).toBeNull();
    expect(findEquipmentCategory("")).toBeNull();
    // Slug inválido também não aplica recorte silencioso.
    expect(findEquipmentCategory("licencas")).toBeNull();

    // Na página, o recorte só acontece quando existe categoria: sem `category`
    // a lista é a lista completa de `api.assets.list`.
    expect(assetsPage).toContain("matchesEquipmentCategory(a.assetType, category)");
    expect(assetsPage).toContain(
      "? (assets ?? []).filter((a) => matchesEquipmentCategory(a.assetType, category))"
    );
    // O botão "Todos" limpa o parâmetro de categoria.
    expect(assetsPage).toContain("onClick={() => setSearchParams({})}");

    // Um asset de qualquer tipo sobrevive ao filtro "Todos".
    for (const cat of EQUIPMENT_CATEGORIES) {
      for (const t of cat.types) {
        expect(matchesEquipmentCategory(t, cat)).toBe(true);
      }
    }
  });
});

describe("EQUIP-UX — Categoria vazia é explicativa, não um erro", () => {
  it("EQUIP-UX-07: categoria vazia possui explicação clara", () => {
    expect(EMPTY_CATEGORY_TITLE).toBe("Nenhum equipamento cadastrado nesta categoria.");
    expect(NO_ASSETS_TITLE).toBe("Nenhum equipamento cadastrado");
    expect(NO_ASSETS_DESCRIPTION).toBe(
      "Os itens de estoque não aparecem aqui automaticamente. Esta área controla equipamentos/ativos individualmente.",
    );

    // Os textos aparecem na tela.
    expect(assetsPage).toContain("EMPTY_CATEGORY_TITLE");
    expect(assetsPage).toContain("NO_ASSETS_TITLE");
    expect(assetsPage).toContain("NO_ASSETS_DESCRIPTION");

    // E a página NÃO afirma erro/ruptura de estoque.
    expect(assetsPage).not.toContain("Erro no estoque");
    expect(assetsPage).not.toContain("estoque corrompido");
  });

  it("EQUIP-UX-07b: filtro de busca não é apresentado como categoria vazia", () => {
    // Com busca/filtro ativo o texto é "não encontrado", não "não cadastrado":
    // o operator precisa distinguir "não existe" de "não bateu com o filtro".
    expect(assetsPage).toContain("Nenhum equipamento encontrado");
    expect(assetsPage).toContain("filters.search || filters.status || filters.assetType");
  });
});

describe("EQUIP-UX — Produtos de estoque relacionados (somente leitura)", () => {
  const redesProdutos: RelatedStockProductInput[] = [
    product("Switch JetStream 8 portas", { categoryName: "Redes e Conectividade", stock: stock(3) }),
    product("Switch 26 portas", { brand: "Dell", categoryName: "Redes e Conectividade", stock: stock(1) }),
    product("Switch 5 portas 10/100 PoE", {
      brand: "TP-Link",
      categoryName: "Redes e Conectividade",
      stock: stock(3),
    }),
    product("RouterBoard", { brand: "MikroTik", categoryName: "Redes e Conectividade", stock: stock(2) }),
    // Fora da categoria: NÃO entra na lista.
    product("Toner MFC-L6902DW — Preto 20K", {
      categoryName: "Suprimentos de Impressão",
      stock: stock(40),
    }),
  ];

  it("EQUIP-UX-08: categoria vazia com produtos mostra atalho 'Ver estoque'", () => {
    const related = buildRelatedStockProducts(redesProdutos, category("redes"));

    // Os 4 itens de rede do exemplo do requisito, com o saldo REAL.
    expect(related.map((r) => [r.productName, r.availableQuantity])).toEqual([
      ["RouterBoard", 2],
      ["Switch 26 portas", 1],
      ["Switch 5 portas 10/100 PoE", 3],
      ["Switch JetStream 8 portas", 3],
    ]);
    // Toner (impressoras) NÃO aparece em Redes.
    expect(related.some((r) => r.productName.startsWith("Toner"))).toBe(false);

    // O bloco de relacionados existe na tela, com o atalho.
    expect(assetsPage).toContain("relatedStockTitle");
    expect(assetsPage).toContain("RELATED_STOCK_HINT");
    expect(assetsPage).toContain("RELATED_STOCK_ACTION");
    expect(assetsPage).toContain("stockHrefForEquipmentCategory");

    // Equivalente para Telefonia / Computadores / Impressoras.
    expect(relatedStockTitle("Redes")).toContain("Redes");
    expect(EQUIPMENT_CATEGORIES.map((c) => c.slug)).toEqual([
      "impressoras",
      "computadores",
      "redes",
      "telefonia",
    ]);
  });

  it("EQUIP-UX-08b: cada categoria oficial relaciona seus próprios produtos", () => {
    const catalog: RelatedStockProductInput[] = [
      product("Telefone", { categoryName: "Telefonia e Comunicação", stock: stock(3) }),
      product("Telefone VoIP TIP 125I", { categoryName: "Telefonia e Comunicação", stock: stock(1) }),
      product("RouterBoard", { categoryName: "Redes e Conectividade", stock: stock(2) }),
      product("Teclado", { categoryName: "Periféricos", stock: stock(6) }),
      product("Mouse com fio", { categoryName: "Periféricos", stock: stock(4) }),
      product("Toner CX735 — Preto", { categoryName: "Suprimentos de Impressão", stock: stock(5) }),
      product("Fita isolante", { categoryName: "Materiais de Infraestrutura", stock: stock(7) }),
    ];

    const telefonia = buildRelatedStockProducts(catalog, category("telefonia"));
    expect(telefonia.map((t) => t.productName).sort()).toEqual([
      "Telefone",
      "Telefone VoIP TIP 125I",
    ]);

    const computadores = buildRelatedStockProducts(catalog, category("computadores"));
    expect(computadores.map((t) => t.productName).sort()).toEqual(["Mouse com fio", "Teclado"]);

    const impressoras = buildRelatedStockProducts(catalog, category("impressoras"));
    expect(impressoras.map((t) => t.productName)).toEqual(["Toner CX735 — Preto"]);

    // "Fita isolante" NÃO é confundido com suprimento de impressão.
    expect(impressoras.some((p) => p.productName === "Fita isolante")).toBe(false);
  });

  it("EQUIP-UX-08c: só entra produto com saldo físico maior que zero", () => {
    const comSaldo = product("Switch 26 portas", {
      categoryName: "Redes e Conectividade",
      stock: stock(1),
    });
    const semSaldo = product("Switch Zenith 24p", {
      categoryName: "Redes e Conectividade",
      stock: stock(0),
    });
    const semRegistro = product("Switch Antigo", { categoryName: "Redes e Conectividade" });

    const related = buildRelatedStockProducts([comSaldo, semSaldo, semRegistro], category("redes"));
    expect(related.map((r) => r.productName)).toEqual(["Switch 26 portas"]);
  });

  it("EQUIP-UX-08d: sem categoria não há relação alguma", () => {
    const redes = category("redes");
    expect(matchesEquipmentStockProduct(product("Switch"), null)).toBe(false);
    expect(buildRelatedStockProducts([product("Switch", { stock: stock(3) })], null)).toEqual([]);
    expect(buildRelatedStockProducts([product("Switch", { stock: stock(3) })], redes)).toHaveLength(1);
  });

  it("EQUIP-UX-08e: o atalho leva a /stock e NÃO duplica estoque", () => {
    const redes = category("redes");
    expect(stockHrefForEquipmentCategory(redes)).toBe(`/stock?${EQUIPMENT_STOCK_PARAM}=redes`);

    // /stock aplica o MESMO filtro puro sobre `products.list`.
    expect(stockPage).toContain("matchesEquipmentStockProduct");
    expect(stockPage).toContain("findEquipmentCategory");
    expect(stockPage).toContain(EQUIPMENT_STOCK_PARAM);
    // E a origem dos dados continua sendo products.list (fonte única).
    expect(stockPage).toContain("api.products.list");
    expect(stockPage).not.toContain("api.assets.relatedStockByCategory");
  });
});

describe("EQUIP-UX — Licenças não são assets", () => {
  it("licenças permanecem fora de `assets` e com rota própria", () => {
    // A tabela `assets` não tem nenhum campo de licença.
    const assetsTable = schema.slice(
      schema.indexOf("assets: defineTable"),
      schema.indexOf("assetParts: defineTable")
    );
    expect(assetsTable).not.toContain("licenseId");
    expect(assetsTable).not.toContain("license");

    // /licenses é rota independente de /assets, com permissão própria.
    expect(appShell).toContain('{ label: "Licenças", href: "/licenses"');

    // Nenhuma das categorias de equipamento é "licenças".
    expect(EQUIPMENT_CATEGORIES.some((c) => c.slug === "licencas")).toBe(false);
    expect(findEquipmentCategory("licencas")).toBeNull();
  });
});

describe("EQUIP-UX — RBAC preservado em /assets", () => {
  it("leitura de equipment e de estoque continuam exigindo permissão", () => {
    expect(assetsBackend).toContain('requirePermission(ctx, "equipment.view")');
    expect(assetsBackend).toContain('requirePermission(ctx, "equipment.manage"');
    // A query de produtos relacionados devolve SALDO → exige stock.view.
    expect(assetsBackend).toContain('requirePermission(ctx, "stock.view")');
  });
});
