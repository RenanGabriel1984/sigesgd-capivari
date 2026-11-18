import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveEntryItemAreaId } from "./entry-area-classification";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("classificação efetiva por item na confirmação da entrada", () => {
  it("mantém áreas diferentes para itens da mesma entrada", () => {
    const defaultArea = "stockAreas:ti";
    const items = [
      { productId: "products:toner", areaId: "stockAreas:impressoras" },
      { productId: "products:detergente", areaId: "stockAreas:limpeza" },
      { productId: "products:mouse" },
    ];

    expect(items.map((item) =>
      resolveEntryItemAreaId(item.areaId, defaultArea)
    )).toEqual([
      "stockAreas:impressoras",
      "stockAreas:limpeza",
      "stockAreas:ti",
    ]);
  });

  it("usa a área explícita do item mesmo quando o cabeçalho tem outra área", () => {
    expect(resolveEntryItemAreaId(
      "stockAreas:copa",
      "stockAreas:ti",
    )).toBe("stockAreas:copa");
  });

  it("faz o item herdar a área padrão quando não há sobrescrita", () => {
    expect(resolveEntryItemAreaId(undefined, "stockAreas:ti"))
      .toBe("stockAreas:ti");
    expect(resolveEntryItemAreaId(null, "stockAreas:ti"))
      .toBe("stockAreas:ti");
  });

  it("não inventa área quando nem item nem cabeçalho têm classificação", () => {
    expect(resolveEntryItemAreaId(undefined, undefined)).toBeUndefined();
    expect(resolveEntryItemAreaId(null, null)).toBeUndefined();
  });
});

describe("integração da classificação com entries.confirm", () => {
  const entries = read("src/convex/entries.ts");

  it("usa a mesma área efetiva para validar e gravar o lote e o item", () => {
    expect(entries).toContain("resolveEntryItemAreaId(item.areaId, entry.areaId)");
    expect(entries).toContain("if (!effectiveAreaId)");
    expect(entries).toContain("if (!area || !area.active)");
    expect(entries).toContain("areaId: itemAreaId as any,");
    expect(entries).toContain('await ctx.db.patch(item._id, {\n        lotId: lotId as string,\n        areaId: itemAreaId as any,');
  });

  it("grava a área efetiva no saldo por local e na movimentação", () => {
    expect(entries).toMatch(/stockByLocation[\s\S]*?areaId: itemAreaId as any/);
    expect(entries).toMatch(/stockMovements[\s\S]*?areaId: itemAreaId as any/);
    expect(entries).toContain("itemAreas.set(item._id as string, effectiveAreaId as string)");
  });

  it("rejeita área inativa ou inexistente antes de efetivar os lotes", () => {
    expect(entries).toContain("if (!area || !area.active)");
    expect(entries.indexOf("if (!area || !area.active)"))
      .toBeLessThan(entries.indexOf("// Generate lot"));
  });
});
