import { describe, expect, it } from "vitest";
import { parseWaterMoneyToCents, splitWaterCostCents } from "../lib/water-control";

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
