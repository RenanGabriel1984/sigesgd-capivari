import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("patrimônio — limites de observação", () => {
  const source = readFileSync(resolve(__dirname, "../convex/assets.ts"), "utf8");

  for (const name of ["create", "update", "assign", "transfer", "changeStatus"]) {
    it(`valida o tamanho da observação em ${name} antes de gravar`, () => {
      const start = source.indexOf(`export const ${name} = mutation({`);
      const end = source.indexOf("\nexport const ", start + 1);
      const mutation = source.slice(start, end === -1 ? undefined : end);

      expect(mutation).toContain("assertTextLimits({ observation: args.observation }, MAX_OBSERVATION)");
      if (name === "create" || name === "update") {
        expect(mutation).toContain("assertShortTextLimits({ patrimony: args.patrimonyNumber, serialNumber: args.serialNumber, manufacturer: args.manufacturer, model: args.model, hostname: args.hostname, macAddress: args.macAddress })");
      }
      const validation = mutation.indexOf("assertTextLimits({ observation: args.observation }");
      const firstWrite = mutation.search(/ctx\.db\.(insert|patch)\(/);
      expect(validation).toBeGreaterThan(-1);
      expect(firstWrite).toBeGreaterThan(validation);
    });
  }
});


describe("peças instaladas — limites de observação", () => {
  const source = readFileSync(resolve(__dirname, "../convex/assetParts.ts"), "utf8");

  for (const name of ["installPart", "removePart"]) {
    it(`valida a observação em ${name} antes de qualquer gravação`, () => {
      const start = source.indexOf(`export const ${name} = mutation({`);
      const end = source.indexOf("\\nexport const ", start + 1);
      const mutation = source.slice(start, end === -1 ? undefined : end);
      const validation = mutation.indexOf("assertTextLimits({ observation: args.observation }, MAX_OBSERVATION)");
      const firstWrite = mutation.search(/ctx\\.db\\.(insert|patch)\\(/);

      expect(validation).toBeGreaterThan(-1);
      expect(firstWrite).toBeGreaterThan(validation);
    });
  }
});
