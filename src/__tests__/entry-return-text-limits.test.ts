import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("entradas e devoluções — limites de campos livres", () => {
  const entries = readFileSync(resolve(__dirname, "../convex/entries.ts"), "utf8");
  const returns = readFileSync(resolve(__dirname, "../convex/returns.ts"), "utf8");

  const mutationBody = (source: string, name: string) => {
    const start = source.indexOf(`export const ${name} = mutation({`);
    const end = source.indexOf("\nexport const ", start + 1);
    return source.slice(start, end === -1 ? undefined : end);
  };

  for (const name of ["create", "addItem", "updateItem", "editDraft"]) {
    it(`limita observações e identificadores textuais em entries.${name}`, () => {
      const body = mutationBody(entries, name);
      expect(body).toContain("assertTextLimits({ observation: args.observation }, MAX_OBSERVATION)");
      const validation = body.indexOf("assertTextLimits({ observation: args.observation }");
      const firstWrite = body.search(/ctx\.db\.(insert|patch|delete)\(/);
      expect(firstWrite).toBeGreaterThan(validation);
    });
  }

  it("limita justificativa de estorno de entrada antes das gravações", () => {
    const body = mutationBody(entries, "reverse");
    expect(body).toContain("assertTextLimits({ observation: reason }, MAX_OBSERVATION)");
    expect(body.search(/ctx\.db\.(insert|patch|delete)\(/)).toBeGreaterThan(body.indexOf("assertTextLimits({ observation: reason }"));
  });

  it("limita observações das unidades patrimoniais antes das gravações", () => {
    const body = mutationBody(entries, "setUnits");
    expect(body).toContain("assertTextLimits({ observation: unit.observation }, MAX_OBSERVATION)");
    expect(body.search(/ctx\.db\.(insert|patch|delete)\(/)).toBeGreaterThan(body.indexOf("assertTextLimits({ observation: unit.observation }"));
  });

  it("limita motivo e observação da devolução antes das gravações", () => {
    const body = mutationBody(returns, "create");
    expect(body).toContain("assertTextLimits({ observation: reason, description: args.observation }, MAX_OBSERVATION)");
    expect(body.search(/ctx\.db\.(insert|patch|delete)\(/)).toBeGreaterThan(body.indexOf("assertTextLimits({ observation: reason"));
  });
});
