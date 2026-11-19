import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("solicitações — limite de observações", () => {
  const source = readFileSync(resolve(__dirname, "../convex/requests.ts"), "utf8");

  it("limita a observação da aprovação antes de qualquer gravação", () => {
    const start = source.indexOf("export const approve = mutation({");
    const end = source.indexOf("\nexport const ", start + 1);
    const mutation = source.slice(start, end === -1 ? undefined : end);

    expect(mutation).toContain("assertTextLimits({ observation: args.observation }, MAX_OBSERVATION)");
    const validation = mutation.indexOf("assertTextLimits({ observation: args.observation }");
    const firstWrite = mutation.search(/ctx\.db\.(insert|patch)\(/);
    expect(validation).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(validation);
  });

  it("limita o motivo da rejeição antes de alterar a solicitação", () => {
    const start = source.indexOf("export const reject = mutation({");
    const end = source.indexOf("\nexport const ", start + 1);
    const mutation = source.slice(start, end === -1 ? undefined : end);

    expect(mutation).toContain("assertTextLimits({ observation: reason }, MAX_OBSERVATION)");
    const validation = mutation.indexOf("assertTextLimits({ observation: reason }");
    const firstWrite = mutation.search(/ctx\.db\.(insert|patch)\(/);
    expect(validation).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(validation);
  });
});
