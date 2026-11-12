import { describe, expect, it } from "vitest";
import {
  parseWaterMoneyToCents,
  splitWaterCostCents,
  validateWaterPeriodRange,
  validateWaterReceiptDate,
  isValidWaterTimestamp,
  calculateWaterContainerBalance,
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
