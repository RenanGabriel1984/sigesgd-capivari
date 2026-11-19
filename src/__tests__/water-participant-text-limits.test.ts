import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("água — limites de observação dos participantes", () => {
  const source = readFileSync(resolve(__dirname, "../convex/water.ts"), "utf8");

  for (const name of ["createParticipant", "updateParticipant"]) {
    it(`limita observação em ${name} antes da primeira gravação`, () => {
      const start = source.indexOf(`export const ${name} = mutation({`);
      const end = source.indexOf("\nexport const ", start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      expect(body).toContain("assertTextLimits({ observation: args.observation }, 500)");
      const validation = body.indexOf("assertTextLimits({ observation: args.observation }");
      const firstWrite = body.search(/ctx\.db\.(insert|patch|delete)\(/);
      expect(firstWrite).toBeGreaterThan(validation);
    });
  }
});
