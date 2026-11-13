import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const entries = readFileSync(resolve(ROOT, "src/convex/entries.ts"), "utf-8");
const reverseStart = entries.indexOf("export const reverse = mutation({");
const reverseEnd = entries.indexOf("/**\n * Registra/ substitui as UNIDADES PATRIMONIAIS", reverseStart);
const reverse = entries.slice(reverseStart, reverseEnd);

describe("integridade do estorno de entradas", () => {
  it("resolve o lote criado pelo item da entrada, sem usar outro lote do mesmo produto", () => {
    expect(reverse).toContain('ctx.db.get(item.lotId as Id<"lots">)');
    expect(reverse).toContain("entryLots.filter((candidate: any) => candidate.productId === item.productId)");
    expect(reverse).toContain("candidates.length === 1");
    expect(reverse).toContain("reversedLotIds.has(String(lot._id))");
  });

  it("bloqueia lote consumido, transferido, inativo ou reservado", () => {
    expect(reverse).toContain("lotAfter < reservedInLot");
    expect(reverse).toContain("lotAfter < 0");
    expect(reverse).toContain("lot.active === false");
    expect(reverse).toContain("lot.quantityAvailable");
  });

  it("estorna pelo par correto área + local físico", () => {
    expect(reverse).toContain("(item.areaId ?? undefined) !== lotAreaId");
    expect(reverse).toContain("(item.locationId ?? undefined) !== lotLocationId");
    expect(reverse).toContain("row.locationId === lotLocationId && (row.areaId ?? undefined) === lotAreaId");
    expect(reverse).toContain("matchingRows.length !== 1");
  });

  it("preserva o histórico do lote e registra a localização no movimento", () => {
    expect(reverse).toContain("quantityAvailable: lotAfter");
    expect(reverse).toContain("active: lotAfter > 0");
    expect(reverse).toContain("lotId: lot._id as string");
    expect(reverse).toContain("areaId: lotAreaId as any");
    expect(reverse).toContain("locationId: lotLocationId as any");
    expect(reverse).not.toContain("ctx.db.delete(lot");
  });
});
