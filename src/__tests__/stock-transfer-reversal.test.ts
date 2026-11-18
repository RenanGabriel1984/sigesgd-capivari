import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const transfers = read("src/convex/stockTransfers.ts");
const schema = read("src/convex/schema.ts");
const page = read("src/pages/StockTransfers.tsx");

function mutationBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} = mutation({`);
  expect(start, `mutation ${name} ausente`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("estorno seguro de transferências", () => {
  const reverse = mutationBlock(transfers, "reverse");

  it("exige permissão e justificativa, e impede estorno repetido", () => {
    expect(reverse).toContain('requirePermission(ctx, "transfers.create"');
    expect(reverse).toContain('if (!reason) throw new Error("O motivo do estorno é obrigatório")');
    expect(reverse).toContain("if (transfer.reversedAt)");
  });

  it("bloqueia registros históricos sem áreas ou linhagem de lotes", () => {
    expect(reverse).toContain("!transfer.fromAreaId || !transfer.toAreaId");
    expect(reverse).toContain("if (!links.length)");
    expect(reverse).toContain("linkedTotal - transfer.quantity");
  });

  it("só reverte quando os lotes de destino continuam integralmente disponíveis e sem reservas", () => {
    expect(reverse).toContain("destinationReservations > 0");
    expect(reverse).toContain("destinationLot.quantityAvailable) - link.quantity");
    expect(reverse).toContain("destinationLot.active === false");
    expect(reverse).toContain("destinationBalances.length !== 1");
    expect(reverse).toContain("destinationBalances[0].locationId !== transfer.toLocationId");
    expect(reverse).toContain("sourceBalances.length !== 1");
    expect(reverse).toContain("sourceBalances[0].locationId !== transfer.fromLocationId");
    expect(reverse).toContain("sourceBalances[0].quantityAvailable) - Number(sourceLot.quantityAvailable)");
  });

  it("confere a consistência dos saldos por área/local com a soma dos lotes", () => {
    expect(reverse).toContain("sourceLotTotal - sourceQuantity");
    expect(reverse).toContain("destinationLotTotal - destinationQuantity");
    expect(reverse).toContain("sourceStockRows.length !== 1 || destinationStockRows.length !== 1");
  });

  it("restaura lote e saldo físico nas duas pontas sem alterar saldo global", () => {
    expect(reverse).toContain("quantityAvailable: Number(part.sourceLot.quantityAvailable) + part.link.quantity");
    expect(reverse).toContain("quantityAvailable: 0, active: false");
    expect(reverse).toContain("quantity: sourceQuantity + transfer.quantity");
    expect(reverse).toContain("quantity: destinationQuantity - transfer.quantity");
    expect(reverse).toContain("previousPhysical: globalStock.physicalQuantity, newPhysical: globalStock.physicalQuantity");
    expect(reverse).not.toContain('ctx.db.patch(globalStock._id');
  });

  it("grava estorno, usuário, motivo, movimentação e auditoria sem apagar a transferência", () => {
    expect(schema).toContain("reversedAt: v.optional(v.number())");
    expect(schema).toContain("reversedByUserId: v.optional(v.id(\"users\"))");
    expect(schema).toContain("reversalReason: v.optional(v.string())");
    expect(schema).toContain('REVERSE_TRANSFER: "reverse_stock_transfer"');
    expect(schema).toContain("v.literal(AUDIT_ACTIONS.REVERSE_TRANSFER)");
    expect(reverse).toContain("reversedAt: now, reversedByUserId: userId, reversalReason: reason");
    expect(reverse).toContain('action: "reverse_stock_transfer"');
    expect(reverse).toContain('ctx.db.insert("stockMovements"');
    expect(reverse).not.toContain("ctx.db.delete(transfer");
  });

  it("valida tudo antes da primeira escrita", () => {
    const validationEnd = reverse.indexOf("// Todas as validações são concluídas antes da primeira escrita.");
    const firstWrite = reverse.indexOf("ctx.db.patch(part.sourceLot._id");
    expect(validationEnd).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(validationEnd);
  });

  it("a interface só oferece estorno para transferências não estornadas e exige justificativa", () => {
    expect(page).toContain("!t.reversedAt");
    expect(page).toContain('setSelectedTransfer(t)');
    expect(page).toContain("reversalReason.trim()");
    expect(page).toContain("api.stockTransfers.reverse");
    expect(page).toContain("O histórico original não será apagado");
    expect(page).toContain("Estornada");
  });
});
