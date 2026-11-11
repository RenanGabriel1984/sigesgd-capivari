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
  });

  it("confirma entrada com área e local físico independentes", () => {
    const confirm = mutationBlock(entries, "confirm");
    expect(confirm).toContain("item.areaId ?? entry.areaId");
    expect(confirm).toContain("locationId: item.locationId");
    expect(confirm).toContain("areaId: areaByEntryItem.get(item._id as string)");
    expect(confirm).not.toContain("location.areaId !==");
    expect(schema).toContain("areaId: v.optional(v.id(\"stockAreas\"))");
  });

  it("exige área e local explícitos em cada nova solicitação", () => {
    const create = mutationBlock(requests, "create");
    expect(create).toContain('areaId: v.id("stockAreas")');
    expect(create).toContain('sourceLocationId: v.id("storageLocations")');
    expect(create).toContain("sourceLocation.active");
    expect(create).not.toContain("sourceLocation.areaId");
  });

  it("não associa uma área lógica ao cadastro do armário", () => {
    const locations = read("src/convex/storageLocations.ts");
    const createLocation = mutationBlock(locations, "create");
    expect(createLocation).toContain("areaId: v.optional(v.id(\"stockAreas\"))");
    expect(createLocation).not.toContain("Selecione uma área/subestoque ativa para o local");
    expect(stockAreas).not.toContain("location.areaId === lot.areaId");
  });

  it("aprova com reserva FIFO restrita à mesma área e ao mesmo local", () => {
    const approve = mutationBlock(requests, "approve");
    expect(approve).toContain("planFifoAreaLotAllocation");
    expect(approve).toContain("lot.areaId !== requestItem.areaId");
    expect(approve).toContain("lot.locationId !== requestItem.sourceLocationId");
    expect(approve).toContain('ctx.db.insert("requestItemReservations"');
  });

  it("entrega apenas lotes reservados e reduz o saldo do local de origem", () => {
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
    expect(quickExit).toContain("lot.areaId !== args.areaId");
    expect(quickExit).toContain("lot.locationId !== args.locationId");
    expect(quickExit).toContain("lot.quantityAvailable - reserved");
  });

  it("transferência registra áreas e preserva linhagem dos lotes de origem/destino", () => {
    const create = mutationBlock(transfers, "create");
    expect(create).toContain("fromAreaId: v.optional(v.union(v.id(\"stockAreas\"), v.null()))");
    expect(create).toContain("toAreaId: v.optional(v.union(v.id(\"stockAreas\"), v.null()))");
    expect(create).toContain("const sourceAreaId = args.fromAreaId === undefined ? fromLocation.areaId");
    expect(create).toContain("const destinationAreaId = args.toAreaId === undefined ? toLocation.areaId");
    expect(create).toContain('ctx.db.insert("stockTransferLots"');
    expect(create).toContain("sourceLotId");
    expect(create).toContain("destinationLotId");
    expect(create).toContain("toAreaId: destinationAreaId");
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

  it("permite área opcional independente do local na carga inicial", () => {
    const createProduct = mutationBlock(products, "create");
    expect(createProduct).toContain("initialAreaId: v.optional(v.id(\"stockAreas\"))");
    expect(createProduct).toContain("requestedInitialAreaId ?? location.areaId");
    expect(createProduct).toContain("areaId: initialAreaId");
    expect(stockSetup).toContain("areaId: v.optional(v.id(\"stockAreas\"))");
    expect(stockSetup).toContain("item.areaId = item.areaId ?? location.areaId");
    expect(stockSetup).not.toContain("if (!location.areaId)");
  });

  it("devolve cada parcela ao lote e ao subestoque da saída original", () => {
    const createReturn = mutationBlock(returns, "create");
    expect(createReturn).toContain('ctx.db.query("stockMovementLots")');
    expect(createReturn).toContain("sourceLots");
    expect(createReturn).toContain("lot.areaId !== exit.areaId");
    expect(createReturn).toContain("lot.locationId !== exit.locationId");
    expect(createReturn).toContain("areaId: exit.areaId");
    expect(createReturn).toContain("quantityAvailable: part.lot.quantityAvailable + part.quantity");
    expect(createReturn).toContain("row.locationId === targetLocationId");
    expect(createReturn).toContain("unassignedLegacyReturned");
  });

  it("mantém as cinco áreas de estoque aprovadas como estrutura padrão", () => {
    for (const areaName of ["TI Geral", "Impressoras", "Limpeza", "Copa e Cozinha", "Água Mineral"]) {
      expect(areaDefinitions).toContain(areaName);
    }
  });

  it("classificação usa área e local independentes sem alterar saldo global", () => {
    const classify = mutationBlock(stockAreas, "classifyLot");
    expect(classify).toContain("legacyQuantity < lot.quantityAvailable");
    expect(classify).toContain('ctx.db.patch(lot._id, { areaId: args.areaId, locationId: args.locationId })');
    expect(classify).toContain('entity: "lots"');
    expect(classify).not.toContain("location.areaId");
    expect(classify).not.toContain('ctx.db.patch(productStock._id');
  });

  it("resumo e detalhe usam a área do lote/saldo, não a área legada do armário", () => {
    expect(stockAreas).toContain("const key = lot.areaId && buckets.has(lot.areaId as string)");
    expect(stockAreas).not.toContain("location.areaId === lot.areaId");
    expect(products).toContain("const area = row.areaId ? await ctx.db.get(row.areaId) : null");
  });

  it("inventário por armário separa área e impede ajuste ambíguo", () => {
    const create = mutationBlock(inventory, "create");
    const close = mutationBlock(inventory, "close");
    expect(create).toContain('areaId: v.optional(v.id("stockAreas"))');
    expect(create).toContain("(row.areaId ?? undefined) === args.areaId");
    expect(close).toContain("(row.areaId ?? undefined) === areaId");
    expect(close).toContain("refaça a contagem para ajustar o bucket correto");
  });

  it("bloqueia mutations antigas que alteravam somente o saldo global", () => {
    for (const name of ["createEntry", "createExit", "reserveStock", "editEntry", "reverseEntry", "createAdjustment"]) {
      const block = mutationBlock(stockMovements, name);
      expect(block).toContain("throw new Error");
    }
  });
});
