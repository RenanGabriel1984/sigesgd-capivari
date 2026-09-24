import { describe, expect, it } from "vitest";
import {
  buildEntryDraftFromNfe,
  canContinueNfeReview,
  findEntryByAccessKey,
  mapNfeUnit,
  matchNfeProduct,
  normalizeText,
  type NfeData,
  type NfeItem,
  type ProductForMatch,
} from "@/lib/nfe";

const item = (overrides: Partial<NfeItem> = {}): NfeItem => ({
  lineNumber: 1,
  code: "GOMAQ-001",
  description: "CART. TONER AMARELO 16.2K CX-735 (81C8XY0)",
  ncm: "844399",
  cfop: "5102",
  unit: "UN",
  quantity: 1,
  unitValue: 100,
  totalValue: 100,
  ...overrides,
});

const products: ProductForMatch[] = [
  { _id: "cx-yellow", name: "Toner para Lexmark CX735 — Amarelo", brand: "Lexmark", model: "CX735" },
  { _id: "cx-cyan", name: "Toner para Lexmark CX735 — Ciano", brand: "Lexmark", model: "CX735" },
  { _id: "cx-black", name: "Toner para Lexmark CX735 — Preto", brand: "Lexmark", model: "CX735" },
  { _id: "alta-cyan", name: "Toner AltaLink — Ciano", brand: "Xerox", model: "AltaLink" },
  { _id: "brother", name: "Brother MFC-L6902DW / TN-34925BR", brand: "Brother", model: "MFC-L6902DW" },
  { _id: "pvc", name: "Cartão PVC para crachá" },
  { _id: "thermal", name: "Papel para impressora térmica" },
  { _id: "ribbon-sigma", name: "Ribbon para impressora de cartões / Sigma" },
  { _id: "ribbon-generic", name: "Ribbon" },
];

const parsed: NfeData = {
  accessKey: "3".repeat(44),
  number: "372043",
  series: "1",
  emissionDate: "2026-09-01",
  emitterCnpj: "61.457.941/0001-43",
  emitterName: "GOMAQ MÁQUINAS PARA ESCRITÓRIO LTDA",
  totalValue: 20822.22,
  items: [item({ description: "BOBINA TÉRMICA BRANCA 80x40 CAIXA C 30 UNID", unit: "CX", quantity: 90 })],
};

describe("NFE-MATCH-01..11", () => {
  it("NFE-MATCH-01: descrição fiscal diferente encontra produto pelo modelo e cor", () => {
    const result = matchNfeProduct(item(), products);
    expect(result).toMatchObject({ productId: "cx-yellow", status: "found" });
    expect(result.source).toBe("brand_model");
  });

  it("NFE-MATCH-02: CX735 Amarelo é reconhecido e não confunde com preto/ciano", () => {
    expect(matchNfeProduct(item(), products).productId).toBe("cx-yellow");
    expect(matchNfeProduct(item({ description: "CART. TONER CIANO 16.2K CX-735 (81C8XC0)" }), products).productId).toBe("cx-cyan");
  });

  it("NFE-MATCH-03: AltaLink Ciano usa família e cor, sem depender de igualdade textual", () => {
    const result = matchNfeProduct(item({ code: "006R", description: "CART. TONER XEROX (006R01759) ALTALINK C8145 / C8155 CIANO" }), products);
    expect(result).toMatchObject({ productId: "alta-cyan", status: "found" });
  });

  it("NFE-MATCH-04: cartão PVC para crachá é relacionado ao cartão PVC fiscal", () => {
    const result = matchNfeProduct(item({ description: "CARTÃO PVC CR80 86x54x0,76mm BRANCO", quantity: 400, unit: "UN" }), products);
    expect(result).toMatchObject({ productId: "pvc", status: "found" });
  });

  it("NFE-MATCH-05: bobina térmica não multiplica 90 caixas por 30 unidades", () => {
    const result = matchNfeProduct(parsed.items[0], products);
    expect(result.productId).toBe("thermal");
    const draft = buildEntryDraftFromNfe(parsed, [{ productId: "thermal", matchScore: result.score }]);
    expect(draft.items[0].quantity).toBe(90);
    expect(draft.items[0].unitOfMeasure).toBe("cx");
    expect(mapNfeUnit("CX")).toBe("cx");
  });

  it("NFE-MATCH-06: Brother MFC-L6902DW nunca é associado a Lexmark/CX735/AltaLink", () => {
    const brotherItem = item({ description: "CART. TONER PRETO P/MFC-L6902DW 20K (TN-34925BR)" });
    expect(matchNfeProduct(brotherItem, products).productId).toBe("brother");
    const wrongOnly = products.filter((product) => ["cx-black", "cx-yellow", "cx-cyan", "alta-cyan"].includes(product._id));
    expect(matchNfeProduct(brotherItem, wrongOnly).status).toBe("not_found");
    const genericAlta = matchNfeProduct(item({ description: "CART. TONER XEROX 006R01759 ALTALINK C8145 CIANO" }), [{ _id: "generic-cyan", name: "Toner Ciano" }]);
    expect(genericAlta.status).not.toBe("found");
  });

  it("NFE-MATCH-07: produto inexistente não é criado e Ribbon genérico não substitui Ribbon Sigma", () => {
    const before = [...products];
    const sigma = matchNfeProduct(item({ description: "KIT RIBBON COLOR YMCKT P/ SIGMA (525100-004)" }), products);
    expect(sigma).toMatchObject({ productId: "ribbon-sigma", status: "found" });
    const genericOnly = matchNfeProduct(item({ description: "KIT RIBBON COLOR YMCKT P/ SIGMA (525100-004)" }), [products[8]]);
    expect(genericOnly.status).toBe("not_found");
    expect(products).toEqual(before);
  });

  it("NFE-MATCH-08: associação manual explícita libera a revisão sem renomear o produto", () => {
    expect(canContinueNfeReview([{ productId: "cx-yellow", matchStatus: "found", associationType: "manual" }])).toBe(true);
  });

  it("NFE-MATCH-09: associação memorizada do fornecedor é reutilizada", () => {
    const result = matchNfeProduct(item(), products, {
      supplierId: "supplier-gomaq",
      aliases: [{ _id: "alias-1", supplierId: "supplier-gomaq", supplierCode: "GOMAQ-001", normalizedDescription: "", productId: "cx-cyan" }],
    });
    expect(result).toMatchObject({ productId: "cx-cyan", status: "found", source: "supplier_alias" });
  });

  it("NFE-MATCH-10: avanço fica bloqueado com item sem produto ou possível não confirmado", () => {
    expect(canContinueNfeReview([{ productId: "cx-yellow", matchStatus: "found" }, { productId: "", matchStatus: "not_found" }])).toBe(false);
    expect(canContinueNfeReview([{ productId: "cx-yellow", matchStatus: "possible" }])).toBe(false);
    expect(canContinueNfeReview([{ productId: "cx-yellow", matchStatus: "found" }, { productId: "cx-cyan", matchStatus: "found" }])).toBe(true);
  });

  it("NFE-MATCH-11: chave da NF-e continua protegendo contra duplicidade", () => {
    const key = ` ${parsed.accessKey.slice(0, 2)} ${parsed.accessKey.slice(2)} `;
    expect(findEntryByAccessKey([{ _id: "entry-1", entryNumber: "ENT-2026-000001", accessKey: parsed.accessKey }], key)?.entryNumber).toBe("ENT-2026-000001");
  });

  it("normalização preserva modelo, capacidade, cor e código", () => {
    expect(normalizeText("CART. TONER PRETO 28K CX-735 (81C8XK0)")).toContain("28k");
    expect(normalizeText("CX-735")).toBe("cx735");
    expect(normalizeText("CART. TONER AMARELO 16.2K CX 735 (81C8XY0)")).toContain("amarelo");
    expect(normalizeText("CART. TONER AMARELO 16.2K CX 735 (81C8XY0)")).toContain("81c8xy0");
  });
});
