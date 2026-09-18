import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf8");

const CSS = read("src/index.css");
const SEARCH = read("src/components/SearchInput.tsx");
const SHELL = read("src/components/AppShell.tsx");
const ORG = read("src/pages/Organization.tsx");
const PRODUCTS = read("src/pages/Products.tsx");
const STOCK = read("src/pages/Stock.tsx");
const EXIT = read("src/pages/Exit.tsx");
const DETAIL = read("src/pages/ProductDetail.tsx");
const ENTRIES = read("src/pages/Entries.tsx");

// ─── Lib NF-e (testes unitários REAIS — funções puras) ───────────────────────
import { mapNfeUnit, buildEntryDraftFromNfe, findEntryByAccessKey, type NfeData } from "@/lib/nfe";

describe("R2 — Bug da letra B (tipografia)", () => {
  it("R2-01: index.css NÃO ativa features opentype (ss01/ss02) que trocam glifos", () => {
    expect(CSS).not.toContain('"ss01"');
    expect(CSS).not.toContain('"ss02"');
    expect(CSS).toContain("font-feature-settings: normal");
  });
});

describe("R2 — Pesquisa no celular (ENTER recolhe o teclado)", () => {
  it("R2-02: SearchInput previne submit, desfoca e mantém o termo no Enter", () => {
    expect(SEARCH).toContain('e.key === "Enter"');
    expect(SEARCH).toContain("e.preventDefault()");
    expect(SEARCH).toContain("blur()");
    expect(SEARCH).toContain('type="search"');
    expect(SEARCH).toContain('enterKeyHint="search"');
  });

  it("R2-03: todos os campos de busca usam o SearchInput padronizado", () => {
    for (const f of ["Products", "Stock", "Users", "Exit", "Lots", "Assets", "Suppliers", "Printers"]) {
      const src = read(`src/pages/${f}.tsx`);
      expect(src).toContain('from "@/components/SearchInput"');
      expect(src).toContain("<SearchInput");
    }
  });

  it("R2-04: campo de patrimônio em Solicitações também recolhe o teclado no Enter", () => {
    expect(read("src/pages/Requests.tsx")).toContain('if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }');
  });
});

describe("R2 — Nomes completos (sem truncamento)", () => {
  it("R2-05: produto (lista, saída e detalhe) e estoque exibem nome completo", () => {
    expect(PRODUCTS).not.toMatch(/truncate[^"]*">\{p\.name\}/);
    expect(STOCK).not.toMatch(/truncate[^"]*">\{p\.name\}/);
    expect(EXIT).not.toMatch(/truncate[^"]*">\{p\.name\}/);
    expect(DETAIL).not.toMatch(/truncate[^"]*">\{product\.name\}/);
    expect(DETAIL).toContain("app-break");
  });

  it("R2-06: especificação do produto não é truncada no catálogo", () => {
    expect(PRODUCTS).not.toMatch(/mb-2 truncate/);
  });
});

describe("R2 — Hierarquia da Organização", () => {
  it("R2-07: nome da unidade nunca truncado; status em área própria", () => {
    // O bloco do nó da árvore não pode truncar o nome
    const nodeBlock = ORG.slice(ORG.indexOf("function OrgTreeNode"), ORG.indexOf("export default function Organization"));
    expect(nodeBlock).not.toContain("truncate");
    expect(nodeBlock).toContain("app-break");
    // Status/edit em coluna própria (flex-col items-end), nunca sobre o nome
    expect(nodeBlock).toContain("flex-col items-end");
  });

  it("R2-08: indentação hierárquica por nível (esquerda → direita)", () => {
    expect(ORG).toContain("TREE_INDENT");
    expect(ORG).toContain("level * TREE_INDENT");
  });
});

describe("R2 — Menu hamburger fluido", () => {
  it("R2-09: anima apenas transform (x %), 180ms, sem spring", () => {
    expect(SHELL).toContain('x: "-100%"');
    expect(SHELL).toContain("duration: 0.18");
    expect(SHELL).not.toContain("x: -280");
    expect(SHELL).not.toContain('type: "spring"');
  });

  it("R2-10: SidebarLink memoizado (sem re-render da árvore durante a animação)", () => {
    expect(SHELL).toContain("memo(function SidebarLink");
  });
});

describe("R2 — NF-e: regras fiscais (testes unitários reais)", () => {
  it("R2-11: unidades fiscais são preservadas (nunca convertidas em quantidade)", () => {
    expect(mapNfeUnit("UN")).toBe("un");
    expect(mapNfeUnit("UNI")).toBe("un");
    expect(mapNfeUnit("PC")).toBe("pc");
    expect(mapNfeUnit("CX")).toBe("cx");
    expect(mapNfeUnit("KIT")).toBe("kt");
    expect(mapNfeUnit("XX")).toBe("outro"); // desconhecida → "outro", jamais multiplica
  });

  it("R2-12: o rascunho preserva a quantidade fiscal EXATA de cada item", () => {
    const nfe: NfeData = {
      accessKey: "12345678901234567890123456789012345678901234",
      number: "372043",
      series: "1",
      emissionDate: "2026-09-01",
      emitterName: "GOMAQ",
      items: [
        { lineNumber: 1, code: "1110038040", description: "BOBINA TERMICA BRANCA 80x40 CAIXA C 30 UNID", unit: "UN", quantity: 90 },
        { lineNumber: 2, code: "1110000080", description: "CARTAO PVC CR80 86x54x0.76mm BRANCO", unit: "UN", quantity: 400 },
      ],
    };
    const draft = buildEntryDraftFromNfe(
      nfe,
      [{ productId: "p1" }, { productId: "p2" }],
      { supplierId: "sup1" }
    );
    // 90 continua 90 (NUNCA 2.700) e 400 continua 400
    expect(draft.items[0].quantity).toBe(90);
    expect(draft.items[1].quantity).toBe(400);
    expect(draft.invoiceNumber).toBe("372043");
    expect(draft.supplierId).toBe("sup1");
  });

  it("R2-13: itens sem produto associado não podem virar entrada (confirmação parcial bloqueada)", () => {
    const nfe: NfeData = {
      accessKey: "1",
      number: "1",
      series: "1",
      emissionDate: "2026-09-01",
      items: [{ lineNumber: 1, code: "x", description: "y", unit: "UN", quantity: 1 }],
    };
    expect(() => buildEntryDraftFromNfe(nfe, [{ productId: "" } as any])).toThrow();
  });

  it("R2-14: mesma chave de acesso é detectada como NF duplicada", () => {
    const entries = [
      { _id: "e1", entryNumber: "ENT-2026-000001", accessKey: "12345678901234567890123456789012345678901234" },
    ];
    expect(findEntryByAccessKey(entries, "12345678901234567890123456789012345678901234")?._id).toBe("e1");
    expect(findEntryByAccessKey(entries, "999")).toBeUndefined();
  });

  it("R2-15: conferência da NF mostra a categoria do material (fornecedor ≠ categoria)", () => {
    expect(ENTRIES).toContain("products?.find((p: any) => p._id === r.productId)?.category?.name");
  });
});
