import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("numeração global de lotes", () => {
  it("usa a mesma sequência global nas cargas iniciais, entradas e transferências", () => {
    const setup = readFileSync("src/convex/stockSetup.ts", "utf8");
    const entries = readFileSync("src/convex/entries.ts", "utf8");
    const transfers = readFileSync("src/convex/stockTransfers.ts", "utf8");

    const setupStart = setup.indexOf("async function generateLotNumber");
    const setupEnd = setup.indexOf("\n}", setupStart);
    const setupGenerator = setup.slice(setupStart, setupEnd);

    expect(setupGenerator).toContain('withIndex("by_number"');
    expect(setupGenerator).not.toContain('withIndex("by_product"');
    expect(entries).toContain('withIndex("by_number"');
    expect(transfers).toContain('withIndex("by_number"');
    expect(transfers).toContain("maxSequence += 1");
  });
});
