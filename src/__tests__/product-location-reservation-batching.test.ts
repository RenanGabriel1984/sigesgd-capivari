import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/products.ts"), "utf8");

describe("detalhe do produto — reservas por localização", () => {
  it("carrega o ledger de reservas uma vez, fora do mapeamento dos locais", () => {
    const start = source.indexOf("export const getById = query({");
    const end = source.indexOf("export const getStock = query({", start);
    const block = source.slice(start, end);
    const reservationQuery = block.indexOf('ctx.db.query("requestItemReservations")');
    const locationMap = block.indexOf("sbls.map(");

    expect(reservationQuery).toBeGreaterThan(-1);
    expect(locationMap).toBeGreaterThan(-1);
    expect(reservationQuery).toBeLessThan(locationMap);
    expect(block.match(/ctx\.db\.query\("requestItemReservations"\)/g)).toHaveLength(1);
  });
});
