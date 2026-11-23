import { describe, expect, it } from "vitest";
import { assertUniqueApprovalItemIds } from "../lib/request-approval-validation";

describe("integridade da aprovação de solicitações", () => {
  it("aceita itens distintos, inclusive produtos iguais em linhas diferentes", () => {
    expect(() => assertUniqueApprovalItemIds([
      { itemId: "request-item-1" },
      { itemId: "request-item-2" },
    ])).not.toThrow();
  });

  it("rejeita a repetição da mesma linha antes de reservar estoque", () => {
    expect(() => assertUniqueApprovalItemIds([
      { itemId: "request-item-1" },
      { itemId: "request-item-1" },
    ])).toThrow(/mesma linha da solicitação/i);
  });

  it("aceita uma lista vazia sem produzir efeitos", () => {
    expect(() => assertUniqueApprovalItemIds([])).not.toThrow();
  });
});
