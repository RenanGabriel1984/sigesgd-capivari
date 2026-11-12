import { describe, expect, it } from "vitest";
import { isDiscreteStockUnit, isValidStockQuantity } from "../lib/stock-quantity-rules";

describe("quantidades de estoque por unidade", () => {
  it.each(["un", "pc", "cx", "rl", "pct", "po", "kt"])(
    "exige quantidade inteira para %s",
    (unit) => {
      expect(isDiscreteStockUnit(unit)).toBe(true);
      expect(isValidStockQuantity(2, unit)).toBe(true);
      expect(isValidStockQuantity(1.5, unit)).toBe(false);
    },
  );

  it("permite frações em metros", () => {
    expect(isDiscreteStockUnit("m")).toBe(false);
    expect(isValidStockQuantity(1.5, "m")).toBe(true);
  });

  it("sempre exige inteiro para produto serializado", () => {
    expect(isDiscreteStockUnit("m", true)).toBe(true);
    expect(isValidStockQuantity(1.5, "m", true)).toBe(false);
  });

  it("permite zero somente em contagem física", () => {
    expect(isValidStockQuantity(0, "un", false, true)).toBe(true);
    expect(isValidStockQuantity(0, "un")).toBe(false);
  });
});
