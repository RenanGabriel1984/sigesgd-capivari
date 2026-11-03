/**
 * RODADA 31.9 — CONFERÊNCIA ESTÁVEL + ETAPA DE RESUMO DA ENTRADA
 *
 * O que este arquivo garante (por leitura do código que efetivamente roda e
 * pelas funções puras que decidem o fluxo):
 *
 *  A. Não existe mais o botão “Revisar associações” nem a duplicidade com
 *     “Continuar conferência” na tabela: há UM único comando de avanço
 *     (“Avançar para resumo”), que nunca fecha o diálogo.
 *  B. O avanço com item pendente NÃO prossegue: informa a linha exata e rola
 *     até ela; com todos os itens associados e quantidades válidas, abre o
 *     resumo.
 *  C. O resumo mostra nota, fornecedor, chave, AF/processo/empenho, itens,
 *     local, lote e total geral, com apenas duas ações — “Voltar para
 *     produtos” e “Confirmar entrada”.
 *  D. Voltar preserva os dados (a etapa é só um estado de visualização) e
 *     abrir/fechar o resumo não chama mutação alguma; confirmar só acontece
 *     no clique explícito.
 *
 * LIMITAÇÃO DECLARADA: este ambiente não tem navegador — o clique real no
 * preview (Parte A/E) não foi executado aqui; o caminho do evento é
 * demonstrado pelo código-fonte e pelas funções puras. Nenhum banco, estoque
 * ou registro é criado/modificado.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildNfeEntrySummary,
  evaluateNfeAdvance,
  type NfeAdvanceRow,
} from "@/lib/nfe-summary";
import type { NfeItem } from "@/lib/nfe";

const ENTRIES = readFileSync(
  resolve(__dirname, "..", "pages", "Entries.tsx"),
  "utf8",
);
const REVIEW_TABLE = readFileSync(
  resolve(__dirname, "..", "components", "NfeReviewTable.tsx"),
  "utf8",
);
const SUMMARY = readFileSync(
  resolve(__dirname, "..", "components", "NfeEntrySummary.tsx"),
  "utf8",
);
const DIALOG = readFileSync(
  resolve(__dirname, "..", "components", "DanfeImportDialog.tsx"),
  "utf8",
);
const DIAGNOSTICS = readFileSync(
  resolve(__dirname, "..", "lib", "danfe-diagnostics.ts"),
  "utf8",
);
const DEPLOY_DOC = readFileSync(
  resolve(__dirname, "..", "..", "docs", "DEPLOY.md"),
  "utf8",
);

const advanceBody = ENTRIES.slice(
  ENTRIES.indexOf("const handleAdvanceToSummary = () => {"),
  ENTRIES.indexOf("const handleBackToProducts"),
);

// ─── A — comando único de avanço, sem fechar a conferência ─────────────────

describe("R31.9 A — comando único de avanço", () => {
  it("removeu 'Revisar associações' e a duplicidade da tabela", () => {
    expect(ENTRIES).not.toContain("Revisar associações");
    expect(ENTRIES).not.toContain("handleReviewAssociations");
    expect(REVIEW_TABLE).not.toContain("Continuar conferência");
    expect(REVIEW_TABLE).not.toContain("onContinue");
    expect(ENTRIES).not.toContain("onContinue=");
  });

  it("rodapé da conferência tem exatamente Cancelar + Avançar para resumo", () => {
    const footerStart = ENTRIES.indexOf('<DialogFooter className="gap-2 sm:gap-3">');
    const footerEnd = ENTRIES.indexOf("</DialogFooter>", footerStart);
    expect(footerStart).toBeGreaterThan(-1);
    const footer = ENTRIES.slice(footerStart, footerEnd);
    expect((footer.match(/type="button"/g) ?? []).length).toBe(2);
    expect(footer).toContain("onClick={cancelNfeConference}");
    expect(footer).toContain("onClick={handleAdvanceToSummary}");
    expect(footer).toContain("Avançar para resumo");
    expect(footer).not.toContain("Confirmar entrada");
  });

  it("avançar não escreve nfeOpen, não navega e não cria dados", () => {
    expect(advanceBody).toContain("const handleAdvanceToSummary");
    expect(advanceBody).not.toContain("setNfeOpen");
    expect(advanceBody).not.toContain("setNfe(");
    expect(advanceBody).not.toContain("setNfeItems");
    expect(advanceBody).not.toContain("createEntry");
    expect(advanceBody).not.toContain("confirmEntry");
    expect(advanceBody).not.toContain("createProduct");
    expect(advanceBody).not.toContain("upsertNfeProductAlias");
    expect(advanceBody).not.toContain("navigate");
    expect(advanceBody).not.toContain("location.href");
  });

  it("pendência identifica a linha e rola até ela em vez de sair da tela", () => {
    expect(advanceBody).toContain("evaluateNfeAdvance(nfeItems)");
    expect(advanceBody).toContain("`nfe-item-${outcome.firstPendingIndex}`");
    expect(advanceBody).toContain("scrollIntoView");
    // cada linha da tabela tem âncora para a rolagem:
    expect(REVIEW_TABLE).toContain("id={`nfe-item-${index}`}");
    // e a seção de itens mantém a âncora de fallback:
    expect(ENTRIES).toContain('id="nfe-review-items"');
  });

  it("com tudo válido abre o resumo (mesma conferência, sem recriar estado)", () => {
    expect(advanceBody).toContain('setNfeStep("summary")');
    expect(ENTRIES).toContain("{nfeStep === \"summary\" ? (");
    expect(ENTRIES).toContain("<NfeEntrySummary");
    expect(ENTRIES).toContain("onBack={handleBackToProducts}");
    expect(ENTRIES).toContain("onConfirm={() => void handleConfirmImport()}");
    expect(ENTRIES).toContain("confirming={nfeConfirming}");
  });

  it("voltar preserva os dados; cancelar continua sendo a saída intencional", () => {
    expect(ENTRIES).toContain(
      "const handleBackToProducts = () => setNfeStep(\"products\");",
    );
    const cancelBody = ENTRIES.slice(
      ENTRIES.indexOf("const cancelNfeConference = () => {"),
      ENTRIES.indexOf("const openQuickProductForRow"),
    );
    expect(cancelBody).toContain("setNfeOpen(false)");
    expect(cancelBody).toContain('setNfeStep("products")');
    // Cancelar não limpa a NF-e (só fecha a operação):
    expect(cancelBody).not.toContain("setNfeItems([])");
  });

  it("fechamento acidental por pointer-down fora do diálogo continua bloqueado", () => {
    expect(ENTRIES).toContain(
      "onPointerDownOutside={(event) => event.preventDefault()}",
    );
    expect(ENTRIES).toContain(
      "onInteractOutside={(event) => event.preventDefault()}",
    );
  });
});

// ─── B — regra pura de avanço (pendência, quantidade, sucesso) ───────────────

describe("R31.9 B — evaluateNfeAdvance", () => {
  const item: NfeItem = {
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
  const found: NfeAdvanceRow = {
    item,
    productId: "p-vinik",
    matchStatus: "found",
    locationId: "loc-1",
    supplierLot: "L-77",
  };
  const pending: NfeAdvanceRow = { item, productId: "", matchStatus: "not_found" };

  it("sem itens não avança", () => {
    const outcome = evaluateNfeAdvance([]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("empty");
  });

  it("item pendente não avança e aponta a linha exata (cód. 231071)", () => {
    const outcome = evaluateNfeAdvance([pending]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("pending");
    expect(outcome.firstPendingIndex).toBe(0);
    expect(outcome.message).toContain("cód. 231071");
    expect(outcome.pending[0]).toContain("linha 1");
  });

  it("quantidade ausente/zero não avança", () => {
    const outcome = evaluateNfeAdvance([
      { ...found, item: { ...item, quantity: 0 } },
    ]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("invalid-quantity");
      expect(outcome.firstPendingIndex).toBe(0);
    }
  });

  it("todos associados com quantidade válida abre o resumo", () => {
    expect(evaluateNfeAdvance([found])).toEqual({ ok: true });
    expect(evaluateNfeAdvance([found, { ...found, productId: "p-2" }])).toEqual({
      ok: true,
    });
  });
});

// ─── C/D — resumo: dados completos, duas ações, nenhuma mutação ─────────────

describe("R31.9 C/D — resumo da entrada", () => {
  const item: NfeItem = {
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
  const row: NfeAdvanceRow = {
    item,
    productId: "p-vinik",
    matchStatus: "found",
    locationId: "loc-1",
    supplierLot: "L-77",
  };

  it("preserva os dados fiscais da Incotech no modelo do resumo", () => {
    const summary = buildNfeEntrySummary({
      nfe: {
        number: "2967",
        series: "001",
        emissionDate: "2026-09-28",
        accessKey: "42260922816315000144550010000029671155440064",
        totalValue: 1323.5,
      },
      rows: [row],
      products: [{ _id: "p-vinik", name: "KIT TECLADO E MOUSE USB SLIM CHOCOLATE" }],
      locations: [{ _id: "loc-1", name: "Almoxarifado Central" }],
      supplier: { legalName: "Incotech Company LTDA", cnpj: "22816315000144" },
      afNumber: "2223/2026",
      processNumber: "PR-2026-1",
      empenhoNumber: "7718/2026",
    });

    expect(summary.number).toBe("2967");
    expect(summary.series).toBe("001");
    expect(summary.emissionDate).toBe("2026-09-28");
    expect(summary.supplierName).toBe("Incotech Company LTDA");
    expect(summary.supplierCnpj).toBe("22816315000144");
    expect(summary.accessKey).toBe("42260922816315000144550010000029671155440064");
    expect(summary.afNumber).toBe("2223/2026");
    expect(summary.processNumber).toBe("PR-2026-1");
    expect(summary.empenhoNumber).toBe("7718/2026");
    expect(summary.total).toBeCloseTo(1323.5, 2);
    expect(summary.totalFromDocument).toBe(true);

    expect(summary.items).toHaveLength(1);
    const [line] = summary.items;
    expect(line.supplierCode).toBe("231071");
    expect(line.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(line.ncm).toBe("84716053");
    expect(line.cst).toBe("0102");
    expect(line.quantity).toBe(25);
    expect(line.unit).toBe("PC");
    expect(line.unitValue).toBeCloseTo(52.94, 2);
    expect(line.totalValue).toBeCloseTo(1323.5, 2);
    expect(line.productName).toBe("KIT TECLADO E MOUSE USB SLIM CHOCOLATE");
    expect(line.locationName).toBe("Almoxarifado Central");
    expect(line.supplierLot).toBe("L-77");
  });

  it("total geral cai para a soma dos itens quando o documento não traz total", () => {
    const summary = buildNfeEntrySummary({
      nfe: {
        number: "2967",
        series: "001",
        emissionDate: "2026-09-28",
        totalValue: undefined,
      },
      rows: [row],
      products: [{ _id: "p-vinik", name: "KIT" }],
    });
    expect(summary.total).toBeCloseTo(1323.5, 2);
    expect(summary.totalFromDocument).toBe(false);
  });

  it("é puro: não muta as linhas da conferência", () => {
    const rows = [{ ...row, item: { ...item } }];
    const before = JSON.stringify(rows);
    buildNfeEntrySummary({
      nfe: { number: "2967", series: "001", emissionDate: "2026-09-28" },
      rows,
      products: [{ _id: "p-vinik", name: "KIT" }],
    });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("componente do resumo expõe apenas as duas ações, ambas type=button", () => {
    expect(SUMMARY).toContain("Voltar para produtos");
    expect(SUMMARY).toContain("Confirmar entrada");
    expect((SUMMARY.match(/type="button"/g) ?? []).length).toBe(2);
    expect(SUMMARY).toContain("onClick={onBack}");
    expect(SUMMARY).toContain("onClick={onConfirm}");
    // Nenhuma mutation dentro do resumo: abrir/fechar/voltar não grava nada.
    expect(SUMMARY).not.toContain("useMutation");
    expect(SUMMARY).not.toContain("api.");
    expect(SUMMARY).not.toContain("createEntry");
    expect(SUMMARY).not.toContain("confirmEntry");
    expect(SUMMARY).not.toContain("createProduct");
    expect(SUMMARY).not.toContain("upsertNfeProductAlias");
  });

  it("resumo apresenta todos os campos exigidos (Parte B)", () => {
    for (const rotulo of [
      "Número da NF-e",
      "Série",
      "Data de emissão",
      "Fornecedor",
      "CNPJ",
      "Chave de acesso",
      "Número da AF",
      "Processo administrativo",
      "Empenho",
      "Quantidade",
      "Valor unitário",
      "Total do item",
      "Produto associado",
      "Local de destino",
      "Lote do fornecedor",
      "Total geral da nota",
    ]) {
      expect(SUMMARY).toContain(rotulo);
    }
  });

  it("confirmar só pode ser acionado por clique explícito no resumo", () => {
    // A criação/confirmação continua somente em handleConfirmImport, que é
    // chamado no onClick do botão — nunca ao abrir o resumo.
    expect(ENTRIES).toContain("onConfirm={() => void handleConfirmImport()}");
    const summaryBranch = ENTRIES.slice(
      ENTRIES.indexOf("{nfeStep === \"summary\" ? ("),
      ENTRIES.indexOf("<DialogHeader>", ENTRIES.indexOf("{nfeStep === \"summary\" ? (")),
    );
    expect(summaryBranch).not.toContain("createEntry");
    expect(summaryBranch).not.toContain("confirmEntry");
    expect(summaryBranch).not.toContain("useEffect");
  });
});

// ─── D — diagnóstico identifica build, ambiente e backend ────────────────────

describe("R31.9 D — diagnóstico do ambiente de execução", () => {
  it("registra build, ambiente e backend (apenas o host, sem segredos)", () => {
    expect(DIALOG).toContain("buildId: buildIdFrom(bundle),");
    expect(DIALOG).toContain("ambiente: environmentLabel(),");
    expect(DIALOG).toContain("backendHost: backendHost(),");
    expect(DIALOG).toContain("new URL(url).host");
    // Nunca chaves/segredos no diagnóstico:
    expect(DIALOG).not.toContain("CONVEX_DEPLOY_KEY");
    // Campos opcionais: diagnósticos/fixtures antigos continuam válidos.
    expect(DIAGNOSTICS).toContain("buildId?: string | null;");
    expect(DIAGNOSTICS).toContain("backendHost?: string | null;");
    expect(DIAGNOSTICS).toContain(
      'ambiente?: "desenvolvimento" | "homologacao" | "producao";',
    );
  });

  it("documenta o procedimento de homologação isolada", () => {
    expect(DEPLOY_DOC).toContain("Homologação isolada");
    expect(DEPLOY_DOC).toContain("VITE_APP_ENV=homologacao");
    expect(DEPLOY_DOC).toContain("--preview-name homolog");
    // A documentação não manda apontar homologação para o banco real.
    expect(DEPLOY_DOC).toContain("Nunca rodar seeds");
  });
});
