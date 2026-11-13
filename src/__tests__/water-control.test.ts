import { describe, expect, it } from "vitest";
import {
  parseWaterMoneyToCents,
  splitWaterCostCents,
  validateWaterPeriodRange,
  validateWaterReceiptDate,
  isValidWaterTimestamp,
  calculateWaterContainerBalance,
  buildWaterSupplierReturnDeltas,
  summarizeWaterFinances,
} from "../lib/water-control";

describe("controle de água mineral", () => {
  it("divide o total em centavos sem perder ou criar valores", () => {
    const shares = splitWaterCostCents(1000, ["p3", "p1", "p2"]);
    expect(shares).toEqual([
      { participantId: "p1", amountDueCents: 334 },
      { participantId: "p2", amountDueCents: 333 },
      { participantId: "p3", amountDueCents: 333 },
    ]);
    expect(shares.reduce((sum, share) => sum + share.amountDueCents, 0)).toBe(1000);
  });

  it("rejeita valor positivo sem participantes", () => {
    expect(() => splitWaterCostCents(100, [])).toThrow(/ao menos uma pessoa/i);
  });

  it("aceita período sem gasto e sem participantes", () => {
    expect(splitWaterCostCents(0, [])).toEqual([]);
  });

  it("interpreta valores brasileiros e impede valores inválidos", () => {
    expect(parseWaterMoneyToCents("1.234,56")).toBe(123456);
    expect(parseWaterMoneyToCents("89,90")).toBe(8990);
    expect(parseWaterMoneyToCents("12.50")).toBe(1250);
    expect(parseWaterMoneyToCents("-1,00")).toBeNull();
    expect(parseWaterMoneyToCents("abc")).toBeNull();
  });
});


describe("datas e intervalos do controle de água", () => {
  const start = new Date(2026, 10, 1, 12).getTime();
  const end = new Date(2026, 10, 30, 12).getTime();

  it("aceita período cronológico com timestamps válidos", () => {
    expect(validateWaterPeriodRange(start, end)).toBeNull();
  });

  it("rejeita datas inválidas e fim anterior ao início", () => {
    expect(validateWaterPeriodRange(Number.NaN, end)).toMatch(/datas/i);
    expect(validateWaterPeriodRange(end, start)).toMatch(/final/i);
  });

  it("só aceita recebimento dentro do período informado", () => {
    expect(validateWaterReceiptDate(start, start, end)).toBeNull();
    expect(validateWaterReceiptDate(end, start, end)).toBeNull();
    expect(validateWaterReceiptDate(start - 1, start, end)).toMatch(/dentro do período/i);
    expect(validateWaterReceiptDate(end + 1, start, end)).toMatch(/dentro do período/i);
  });

  it("rejeita timestamps negativos ou fracionados em movimentações/pagamentos", () => {
    expect(isValidWaterTimestamp(start)).toBe(true);
    expect(isValidWaterTimestamp(-1)).toBe(false);
    expect(isValidWaterTimestamp(start + 0.5)).toBe(false);
  });
});


describe("saldo físico dos galões cheios e vazios", () => {
  it("concilia recebimentos, consumo e devolução de vazios ao fornecedor", () => {
    const balance = calculateWaterContainerBalance(
      [
        { gallonsReceived: 12, emptyGallonsReturned: 0 },
        { gallonsReceived: 6, emptyGallonsReturned: 2 },
      ],
      [
        { fullDelta: -5, emptyDelta: 5 },
        { fullDelta: 0, emptyDelta: -3 },
      ],
    );
    expect(balance).toEqual({ fullGallons: 13, emptyGallons: 0 });
  });

  it("concilia ajustes positivos e negativos sem distorcer a fórmula", () => {
    const balance = calculateWaterContainerBalance(
      [{ gallonsReceived: 4, emptyGallonsReturned: 1 }],
      [
        { fullDelta: 2, emptyDelta: 1 },
        { fullDelta: -1, emptyDelta: 1 },
        { fullDelta: 0, emptyDelta: -1 },
      ],
    );
    expect(balance).toEqual({ fullGallons: 5, emptyGallons: 0 });
  });
});


describe("devolução de galões ao fornecedor", () => {
  it("permite devolver somente vazios", () => {
    expect(buildWaterSupplierReturnDeltas(0, 3)).toEqual({ fullDelta: 0, emptyDelta: -3 });
  });

  it("permite devolver somente cheios", () => {
    expect(buildWaterSupplierReturnDeltas(2, 0)).toEqual({ fullDelta: -2, emptyDelta: 0 });
  });

  it("permite devolver cheios e vazios na mesma movimentação", () => {
    expect(buildWaterSupplierReturnDeltas(2, 4)).toEqual({ fullDelta: -2, emptyDelta: -4 });
  });

  it("rejeita devolução zerada, fracionada ou negativa", () => {
    expect(() => buildWaterSupplierReturnDeltas(0, 0)).toThrow(/ao menos um galão/i);
    expect(() => buildWaterSupplierReturnDeltas(1.5, 0)).toThrow(/inteiro/i);
    expect(() => buildWaterSupplierReturnDeltas(0, -1)).toThrow(/inteiro/i);
  });
});


describe("consolidação financeira acumulada da água", () => {
  it("soma compras, rateios, pagamentos e dívidas de vários períodos", () => {
    const summary = summarizeWaterFinances(
      [{ totalValueCents: 10000 }, { totalValueCents: 10000 }],
      [
        { shareId: "s1", participantId: "p1", participantName: "Ana", amountDueCents: 5000 },
        { shareId: "s2", participantId: "p2", participantName: "Bruno", amountDueCents: 5000 },
        { shareId: "s3", participantId: "p1", participantName: "Ana", amountDueCents: 5000 },
        { shareId: "s4", participantId: "p2", participantName: "Bruno", amountDueCents: 5000 },
      ],
      [
        { shareId: "s1", amountCents: 5000 },
        { shareId: "s2", amountCents: 2000 },
        { shareId: "s3", amountCents: 1000 },
      ],
    );
    expect(summary.totalPurchasedCents).toBe(20000);
    expect(summary.totalAllocatedCents).toBe(20000);
    expect(summary.totalPaidCents).toBe(8000);
    expect(summary.totalOutstandingCents).toBe(12000);
    expect(summary.pendingAllocationCents).toBe(0);
    expect(summary.participants).toEqual([
      { participantId: "p1", participantName: "Ana", totalDueCents: 10000, totalPaidCents: 6000, outstandingCents: 4000, overpaidCents: 0 },
      { participantId: "p2", participantName: "Bruno", totalDueCents: 10000, totalPaidCents: 2000, outstandingCents: 8000, overpaidCents: 0 },
    ]);
  });

  it("separa compras ainda não rateadas das dívidas já atribuídas", () => {
    const summary = summarizeWaterFinances(
      [{ totalValueCents: 15000 }],
      [{ shareId: "s1", participantId: "p1", participantName: "Ana", amountDueCents: 10000 }],
      [{ shareId: "s1", amountCents: 4000 }],
    );
    expect(summary.totalPurchasedCents).toBe(15000);
    expect(summary.totalAllocatedCents).toBe(10000);
    expect(summary.totalPaidCents).toBe(4000);
    expect(summary.totalOutstandingCents).toBe(6000);
    expect(summary.pendingAllocationCents).toBe(5000);
  });

  it("não usa excesso pago em uma competência para esconder dívida de outra", () => {
    const summary = summarizeWaterFinances(
      [{ totalValueCents: 10000 }],
      [
        { shareId: "s1", participantId: "p1", participantName: "Ana", amountDueCents: 4000 },
        { shareId: "s2", participantId: "p1", participantName: "Ana", amountDueCents: 6000 },
      ],
      [
        { shareId: "s1", amountCents: 5000 },
        { shareId: "s2", amountCents: 1000 },
      ],
    );
    expect(summary.totalOutstandingCents).toBe(5000);
    expect(summary.totalOverpaidCents).toBe(1000);
    expect(summary.participants[0]).toMatchObject({
      totalDueCents: 10000,
      totalPaidCents: 6000,
      outstandingCents: 5000,
      overpaidCents: 1000,
    });
  });
});
