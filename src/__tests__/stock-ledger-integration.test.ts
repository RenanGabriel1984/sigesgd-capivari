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
    expect(part).toContain('resolveEntryItemAreaId<Id<"stockAreas">>(item.areaId, entry.areaId)');
    expect(part).toContain("areaId: effectiveAreaId");
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
    expect(part).toContain("areaIsUnclassified: v.optional(v.boolean())");
    expect(part).toContain("areaIsUnclassified: args.areaIsUnclassified");
    expect(part).toContain("areaId: lotConsumption.areaId ?? args.areaId");
  });
  it("saída alternativa também é ledger-backed", () => {
    const movements = source("convex/stockMovements.ts");
    const part = movements.slice(movements.indexOf("export const createExit = mutation({"), movements.indexOf("export const reserveStock = mutation({"));
    expect(part).toContain("assertProductLedgerConsistent");
    expect(part).toContain("consumeLotLocationStock");
    expect(part).toContain("recordLotMovementAllocations");
    expect(part).toContain("areaIsUnclassified: v.optional(v.boolean())");
    expect(part).toContain("areaIsUnclassified: args.areaIsUnclassified");
    expect(part).toContain("areaId: lotConsumption.areaId ?? args.areaId");
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
    expect(part).toContain("areaIsUnclassified: v.optional(v.boolean())");
    expect(part).toContain("areaIsUnclassified: input.areaIsUnclassified");
    expect(part).toContain("areaId: lotConsumption.areaId ?? input.areaId");
  });
  it("histórico expõe a área e o armário de cada movimentação", () => {
    const movements = source("convex/stockMovements.ts");
    const list = movements.slice(
      movements.indexOf("export const list = query({"),
      movements.indexOf("export const byProduct = query({"),
    );
    const page = source("pages/Movements.tsx");
    expect(list).toContain("const area = m.areaId ? await ctx.db.get(m.areaId) : null");
    expect(list).toContain("const location = m.locationId ? await ctx.db.get(m.locationId) : null");
    expect(list).toContain("area, location");
    const ledger = source("convex/lotLocationLedger.ts");
    expect(ledger).toContain("areaId: selectedAreaId ?? undefined");
    expect(page).toContain("m.area?.name ?? \"Sem área registrada\"");
    expect(page).toContain("m.location?.name ?? \"Sem armário registrado\"");
    expect(page).toContain("Área / Armário");
  });

  it("interfaces exigem área e armário antes da saída", () => {
    const exit = source("pages/Exit.tsx");
    const requests = source("pages/Requests.tsx");
    expect(exit).toContain("Selecione o armário de origem");
    expect(exit).toContain("productDimensionSummary");
    expect(exit).toContain("areaId: areaId");
    expect(exit).toContain('value="unclassified"');
    expect(exit).toContain("areaIsUnclassified: areaId === \"unclassified\"");
    expect(requests).toContain('value="unclassified"');
    expect(requests).toContain("areaIsUnclassified: di.areaId === \"unclassified\"");
    expect(requests).toContain("Selecione o armário de origem para cada item entregue");
    expect(requests).toContain("locationId: di.locationId");
    expect(requests).toContain("areaId: di.areaId");
  });
});

describe("integração do livro-razão em devoluções e transferências", () => {
  it("devolução disponível registra as parcelas no movimento reversor", () => {
    const returns = source("convex/returns.ts");
    const create = returns.slice(returns.indexOf("export const create = mutation({"), returns.indexOf("export const resolveQuarantine = mutation({"));
    expect(create).toContain("assertProductLedgerConsistent");
    expect(create).toContain("assertProductReservationConsistent");
    expect(create).toContain("resolveConsistentMovementArea");
    expect(create).toContain("areaId: effectiveAreaId");
    expect(create).toContain('const returnMovementId = await ctx.db.insert("stockMovements"');
    expect(create).toContain("recordLotMovementAllocations(ctx");
    expect(create).toContain('allocationType: "reversal"');
    expect(create.indexOf("assertProductLedgerConsistent")).toBeLessThan(create.indexOf('ctx.db.patch(stock._id'));
  });

  it("liberação de quarentena também cria alocação reversora estruturada", () => {
    const returns = source("convex/returns.ts");
    const resolve = returns.slice(returns.indexOf("export const resolveQuarantine = mutation({"));
    expect(resolve).toContain("assertProductLedgerConsistent");
    expect(resolve).toContain("resolveConsistentMovementArea");
    expect(resolve).toContain("recordLotMovementAllocations(ctx");
    expect(resolve).toContain('allocationType: "reversal"');
    expect(resolve).toContain("areaId: effectiveAreaId");
    expect(resolve).toContain("stockDisposition: args.disposition");
  });

  it("transferência mantém saldo global e vincula origem, destino e lote ao movimento", () => {
    const transfers = source("convex/stockTransfers.ts");
    const create = transfers.slice(transfers.indexOf("export const create = mutation({"));
    expect(create).toContain("assertProductLedgerConsistent");
    expect(create).toContain("assertProductReservationConsistent");
    expect(create).toContain("planLotLocationTransfer");
    expect(create).toContain('const movementId = await ctx.db.insert("stockMovements"');
    expect(create).toContain("transferId");
    expect(create).toContain("toLocationId: args.toLocationId");
    expect(create).toContain("areaId: lotDoc?.areaId");
    expect(create).toContain("await ctx.db.patch(transferId, { movementId })");
    expect(create).toContain("newPhysical: reservationStock.physicalQuantity");
    expect(create.indexOf("assertProductLedgerConsistent")).toBeLessThan(create.indexOf("await ctx.db.patch(sourceStock._id"));
  });

  it("schema usa vínculos opcionais compatíveis com os movimentos existentes", () => {
    const schema = source("convex/schema.ts");
    const movementSchema = schema.slice(schema.indexOf("stockMovements: defineTable({"), schema.indexOf("stockMovementLotAllocations: defineTable({"));
    const transferSchema = schema.slice(schema.indexOf("stockTransfers: defineTable({"), schema.indexOf("gomaQExchanges: defineTable({"));
    const returnSchema = schema.slice(schema.indexOf("returns: defineTable({"), schema.indexOf("returnLotAllocations: defineTable({"));
    expect(movementSchema).toContain('transferId: v.optional(v.id("stockTransfers"))');
    expect(movementSchema).toContain('toLocationId: v.optional(v.id("storageLocations"))');
    expect(transferSchema).toContain('movementId: v.optional(v.id("stockMovements"))');
    expect(returnSchema).toContain('areaId: v.optional(v.id("stockAreas"))');
  });
});

