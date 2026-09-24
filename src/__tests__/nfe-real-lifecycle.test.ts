import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canContinueNfeReview,
  matchNfeProduct,
  normalizeText,
  reconcileNfeReviewMatches,
  type NfeItem,
  type ProductAssociationType,
  type ProductForMatch,
  type ProductMatchStatus,
} from "@/lib/nfe";

const CX735_AMARELO_ID = "kd7a1824vydkd3jrpqz2vy3q6tga9k4v";
const ALTALINK_CIANO_ID = "kd73hh4taw6qmfkefmdn9aw2x2d4dths";
const CARTAO_PVC_ID = "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f";
const PAPEL_TERMICO_ID = "kd75k6hz4gj7szvar4d44nxnwp9a52qa";

/**
 * Documentos reais de products no deployment first-herring-264.
 * Os quatro campos opcionais internalCode/ean/model/specification não existem
 * nesses documentos; a regressão deve passar somente com name + brand.
 */
const REAL_PRODUCTS: ProductForMatch[] = [
  { _id: CX735_AMARELO_ID, name: "Toner CX735 — Amarelo", brand: "Lexmark" },
  { _id: ALTALINK_CIANO_ID, name: "Toner AltaLink — Ciano", brand: "Xerox" },
  { _id: CARTAO_PVC_ID, name: "Cartão PVC para crachá", brand: "Extracard" },
  { _id: PAPEL_TERMICO_ID, name: "Papel para impressora térmica", brand: "Sem marca" },
];

const REAL_NF_372043_ITEMS: NfeItem[] = [
  { lineNumber: 1, code: "0110000735", description: "CART. TONER PRETO 28K CX-735 (81C8XK0)", unit: "UN", quantity: 1 },
  { lineNumber: 2, code: "0110001735", description: "CART. TONER AMARELO 16.2K CX-735 (81C8XY0)", unit: "UN", quantity: 1 },
  { lineNumber: 3, code: "0110002735", description: "CART. TONER CIANO 16.2K CX-735 (81C8XC0)", unit: "UN", quantity: 1 },
  { lineNumber: 4, code: "0110053004", description: "KIT RIBBON COLOR YMCKT P/SIGMA (525100-004)", unit: "UN", quantity: 1 },
  { lineNumber: 5, code: "0131091359", description: "CART. TONER XEROX (006R01759) ALTALINK C8145 C8155 C8170/C8270 CIANOIMP", unit: "UN", quantity: 1 },
  { lineNumber: 6, code: "1110000080", description: "CARTÃO PVC CR80 86x54x0.76mm BRANCO", unit: "PC", quantity: 400 },
  { lineNumber: 7, code: "1110038040", description: "BOBINA TERMICA BRANCA 80x40 CAIXA C 30 UNID", unit: "UNI", quantity: 90 },
  { lineNumber: 8, code: "4000003491", description: "CART. TONER PRETO P/MFC-L6902DW 20K (TN-34925BR)", unit: "UN", quantity: 40 },
];

type Review = {
  item: NfeItem;
  productId: string;
  matchStatus: ProductMatchStatus;
  matchScore: number;
  associationType: ProductAssociationType;
  locationId: string;
  supplierLot: string;
};

const review = (item: NfeItem): Review => ({
  item,
  productId: "",
  matchStatus: "not_found",
  matchScore: 0,
  associationType: "automatic",
  locationId: "",
  supplierLot: "",
});

const read = (path: string) => readFileSync(resolve(__dirname, "..", "..", path), "utf8");
const ENTRIES_SOURCE = read("src/pages/Entries.tsx");
const REVIEW_TABLE_SOURCE = read("src/components/NfeReviewTable.tsx");

describe("NF-e 372043 — catálogo real do deployment", () => {
  it.each([
    ["CX735 — Amarelo", 1, CX735_AMARELO_ID, 96],
    ["AltaLink — Ciano", 4, ALTALINK_CIANO_ID, 94],
    ["Cartão PVC", 5, CARTAO_PVC_ID, 93],
    ["Papel térmico", 6, PAPEL_TERMICO_ID, 93],
  ] as const)("encontra %s pelo documento real", (_caseName, index, productId, score) => {
    const result = matchNfeProduct(REAL_NF_372043_ITEMS[index], REAL_PRODUCTS, {
      supplierId: undefined,
      aliases: [],
    });

    expect(result).toMatchObject({ productId, status: "found", score });
  });

  it("mantém 4 encontrados, 0 possíveis e 4 não encontrados nos 8 itens reais", () => {
    const results = REAL_NF_372043_ITEMS.map((item) =>
      matchNfeProduct(item, REAL_PRODUCTS, { supplierId: undefined, aliases: [] }),
    );

    expect(results.filter((result) => result.status === "found")).toHaveLength(4);
    expect(results.filter((result) => result.status === "possible")).toHaveLength(0);
    expect(results.filter((result) => result.status === "not_found")).toHaveLength(4);
    expect(REAL_NF_372043_ITEMS[5].quantity).toBe(400);
    expect(REAL_NF_372043_ITEMS[6].quantity).toBe(90);
    expect(REAL_NF_372043_ITEMS[7].quantity).toBe(40);
  });

  it("não associa Brother, CX735 Ciano ou Ribbon Sigma a produtos incompatíveis", () => {
    const withoutBrother = REAL_NF_372043_ITEMS[7];
    const cxCyan = REAL_NF_372043_ITEMS[2];
    const sigma = REAL_NF_372043_ITEMS[3];

    expect(matchNfeProduct(withoutBrother, REAL_PRODUCTS).status).toBe("not_found");
    expect(matchNfeProduct(cxCyan, REAL_PRODUCTS).status).toBe("not_found");
    expect(matchNfeProduct(sigma, REAL_PRODUCTS).status).toBe("not_found");
  });
});

describe("NF-e 372043 — ciclo de vida da conferência", () => {
  it("produtos inicialmente vazios → catálogo carregado → quatro itens são encontrados", () => {
    const initial = reconcileNfeReviewMatches(
      REAL_NF_372043_ITEMS.map(review),
      [],
      { aliases: [] },
    );
    expect(initial.every((item) => item.matchStatus === "not_found")).toBe(true);

    const loaded = reconcileNfeReviewMatches(initial, REAL_PRODUCTS, { aliases: [] });
    expect(loaded.filter((item) => item.matchStatus === "found")).toHaveLength(4);
    expect(loaded.find((item) => item.item.lineNumber === 2)?.productId).toBe(CX735_AMARELO_ID);
    expect(loaded.find((item) => item.item.lineNumber === 5)?.productId).toBe(ALTALINK_CIANO_ID);
    expect(loaded.find((item) => item.item.lineNumber === 6)?.productId).toBe(CARTAO_PVC_ID);
    expect(loaded.find((item) => item.item.lineNumber === 7)?.productId).toBe(PAPEL_TERMICO_ID);
  });

  it("aliases indefinidos não bloqueiam o matching quando products já carregou", () => {
    const [loaded] = reconcileNfeReviewMatches(
      [review(REAL_NF_372043_ITEMS[1])],
      REAL_PRODUCTS,
    );
    expect(loaded).toMatchObject({ productId: CX735_AMARELO_ID, matchStatus: "found" });
    expect(ENTRIES_SOURCE).toContain("if (!nfe || !products) return;");
    expect(ENTRIES_SOURCE).toContain("aliases: nfeAliases ?? []");
  });

  it("matching encontrado permanece encontrado em rerender e atualização de catálogo/aliases", () => {
    const [found] = reconcileNfeReviewMatches(
      [review(REAL_NF_372043_ITEMS[1])],
      REAL_PRODUCTS,
    );
    const [rerendered] = reconcileNfeReviewMatches([found], [], {
      aliases: [{ _id: "alias-late", normalizedDescription: normalizeText(found.item.description), productId: "other" }],
    });

    expect(rerendered).toBe(found);
    expect(rerendered).toMatchObject({ productId: CX735_AMARELO_ID, matchStatus: "found" });
  });

  it.each(["manual", "created"] as const)("associação %s não é sobrescrita por catálogo/aliases", (associationType) => {
    const protectedReview: Review = {
      ...review(REAL_NF_372043_ITEMS[1]),
      productId: "manual-or-created-product",
      matchStatus: "found",
      matchScore: 100,
      associationType,
    };

    const [afterUpdate] = reconcileNfeReviewMatches([protectedReview], [], {
      aliases: [{ _id: "alias-late", normalizedDescription: normalizeText(protectedReview.item.description), productId: "other" }],
    });

    expect(afterUpdate).toBe(protectedReview);
    expect(afterUpdate.productId).toBe("manual-or-created-product");
  });

  it("usa canContinueNfeReview como regra única visual e funcional do avanço", () => {
    expect(REVIEW_TABLE_SOURCE).toContain("disabled={!canContinueNfeReview(items)}");
    expect(ENTRIES_SOURCE).toContain("if (!canContinueNfeReview(nfeItems))");
    expect(canContinueNfeReview([
      { productId: CX735_AMARELO_ID, matchStatus: "found", associationType: "automatic" },
      { productId: "", matchStatus: "not_found", associationType: "automatic" },
    ])).toBe(false);
  });
});
