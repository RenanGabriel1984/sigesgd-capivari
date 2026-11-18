import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/entries.ts"), "utf-8");

function mutationBlock(name: string): string {
  const start = source.indexOf(`export const ${name} = mutation({`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

describe("integridade financeira das entradas", () => {
  it("valida o total da entrada e os custos de todos os itens antes de gravar", () => {
    const create = mutationBlock("create");
    expect(create).toContain('assertEntryFinancialValues({ totalValue: args.totalValue }, "entrada")');
    expect(create).toContain("unitCost: item.unitCost, totalCost: item.totalCost");
  });

  it("valida custos também ao adicionar ou editar itens de rascunho", () => {
    expect(mutationBlock("addItem")).toContain('assertEntryFinancialValues({ unitCost: args.unitCost, totalCost: args.totalCost }, "item")');
    expect(mutationBlock("updateItem")).toContain('assertEntryFinancialValues({ unitCost: args.unitCost, totalCost: args.totalCost }, "item")');
  });

  it("rejeita valores negativos, infinitos e não numéricos", () => {
    expect(source).toContain("!Number.isFinite(value) || value < 0");
  });
});
