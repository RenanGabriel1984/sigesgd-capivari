import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveEntryItemAreaId } from "../lib/entry-area-classification";
import { buildEntryDraftFromNfe } from "../lib/nfe";
import { buildNfeEntrySummary } from "../lib/nfe-summary";

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

  it("leva a área revisada por item até o payload da NF-e", () => {
    const draft = buildEntryDraftFromNfe(
      {
        accessKey: "",
        number: "123",
        series: "1",
        emissionDate: "2026-11-25",
        items: [{
          lineNumber: 1,
          code: "TONER",
          description: "Toner preto",
          unit: "UN",
          quantity: 2,
        }],
      },
      [{ productId: "products:toner", areaId: "stockAreas:impressoras" }],
    );

    expect(draft.items[0].areaId).toBe("stockAreas:impressoras");
  });

  it("mostra a área específica do item e a área padrão no resumo da NF-e", () => {
    const summary = buildNfeEntrySummary({
      nfe: { number: "123", series: "1", emissionDate: "2026-11-25" },
      rows: [
        {
          item: { lineNumber: 1, code: "A", description: "Toner", unit: "UN", quantity: 2 },
          productId: "products:toner",
          matchStatus: "found",
          areaId: "stockAreas:impressoras",
        },
        {
          item: { lineNumber: 2, code: "B", description: "Mouse", unit: "UN", quantity: 1 },
          productId: "products:mouse",
          matchStatus: "found",
        },
      ],
      products: [
        { _id: "products:toner", name: "Toner" },
        { _id: "products:mouse", name: "Mouse" },
      ],
      areas: [
        { _id: "stockAreas:impressoras", name: "Impressoras / Gomaq" },
        { _id: "stockAreas:ti", name: "TI Geral" },
      ],
      defaultAreaId: "stockAreas:ti",
    });

    expect(summary.items.map((item) => item.areaName)).toEqual([
      "Impressoras / Gomaq",
      "TI Geral",
    ]);
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
