import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("áreas de estoque — limites de texto", () => {
  const source = readFileSync(resolve(__dirname, "../convex/stockAreas.ts"), "utf8");

  for (const name of ["create", "update"]) {
    it(`limita nome e descrição em ${name} antes da primeira gravação`, () => {
      const start = source.indexOf(`export const ${name} = mutation({`);
      const end = source.indexOf("\nexport const ", start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      expect(body).toContain("assertShortTextLimits({ name })");
      expect(body).toContain("assertTextLimits({ description:");
      const firstWrite = body.search(/ctx\.db\.(insert|patch|delete)\(/);
      const nameValidation = body.indexOf("assertShortTextLimits({ name })");
      expect(firstWrite).toBeGreaterThan(nameValidation);
      if (name === "create") {
        expect(body.indexOf("assertTextLimits({ description:"))
          .toBeLessThan(firstWrite);
      } else {
        expect(body).toContain("if (args.description !== undefined)");
      }
    });
  }
});
