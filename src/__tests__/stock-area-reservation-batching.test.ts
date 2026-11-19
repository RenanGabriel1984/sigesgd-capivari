import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/stockAreas.ts"), "utf8");

describe("resumo das áreas — consultas de reservas em lote", () => {
  it("carrega reservas uma vez e agrupa por lote sem consulta N+1", () => {
    const start = source.indexOf("export const summary = query({");
    const end = source.indexOf("export const unclassifiedLots", start);
    const block = source.slice(start, end);

    expect(block).toContain('ctx.db.query("requestItemReservations").collect()');
    expect(block).toContain("const reservationsByLot = new Map");
    expect(block).toContain("reservationsByLot.get(lot._id as string)");
    expect(block).not.toContain('.withIndex("by_lot"');
  });
});
