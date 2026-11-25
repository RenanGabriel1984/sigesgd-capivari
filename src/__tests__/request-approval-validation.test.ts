import { describe, expect, it } from "vitest";
import {
  assertCompleteApprovalItemIds,
  assertCompleteDeliveryItemIds,
  assertUniqueApprovalItemIds,
  getDeliveryStockAdjustment,
} from "../lib/request-approval-validation";

describe("validações puras de aprovação e entrega", () => {
  it("rejeita IDs duplicados nas linhas da solicitação", () => {
    expect(() => assertUniqueApprovalItemIds([{ itemId: "a" }, { itemId: "a" }])).toThrow(/mais de uma vez/i);
  });
  it("exige aprovação explícita de todas as linhas", () => {
    expect(() => assertCompleteApprovalItemIds([{ itemId: "a" }, { itemId: "b" }], [{ itemId: "a" }])).toThrow(/todas as linhas/i);
    expect(() => assertCompleteApprovalItemIds([{ itemId: "a" }], [{ itemId: "a" }, { itemId: "surpresa" }])).toThrow(/todas as linhas/i);
  });
  it("exige que a entrega trate todas e somente as linhas aprovadas", () => {
    expect(() => assertCompleteDeliveryItemIds([{ itemId: "a" }, { itemId: "b" }], [{ itemId: "a" }])).toThrow(/todas as linhas/i);
    expect(() => assertCompleteDeliveryItemIds([{ itemId: "a" }], [{ itemId: "a" }, { itemId: "x" }])).toThrow(/todas as linhas/i);
    expect(() => assertCompleteDeliveryItemIds([{ itemId: "a" }], [{ itemId: "a" }, { itemId: "a" }])).toThrow(/mais de uma vez/i);
  });
  it("remove fisicamente apenas o entregue e libera toda a reserva aprovada", () => {
    expect(getDeliveryStockAdjustment(10, 7)).toEqual({ physicalToRemove: 7, reservedToRelease: 10, unusedReservation: 3 });
  });
  it("bloqueia quantidades inválidas e entrega acima do aprovado", () => {
    for (const [approved, delivered] of [[0, 1], [4, 0], [4, 5], [4, Number.NaN], [Number.POSITIVE_INFINITY, 1]]) {
      expect(() => getDeliveryStockAdjustment(approved, delivered)).toThrow();
    }
  });
});
