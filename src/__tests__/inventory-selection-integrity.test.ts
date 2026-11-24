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


describe("integridade do fechamento do inventário", () => {
  it("bloqueia saldos positivos de lote/armário que surgiram após a abertura e não foram contados", () => {
    const closeStart = source.indexOf("export const close = mutation({");
    const lotBranchStart = source.indexOf("if (lotCounts.length > 0)", closeStart);
    const coverageStart = source.indexOf("const currentPositiveLotBalances", lotBranchStart);
    const reconciliationStart = source.indexOf("// Recalcula os totais dos lotes", coverageStart);
    expect(closeStart).toBeGreaterThan(-1);
    expect(lotBranchStart).toBeGreaterThan(closeStart);
    expect(coverageStart).toBeGreaterThan(lotBranchStart);
    expect(reconciliationStart).toBeGreaterThan(coverageStart);
    const guard = source.slice(coverageStart, reconciliationStart);
    expect(guard).toContain('withIndex("by_product"');
    expect(guard).toContain("balance.quantityAvailable <= EPSILON");
    expect(guard).toContain("if (inv.locationId && String(balance.locationId) !== String(inv.locationId)) continue");
    expect(guard).toContain("if (!seen.has(key))");
    expect(guard).toContain("não foi contado");
  });
});
