import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("edição de produtos — validação de campos", () => {
  const source = readFileSync(resolve(__dirname, "../convex/products.ts"), "utf8");
  const start = source.indexOf("export const update = mutation({");
  const end = source.indexOf("\nexport const ", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);

  it("aplica limites de texto também na edição", () => {
    expect(body).toContain("assertTextLimits({");
    expect(body).toContain("description: updates.description");
    expect(body).toContain("manufacturer: updates.manufacturer");
    expect(body).toContain("assertTextLimits({ observation: updates.observation }, MAX_OBSERVATION)");
    expect(body).toContain("assertShortTextLimits({");
    expect(body).toContain("internalCode: updates.internalCode");
    expect(body).toContain("brand: updates.brand");
    expect(body).toContain("model: updates.model");

    const firstWrite = body.search(/ctx\.db\.(insert|patch|delete)\(/);
    expect(firstWrite).toBeGreaterThan(body.indexOf("assertTextLimits({"));
    expect(firstWrite).toBeGreaterThan(body.indexOf("assertShortTextLimits({"));
  });

  it("rejeita números não finitos e preserva a relação estoque ideal/máximo", () => {
    expect(body).toContain("!Number.isFinite(value)");
    expect(body).toContain("nextIdealStock > nextMaximumStock");
    expect(body).toContain('Estoque ideal não pode ser maior que o estoque máximo');
  });
});
