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
