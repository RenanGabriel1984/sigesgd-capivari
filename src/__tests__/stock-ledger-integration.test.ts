import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) => readFileSync(resolve(__dirname, "..", relativePath), "utf8");

describe("integração do livro-razão em entradas e saídas", () => {
  it("confirma entradas somente após validar o ledger e registra lote × armário", () => {
    const entries = source("convex/entries.ts");
    const part = entries.slice(entries.indexOf("export const confirm = mutation({"), entries.indexOf("export const addItem = mutation({"));
    const guard = part.indexOf("assertProductLedgerConsistent(ctx, item.productId, product.name)");
    const firstWrite = part.indexOf('ctx.db.insert("lots"');
    expect(guard).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(guard);
    expect(part).toContain('ctx.db.insert("lotLocationBalances"');
    expect(part).toContain('ctx.db.insert("stockMovements"');
    expect(part).toContain("locationId: item.locationId");
    expect(part).toContain("resolveEntryItemAreaId(item.areaId, entry.areaId)");
    expect(part).toContain("areaId: effectiveAreaId as any");
  });
  it("estorna entradas com alocação estruturada por armário", () => {
    const entries = source("convex/entries.ts");
    const part = entries.slice(entries.indexOf("export const reverse = mutation({"), entries.indexOf("export const setUnits = mutation({"));
    expect(part).toContain("assertProductLedgerConsistent");
    expect(part).toContain("recordLotMovementAllocations(ctx");
    expect(part).toContain('allocationType: "reversal"');
  });
  it("retirada rápida valida ledger/reservas, consome FIFO e registra as parcelas", () => {
    const setup = source("convex/stockSetup.ts");
    const part = setup.slice(setup.indexOf("export const quickExit = mutation({"), setup.indexOf("export const cleanupTestData"));
    expect(part).toContain("assertProductLedgerConsistent");
    expect(part).toContain("assertProductReservationConsistent");
    expect(part).toContain("resolveWithdrawalLocation");
    expect(part).toContain("consumeLotLocationStock");
    expect(part).toContain("recordLotMovementAllocations");
    expect(part).toContain('areaId: v.optional(v.id("stockAreas"))');
    expect(part).toContain("areaId: args.areaId");
  });
  it("saída alternativa também é ledger-backed", () => {
    const movements = source("convex/stockMovements.ts");
    const part = movements.slice(movements.indexOf("export const createExit = mutation({"), movements.indexOf("export const reserveStock = mutation({"));
    expect(part).toContain("assertProductLedgerConsistent");
    expect(part).toContain("consumeLotLocationStock");
    expect(part).toContain("recordLotMovementAllocations");
    expect(part).toContain("areaId: args.areaId");
  });
  it("entrega da requisição pré-valida e registra baixa FIFO por armário", () => {
    const requests = source("convex/requests.ts");
    const part = requests.slice(requests.indexOf("export const deliver = mutation({"), requests.indexOf("export const cancel = mutation({"));
    expect(part).toContain("assertProductLedgerConsistent");
    expect(part).toContain("assertProductReservationConsistent");
    expect(part).toContain("assertCompleteDeliveryItemIds");
    expect(part).toContain("consumeLotLocationStock");
    expect(part).toContain("recordLotMovementAllocations");
    expect(part).toContain("locationId: sourceLocationId");
    expect(part).toContain("reservedToRelease");
    expect(part).toContain("const finalReserved = newReserved - unusedReservation;");
    expect(part).toContain("areaId: input.areaId");
  });
  it("interfaces exigem área e armário antes da saída", () => {
    const exit = source("pages/Exit.tsx");
    const requests = source("pages/Requests.tsx");
    expect(exit).toContain("Selecione o armário de origem");
    expect(exit).toContain("productDimensionSummary");
    expect(exit).toContain("areaId: areaId");
    expect(requests).toContain("Selecione o armário de origem para cada item entregue");
    expect(requests).toContain("locationId: di.locationId");
    expect(requests).toContain("areaId: di.areaId");
  });
});
