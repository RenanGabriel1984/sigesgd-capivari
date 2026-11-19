import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("saídas disponíveis para devolução", () => {
  it("não oferece saídas canceladas na consulta returnable", () => {
    const source = readFileSync(resolve(__dirname, "../convex/returns.ts"), "utf8");
    const endpoint = source.slice(
      source.indexOf("export const returnable"),
      source.indexOf("export const listByRequest"),
    );

    expect(endpoint).toContain("const activeExits = exits.filter((movement: any) => !movement.canceled)");
    expect(endpoint).toContain("Promise.all(activeExits.map");
  });
});
