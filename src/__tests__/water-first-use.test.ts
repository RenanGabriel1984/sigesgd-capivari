import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateWaterContainerBalance,
  summarizeWaterFinances,
  splitWaterCostCents,
} from "../lib/water-control";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const backend = read("src/convex/water.ts");
const page = read("src/pages/Water.tsx");

describe("implantação inicial do módulo Água Mineral (sem histórico prévio)", () => {
  it("apresenta saldos físicos zerados quando ainda não existem lançamentos", () => {
    expect(calculateWaterContainerBalance([], [])).toEqual({
      fullGallons: 0,
      emptyGallons: 0,
    });
  });

  it("apresenta resumo financeiro vazio sem criar dívidas ou valores fictícios", () => {
    expect(summarizeWaterFinances([], [], [])).toMatchObject({
      totalPurchasedCents: 0,
      totalAllocatedCents: 0,
      totalPaidCents: 0,
      totalOutstandingCents: 0,
      pendingAllocationCents: 0,
      unallocatedOverageCents: 0,
      totalOverpaidCents: 0,
      unmatchedPaymentCount: 0,
      participants: [],
    });
  });

  it("permite implantar o saldo físico inicial por ajuste explícito, sem exigir recebimento ou período", () => {
    expect(backend).toContain('v.literal("adjustment")');
    expect(backend).toContain('if (args.type === "adjustment" && args.fullDelta === 0 && args.emptyDelta === 0)');
    expect(backend).toContain('entity: "waterContainerMovements"');
    expect(backend).toContain("balance.fullGallons + args.fullDelta < 0");
    expect(backend).toContain("balance.emptyGallons + args.emptyDelta < 0");
  });

  it("não permite fechar período sem compra válida e participantes", () => {
    expect(backend).toContain("if (activeReceipts.length === 0) throw new Error");
    expect(backend).toContain("if (participants.length === 0) throw new Error");
  });

  it("não permite registrar pagamento sem uma parcela de rateio existente", () => {
    expect(backend).toContain('const share = await ctx.db.get(args.shareId)');
    expect(backend).toContain('if (!share) throw new Error("Parcela de rateio não encontrada.")');
  });

  it("distribui centavos de forma exata no primeiro rateio", () => {
    const shares = splitWaterCostCents(1001, ["p2", "p1", "p3"]);
    expect(shares.reduce((sum, share) => sum + share.amountDueCents, 0)).toBe(1001);
    expect(shares.map((share) => share.amountDueCents)).toEqual([334, 334, 333]);
  });

  it("orienta o usuário quando ainda não há rateios, recebimentos ou movimentações", () => {
    expect(page).toContain("Ainda não há rateios fechados");
    expect(page).toContain("Nenhuma movimentação de consumo, devolução ou ajuste registrada.");
    expect(page).toContain("Abra um período de rateio para registrar recebimentos.");
    expect(page).toContain("Ajuste de saldo / implantação");
  });

  it("exibe orientação sequencial de implantação somente quando o módulo está vazio", () => {
    expect(page).toContain("Primeira configuração do controle de água");
    expect(page).toContain("Cadastre os participantes");
    expect(page).toContain("Faça a contagem física");
    expect(page).toContain("Abra o período");
    expect(page).toContain("Registre cada recebimento");
    expect(page).toContain("Feche o período");
    expect(page).toContain("periods.length === 0 && dashboard.receipts.length === 0 && dashboard.movements.length === 0 && dashboard.participants.length === 0");
    expect(page).toContain("O ajuste inicial altera somente o saldo físico de galões");
  });

  it("mantém estornos inativos quando não há lançamentos, sem criar registros artificiais", () => {
    expect(backend).toContain("export const reverseReceipt = mutation");
    expect(backend).toContain("export const reverseContainerMovement = mutation");
    expect(backend).toContain("export const reversePayment = mutation");
    expect(calculateWaterContainerBalance([], [])).toEqual({ fullGallons: 0, emptyGallons: 0 });
  });
});
