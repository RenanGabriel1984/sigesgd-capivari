import { describe, expect, it } from "vitest";
import {
  assertReservedQuantityMatchesApprovedRequests,
  expectedReservedQuantityForProduct,
} from "../lib/stock-reservation-integrity";

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
