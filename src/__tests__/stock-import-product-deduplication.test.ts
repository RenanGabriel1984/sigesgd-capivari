import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/stockSetup.ts"), "utf8");

describe("importação de planilha — reutilização de produtos criados na própria importação", () => {
  it("mantém o documento completo do produto recém-criado no catálogo local para as linhas seguintes", () => {
    const importStart = source.indexOf("export const importInitialSheet");
    const importEnd = source.indexOf("export const productLocationSummary", importStart);
    const block = source.slice(importStart, importEnd);

    expect(importStart).toBeGreaterThan(-1);
    expect(block).toContain("const createdProduct = await ctx.db.get(id);");
    expect(block).toContain("if (!createdProduct)");
    expect(block).toContain("products.push(createdProduct);");
    expect(block).not.toContain("products.push({");
  });

  it("reconhece a segunda linha com o mesmo nome sem criar um segundo produto", () => {
    const products: Array<{ _id: string; name: string }> = [];
    const importedNames = ["Adaptador USB-C", "Adaptador USB-C"];
    let created = 0;
    const productIds: string[] = [];

    for (const name of importedNames) {
      const existing = products.find(
        (product) => product.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      if (existing) {
        productIds.push(existing._id);
        continue;
      }
      const id = `product-${++created}`;
      products.push({ _id: id, name });
      productIds.push(id);
    }

    expect(created).toBe(1);
    expect(productIds).toEqual(["product-1", "product-1"]);
  });
});
