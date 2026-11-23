import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("locais físicos — validação de nome e descrição", () => {
  const source = readFileSync(resolve(__dirname, "../convex/storageLocations.ts"), "utf8");

  for (const name of ["create", "update"]) {
    it(`valida o nome e os limites textuais em ${name} antes de gravar`, () => {
      const start = source.indexOf(`export const ${name} = mutation({`);
      const end = source.indexOf("\nexport const ", start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      expect(body).toContain("assertShortTextLimits({ name })");
      expect(body).toContain("assertTextLimits({ description:");
      expect(body).toContain('throw new Error("Nome do local é obrigatório")');
      const firstWrite = body.search(/ctx\.db\.(insert|patch|delete)\(/);
      expect(firstWrite).toBeGreaterThan(body.indexOf("assertShortTextLimits({ name })"));
      expect(firstWrite).toBeGreaterThan(body.indexOf("assertTextLimits({ description:"));
    });
  }

  it("normaliza nome e descrição antes de persistir", () => {
    const createStart = source.indexOf("export const create = mutation({");
    const updateStart = source.indexOf("export const update = mutation({");
    const createBody = source.slice(createStart, updateStart);
    const updateBody = source.slice(updateStart);
    expect(createBody).toContain("name,");
    expect(createBody).toContain("args.description?.trim() || undefined");
    expect(updateBody).toContain("const name = args.name.trim()");
    expect(updateBody).toContain("updates.description = args.description.trim() || undefined");
  });
});
