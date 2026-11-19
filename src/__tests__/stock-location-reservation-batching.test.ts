import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("saldos por local — consultas de reservas em lote", () => {
  const source = readFileSync(resolve(__dirname, "../convex/stockLocations.ts"), "utf8");

  it("carrega reservas por produto fora do enriquecimento de cada linha", () => {
    const helperStart = source.indexOf("async function loadReservationsByProduct");
    const enrichStart = source.indexOf("async function enrichLocationStock");
    const listStart = source.indexOf("export const listByProduct");
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(enrichStart).toBeGreaterThan(helperStart);
    expect(listStart).toBeGreaterThan(enrichStart);

    const enrich = source.slice(enrichStart, listStart);
    expect(enrich).not.toContain('query("requestItemReservations")');
    expect(enrich).toMatch(/reservations\\s*\\.filter\\(/);
  });

  it.each(["listByProduct", "summary", "listByLocation"])(
    "reutiliza reservas carregadas previamente em %s",
    (name) => {
      const start = source.indexOf(`export const ${name} = query({`);
      const end = source.indexOf("\nexport const ", start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      expect(body).toContain("loadReservationsByProduct");
      expect(body).toContain("enrichLocationStock");
      expect(body).not.toContain('query("requestItemReservations")');
    },
  );

  it("deduplica os produtos antes de consultar suas reservas", () => {
    const start = source.indexOf("async function loadReservationsByProduct");
    const end = source.indexOf("\nasync function enrichLocationStock", start);
    const helper = source.slice(start, end);
    expect(helper).toContain("[...new Set(productIds)]");
    expect(helper).toContain("Promise.all");
  });
});
