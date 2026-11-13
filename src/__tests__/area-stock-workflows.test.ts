import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const schema = read("src/convex/schema.ts");
const requests = read("src/convex/requests.ts");
const entries = read("src/convex/entries.ts");
const stockSetup = read("src/convex/stockSetup.ts");
const transfers = read("src/convex/stockTransfers.ts");
const stockAreas = read("src/convex/stockAreas.ts");
const stockMovements = read("src/convex/stockMovements.ts");
const products = read("src/convex/products.ts");
const returns = read("src/convex/returns.ts");
const areaDefinitions = read("src/lib/stock-areas.ts");
const stockLocations = read("src/convex/stockLocations.ts");
const exitPage = read("src/pages/Exit.tsx");
const stockAreasPage = read("src/pages/StockAreas.tsx");
const requestsPage = read("src/pages/Requests.tsx");
const transfersPage = read("src/pages/StockTransfers.tsx");
const inventory = read("src/convex/inventory.ts");

function mutationBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} = mutation({`);
  expect(start, `mutation ${name} ausente`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("estoque por área e local físico — regressões de segurança", () => {
  it("mantém campos aditivos e rastreabilidade entre reserva, lote e transferência", () => {
    expect(schema).toContain('areaId: v.optional(v.id("stockAreas"))');
    expect(schema).toContain('sourceLocationId: v.optional(v.id("storageLocations"))');
    expect(schema).toContain("requestItemReservations: defineTable({");
    expect(schema).toContain('locationId: v.optional(v.id("storageLocations"))');
    expect(schema).toContain("stockTransferLots: defineTable({");
    expect(schema).toContain('toLocationId: v.optional(v.id("storageLocations"))');
    expect(schema).toContain('toAreaId: v.optional(v.id("stockAreas"))');
    expect(schema).toContain('areaId: v.optional(v.id("stockAreas")),\n      locationId: v.optional(v.id("storageLocations"))');
  });

  it("confirma entrada usando área do item/entrada e local físico independente", () => {
    const confirm = mutationBlock(entries, "confirm");
    expect(confirm).toContain("const effectiveAreaId = item.areaId ?? entry.areaId");
    expect(confirm).toContain("locationId: item.locationId");
    expect(confirm).toContain("areaId: itemAreaId");
    expect(confirm).not.toContain("location.areaId");
  });

  it("exige área e local explícitos em cada nova solicitação sem vinculá-los entre si", () => {
    const create = mutationBlock(requests, "create");
    expect(create).toContain('areaId: v.id("stockAreas")');
    expect(create).toContain('sourceLocationId: v.id("storageLocations")');
    expect(create).not.toContain("sourceLocation.areaId");
  });

  it("aprova com reserva FIFO restrita ao mesmo lote, área e local físicos", () => {
    const approve = mutationBlock(requests, "approve");
    expect(approve).toContain("planFifoAreaLotAllocation");
    expect(approve).toContain("validateAreaLocationLotBalance");
    expect(approve).toContain("O saldo físico da área/local diverge da soma dos lotes.");
    expect(approve).toContain("lot.areaId !== requestItem.areaId");
    expect(approve).toContain("lot.locationId !== requestItem.sourceLocationId");
    expect(approve).not.toMatch(/\blocation\.areaId/);
    expect(approve).toContain('ctx.db.insert("requestItemReservations"');
  });

  it("entrega apenas lotes reservados e reduz o saldo do local/área de origem", () => {
    const deliver = mutationBlock(requests, "deliver");
    expect(deliver).toContain('ctx.db.query("requestItemReservations")');
    expect(deliver).toContain("lot.areaId !== item.areaId");
    expect(deliver).toContain("lot.locationId !== item.sourceLocationId");
    expect(deliver).toContain('ctx.db.patch(source._id, { quantity: source.quantity - input.quantityDelivered })');
    expect(deliver).toContain("Materiais de áreas definidas não serão consumidos");
  });

  it("saída rápida exige área/local e não consome lotes reservados", () => {
    const quickExit = mutationBlock(stockSetup, "quickExit");
    expect(quickExit).toContain('areaId: v.id("stockAreas")');
    expect(quickExit).toContain('locationId: v.id("storageLocations")');
    expect(quickExit).toContain("lot.areaId === args.areaId && lot.locationId === args.locationId");
    expect(quickExit).toContain("reservation.areaId !== lot.areaId || reservation.locationId !== lot.locationId");
    expect(quickExit).toContain("lot.quantityAvailable - reserved");
  });

  it("transferência recebe área e local físico separadamente e preserva linhagem", () => {
    const create = mutationBlock(transfers, "create");
    expect(create).toContain("fromAreaId: v.optional(v.id(\"stockAreas\"))");
    expect(create).toContain("toAreaId: v.optional(v.id(\"stockAreas\"))");
    expect(create).toContain("const fromAreaId = args.fromAreaId");
    expect(create).toContain("const toAreaId = args.toAreaId");
    expect(create).not.toContain("fromLocation.areaId");
    expect(create).not.toContain("toLocation.areaId");
    expect(create).toContain('ctx.db.insert("stockTransferLots"');
    expect(create).toContain("sourceLotId");
    expect(create).toContain("destinationLotId");
    expect(create).toContain('ctx.db.insert("stockMovementLots"');
    expect(create).toContain("lotId: part.lotId");
    expect(create).toContain('withIndex("by_number", (q: any) => q.gte("lotNumber", prefix))');
    expect(stockMovements).toContain("const toArea = m.toAreaId ? await ctx.db.get(m.toAreaId) : null");
  });

  it("registra todas as alocações de lote feitas por cada saída", () => {
    expect(schema).toContain("stockMovementLots: defineTable({");
    const deliver = mutationBlock(requests, "deliver");
    const quickExit = mutationBlock(stockSetup, "quickExit");
    expect(deliver).toContain('ctx.db.insert("stockMovementLots"');
    expect(quickExit).toContain('ctx.db.insert("stockMovementLots"');
    expect(deliver).toContain("movementId, lotId: lot._id, quantity: consume");
    expect(quickExit).toContain("lotId: consumed.lotId");
  });

  it("exige área e local independentes para saldo inicial", () => {
    const createProduct = mutationBlock(products, "create");
    expect(createProduct).toContain("selectedInitialAreaId");
    expect(createProduct).toContain("Informe a área/subestoque do saldo inicial");
    expect(createProduct).not.toContain("location.areaId");
    expect(createProduct).toContain("areaId: initialAreaId");
    expect(stockSetup).toContain("const areaId = item.areaId");
    expect(stockSetup).toContain("if (!item.areaId || !area?.active)");
    expect(stockSetup).toMatch(/local físico não define a área/i);
    expect(stockSetup).toMatch(/areaId,\s*\}\);/);
  });

  it("devolve cada parcela ao lote e ao subestoque da saída original", () => {
    const createReturn = mutationBlock(returns, "create");
    expect(createReturn).toContain('ctx.db.query("stockMovementLots")');
    expect(createReturn).toContain("sourceLots");
    expect(createReturn).toContain("lot.areaId !== exit.areaId");
    expect(createReturn).toContain("lot.locationId !== exit.locationId");
    expect(createReturn).toContain("areaId: exit.areaId");
    expect(createReturn).toContain("applyReturnToLot(");
    expect(createReturn).toContain("shouldRestockReturnedMaterial(condition)");
    expect(createReturn).toContain("row.locationId === targetLocationId");
  });

  it("mostra área pelo saldo por localização, não por área legada do armário", () => {
    expect(stockLocations).toContain("const area = row.areaId ? await ctx.db.get(row.areaId) : null");
    expect(stockLocations).not.toContain("location?.areaId === row.areaId");
    expect(stockAreas).not.toContain("location.areaId !== lot.areaId");
  });

  it("seleciona saídas pelo par área + local, sem colidir no mesmo armário", () => {
    expect(exitPage).toContain('${location.areaId ?? ""}::${location.locationId}');
    expect(exitPage).toContain('${l.areaId}::${l.locationId}');
    expect(exitPage).toContain("locationId: selectedLocation.locationId");
  });

  it("solicitações e transferências oferecem locais físicos sem filtrar por área legada", () => {
    expect(requestsPage).toContain("location.active");
    expect(requestsPage).not.toContain("location.areaId === item.areaId");
    expect(transfersPage).toContain("fromAreaId: fromAreaId as any");
    expect(transfersPage).toContain("toAreaId: toAreaId as any");
    expect(transfersPage).toContain("Selecione a área...");
  });

  it("inventários e classificação permitem escolher área e armário separadamente", () => {
    expect(inventory).toContain("inv.locationId && !inv.areaId");
    expect(inventory).toContain("row.locationId === inv.locationId && row.areaId === inv.areaId");
    expect(stockAreasPage).toContain("location.active");
    expect(stockAreasPage).not.toContain("location.areaId === classificationAreaId");
  });

  it("mantém as cinco áreas de estoque aprovadas como estrutura padrão", () => {
    for (const areaName of ["TI Geral", "Impressoras", "Limpeza", "Copa e Cozinha", "Água Mineral"]) {
      expect(areaDefinitions).toContain(areaName);
    }
  });

  it("classificação manual não altera saldo global e exige conferência do saldo legado", () => {
    const classify = mutationBlock(stockAreas, "classifyLot");
    expect(classify).toContain("legacyQuantity < lot.quantityAvailable");
    expect(classify).toContain('ctx.db.patch(lot._id, { areaId: args.areaId, locationId: args.locationId })');
    expect(classify).toContain('entity: "lots"');
    expect(classify).not.toContain('ctx.db.patch(productStock._id');
  });

  it("bloqueia mutations antigas que alteravam somente o saldo global", () => {
    for (const name of ["createEntry", "createExit", "reserveStock", "editEntry", "reverseEntry", "createAdjustment"]) {
      const block = mutationBlock(stockMovements, name);
      expect(block).toContain("throw new Error");
    }
  });
});
