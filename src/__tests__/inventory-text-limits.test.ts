import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/inventory.ts"), "utf8");

describe("limites de texto livre no inventário", () => {
  it("limita observação na abertura e na contagem", () => {
    const createStart = source.indexOf("export const create = mutation({");
    const createEnd = source.indexOf("/** Update inventory status", createStart);
    const create = source.slice(createStart, createEnd);
    expect(create).toContain("assertTextLimits({ observation: args.observation }, MAX_OBSERVATION)");

    const saveStart = source.indexOf("export const saveCount = mutation({");
    const saveEnd = source.indexOf("/** Move inventory to REVIEW", saveStart);
    const save = source.slice(saveStart, saveEnd);
    expect(save).toContain("assertTextLimits({ observation: args.observation }, MAX_OBSERVATION)");
  });

  it("usa a permissão central para fechar inventário, incluindo secretary", () => {
    const closeStart = source.indexOf("export const close = mutation({");
    const closeEnd = source.indexOf("/** Cancel an inventory", closeStart);
    const close = source.slice(closeStart, closeEnd);
    expect(close).toContain("const { userId } = await requireStockManagerOrAdmin(ctx)");
    expect(close).not.toContain('role !== "admin"');
    expect(close).not.toContain('role !== "stock_manager"');
  });

  it("bloqueia ajuste agregado quando qualquer lote do produto é permanente", () => {
    const closeStart = source.indexOf("export const close = mutation({");
    const closeEnd = source.indexOf("/** Cancel an inventory", closeStart);
    const close = source.slice(closeStart, closeEnd);
    expect(close).toContain('lots.some((lot) => lot.materialType === "permanent")');
    expect(close).toContain("materialType: lots.find((lot) => lot.materialType)?.materialType");
  });

  it("limita justificativa antes de qualquer ajuste do fechamento", () => {
    const closeStart = source.indexOf("export const close = mutation({");
    const closeEnd = source.indexOf("/** Cancel an inventory", closeStart);
    const close = source.slice(closeStart, closeEnd);
    const validation = close.indexOf("assertTextLimits({ justification: args.justification }, MAX_OBSERVATION)");
    const firstWrite = close.search(/ctx\.db\.(insert|patch|delete)\(/);
    expect(validation).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(validation);
  });
});
