import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const transfers = read("src/convex/stockTransfers.ts");
const schema = read("src/convex/schema.ts");
const returns = read("src/convex/returns.ts");

function mutationBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} = mutation({`);
  expect(start, `mutation ${name} ausente`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("integridade das transferências entre áreas e locais", () => {
  const create = mutationBlock(transfers, "create");

  it("mantém área e local como dimensões independentes e exige ambas as pontas", () => {
    expect(create).toContain("const fromAreaId = args.fromAreaId");
    expect(create).toContain("const toAreaId = args.toAreaId");
    expect(create).toContain("if (!fromAreaId || !toAreaId)");
    expect(create).not.toContain("fromLocation.areaId");
    expect(create).not.toContain("toLocation.areaId");
  });

  it("bloqueia transferência de quantidade reservada e exige conciliação das reservas", () => {
    expect(create).toContain("const legacyReserved = Math.max(0, globalStock.reservedQuantity - areaReserved)");
    expect(create).toContain("reservedByLot");
    expect(create).toContain("const free = Number(lot.quantityAvailable) - reserved");
    expect(create).toContain("transferências não podem consumir quantidades reservadas");
  });

  it("valida saldo físico por área/local contra a soma dos lotes antes de movimentar", () => {
    expect(create).toContain("sourceLotTotal - sourceStockQuantity");
    expect(create).toContain("destinationLotTotal - destinationStockQuantity");
    expect(create).toContain("sourceRows.length !== 1");
    expect(create).toContain("destinationRows.length > 1");
  });

  it("preserva a data original de recebimento e os dados de procedência no lote de destino", () => {
    expect(create).toContain("receivedAt: sourceLot.receivedAt");
    for (const field of [
      "entryId: sourceLot.entryId",
      "supplierId: sourceLot.supplierId",
      "unitCost: sourceLot.unitCost",
      "invoiceNumber: sourceLot.invoiceNumber",
      "purchaseAuthorizationNumber: sourceLot.purchaseAuthorizationNumber",
      "supplierLotNumber: sourceLot.supplierLotNumber",
      "materialType: sourceLot.materialType",
    ]) expect(create).toContain(field);
    expect(create).not.toContain("receivedAt: now");
  });

  it("registra a linhagem entre lote de origem e lote de destino e o movimento associado", () => {
    expect(schema).toContain("stockTransferLots: defineTable({");
    expect(create).toContain('ctx.db.insert("stockTransferLots"');
    expect(create).toContain("sourceLotId: sourceLot._id");
    expect(create).toContain("destinationLotId");
    expect(create).toContain('ctx.db.insert("stockMovementLots"');
    expect(create).toContain("lotId: part.lotId");
    expect(create).toContain('action: "transfer_stock"');
  });

  it("mantém o saldo global e as reservas inalterados durante a transferência", () => {
    expect(create).toContain("previousPhysical: globalStock.physicalQuantity, newPhysical: globalStock.physicalQuantity");
    expect(create).toContain("previousReserved: globalStock.reservedQuantity, newReserved: globalStock.reservedQuantity");
    expect(create).not.toContain('ctx.db.patch(globalStock._id');
  });

  it("mantém devolução como fluxo distinto, vinculado à saída e à origem original", () => {
    const createReturn = mutationBlock(returns, "create");
    expect(createReturn).toContain("exitMovementId: v.id(\"stockMovements\")");
    expect(createReturn).toContain("A devolução deve voltar ao local físico de origem");
    expect(createReturn).toContain("applyReturnToLot(");
    expect(createReturn).toContain("exitMovementId: exit._id");
    expect(createReturn).toContain('type: "return"');
  });
});
