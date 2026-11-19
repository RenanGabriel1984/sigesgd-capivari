import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/stockSetup.ts"), "utf8");

describe("importação de planilha — reutilização de produtos criados na própria importação", () => {
  it("mantém o nome do produto recém-criado no catálogo local para as linhas seguintes", () => {
    const start = source.indexOf("products.push({", source.indexOf("export const importInitialSheet"));
    const end = source.indexOf("productId = id;", start);
    const block = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("name,");
    expect(block).toContain("unitOfMeasure:");
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
