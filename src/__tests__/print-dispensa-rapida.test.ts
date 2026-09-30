/**
 * Gestão de Estoque SGGD — DISPENSAÇÃO RÁPIDA DE SUPRIMENTOS (PRINT-DISP-01..10).
 *
 * "Retirar" na tela de Gestão de Suprimentos de Impressão é um ATALHO de
 * DISPENSAÇÃO/ENTREGA — não é transferência, não remove o produto da área
 * Impressoras e não desassocia o produto da área.
 *
 * Garantias cobertas:
 *  - modal abre com o produto já selecionado;
 *  - confirmação explícita antes de qualquer escrita;
 *  - Cancelar não altera estoque;
 *  - a gravação é uma SAÍDA real (FIFO + lotId + stockMovement + auditoria);
 *  - saldo antes/depois, aviso de mínimo NÃO bloqueante e RBAC;
 *  - o backend bloqueia retirada acima do disponível.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhuma movimentação fictícia,
 * nenhuma quantidade real alterada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  validateWithdrawal,
  buildLowStockWarning,
  buildWithdrawalConfirmation,
  canConfirmWithdrawal,
  planPackOperation,
} from "@/lib/print-supplies";
import { roleHasPermission, type AppRole } from "@/lib/rbac";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const panel = read("src/pages/GomaQ.tsx");
const backend = read("src/convex/printSupplies.ts");

/** Bloco do diálogo de retirada dentro de GomaQ.tsx. */
const dialog = panel.slice(
  panel.indexOf("function WithdrawDialog"),
  panel.indexOf("/* ═══ Aba CONSUMO MENSAL")
);

/**
 * Corpo de uma mutation, delimitado pelo PRÓXIMO `export const` do arquivo
 * (usar `});` truncaria o bloco nos args e leria vazio).
 */
function backendBlock(name: string): string {
  const start = backend.indexOf(`export const ${name} =`);
  expect(start, `mutation ${name} não encontrada`).toBeGreaterThan(-1);
  const rest = backend.slice(start);
  const next = rest.slice(1).search(/\nexport const /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const withdrawBlock = backendBlock("withdraw");
const withdrawFamilyBlock = backendBlock("withdrawFamily");

// ─────────────────────────────────────────────────────────────────────────────

describe("PRINT-DISP — Abertura do modal", () => {
  it("PRINT-DISP-01: 'Retirar' abre modal com o produto selecionado", () => {
    // A linha da tabela passa a FAMÍLIA selecionada para o diálogo.
    expect(panel).toContain("setWithdrawFor(f)");
    expect(dialog).toContain("family: SupplyFamilyView");

    // O modal identifica o produto e mostra os dados pedidos.
    expect(dialog).toContain("Retirada de suprimento");
    expect(dialog).toContain("{family.familyName}");
    expect(dialog).toContain("Marca: {family.brand ?? \"—\"} · Modelo: {family.model ?? \"—\"}");
    expect(dialog).toContain("Estoque disponível");
    expect(dialog).toContain("Quantidade solicitada");
    expect(dialog).toContain("Saldo após retirada");

    // Todos os campos exigidos pelo fluxo existem no formulário.
    for (const label of ["Quantidade", "Secretaria", "Departamento", "Unidade", "Motivo", "O.S.", "Observação"]) {
      expect(dialog).toContain(`<Label>${label}`);
    }
    expect(dialog).toContain('<Label>O.S. (opcional)</Label>');
    expect(dialog).toContain('<Label>Quantidade em {family.baseUnit} *</Label>');

    // O operador não sai da tela: o diálogo abre inline, sem navegação.
    expect(dialog).not.toContain("navigate(");
    expect(dialog).not.toContain("window.location");
  });
});

describe("PRINT-DISP — Confirmação antes da escrita", () => {
  it("PRINT-DISP-07: há confirmação explícita antes de gravar", () => {
    expect(dialog).toContain('const [step, setStep] = useState<"form" | "confirm">("form")');
    expect(dialog).toContain('"Confirmar retirada?"');
    expect(dialog).toContain('setStep("confirm")');

    // A mutation só é disparada pelo botão da etapa de confirmação.
    expect(dialog).toContain("onClick={submit}");
    // Avançar para a confirmação acontece sem gravação: o botão da etapa 1
    // apenas troca o estado local (`step`).
    const formButton = dialog.slice(
      dialog.indexOf('onClick={() => setStep("confirm")}') - 200,
      dialog.indexOf('onClick={() => setStep("confirm")}')
    );
    expect(formButton).not.toContain("submit");
    expect(formButton).not.toContain("withdraw");

    // Botões "Cancelar" e "Confirmar retirada".
    expect(dialog).toContain("Cancelar");
    expect(dialog).toContain("Confirmar retirada");
  });

  it("PRINT-DISP-07b: o resumo traz produto, quantidade, destino, motivo, O.S. e saldos", () => {
    const rows = buildWithdrawalConfirmation({
      productLabel: "MFC-L6902DW — Preto",
      quantity: 1,
      baseUnit: "un",
      currentStock: 40,
      minimumStock: 5,
      secretaria: "Secretaria X",
      departamento: "Departamento Y",
      unidade: "Unidade Z",
      reason: "Substituição",
      osNumber: "XXXX",
    });

    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Produto"]).toBe("MFC-L6902DW — Preto");
    expect(byLabel["Quantidade"]).toBe("1 un");
    expect(byLabel["Destino"]).toBe("Secretaria X / Departamento Y / Unidade Z");
    expect(byLabel["Motivo"]).toBe("Substituição");
    expect(byLabel["O.S."]).toBe("XXXX");
    expect(byLabel["Estoque atual"]).toBe("40 un");
    expect(byLabel["Estoque após retirada"]).toBe("39 un");

    // Campos não informados viram "—", nunca "undefined"/"null" na tela.
    const parcial = buildWithdrawalConfirmation({
      productLabel: "Toner CX735 — Preto",
      quantity: 2,
      baseUnit: "un",
      currentStock: 5,
      minimumStock: null,
      reason: "Reposição",
    });
    const parcialByLabel = Object.fromEntries(parcial.map((r) => [r.label, r.value]));
    expect(parcialByLabel["Destino"]).toBe("—");
    expect(parcialByLabel["O.S."]).toBe("—");
    expect(parcialByLabel["Estoque após retirada"]).toBe("3 un");

    // A ordem das linhas é estável (resumo legível).
    expect(rows.map((r) => r.label)).toEqual([
      "Produto",
      "Quantidade",
      "Destino",
      "Motivo",
      "O.S.",
      "Estoque atual",
      "Estoque após retirada",
    ]);
  });

  it("PRINT-DISP-08: Cancelar não altera estoque (nenhuma mutation no caminho)", () => {
    // `cancel` só mexe no estado local do formulário.
    expect(dialog).toContain("const cancel = () => {");
    expect(dialog).toContain('setStep("form")');

    const cancelBody = dialog.slice(
      dialog.indexOf("const cancel = () => {"),
      dialog.indexOf("const submit = async")
    );
    expect(cancelBody).not.toContain("withdraw");
    expect(cancelBody).not.toContain("await ");
    expect(cancelBody).not.toContain("useMutation");

    // A confirmação chama as mutations; o cancelamento nunca aparece nessa função.
    const submitBody = dialog.slice(
      dialog.indexOf("const submit = async"),
      dialog.indexOf("return (")
    );
    expect(submitBody).not.toContain("cancel()");
  });

  it("PRINT-DISP-07c: o botão só habilita com saldo válido E motivo informado", () => {
    expect(canConfirmWithdrawal({ quantity: 1, available: 40, reason: "Substituição" })).toBe(true);
    // Sem motivo → não confirma.
    expect(canConfirmWithdrawal({ quantity: 1, available: 40, reason: "   " })).toBe(false);
    // Quantidade acima do disponível → não confirma.
    expect(canConfirmWithdrawal({ quantity: 41, available: 40, reason: "Substituição" })).toBe(false);
    // Quantidade zero/negativa → não confirma.
    expect(canConfirmWithdrawal({ quantity: 0, available: 40, reason: "Substituição" })).toBe(false);
    expect(dialog).toContain("disabled={!canConfirm}");
    expect(dialog).toContain("disabled={saving || !canConfirm}");
  });
});

describe("PRINT-DISP — Regra de saldo e de mínimo", () => {
  it("PRINT-DISP-05: saldo antes/depois calculado corretamente", () => {
    const check = validateWithdrawal(1, 40);
    expect(check.ok).toBe(true);
    expect(check.balanceAfter).toBe(39);

    expect(validateWithdrawal(20, 668).balanceAfter).toBe(648);
    expect(validateWithdrawal(40, 40).balanceAfter).toBe(0);

    // Acima do disponível é BLOQUEADO (com mensagem de saldo disponível).
    const excedente = validateWithdrawal(41, 40);
    expect(excedente.ok).toBe(false);
    expect(excedente.reason).toContain("Estoque insuficiente");
    expect(excedente.reason).toContain("40");
    expect(excedente.balanceAfter).toBeUndefined();

    // Quantidade não positiva é bloqueada.
    expect(validateWithdrawal(0, 40).ok).toBe(false);
    expect(validateWithdrawal(-1, 40).ok).toBe(false);
  });

  it("PRINT-DISP-06: aviso de estoque abaixo do mínimo é NÃO bloqueante", () => {
    // 40 → 1 deixa abaixo do mínimo 5: avisa.
    const abaixo = buildLowStockWarning(40, 5, 39);
    expect(abaixo.warn).toBe(true);
    expect(abaixo.current).toBe(40);
    expect(abaixo.minimum).toBe(5);
    expect(abaixo.balanceAfter).toBe(1);

    // Ainda acima do mínimo: não avisa.
    expect(buildLowStockWarning(40, 5, 1).warn).toBe(false);
    // Exatamente no mínimo: ainda não é "abaixo" (regra de <= do status).
    expect(buildLowStockWarning(40, 5, 35).warn).toBe(false);
    expect(buildLowStockWarning(40, 5, 36).warn).toBe(true);

    // Mínimo não configurado → sem alerta (parâmetro indefinido não alarma).
    expect(buildLowStockWarning(40, null, 39).warn).toBe(false);
    expect(buildLowStockWarning(40, 0, 39).warn).toBe(false);
    expect(buildLowStockWarning(40, null, 39).minimum).toBeNull();

    // O aviso NÃO impede a confirmação: com motivo e saldo, confirma normalmente.
    const confirmavel = canConfirmWithdrawal({ quantity: 39, available: 40, reason: "Reposição" });
    expect(confirmavel).toBe(true);

    // A tela exibe o texto e os três números exigidos.
    expect(dialog).toContain("Esta retirada deixará o estoque abaixo do mínimo.");
    expect(dialog).toContain("Atenção");
    expect(dialog).toContain("lowStock.current");
    expect(dialog).toContain("lowStock.minimum");
    expect(dialog).toContain("lowStock.balanceAfter");
  });
});

describe("PRINT-DISP — A retirada é uma SAÍDA real, não transferência", () => {
  it("PRINT-DISP-02: retirada não remove o produto da área Impressoras", () => {
    // Nenhuma escrita em `stockByLocation`, `products` ou nas áreas.
    const submitBody = dialog.slice(
      dialog.indexOf("const submit = async"),
      dialog.indexOf("return (")
    );
    expect(submitBody).not.toContain("stockByLocation");
    expect(submitBody).not.toContain("delete");
    expect(submitBody).not.toContain("patch");

    // O backend só DEBITO saldo: não apaga registro de estoque/local.
    expect(withdrawBlock).not.toContain("db.delete");
    expect(withdrawFamilyBlock).not.toContain("db.delete");
    expect(withdrawBlock).toContain("physicalQuantity: newPhysical");
    // E nenhuma das duas mutations altera produtos/áreas/locais.
    for (const block of [withdrawBlock, withdrawFamilyBlock]) {
      expect(block).not.toContain('db.patch(product');
      expect(block).not.toContain("stockByLocation");
    }
  });

  it("PRINT-DISP-03: retirada grava uma saída real (movimentação + auditoria)", () => {
    // Movimentação do tipo "exit" com saldo anterior e novo.
    expect(withdrawBlock).toContain('type: "exit"');
    expect(withdrawBlock).toContain("previousPhysical");
    expect(withdrawBlock).toContain("newPhysical");
    expect(withdrawBlock).toContain("newPhysical = previousPhysical - args.quantity");

    // Auditoria obrigatória.
    expect(withdrawBlock).toContain('action: "move_stock"');
    expect(withdrawBlock).toContain('entity: "stockMovements"');

    // Contexto preservado na observação (motivo / O.S. / destino / lotes).
    expect(withdrawBlock).toContain("Retirada de suprimento");
    expect(withdrawBlock).toContain("args.reason");
    expect(withdrawBlock).toContain("args.osNumber");
    expect(withdrawBlock).toContain("args.secretariaId");

    // A família (unidade-base) grava também, com a mesma natureza de saída.
    expect(withdrawFamilyBlock).toContain('type: "exit"');
    expect(withdrawFamilyBlock).toContain("lotId");
    expect(withdrawFamilyBlock).toContain('action: "move_stock"');
  });

  it("PRINT-DISP-04: FIFO e lotId preservados", () => {
    // Lotes consumidos em ordem de recebimento (FIFO)…
    expect(withdrawBlock).toContain("sort((a, b) => a.receivedAt - b.receivedAt)");
    expect(withdrawBlock).toContain("quantityAvailable");
    expect(withdrawBlock).toContain("lot.quantityAvailable - take");
    // …e o lotId do 1º lote consumido vai para a movimentação.
    expect(withdrawBlock).toContain("lotId: consumedLots[0].lotId");

    // Falha de consistência ABORTA (nenhuma saída parcial registrada).
    expect(withdrawBlock).toContain("Falha de consistência: lotes insuficientes");
    expect(withdrawBlock).toContain("Nenhuma saída registrada");
  });

  it("PRINT-DISP-04b: a abertura de embalagem é um evento explícito e rastreado", () => {
    // Retirar 20 un de um produto com 18 avulsas abre 1 caixa fechada.
    const plano = planPackOperation(20, { closedPacks: 13, looseUnits: 18, factor: 50 });
    expect(plano).toEqual({ operation: "open_pack", packs: 1 });

    // 668 un = 13 caixas × 50 + 18 avulsas: a composição fecha exata em
    // caixas inteiras → take_pack, NADA é desmontado.
    expect(planPackOperation(668, { closedPacks: 13, looseUnits: 18, factor: 50 })).toEqual({
      operation: "take_pack",
      packs: 13,
    });
    // 650 un com 18 avulsas NÃO fecha em caixas inteiras (632 = 12×50 + 32):
    // abrir 13 caixas é o ÚNICO evento físico possível — o registro é explícito.
    expect(planPackOperation(650, { closedPacks: 13, looseUnits: 18, factor: 50 })).toEqual({
      operation: "open_pack",
      packs: 13,
    });

    // Impossível → null (a UI não oferece operação sem estoque físico).
    expect(planPackOperation(9999, { closedPacks: 13, looseUnits: 18, factor: 50 })).toBeNull();
  });
});

describe("PRINT-DISP — Backend é a autoridade final", () => {
  it("PRINT-DISP-10: backend bloqueia retirada acima do disponível", () => {
    for (const body of [withdrawBlock, withdrawFamilyBlock]) {
      // Valida a forma…
      expect(body).toContain("validateWithdrawal");
      // …e o saldo real, calculado a partir de `stock` (físico − reservado).
      expect(body).toContain("physicalQuantity");
      expect(body).toContain("reservedQuantity");
      expect(body).toContain("Estoque insuficiente");
      // Um produto de outra categoria nunca sai por este atalho.
      expect(body).toContain("categoryId !== SUPPLY_CATEGORY_ID");
    }

    // A UI apenas antecipa a regra — quem decide é o servidor.
    expect(dialog).toContain("validateWithdrawal(qty, family.baseStock)");
    const submitBody = dialog.slice(
      dialog.indexOf("const submit = async"),
      dialog.indexOf("return (")
    );
    expect(submitBody).toContain("check.ok");
    expect(submitBody).toContain('toast.error(check.reason ?? "Quantidade inválida")');
    // E o erro do servidor é exibido, nunca engolido.
    expect(submitBody).toContain('toast.error(err instanceof Error ? err.message : "Falha na retirada")');
  });

  it("PRINT-DISP-09: RBAC respeitado (backend + ocultação do botão)", () => {
    // Backend: retirar exige stock.mutate.
    for (const body of [withdrawBlock, withdrawFamilyBlock]) {
      expect(body).toContain('requirePermission(ctx, "stock.mutate"');
    }

    // O botão é ocultado por uma flag de permissão no cliente…
    expect(panel).toContain("permissions.canCreateEntries");

    // …mas quem AUTORIZA é o backend com stock.mutate. A flag de UI
    // (canCreateEntries → entries.create) só pode ser usada como atalho de
    // exibição se ela COINCIDIR com stock.mutate em todos os papéis; caso
    // contrário esconderia (ou mostraria) o botão para o papel errado.
    const roles: AppRole[] = ["admin", "secretary", "stock_manager", "director", "technician"];
    for (const role of roles) {
      expect(roleHasPermission(role, "entries.create")).toBe(
        roleHasPermission(role, "stock.mutate")
      );
    }

    // Papéis que podem retirar de fato.
    expect(roles.filter((r) => roleHasPermission(r, "stock.mutate")).sort()).toEqual([
      "admin",
      "secretary",
      "stock_manager",
    ]);
  });

  it("PRINT-DISP-09b: a tela não duplica lógica de saída existente", () => {
    // A tela reaproveita as mesmas regras puras já existentes.
    expect(dialog).toContain("validateWithdrawal");
    expect(dialog).toContain("planPackOperation");
    expect(dialog).toContain("normalizeOrgList");
    // E delega a escrita às mutations existentes — nenhuma nova mutation.
    expect(dialog).toContain("api.printSupplies.withdraw");
    expect(dialog).toContain("api.printSupplies.withdrawFamily");
    expect(dialog).not.toContain("useMutation(api.stockSetup");
  });
});
