import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveEntryItemAreaId, resolveEntryLotLocationId } from "./entry-area-classification";

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

describe("compatibilidade de localização no estorno de entradas históricas", () => {
  it("prioriza a localização gravada no lote", () => {
    expect(resolveEntryLotLocationId("locations:lot", "locations:balance", "locations:item"))
      .toBe("locations:lot");
  });

  it("recupera a localização do saldo lote × armário quando o lote é legado", () => {
    expect(resolveEntryLotLocationId(undefined, "locations:balance", undefined))
      .toBe("locations:balance");
  });

  it("usa a localização do item como último fallback histórico", () => {
    expect(resolveEntryLotLocationId(undefined, undefined, "locations:item"))
      .toBe("locations:item");
  });

  it("não inventa localização quando nenhuma origem a informa", () => {
    expect(resolveEntryLotLocationId(undefined, null, undefined)).toBeUndefined();
  });

  it("aplica a área do cabeçalho como fallback no estorno de item legado", () => {
    expect(resolveEntryItemAreaId(undefined, "stockAreas:ti")).toBe("stockAreas:ti");
  });
});

describe("integração da compatibilidade histórica com entries.reverse", () => {
  const entries = read("src/convex/entries.ts");
  const reverseBody = entries.slice(entries.indexOf("export const reverse = mutation"));

  it("resolve a área do item pelo mesmo fallback usado na confirmação", () => {
    expect(reverseBody).toContain("resolveEntryItemAreaId(item.areaId, entry.areaId)");
    expect(reverseBody).toContain("const lotAreaId = lot.areaId ?? itemAreaId");
    expect(reverseBody).toContain("(itemAreaId ?? undefined) !== (lotAreaId ?? undefined)");
  });

  it("recupera localização legada e aplica o estorno no mesmo armário", () => {
    expect(reverseBody).toContain("withIndex(\"by_lot\", (q: any) => q.eq(\"lotId\", lot._id))");
    expect(reverseBody).toContain("const lotLocationId = lot.locationId ?? lotLocationRows[0]?.locationId ?? item.locationId ?? undefined");
    expect(reverseBody).toContain("locationId: lotLocationId");
    expect(reverseBody).toContain("locationStock.quantity - item.quantity");
  });

  it("bloqueia saldo lote × armário duplicado antes de aplicar o estorno", () => {
    expect(reverseBody).toContain("if (lotLocationRows.length > 1)");
    expect(reverseBody.indexOf("if (lotLocationRows.length > 1)"))
      .toBeLessThan(reverseBody.indexOf("await ctx.db.patch(stock._id"));
  });

  it("mantém proteção contra repetição do estorno e exige entrada confirmada", () => {
    expect(reverseBody).toContain('if (entry.status !== "confirmed")');
    expect(reverseBody).toContain('await ctx.db.patch(args.entryId, { status: "reversed", updatedAt: now })');
    expect(reverseBody).toContain('action: "reverse_entry"');
  });
});
