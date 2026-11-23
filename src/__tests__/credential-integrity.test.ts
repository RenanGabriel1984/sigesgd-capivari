import { describe, expect, it } from "vitest";
import {
  describeDuplicateCredential,
  resolveUniqueRecord,
} from "../lib/credential-integrity";

describe("resolução de identidade e credencial única", () => {
  it("distingue registro ausente, único e ambíguo", () => {
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

  it("não escolhe o primeiro registro quando há duplicidade", () => {
    const records = [{ id: "user-a" }, { id: "user-b" }];
    const result = resolveUniqueRecord(records);
    expect(result.status).toBe("ambiguous");
    expect(result).not.toHaveProperty("record");
  });

  it("gera mensagem operacional sem revelar dados da conta", () => {
    expect(describeDuplicateCredential(3)).toContain("3 registros");
    expect(describeDuplicateCredential(3)).toContain("Regularize a duplicidade");
    expect(describeDuplicateCredential(1)).toContain("2 registros");
  });
});
