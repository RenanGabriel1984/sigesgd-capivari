import { describe, expect, it } from "vitest";
import { resolveConsistentMovementArea } from "../lib/stock-movement-area";

describe("área efetiva do movimento de estoque", () => {
  it("preserva a área única dos lotes e da saída original", () => {
    expect(resolveConsistentMovementArea(["area-ti", "area-ti", "area-ti"])).toBe("area-ti");
  });

  it("mantém movimento sem classificação quando todos os lotes são legados", () => {
    expect(resolveConsistentMovementArea([null, undefined, null])).toBeUndefined();
  });

  it("bloqueia mistura de áreas em uma única devolução", () => {
    expect(() => resolveConsistentMovementArea(["area-ti", "area-gomaq"])).toThrow(/não pode misturar/i);
  });

  it("bloqueia combinação de lote classificado e lote sem área", () => {
    expect(() => resolveConsistentMovementArea(["area-ti", null])).toThrow(/não pode misturar/i);
  });
});
