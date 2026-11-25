import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveEntryItemAreaId } from "./entry-area-classification";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("classificação de área por item na entrada", () => {
  it("prioriza a área específica do item", () => {
    expect(resolveEntryItemAreaId("stockAreas:impressoras", "stockAreas:ti"))
      .toBe("stockAreas:impressoras");
  });

  it("herda a área padrão do cabeçalho para itens sem sobrescrita", () => {
    expect(resolveEntryItemAreaId(undefined, "stockAreas:ti")).toBe("stockAreas:ti");
    expect(resolveEntryItemAreaId(null, "stockAreas:ti")).toBe("stockAreas:ti");
  });

  it("não inventa uma área quando nenhuma foi selecionada", () => {
    expect(resolveEntryItemAreaId(undefined, undefined)).toBeUndefined();
    expect(resolveEntryItemAreaId(null, null)).toBeUndefined();
  });
});

describe("integração de área efetiva com o fluxo de entradas", () => {
  const schema = read("convex/schema.ts");
  const entries = read("convex/entries.ts");
  const confirmation = entries.slice(
    entries.indexOf("export const confirm = mutation({"),
    entries.indexOf("export const addItem = mutation({"),
  );

  it("persiste a área opcional na linha de entrada, sem alterar a dimensão física do armário", () => {
    const itemSchema = schema.slice(
      schema.indexOf("entryItems: defineTable({"),
      schema.indexOf("// ── Lots", schema.indexOf("entryItems: defineTable({")),
    );
    expect(itemSchema).toContain('areaId: v.optional(v.id("stockAreas"))');
    expect(itemSchema).toContain('locationId: v.optional(v.id("storageLocations"))');
  });

  it("usa a área do item ou herda o cabeçalho ao criar lote e confirmar item", () => {
    expect(confirmation).toContain("resolveEntryItemAreaId(item.areaId, entry.areaId)");
    expect(confirmation).toContain("areaId: effectiveAreaId as any");
    expect(confirmation).toContain("await ctx.db.patch(item._id, { lotId: lotId as string, areaId: effectiveAreaId as any })");
  });

  it("valida a área efetiva antes de gerar o lote", () => {
    expect(confirmation).toContain("if (!effectiveAreaId)");
    expect(confirmation).toContain("if (!effectiveArea || effectiveArea.active === false)");
    expect(confirmation.indexOf("if (!effectiveArea || effectiveArea.active === false)"))
      .toBeLessThan(confirmation.indexOf("// Generate lot"));
  });

  it("mantém saídas e saldo físico por armário independentes da área do lote", () => {
    expect(confirmation).toContain('ctx.db.insert("lotLocationBalances"');
    expect(confirmation).toContain('ctx.db.insert("stockByLocation"');
    expect(confirmation).toContain("locationId: item.locationId");
  });

  it("valida e grava a sobrescrita de área em rascunhos antes da confirmação", () => {
    expect(entries).toContain("areaId: v.optional(v.id(\"stockAreas\")),");
    expect(entries).toContain("areaId: item.areaId,");
  });
});
