import { describe, expect, it } from "vitest";
import { validateProductStockSemanticsChange } from "../lib/product-stock-semantics";

describe("semântica de produto com histórico de estoque", () => {
  it("bloqueia alteração de unidade depois de movimentações", () => {
    expect(validateProductStockSemanticsChange({
      currentUnit: "cx",
      nextUnit: "un",
      currentHasSerial: false,
      hasStockHistory: true,
    })).toMatch(/histórico de estoque/i);
  });

  it("bloqueia ativar ou desativar controle serial após uso", () => {
    expect(validateProductStockSemanticsChange({
      currentUnit: "un",
      currentHasSerial: false,
      nextHasSerial: true,
      hasStockHistory: true,
    })).toMatch(/controle por número de série/i);
  });

  it("permite definir a classificação antes de qualquer histórico", () => {
    expect(validateProductStockSemanticsChange({
      currentUnit: "un",
      nextUnit: "pct",
      currentHasSerial: false,
      nextHasSerial: true,
      hasStockHistory: false,
    })).toBeNull();
  });

  it("não bloqueia alterações que não mudam o significado do saldo", () => {
    expect(validateProductStockSemanticsChange({
      currentUnit: "un",
      nextUnit: "un",
      currentHasSerial: false,
      nextHasSerial: false,
      hasStockHistory: true,
    })).toBeNull();
  });

  it("rejeita unidade vazia", () => {
    expect(validateProductStockSemanticsChange({
      currentUnit: "un",
      nextUnit: "   ",
      currentHasSerial: false,
      hasStockHistory: false,
    })).toMatch(/não pode ficar vazia/i);
  });
});
