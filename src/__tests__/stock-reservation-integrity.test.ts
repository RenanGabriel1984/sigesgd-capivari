import { describe, expect, it } from "vitest";
import {
  assertReservedQuantityMatchesApprovedRequests,
  expectedReservedQuantityForProduct,
} from "../lib/stock-reservation-integrity";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requests = [
  { _id: "approved-1", status: "approved" },
  { _id: "approved-2", status: "approved" },
  { _id: "delivered-1", status: "delivered" },
  { _id: "pending-1", status: "pending" },
  { _id: "cancelled-1", status: "cancelled" },
];
const items = [
  { requestId: "approved-1", productId: "p1", quantityApproved: 4 },
  { requestId: "approved-1", productId: "p1", quantityApproved: 2 },
  { requestId: "approved-2", productId: "p1", quantityApproved: 3 },
  { requestId: "delivered-1", productId: "p1", quantityApproved: 8 },
  { requestId: "pending-1", productId: "p1", quantityApproved: 10 },
  { requestId: "cancelled-1", productId: "p1", quantityApproved: 5 },
  { requestId: "approved-1", productId: "p2", quantityApproved: 7 },
];

describe("integridade entre reservas e solicitações aprovadas", () => {
  it("soma somente linhas de solicitações ainda aprovadas", () => {
    expect(expectedReservedQuantityForProduct("p1", requests, items)).toBe(9);
    expect(expectedReservedQuantityForProduct("p2", requests, items)).toBe(7);
    expect(expectedReservedQuantityForProduct("p3", requests, items)).toBe(0);
  });

  it("aceita quando o reservado global coincide com solicitações aprovadas", () => {
    expect(assertReservedQuantityMatchesApprovedRequests({
      stock: { physicalQuantity: 20, reservedQuantity: 9 },
      requests,
      items,
      productId: "p1",
      productLabel: "Produto 1",
    })).toBe(9);
  });

  it("bloqueia reserva órfã, ausente ou acima do total aprovado", () => {
    for (const actual of [0, 8, 10]) {
      expect(() => assertReservedQuantityMatchesApprovedRequests({
        stock: { physicalQuantity: 20, reservedQuantity: actual },
        requests,
        items,
        productId: "p1",
        productLabel: "Produto 1",
      })).toThrow(/reserva divergente/i);
    }
  });

  it("bloqueia linha aprovada com quantidade inválida", () => {
    expect(() => expectedReservedQuantityForProduct("p1", requests, [
      { requestId: "approved-1", productId: "p1", quantityApproved: Number.NaN },
    ])).toThrow(/quantidade aprovada inválida/i);
  });

  it("sem registro global aceita somente quando não existe reserva esperada", () => {
    expect(assertReservedQuantityMatchesApprovedRequests({
      stock: null,
      requests,
      items,
      productId: "p3",
      productLabel: "Produto 3",
    })).toBe(0);
    expect(() => assertReservedQuantityMatchesApprovedRequests({
      stock: null,
      requests,
      items,
      productId: "p1",
      productLabel: "Produto 1",
    })).toThrow(/reserva divergente/i);
  });
});


describe("integração da conciliação de reservas nos fluxos operacionais", () => {
  const root = resolve(__dirname, "..");
  const source = (path: string) => readFileSync(resolve(root, path), "utf8");

  it("aprovação valida reserva anterior antes da primeira gravação", () => {
    const requests = source("convex/requests.ts");
    const start = requests.indexOf("export const approve = mutation({");
    const end = requests.indexOf("export const reject = mutation({", start);
    const block = requests.slice(start, end);
    const guard = block.indexOf("assertProductReservationConsistent(ctx, productId, needed.productName, stock)");
    const firstWrite = Math.min(...["ctx.db.patch(", "ctx.db.insert("].map((term) => {
      const index = block.indexOf(term);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }));
    expect(guard).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(guard);
  });

  it("entrega e cancelamento reconciliam as reservas antes de liberar unidades", () => {
    const requests = source("convex/requests.ts");
    const deliverStart = requests.indexOf("export const deliver = mutation({");
    const cancelStart = requests.indexOf("export const cancel = mutation({");
    const pendingStart = requests.indexOf("export const pendingCount = query({");
    const delivery = requests.slice(deliverStart, cancelStart);
    const cancellation = requests.slice(cancelStart, pendingStart);
    expect(delivery).toContain("assertProductReservationConsistent(ctx, productId, label, stock)");
    expect(cancellation).toContain("assertProductReservationConsistent(ctx, productId, label, stock)");
  });

  it("saídas diretas, suprimentos e inventário verificam reserva contra requisições aprovadas", () => {
    expect(source("convex/stockMovements.ts")).toContain("assertProductReservationConsistent(ctx, args.productId, String(args.productId), stock)");
    expect(source("convex/stockSetup.ts")).toContain("await assertProductReservationConsistent(ctx, args.productId, product.name, stock)");
    expect(source("convex/printSupplies.ts")).toContain("await assertProductReservationConsistent(ctx, args.productId, product.name, stock)");
    expect(source("convex/inventory.ts")).toContain("await assertProductReservationConsistent(ctx, productId, productName, stock)");
  });

  it("entradas e devoluções também preservam a integridade das reservas ativas", () => {
    expect(source("convex/entries.ts")).toContain("assertProductReservationConsistent(ctx, item.productId, product.name, stockBefore)");
    expect(source("convex/entries.ts")).toContain("assertProductReservationConsistent(ctx, item.productId, productName, stock)");
    expect(source("convex/returns.ts")).toContain("assertProductReservationConsistent(ctx, exit.productId, product.name, stock)");
    expect(source("convex/returns.ts")).toContain("assertProductReservationConsistent(ctx, returned.productId, product.name, stock)");
  });
});


describe("reconciliação administrativa respeita livros-razão e reservas", () => {
  it("não escolhe arbitrariamente um registro global e valida reservas/lotes antes de corrigir físico", () => {
    const diagnostics = readFileSync(resolve(__dirname, "../convex/diagnostics.ts"), "utf8");
    const start = diagnostics.indexOf("async function reconcileCore");
    const end = diagnostics.indexOf("export const environmentCheckInternal", start);
    const core = diagnostics.slice(start, end);
    expect(core).toContain("productStocks.length > 1");
    expect(core).toContain("assertProductReservationConsistent(ctx, product._id, product.name, st ?? null)");
    expect(core).toContain("assertProductLedgerSnapshot(");
    expect(core).not.toContain("stocks.find((s: any) => s.productId === product._id)");
    expect(core).toContain("reason: structuralError");
  });

  it("transferências conciliam reservas antes de alterar armários", () => {
    const transfers = readFileSync(resolve(__dirname, "../convex/stockTransfers.ts"), "utf8");
    expect(transfers).toContain("assertProductReservationConsistent(ctx, args.productId, product.name, reservationStock)");
    expect(transfers).toContain("validateUniqueScopedStockRows");
    expect(transfers).toContain("planLotLocationTransfer");
  });

  it("GomaQ valida reserva e baixa lote/armário pelo ledger", () => {
    const gomaq = readFileSync(resolve(__dirname, "../convex/gomaQ.ts"), "utf8");
    const start = gomaq.indexOf("export const createExchange = mutation({");
    const end = gomaq.indexOf("export const createCollection = mutation({", start);
    const block = gomaq.slice(start, end);
    expect(block).toContain("assertProductReservationConsistent");
    expect(block).toContain("consumeLotLocationStock");
    expect(block).toContain("recordLotMovementAllocations");
    expect(block).toContain("Trocas GomaQ vinculadas a requisições devem ser registradas");
  });

  it("instalação de peças patrimoniais baixa físico, armário e lotes na mesma operação", () => {
    const assetParts = readFileSync(resolve(__dirname, "../convex/assetParts.ts"), "utf8");
    const start = assetParts.indexOf("export const installPart = mutation({");
    const end = assetParts.indexOf("export const removePart = mutation({", start);
    const block = assetParts.slice(start, end);
    expect(block).toContain("assertProductLedgerConsistent");
    expect(block).toContain("assertProductReservationConsistent");
    expect(block).toContain("consumeLotLocationStock");
    expect(block).toContain("recordLotMovementAllocations");
    expect(block).toContain("movementId");
    expect(block).toContain("locationId: sourceLocationId");
  });

});
