import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/convex/inventory.ts"), "utf8");

describe("integridade da seleção de inventário", () => {
  it("rejeita produtos duplicados na seleção", () => {
    expect(source).toContain("selected.size !== selectedIds.length");
    expect(source).toContain("A seleção do inventário contém produtos duplicados.");
  });

  it("rejeita produtos inexistentes ou inativos em vez de ignorá-los", () => {
    expect(source).toContain("selectedProducts.some((product) => !product || !product.active)");
    expect(source).toContain("Um ou mais produtos selecionados não existem ou estão inativos.");
  });

  it("impede produto fora da categoria e inventário sem produtos", () => {
    expect(source).toContain("selectedProducts.some((product) => product?.categoryId !== args.categoryId)");
    expect(source).toContain("A seleção contém produto fora da categoria informada.");
    expect(source).toContain("if (products.length === 0)");
    expect(source).toContain("Nenhum produto ativo corresponde ao escopo do inventário.");
  });
});
