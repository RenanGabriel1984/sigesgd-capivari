import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateRequestItemReservationLedger } from "../lib/request-reservation-ledger";

const requests = readFileSync(resolve(__dirname, "../convex/requests.ts"), "utf-8");
const deliverStart = requests.indexOf("export const deliver = mutation({");
const cancelStart = requests.indexOf("export const cancel = mutation({");
const deliver = requests.slice(deliverStart, cancelStart);
const cancel = requests.slice(cancelStart);

const reservation = {
  requestItemId: "item-1",
  productId: "product-1",
  lotId: "lot-1",
  areaId: "area-1",
  locationId: "location-1",
  quantity: 5,
  quantityRemaining: 5,
  quantityDelivered: 0,
  quantityReleased: 0,
};

describe("integridade do livro de reservas de solicitações", () => {
  it("aceita reserva completa e retorna o saldo ainda reservado", () => {
    expect(validateRequestItemReservationLedger({
      requestItemId: "item-1",
      productId: "product-1",
      areaId: "area-1",
      locationId: "location-1",
      quantityApproved: 5,
      reservations: [reservation],
    })).toEqual({ remaining: 5, error: null });
  });

  it("bloqueia item aprovado sem reserva vinculada", () => {
    const result = validateRequestItemReservationLedger({
      requestItemId: "item-1",
      productId: "product-1",
      areaId: "area-1",
      locationId: "location-1",
      quantityApproved: 5,
      reservations: [],
    });
    expect(result.error).toMatch(/não possui reservas por lote/i);
  });

  it("bloqueia divergência entre quantidade aprovada e total alocado", () => {
    const result = validateRequestItemReservationLedger({
      requestItemId: "item-1",
      productId: "product-1",
      areaId: "area-1",
      locationId: "location-1",
      quantityApproved: 5,
      reservations: [{ ...reservation, quantity: 4, quantityRemaining: 4 }],
    });
    expect(result.error).toMatch(/não correspondem à quantidade aprovada/i);
  });

  it("bloqueia referência de área/local ou produto divergente", () => {
    const result = validateRequestItemReservationLedger({
      requestItemId: "item-1",
      productId: "product-1",
      areaId: "area-1",
      locationId: "location-1",
      quantityApproved: 5,
      reservations: [{ ...reservation, locationId: "location-2" }],
    });
    expect(result.error).toMatch(/não corresponde ao item, produto, área ou local/i);
  });

  it("valida a equação entre alocado, restante, entregue e liberado", () => {
    const result = validateRequestItemReservationLedger({
      requestItemId: "item-1",
      productId: "product-1",
      areaId: "area-1",
      locationId: "location-1",
      quantityApproved: 5,
      reservations: [{
        ...reservation,
        quantityRemaining: 2,
        quantityDelivered: 2,
        quantityReleased: 1,
      }],
    });
    expect(result).toEqual({ remaining: 2, error: null });
  });

  it("usa a validação tanto na entrega quanto no cancelamento", () => {
    expect(deliver).toContain("validateRequestItemReservationLedger");
    expect(cancel).toContain("validateRequestItemReservationLedger");
    expect(cancel).toContain("Cancelamento bloqueado para preservar o estoque");
  });
});
