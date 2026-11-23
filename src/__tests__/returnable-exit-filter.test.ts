import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("saídas disponíveis para devolução", () => {
  it("não oferece saídas canceladas na consulta returnable", () => {
    const source = readFileSync(resolve(__dirname, "../convex/returns.ts"), "utf8");
    const helper = source.slice(
      source.indexOf("async function buildReturnableExitRow"),
      source.indexOf("export const returnablePage"),
    );
    const endpoint = source.slice(
      source.indexOf("export const returnablePage"),
      source.indexOf("export const returnableByExit"),
    );

    expect(helper).toContain('movement.type !== "exit" || movement.canceled');
    expect(endpoint).toContain("paginationOptsValidator");
    expect(endpoint).toContain("buildReturnableExitRow(ctx, movement)");
    expect(endpoint).not.toContain("activeExits");
  });
});
