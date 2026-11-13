import { describe, expect, it } from "vitest";
import { isDiscreteStockUnit, isValidStockQuantity, requireSingleValidGlobalStock } from "../lib/stock-quantity-rules";

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


describe("integridade do saldo global do estoque", () => {
  it("aceita exatamente um saldo global válido", () => {
    const row = { id: "stock-1", physicalQuantity: 12, reservedQuantity: 3 };
    expect(requireSingleValidGlobalStock([row], "Teclado")).toBe(row);
  });

  it("bloqueia ausência ou duplicidade de registros globais", () => {
    expect(() => requireSingleValidGlobalStock([], "Mouse")).toThrow(/não encontrado/i);
    expect(() => requireSingleValidGlobalStock([
      { physicalQuantity: 10, reservedQuantity: 0 },
      { physicalQuantity: 10, reservedQuantity: 0 },
    ], "Mouse")).toThrow(/duplicados/i);
  });

  it.each([
    { physicalQuantity: Number.NaN, reservedQuantity: 0 },
    { physicalQuantity: -1, reservedQuantity: 0 },
    { physicalQuantity: 5, reservedQuantity: -1 },
    { physicalQuantity: 5, reservedQuantity: 6 },
    { physicalQuantity: 5, reservedQuantity: Number.POSITIVE_INFINITY },
  ])("bloqueia saldo físico/reservado inválido: $physicalQuantity/$reservedQuantity", (row) => {
    expect(() => requireSingleValidGlobalStock([row], "Material")).toThrow(/inconsistente/i);
  });
});
