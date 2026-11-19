import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("GomaQ — limite de observação", () => {
  it("valida observação da coleta antes da primeira gravação", () => {
    const source = readFileSync(resolve(__dirname, "../convex/gomaQ.ts"), "utf8");
    const start = source.indexOf("export const createCollection = mutation({");
    const end = source.indexOf("\nexport const ", start + 1);
    const body = source.slice(start, end === -1 ? undefined : end);
    expect(body).toContain("assertTextLimits({ observation: args.observation }, MAX_OBSERVATION)");
    const validation = body.indexOf("assertTextLimits({ observation: args.observation }");
    const firstWrite = body.search(/ctx\.db\.(insert|patch|delete)\(/);
    expect(firstWrite).toBeGreaterThan(validation);
  });
});
