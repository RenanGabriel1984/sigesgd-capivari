/**
 * RODADA 31 — CADASTRO RÁPIDO DE PRODUTO INTEGRADO À CONFERÊNCIA DA NF-e
 *
 * Valida, com as linhas REAIS da DANFE Incotech:
 *   §1  estrutura final da tela (um export default, handlers dentro do
 *       componente, botão por LINHA com índice do item);
 *   §2  pré-preenchimento, validação, associação à linha correta, preservação
 *       dos campos fiscais, gating de alias e ausência de mutações de
 *       entrada/estoque no cadastro rápido;
 *   §3  apresentação da NF-e (data BR, NCM/CST separados, rótulos
 *       semânticos distintos, chave com representação única legível).
 *
 * LIMITAÇÃO DECLARADA: o projeto não tem infraestrutura de teste de
 * interação React (sem @testing-library, ambiente "node"). Os helpers puros
 * de src/lib/quickProduct.ts são testados aqui; a abertura visual do modal e
 * o clique nos botões são validados por inspeção do código (asserções
 * estruturais abaixo) e exigem validação manual no navegador — ver relatório
 * da R31.1.
 *
 * Nenhum banco, estoque, entrada ou registro é criado/modificado.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  associateQuickProduct,
  emptyQuickProductForm,
  quickProductPrefill,
  shouldUpsertNfeAlias,
  validateQuickProductForm,
  type QuickProductAssociableRow,
} from "@/lib/quickProduct";
import {
  reconcileNfeReviewMatches,
  type NfeItem,
  type ProductForMatch,
} from "@/lib/nfe";
import { formatIsoDateBrazilian } from "@/lib/br-validators";

const ENTRIES = readFileSync(
  resolve(__dirname, "..", "pages", "Entries.tsx"),
  "utf8",
);
const REVIEW_TABLE = readFileSync(
  resolve(__dirname, "..", "components", "NfeReviewTable.tsx"),
  "utf8",
);

// ─── Linha real da DANFE Incotech ────────────────────────────────────────────

const ITEM_REAL: NfeItem = {
  lineNumber: 1,
  code: "231071",
  description: "KIT TECLADO E MOUSE USB SLIM CHOCO",
  ncm: "84716053",
  cst: "0102",
  unit: "PC",
  quantity: 25,
  unitValue: 52.94,
  totalValue: 1323.5,
};

const makeRow = (
  item: NfeItem,
  overrides: Partial<QuickProductAssociableRow> = {},
): QuickProductAssociableRow => ({
  item,
  productId: "",
  matchStatus: "not_found",
  matchScore: 0,
  associationType: "automatic",
  ...overrides,
});

// ─── §2.3–2.4 — pré-preenchimento e validação ────────────────────────────────

describe("R31 §2 — pré-preenchimento do cadastro rápido a partir do item", () => {
  it("nome e descrição recebem a descrição fiscal limpa da NF-e", () => {
    const form = quickProductPrefill(ITEM_REAL);
    expect(form.name).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(form.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    // Sem NCM/CST concatenados em nenhum dos dois campos.
    expect(form.description).not.toContain("84716053");
    expect(form.description).not.toContain("0102");
    expect(form.name).not.toContain("84716053");
    expect(form.name).not.toContain("0102");
  });

  it("unidade usa o mapeamento existente (PC → pc) e cai em 'un' quando desconhecida", () => {
    expect(quickProductPrefill(ITEM_REAL).unitOfMeasure).toBe("pc");
    expect(
      quickProductPrefill({ ...ITEM_REAL, unit: "ZZ" }).unitOfMeasure,
    ).toBe("un");
  });

  it("marca/modelo só quando há evidência no documento; caso real vem vazio", () => {
    const real = quickProductPrefill(ITEM_REAL);
    expect(real.brand).toBe("");
    expect(real.model).toBe("");

    const comMarca = quickProductPrefill({
      ...ITEM_REAL,
      description: "CARTUCHO HP PRETO",
    });
    expect(comMarca.brand).toBe("HP");
  });

  it("categoria começa vazia (obrigatória) e o padrão de unidade é 'un'", () => {
    expect(quickProductPrefill(ITEM_REAL).categoryId).toBe("");
    expect(emptyQuickProductForm().unitOfMeasure).toBe("un");
  });
});

describe("R31 §2.4 — validação de nome e categoria", () => {
  it("recusa nome vazio com a mensagem real", () => {
    const result = validateQuickProductForm({
      ...emptyQuickProductForm(),
      categoryId: "cat1",
    });
    expect(result).toEqual({ ok: false, error: "Informe o nome do produto." });
  });

  it("recusa categoria ausente mesmo com nome preenchido", () => {
    const result = validateQuickProductForm({
      ...emptyQuickProductForm(),
      name: "  KIT TECLADO  ",
    });
    expect(result).toEqual({
      ok: false,
      error: "Selecione ou crie uma categoria para o produto.",
    });
  });

  it("aceita o caso real com nome/categoria e devolve valores aparados", () => {
    const result = validateQuickProductForm({
      ...quickProductPrefill(ITEM_REAL),
      categoryId: "categoria-1",
    });
    expect(result).toEqual({
      ok: true,
      name: "KIT TECLADO E MOUSE USB SLIM CHOCO",
      description: "KIT TECLADO E MOUSE USB SLIM CHOCO",
      categoryId: "categoria-1",
    });
  });
});

// ─── §2.5–2.7, 2.12 — associação à linha correta ─────────────────────────────

describe("R31 §2 — associação do produto recém-criado à linha de origem", () => {
  it("associa APENAS a linha que originou o cadastro, com origem 'criado'", () => {
    const outra = makeRow({
      ...ITEM_REAL,
      lineNumber: 2,
      code: "999999",
      description: "OUTRO PRODUTO DIFERENTE",
    });
    const rows = [makeRow(ITEM_REAL), outra];

    const result = associateQuickProduct(rows, 0, "produto-novo");

    expect(result).toHaveLength(2);
    // Linha-alvo: associada, coerente.
    expect(result[0].productId).toBe("produto-novo");
    expect(result[0].matchStatus).toBe("found");
    expect(result[0].matchScore).toBe(100);
    expect(result[0].matchSource).toBe("new_product");
    expect(result[0].associationType).toBe("created");
    // Outra linha intocada (nem por referência).
    expect(result[1]).toBe(rows[1]);
  });

  it("preserva código, descrição, NCM, CST, unidade, quantidade e valores da linha", () => {
    const row = makeRow(ITEM_REAL, {
      locationId: "local-1",
      supplierLot: "LOTE-42",
    });
    const [result] = associateQuickProduct([row], 0, "produto-novo");

    expect(result.item).toEqual(ITEM_REAL);
    expect(result.item.code).toBe("231071");
    expect(result.item.description).toBe(
      "KIT TECLADO E MOUSE USB SLIM CHOCO",
    );
    expect(result.item.ncm).toBe("84716053");
    expect(result.item.cst).toBe("0102");
    expect(result.item.cst).toHaveLength(4); // zero à esquerda preservado
    expect(result.item.unit).toBe("PC");
    expect(result.item.quantity).toBe(25);
    expect(result.item.unitValue).toBe(52.94);
    expect(result.item.totalValue).toBe(1323.5);
    // Local e lote preenchidos na conferência permanecem.
    expect(result.locationId).toBe("local-1");
    expect(result.supplierLot).toBe("LOTE-42");
  });

  it("funciona com mais de uma linha: índice 1 não toca a linha 0", () => {
    const rows = [
      makeRow({ ...ITEM_REAL, lineNumber: 1, code: "111" }),
      makeRow({ ...ITEM_REAL, lineNumber: 2, code: "222" }),
      makeRow({ ...ITEM_REAL, lineNumber: 3, code: "333" }),
    ];
    const result = associateQuickProduct(rows, 1, "produto-do-meio");
    expect(result.map((r) => r.productId)).toEqual([
      "",
      "produto-do-meio",
      "",
    ]);
  });

  it("índice inválido devolve as linhas sem alteração", () => {
    const rows = [makeRow(ITEM_REAL)];
    expect(associateQuickProduct(rows, -1, "x")).toBe(rows);
    expect(associateQuickProduct(rows, 5, "x")).toBe(rows);
    expect(associateQuickProduct([], 0, "x")).toEqual([]);
  });

  it("a associação sobrevive à atualização da lista de produtos (rematch)", () => {
    const rows = associateQuickProduct([makeRow(ITEM_REAL)], 0, "produto-novo");
    const products: ProductForMatch[] = [
      { _id: "produto-novo", name: "KIT TECLADO E MOUSE USB SLIM CHOCO" },
      { _id: "outro", name: "QUALQUER COISA" },
    ];

    // Simula a reconexão reativa (useEffect) disparada por produtos/aliases.
    const reconciled = reconcileNfeReviewMatches(rows, products, {
      supplierId: "fornecedor-1",
      aliases: [],
    });

    expect(reconciled[0].productId).toBe("produto-novo");
    expect(reconciled[0].matchStatus).toBe("found");
    expect(reconciled[0].associationType).toBe("created");
  });

  it("sem produtos cadastrados a associação criada também não é sobrescrita", () => {
    const rows = associateQuickProduct([makeRow(ITEM_REAL)], 0, "produto-novo");
    const reconciled = reconcileNfeReviewMatches(rows, [], {});
    expect(reconciled[0].productId).toBe("produto-novo");
    expect(reconciled[0].associationType).toBe("created");
  });
});

// ─── §2 — gating do alias ────────────────────────────────────────────────────

describe("R31 §2 — alias só com fornecedor identificado", () => {
  it("não tenta alias sem fornecedor, sem linha ou sem descrição", () => {
    const row = makeRow(ITEM_REAL);
    expect(shouldUpsertNfeAlias(row, null)).toBe(false);
    expect(shouldUpsertNfeAlias(row, undefined)).toBe(false);
    expect(shouldUpsertNfeAlias(undefined, "fornecedor-1")).toBe(false);
    expect(
      shouldUpsertNfeAlias(
        makeRow({ ...ITEM_REAL, description: "   " }),
        "fornecedor-1",
      ),
    ).toBe(false);
  });

  it("tenta alias apenas com fornecedor identificado e descrição utilizável", () => {
    expect(shouldUpsertNfeAlias(makeRow(ITEM_REAL), "fornecedor-1")).toBe(true);
  });
});

// ─── §2.11 — cadastro rápido não movimenta estoque/entrada ──────────────────

describe("R31 §2.11 — o cadastro rápido não cria entrada nem estoque", () => {
  const quickSaveBody = ENTRIES.slice(
    ENTRIES.indexOf("const handleQuickProductSave = async () => {"),
    ENTRIES.indexOf("/** Cria a categoria sem fechar a conferência"),
  );

  it("o handler usa apenas products.create — nunca entries nem estoque", () => {
    expect(quickSaveBody).toContain("await createProduct({");
    expect(quickSaveBody).not.toContain("createEntry");
    expect(quickSaveBody).not.toContain("confirmEntry");
    expect(quickSaveBody).not.toContain("generateUploadUrl");
    expect(quickSaveBody).not.toContain("stockMovements");
    expect(quickSaveBody).not.toContain("initialStock");
  });

  it("products.create recebe estoques zerados (só catálogo)", () => {
    expect(quickSaveBody).toContain("minimumStock: 0");
    expect(quickSaveBody).toContain("idealStock: 0");
    expect(quickSaveBody).toContain("maximumStock: 0");
  });

  it("entries.create/confirm continuam apenas no fluxo normal de confirmação", () => {
    const confirmFlow = ENTRIES.slice(
      ENTRIES.indexOf("const handleConfirmImport = async () => {"),
      ENTRIES.indexOf("const handleCreateDraft = async () => {"),
    );
    expect(confirmFlow).toContain("await createEntry({");
    expect(confirmFlow).toContain("await confirmEntry({");
  });
});

// ─── §1 e §3 — estrutura da tela e apresentação da NF-e ─────────────────────

describe("R31 §1/§3 — estrutura final e apresentação", () => {
  it("exatamente um export default, apontando para EntriesPage", () => {
    const matches = ENTRIES.match(/export default/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(ENTRIES).toContain("export default EntriesPage");
  });

  it("o botão de CADA linha abre o cadastro rápido com o índice do item", () => {
    expect(REVIEW_TABLE).toContain("onNewProduct?: (index: number) => void");
    expect(REVIEW_TABLE).toContain("onClick={() => onNewProduct(index)}");
    expect(ENTRIES).toContain("onNewProduct={openQuickProductForRow}");
    expect(ENTRIES).toContain("const openQuickProductForRow = (index: number) => {");
    expect(ENTRIES).toContain("setQuickProductForm(quickProductPrefill(row.item))");
    expect(ENTRIES).toContain("setQuickProductOpen(true)");
  });

  it("o cadastro rápido não fecha a conferência da NF-e", () => {
    // O handler de salvar NÃO mexe em setNfeOpen; só fecha o próprio modal.
    const quickSaveBody = ENTRIES.slice(
      ENTRIES.indexOf("const handleQuickProductSave = async () => {"),
      ENTRIES.indexOf("/** Cria a categoria sem fechar a conferência"),
    );
    expect(quickSaveBody).not.toContain("setNfeOpen");
    // Cancelar também preserva a conferência e os dados da NF-e: passa por
    // cancelQuickProduct, que restaura o snapshot sem tocar em setNfeOpen.
    expect(ENTRIES).toContain("onCancel={cancelQuickProduct}");
    expect(ENTRIES).toContain("setNfeItems(quickProductSnapshot)");
    expect(quickSaveBody).not.toContain("setNfeItems([])");
  });

  it("data visível 28/09/2026 com estado interno ISO", () => {
    expect(formatIsoDateBrazilian("2026-09-28")).toBe("28/09/2026");
    expect(ENTRIES).toContain("formatIsoDateBrazilian(nfe.emissionDate)");
  });

  it("NCM e CST em campos visuais separados, preservando 0102", () => {
    expect(REVIEW_TABLE).toContain("NCM {review.item.ncm}");
    expect(REVIEW_TABLE).toContain("CST {review.item.cst}");
    // Nunca concatenados na descrição nem um no outro.
    expect(REVIEW_TABLE).not.toContain("NCM/CST");
    expect(ENTRIES).toContain("NCM {nfe.items[0].ncm}");
    expect(ENTRIES).toContain("CST {nfe.items[0].cst}");
    expect(ENTRIES).toContain("cst: item.cst");
  });

  it("quantidade, código do fornecedor e valores em posições semânticas distintas", () => {
    // Conferência: nº de itens e código do fornecedor são rótulos separados.
    expect(ENTRIES).toContain("Itens da nota:");
    expect(ENTRIES).toContain("Código do item (fornecedor):");
    // Linha da tabela: quantidade com unidade e valores formatados à parte.
    expect(REVIEW_TABLE).toContain("{review.item.quantity} {review.item.unit}");
    expect(REVIEW_TABLE).toContain("formatMoney(review.item.unitValue)");
    expect(REVIEW_TABLE).toContain("formatMoney(review.item.totalValue)");
    expect(REVIEW_TABLE).toContain("cód. {review.item.code}");
    // Total da nota nunca aparece como código.
    expect(ENTRIES).not.toContain("cód. {nfe.totalValue}");
  });

  it("chave: uma representação legível + cópia exatamente dos 44 dígitos", () => {
    // Máscara de impressão é a ÚNICA representação formatada exibida.
    expect(ENTRIES).toContain("formatAccessKeyPrint(nfeAccessKeyDigits)");
    expect(ENTRIES).not.toContain("formatAccessKeyGrouped(");
    // O campo de edição permanece cru (fallback autorizado pela R31 §4).
    expect(ENTRIES).toContain("value={nfeAccessKey}");
    // Cópia: somente dígitos, sem pontuação.
    expect(ENTRIES).toContain("navigator.clipboard.writeText(nfeAccessKeyDigits)");
    expect(ENTRIES).toContain("Copiar chave (44 dígitos)");
  });

  it("sem mensagens fixas da DANFE de teste Incotech", () => {
    expect(ENTRIES).not.toContain("INCOTECH_TEST_ACCESS_KEY");
    expect(ENTRIES).not.toContain("INCOTECH_TEST_CNPJ");
    expect(ENTRIES).not.toContain("confere integralmente com a chave esperada");
    expect(REVIEW_TABLE).not.toContain("INCOTECH");
  });
});
