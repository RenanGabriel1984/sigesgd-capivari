/**
 * RODADA 31.3 — REGRESSÕES: CANCELAMENTO DO CADASTRO RÁPIDO E APRESENTAÇÃO
 *
 * Reproduz os defeitos observados na interface:
 *   §1  abrir e cancelar o cadastro rápido alterava a associação da linha
 *       (rematch assíncrono do catálogo/aliases ficava visível após o
 *       cancelamento; o efeito também reexecutava sem memoização);
 *   §3  descrição/NCM/CST colados ("…SLIM CHOCONCM 84716053 · CST 0102")
 *       e rótulos/valores sem separação na conferência.
 *
 * LIMITAÇÃO DECLARADA: sem infraestrutura de teste de interação React no
 * projeto (vitest, ambiente "node"). Os fluxos são reproduzidos sobre os
 * helpers puros + reconcileNfeReviewMatches (simulando a chegada assíncrona
 * do catálogo) e por asserções estruturais no JSX. A validação visual real
 * depende de passeio manual no navegador — não é afirmada aqui.
 *
 * Nenhum banco, estoque ou registro é criado/modificado.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  associateQuickProduct,
  quickProductPrefill,
  snapshotReviewRows,
  type QuickProductAssociableRow,
} from "@/lib/quickProduct";
import {
  reconcileNfeReviewMatches,
  type NfeItem,
  type ProductAliasForMatch,
  type ProductForMatch,
} from "@/lib/nfe";

const ENTRIES = readFileSync(
  resolve(__dirname, "..", "pages", "Entries.tsx"),
  "utf8",
);
const DIALOG = readFileSync(
  resolve(__dirname, "..", "components", "DanfeImportDialog.tsx"),
  "utf8",
);
const REVIEW_TABLE = readFileSync(
  resolve(__dirname, "..", "components", "NfeReviewTable.tsx"),
  "utf8",
);

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

const OUTRO_ITEM: NfeItem = {
  ...ITEM_REAL,
  lineNumber: 2,
  code: "88888",
  description: "TONER PRETO OUTRO MODELO",
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

/** Catálogo que chega DEPOIS da abertura do modal (query assíncrona). */
const CATALOGO_TARDIO: ProductForMatch[] = [
  {
    _id: "produto-vinik",
    name: "KIT TECLADO E MOUSE USB SLIM CHOCO",
    brand: "Vinik",
  },
];

// ─── §1 — abrir e cancelar preserva o estado anterior ───────────────────────

describe("R31.3 §1 — cancelar o cadastro rápido não altera a conferência", () => {
  it("linha pendente continua pendente mesmo quando o catálogo chega com o modal aberto", () => {
    const antes = [makeRow(ITEM_REAL), makeRow(OUTRO_ITEM)];

    // 1. Usuário abre o formulário → snapshot imediatamente anterior.
    const snapshot = snapshotReviewRows(antes);

    // 2. Enquanto o modal está aberto, a query de produtos termina de
    //    carregar e o rematch legítimo encontra o produto (identidade por
    //    descrição normalizada idêntica).
    const durante = reconcileNfeReviewMatches(antes, CATALOGO_TARDIO, {
      supplierId: "fornecedor-1",
      aliases: [],
    });
    expect(durante[0].matchStatus).toBe("found"); // rematch aconteceu

    // 3. Usuário CANCELA → restaura o snapshot: pendente, sem produto.
    expect(snapshot[0].productId).toBe("");
    expect(snapshot[0].matchStatus).toBe("not_found");
    expect(snapshot[0].associationType).toBe("automatic");
  });

  it("cancelar não modifica outras linhas (o snapshot mantém referências)", () => {
    const linhaA = makeRow(ITEM_REAL);
    const linhaB = makeRow(OUTRO_ITEM);
    const antes = [linhaA, linhaB];

    const snapshot = snapshotReviewRows(antes);
    expect(snapshot).toHaveLength(2);
    // Copia do ARRAY, mas as linhas são as mesmas instâncias — cancelar
    // devolve exatamente o estado anterior sem tocar em nenhuma linha.
    expect(snapshot[0]).toBe(linhaA);
    expect(snapshot[1]).toBe(linhaB);
  });

  it("o corpo do cancelamento não cria produto, categoria, alias, entrada ou estoque", () => {
    const cancelBody = ENTRIES.slice(
      ENTRIES.indexOf("const cancelQuickProduct = () => {"),
      ENTRIES.indexOf("/**\n   * Salva o cadastro rápido"),
    );
    expect(cancelBody).toContain("setNfeItems(quickProductSnapshot)");
    expect(cancelBody).not.toContain("createProduct");
    expect(cancelBody).not.toContain("createCategory");
    expect(cancelBody).not.toContain("upsertNfeProductAlias");
    expect(cancelBody).not.toContain("createEntry");
    expect(cancelBody).not.toContain("confirmEntry");
  });

  it("abrir o formulário registra o snapshot das linhas atuais", () => {
    const openBody = ENTRIES.slice(
      ENTRIES.indexOf("const openQuickProductForRow = (index: number) => {"),
      ENTRIES.indexOf("const cancelQuickProduct = () => {"),
    );
    expect(openBody).toContain("setQuickProductSnapshot(snapshotReviewRows(nfeItems))");
    expect(openBody).toContain("setQuickProductForm(quickProductPrefill(row.item))");
    expect(openBody).not.toContain("createProduct");
  });

  it("o rematch reage a dados, não a renders: productOptions é memoizado", () => {
    // Defeito observado: sem useMemo, cada render criava um array novo e o
    // useEffect de rematch reexecutava, recalculando linhas pendentes.
    expect(ENTRIES).toContain("useMemo(");
    expect(ENTRIES).toMatch(
      /const productOptions = useMemo\(\s*\(\) => \(products \?\? \[\]\) as NfeReviewProduct\[\],\s*\[products\],\s*\);/,
    );
  });

  it("Esc/overlay também passam pelo cancelamento com restauração", () => {
    expect(ENTRIES).toContain("onCancel={cancelQuickProduct}");
    expect(ENTRIES).toContain("else cancelQuickProduct();");
  });
});

// ─── §1 — identidade fiscal × similaridade ─────────────────────────────────

describe("R31.3 §1 — similaridade não vira associação automática", () => {
  it("produto só de parecido (Vinik/chocolate) fica como sugestão, nunca 'found'", () => {
    const rows = [makeRow(ITEM_REAL)];
    const parecido: ProductForMatch[] = [
      {
        _id: "produto-vinik",
        name: "KIT TECLADO E MOUSE USB SLIM CHOCOLATE (Vinik)",
        brand: "Vinik",
      },
    ];
    const result = reconcileNfeReviewMatches(rows, parecido, {
      aliases: [],
    });
    // Regra existente (matchNfeProduct): aproximação NUNCA é "found".
    expect(result[0].matchStatus).not.toBe("found");
  });

  it("alias de fornecedor (identidade memorizada) continua casuando found — matching legítimo preservado", () => {
    const rows = [makeRow(ITEM_REAL)];
    const aliases: ProductAliasForMatch[] = [
      {
        _id: "alias-1",
        supplierId: "fornecedor-1",
        supplierCode: "231071",
        normalizedDescription: "kit teclado e mouse usb slim choco",
        productId: "produto-vinik",
      },
    ];
    const result = reconcileNfeReviewMatches(rows, CATALOGO_TARDIO, {
      supplierId: "fornecedor-1",
      aliases,
    });
    expect(result[0].matchStatus).toBe("found");
    expect(result[0].matchSource).toBe("supplier_alias");
    expect(result[0].matchReason).toContain("memorizada");
  });
});

// ─── §2 — cadastro rápido: pré-preenchimento, associação e preservação ──────

describe("R31.3 §2 — formulário e associação", () => {
  it("abrir pré-preenche o nome com a descrição fiscal limpa", () => {
    const form = quickProductPrefill(ITEM_REAL);
    expect(form.name).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(form.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(form.unitOfMeasure).toBe("pc");
    // O código do fornecedor NUNCA vira código interno do produto.
    expect(form.name).not.toContain("231071");
    expect(JSON.stringify(form)).not.toContain("231071");
  });

  it("salvar associa somente a linha de origem e preserva o fiscal", () => {
    const rows = [makeRow(OUTRO_ITEM), makeRow(ITEM_REAL)];
    const result = associateQuickProduct(rows, 1, "produto-novo");

    expect(result[0]).toBe(rows[0]);
    expect(result[1].productId).toBe("produto-novo");
    expect(result[1].associationType).toBe("created");
    expect(result[1].item.code).toBe("231071");
    expect(result[1].item.ncm).toBe("84716053");
    expect(result[1].item.cst).toBe("0102");
    expect(result[1].item.quantity).toBe(25);
    expect(result[1].item.unit).toBe("PC");
    expect(result[1].item.unitValue).toBe(52.94);
    expect(result[1].item.totalValue).toBe(1323.5);
  });

  it("falha ao salvar: o catch não fecha a conferência nem limpa o formulário", () => {
    const saveBody = ENTRIES.slice(
      ENTRIES.indexOf("const handleQuickProductSave = async () => {"),
      ENTRIES.indexOf("/** Cria a categoria sem fechar a conferência"),
    );
    const catchIdx = saveBody.lastIndexOf("} catch (error) {");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = saveBody.slice(catchIdx);
    // O catch só exibe o erro — estado e modais ficam como estavam.
    expect(catchBlock).not.toContain("setQuickProductOpen");
    expect(catchBlock).not.toContain("setNfeOpen");
    expect(catchBlock).not.toContain("setQuickProductForm(");
    expect(catchBlock).not.toContain("setNfeItems");
    // O único fechamento do formulário está no caminho de SUCESSO (dentro
    // do try, antes do catch externo) — nunca no caminho de falha.
    expect(saveBody.split("setQuickProductOpen(false)").length - 1).toBe(1);
    expect(saveBody.indexOf("setQuickProductOpen(false)")).toBeLessThan(
      catchIdx,
    );
  });

  it("o cadastro continua criando somente catálogo, sem entrada/estoque", () => {
    const saveBody = ENTRIES.slice(
      ENTRIES.indexOf("const handleQuickProductSave = async () => {"),
      ENTRIES.indexOf("/** Cria a categoria sem fechar a conferência"),
    );
    expect(saveBody).toContain("await createProduct({");
    expect(saveBody).toContain("minimumStock: 0");
    expect(saveBody).not.toContain("createEntry");
    expect(saveBody).not.toContain("confirmEntry");
    expect(saveBody).not.toContain("initialStock");
  });
});

// ─── §3 — apresentação sem colagem ─────────────────────────────────────────

describe("R31.3 §3 — separação visual de descrição, NCM, CST e rótulos", () => {
  it("prévia da DANFE: código, descrição, NCM e CST em elementos distintos", () => {
    expect(DIALOG).toContain("Cód. fornecedor {item.code}");
    expect(DIALOG).toContain("NCM {item.ncm}");
    expect(DIALOG).toContain("CST {item.cst}");
    // NCM e CST nunca concatenados por join na mesma string.
    expect(DIALOG).not.toContain('join(" · ")');
    // Cada identificador vive em seu próprio elemento com gap explícito.
    expect(DIALOG).toMatch(/<div className="mt-1\.5 flex flex-wrap items-center gap-2">/);
  });

  it("prévia: descrição em linha própria, separada dos identificadores", () => {
    const liBody = DIALOG.slice(
      DIALOG.indexOf("Cód. fornecedor {item.code}"),
      DIALOG.indexOf("</li>", DIALOG.indexOf("Cód. fornecedor {item.code}")),
    );
    expect(liBody).toContain("{item.description}");
    // descrição e NCM/CST NÃO estão no mesmo elemento inline.
    expect(liBody).not.toContain("{item.description} {");
  });

  it("conferência: NCM e CST em elementos separados (linha da tabela)", () => {
    expect(REVIEW_TABLE).toContain("NCM {review.item.ncm}");
    expect(REVIEW_TABLE).toContain("CST {review.item.cst}");
    expect(REVIEW_TABLE).not.toContain('join(" · ")');
  });

  it("conferência: rótulo e valor de identificadores em blocos separados", () => {
    const blocos = ENTRIES.slice(
      ENTRIES.indexOf("Identificadores fiscais"),
      ENTRIES.indexOf("Número da AF", ENTRIES.indexOf("Identificadores fiscais")),
    );
    expect(blocos).toContain("Itens da nota:");
    expect(blocos).toContain("Código do item (fornecedor):");
    // Valor abaixo do rótulo (elementos distintos), não inline consecutivo.
    expect(blocos).toContain("<p className=\"font-mono font-medium\">{nfe.items.length}</p>");
    expect(blocos).toMatch(/Código do item \(fornecedor\):\s*<\/span>\s*<p className="font-mono font-medium break-all">/);
  });

  it("conferência: razão social e CNPJ em linhas separadas", () => {
    const fornecedorBody = ENTRIES.slice(
      ENTRIES.indexOf("{nfeSupplier ? ("),
      ENTRIES.indexOf("Fornecedor não cadastrado"),
    );
    expect(fornecedorBody).toContain("Fornecedor identificado: {nfeSupplier.legalName}");
    expect(fornecedorBody).toContain("CNPJ {formatCnpj(nfeSupplier.cnpj)}");
    // Nome e CNPJ em elementos <p> distintos (linhas separadas).
    const pTags = fornecedorBody.match(/<p\b/g) ?? [];
    expect(pTags.length).toBeGreaterThanOrEqual(2);
    // Nunca nome e CNPJ concatenados na mesma string.
    expect(ENTRIES).not.toMatch(/legalName\}\}?\s*\{?\{?`?CNPJ/);
  });

  it("chave: única representação formatada e cópia só dos 44 dígitos", () => {
    expect(ENTRIES).toContain("formatAccessKeyPrint(nfeAccessKeyDigits)");
    expect(ENTRIES).not.toContain("formatAccessKeyGrouped(");
    expect(ENTRIES).toContain("navigator.clipboard.writeText(nfeAccessKeyDigits)");
  });
});

// ─── R31.8 §2 — blocos e rótulos explícitos (nada depende só de gap) ────────

describe("R31.8 §2 — apresentação em blocos com rótulos explícitos", () => {
  it("prévia: código do fornecedor e descrição em parágrafos distintos", () => {
    const start = DIALOG.indexOf("Cód. fornecedor {item.code}");
    const liBody = DIALOG.slice(
      DIALOG.lastIndexOf("<li", start),
      DIALOG.indexOf("</li>", start),
    );
    expect(liBody).toMatch(/<p[^>]*>\s*Cód\. fornecedor \{item\.code\}\s*<\/p>/);
    expect(liBody).toMatch(/<p[^>]*>\s*\{item\.description\}\s*<\/p>/);
    // não dividem a mesma linha flexível:
    expect(liBody).not.toContain("items-baseline");
  });

  it("prévia: quantidade, unidade, unitário e total empilhados com rótulo", () => {
    expect(DIALOG).toContain("Quantidade: {item.quantity}");
    expect(DIALOG).toContain("Unidade: {item.unit}");
    expect(DIALOG).toContain(
      "Valor unitário: {formatCurrencyStable(item.unitValue)}",
    );
    expect(DIALOG).toContain(
      "Valor total do item: {formatCurrencyStable(item.totalValue)}",
    );
    // linhas de bloco (space-y), não sequência inline separada por gap:
    expect(DIALOG).toContain(
      'className="mt-1.5 space-y-1 text-xs text-muted-foreground"',
    );
    expect(DIALOG).not.toContain("flex flex-wrap gap-x-3 gap-y-0.5");
  });

  it("prévia e conferência: separador TEXTUAL entre NCM e CST", () => {
    expect(DIALOG).toMatch(/\{item\.ncm && item\.cst \?/);
    expect(REVIEW_TABLE).toMatch(/\{review\.item\.ncm && review\.item\.cst \?/);
    expect(ENTRIES).toMatch(
      /nfe\.items\[0\]\.ncm !== undefined && nfe\.items\[0\]\.cst != null \?/,
    );
  });

  it("conferência: rótulos da linha são elementos de bloco e valores separados", () => {
    const rotulos =
      REVIEW_TABLE.match(
        /<span className="block text-\[10px\] uppercase text-muted-foreground">/g,
      ) ?? [];
    expect(rotulos.length).toBeGreaterThanOrEqual(5);
    expect(REVIEW_TABLE).toContain("Produto associado:");
    expect(REVIEW_TABLE).toMatch(/Unitário \{formatMoney\(review\.item\.unitValue\)\}/);
    expect(REVIEW_TABLE).toMatch(/Total \{formatMoney\(review\.item\.totalValue\)\}/);
    // contador/fonte/status da conferência separados por texto, não só por gap:
    expect(REVIEW_TABLE).toContain('<span aria-hidden="true">·</span>');
  });

  it("conferência: identificadores empilhados e fornecedor em linhas de bloco", () => {
    // Contador e código do item deixam de dividir um grid (colagem no cópia):
    expect(ENTRIES).toContain('<div className="mt-1 space-y-2">');
    // Razão social e CNPJ em <p> de bloco, fora de flex-col:
    expect(ENTRIES).toContain('<div className="min-w-0 space-y-0.5">');
    expect(ENTRIES).toContain('<span className="block min-w-0 truncate">');
    expect(ENTRIES).toContain('<span className="block text-xs text-muted-foreground">');
    expect(ENTRIES).not.toContain("flex min-w-0 flex-col leading-tight");
  });
});
