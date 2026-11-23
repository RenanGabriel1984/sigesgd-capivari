import { describe, expect, it } from "vitest";
import { resolveUniqueRecord } from "../lib/credential-integrity";

describe("resolveUniqueRecord", () => {
  it("distinguishes missing, unique and duplicate records", () => {
    expect(resolveUniqueRecord([])).toEqual({ status: "missing" });
    expect(resolveUniqueRecord([{ id: "one" }])).toEqual({
      status: "unique",
      record: { id: "one" },
    });
    expect(resolveUniqueRecord([{ id: "one" }, { id: "two" }])).toEqual({
      status: "ambiguous",
      count: 2,
    });
  });

  it("never selects an arbitrary record from duplicates", () => {
    const result = resolveUniqueRecord([{ id: "first" }, { id: "second" }]);
    expect(result).not.toHaveProperty("record");
  });
});


describe("normalizeLoginEmail", () => {
  it("trims surrounding whitespace and lowercases the address", () => {
    expect(normalizeLoginEmail("  Usuario@Capivari.SP.GOV.BR  ")).toBe("usuario@capivari.sp.gov.br");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeLoginEmail("   ")).toBe("");
  });
});

describe("user account email normalization integration", () => {
  it("normalizes and validates e-mail before creating or updating a user", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../convex/users.ts"), "utf8");
    expect(source).toContain("normalizeLoginEmail(args.email)");
    expect(source).toContain("normalizeLoginEmail(updates.email)");
    expect(source).toContain(".collect()");
  });
});
