import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nextLotNumber } from "../lib/lot-numbering";

describe("numeração global de lotes", () => {
  it("inicia em 000001 quando ainda não existem lotes no ano", () => {
    expect(nextLotNumber([], 2026)).toBe("LOT-2026-000001");
  });

  it("usa a maior sequência global, independentemente do produto ou da ordem", () => {
    const existing = [
      "LOT-2026-000007",
      "LOT-2025-000099",
      "LOT-2026-000002",
      "LOT-2026-000015",
    ];
    expect(nextLotNumber(existing, 2026)).toBe("LOT-2026-000016");
  });

  it("não reutiliza números ausentes no meio da sequência", () => {
    expect(
      nextLotNumber(["LOT-2026-000001", "LOT-2026-000003"], 2026),
    ).toBe("LOT-2026-000004");
  });

  it("ignora registros de outros anos e números malformados", () => {
    expect(
      nextLotNumber(
        [
          "LOT-2025-999999",
          "LOT-2027-000300",
          "LOTE-2026-000800",
          "LOT-2026-abc",
          "LOT-2026-000004",
        ],
        2026,
      ),
    ).toBe("LOT-2026-000005");
  });

  it("continua único quando a sequência ultrapassa seis dígitos", () => {
    expect(nextLotNumber(["LOT-2026-999999"], 2026)).toBe("LOT-2026-1000000");
  });

  it("rejeita ano fora do intervalo suportado", () => {
    expect(() => nextLotNumber([], 99)).toThrow(/ano inválido/i);
  });
});

describe("integração da regra de lote", () => {
  it("carga inicial e entradas fiscais usam a mesma numeração global", () => {
    const stockSetup = readFileSync("src/convex/stockSetup.ts", "utf8");
    const entries = readFileSync("src/convex/entries.ts", "utf8");

    expect(stockSetup).toContain("nextLotNumber");
    expect(entries).toContain("nextLotNumber");
  });
});
