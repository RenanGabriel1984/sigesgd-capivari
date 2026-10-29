/**
 * RODADA 31.9 — REGRESSÃO: "REVISAR ASSOCIAÇÕES" NÃO FECHA A CONFERÊNCIA
 *
 * Defeito reportado no preview: clicar em "Revisar associações" na conferência
 * da NF-e 2967 fazia a tela sair da conferência.
 *
 * O que este arquivo garante (por leitura do código que efetivamente roda):
 *  1. `handleReviewAssociations` (usado por "Revisar associações" E por
 *     "Continuar conferência") não escreve `nfeOpen`, não navega e não chama
 *     nenhuma mutação de produto/categoria/entrada/estoque;
 *  2. ele informa QUAIS linhas precisam de atenção (resumo puro) e rola para
 *     a seção de itens, mantendo o diálogo aberto;
 *  3. o fechamento da conferência só acontece por ação explícita: Cancelar,
 *     X ou Esc — pointer-down fora do diálogo (overlay ou toast, que vive em
 *     portal próprio fora da camada do Radix) é ignorado;
 *  4. os botões têm `type="button"` (nenhum submit involuntário);
 *  5. os dados fiscais da linha Incotech continuam íntegros: o resumo dos
 *     pendentes é puro (não muta as linhas) e preserva código/descrição.
 *
 * LIMITAÇÃO DECLARADA: este ambiente não tem navegador — o clique real no
 * preview não foi executado aqui; o caminho do evento é demonstrado pelo
 * código-fonte. Nenhum banco, estoque ou registro é criado/modificado.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pendingNfeItemsSummary, type NfeItem } from "@/lib/nfe";

const ENTRIES = readFileSync(
  resolve(__dirname, "..", "pages", "Entries.tsx"),
  "utf8",
);
const REVIEW_TABLE = readFileSync(
  resolve(__dirname, "..", "components", "NfeReviewTable.tsx"),
  "utf8",
);

const reviewBody = ENTRIES.slice(
  ENTRIES.indexOf("const handleReviewAssociations = () => {"),
  ENTRIES.indexOf("const openQuickProductForRow", ENTRIES.indexOf("const handleReviewAssociations")),
);

// ─── §1 — o handler de revisão não fecha nem muta nada ──────────────────────

describe("R31.9 §1 — handleReviewAssociations preserva a conferência", () => {
  it("não escreve nfeOpen, não navega e não reseta estado da NF-e", () => {
    expect(reviewBody).toContain("const handleReviewAssociations");
    expect(reviewBody).not.toContain("setNfeOpen");
    expect(reviewBody).not.toContain("setNfe(");
    expect(reviewBody).not.toContain("setNfeItems");
    expect(reviewBody).not.toContain("setDanfeFile");
    expect(reviewBody).not.toContain("navigate");
    expect(reviewBody).not.toContain("location.href");
  });

  it("nenhuma mutação de produto, categoria, entrada ou estoque", () => {
    expect(reviewBody).not.toContain("createEntry");
    expect(reviewBody).not.toContain("confirmEntry");
    expect(reviewBody).not.toContain("createProduct");
    expect(reviewBody).not.toContain("createCategory");
    expect(reviewBody).not.toContain("upsertNfeProductAlias");
    expect(reviewBody).not.toContain("useMutation");
  });

  it("mantém a regra única de avanço e informa quais itens faltam", () => {
    expect(reviewBody).toContain("if (!canContinueNfeReview(nfeItems))");
    // Lista EXATA do que precisa de atenção (não só mensagem genérica):
    expect(reviewBody).toContain("pendingNfeItemsSummary(nfeItems)");
    // Direciona o olhar para a seção de itens em vez de sair da tela:
    expect(reviewBody).toContain('getElementById("nfe-review-items")');
    expect(reviewBody).toContain("scrollIntoView");
    // Ambos os botões usam o MESMO handler:
    expect(ENTRIES).toContain("onContinue={handleReviewAssociations}");
    expect(ENTRIES).toContain('onClick={handleReviewAssociations}');
  });
});

// ─── §2 — fechamento só explícito + botões sem submit ───────────────────────

describe("R31.9 §2 — fechamento explícito e botões com type=button", () => {
  const dialogStart = ENTRIES.indexOf(
    "<DialogContent\n            className=\"max-h-[90vh] overflow-y-auto sm:max-w-5xl\"",
  );

  it("pointer-down fora do diálogo (overlay/toast) não fecha a conferência", () => {
    expect(dialogStart).toBeGreaterThan(-1);
    expect(ENTRIES).toContain(
      "onPointerDownOutside={(event) => event.preventDefault()}",
    );
    expect(ENTRIES).toContain(
      "onInteractOutside={(event) => event.preventDefault()}",
    );
  });

  it("rodapé: os três botões são type=button e Cancelar segue disponível", () => {
    const footerStart = ENTRIES.indexOf('<DialogFooter className="gap-2 sm:gap-3">');
    const footerEnd = ENTRIES.indexOf("</DialogFooter>", footerStart);
    expect(footerStart).toBeGreaterThan(-1);
    expect(footerEnd).toBeGreaterThan(footerStart);
    const footer = ENTRIES.slice(footerStart, footerEnd);
    expect((footer.match(/type="button"/g) ?? []).length).toBe(3);
    expect(footer).toContain("onClick={() => setNfeOpen(false)}");
    expect(footer).toContain("Revisar associações");
    expect(footer).toContain("Confirmar entrada");
  });

  it("Conferir tabela: botões type=button e o componente nunca toca em nfeOpen", () => {
    expect((REVIEW_TABLE.match(/type="button"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(REVIEW_TABLE).toContain("disabled={!canContinueNfeReview(items)}");
    expect(REVIEW_TABLE).toContain("onClick={onContinue}");
    expect(REVIEW_TABLE).toContain("onClick={() => onNewProduct(index)}");
    expect(REVIEW_TABLE).not.toContain("setNfeOpen");
    expect(REVIEW_TABLE).not.toContain("nfeOpen");
  });

  it("a seção de itens tem âncora para a rolagem da revisão", () => {
    expect(ENTRIES).toContain('id="nfe-review-items"');
  });
});

// ─── §3 — resumo puro dos pendentes + dados fiscais preservados ─────────────

describe("R31.9 §3 — pendingNfeItemsSummary", () => {
  const incotechItem: NfeItem = {
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

  it("lista a linha pendente com código e descrição (cód. 231071)", () => {
    const summary = pendingNfeItemsSummary([
      { item: incotechItem, productId: "", matchStatus: "not_found" },
    ]);
    expect(summary).toEqual([
      "linha 1 — cód. 231071 — KIT TECLADO E MOUSE USB SLIM CHOCO",
    ]);
  });

  it("item associado (found) não aparece; 'possible' precisa de atenção", () => {
    expect(
      pendingNfeItemsSummary([
        { item: incotechItem, productId: "p1", matchStatus: "found" },
      ]),
    ).toEqual([]);
    expect(
      pendingNfeItemsSummary([
        { item: incotechItem, productId: "", matchStatus: "possible" },
      ]),
    ).toHaveLength(1);
  });

  it("é pura: não muta as linhas e os dados fiscais permanecem intactos", () => {
    const rows = [
      { item: { ...incotechItem }, productId: "", matchStatus: "not_found" as const },
    ];
    const before = JSON.stringify(rows);
    pendingNfeItemsSummary(rows);
    expect(JSON.stringify(rows)).toBe(before);
    const [row] = rows;
    expect(row.item.code).toBe("231071");
    expect(row.item.ncm).toBe("84716053");
    expect(row.item.cst).toBe("0102");
    expect(row.item.quantity).toBe(25);
    expect(row.item.unit).toBe("PC");
    expect(row.item.unitValue).toBe(52.94);
    expect(row.item.totalValue).toBe(1323.5);
  });

  it("condição é exatamente a negação de canContinueNfeReview", () => {
    const pendente = [{ item: incotechItem, productId: "", matchStatus: "not_found" as const }];
    const ok = [{ item: incotechItem, productId: "p1", matchStatus: "found" as const }];
    expect(pendingNfeItemsSummary(pendente).length > 0).toBe(true);
    expect(pendingNfeItemsSummary(ok)).toEqual([]);
  });
});
