import { describe, expect, it } from "vitest";
import { nextEntryNumber, nextLotNumber } from "../convex/stockHelpers";

describe("sequências globais de estoque", () => {
  it("gera a próxima entrada pelo maior número existente, não pela contagem", () => {
    expect(nextEntryNumber([
      "ENT-2026-000001",
      "ENT-2026-000009",
      "ENT-2026-000003",
      "ENT-2025-000099",
      "rascunho",
    ], 2026)).toBe("ENT-2026-000010");
  });

  it("gera lote global independentemente do produto e sem reutilizar lacunas", () => {
    expect(nextLotNumber([
      "LOT-2026-000001",
      "LOT-2026-000004",
      "LOT-2026-000002",
      "LOT-2025-999999",
    ], 2026)).toBe("LOT-2026-000005");
  });

  it("começa uma sequência anual em 000001 quando ainda não há registros", () => {
    expect(nextEntryNumber([], 2027)).toBe("ENT-2027-000001");
    expect(nextLotNumber([], 2027)).toBe("LOT-2027-000001");
  });

  it("ignora números malformados e sequências fora do ano", () => {
    expect(nextLotNumber([
      "LOT-2026-X",
      "LOT-2025-000099",
      "LOT-2026-000007-extra",
    ], 2026)).toBe("LOT-2026-000001");
  });
});
