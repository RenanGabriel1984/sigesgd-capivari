import { describe, expect, it } from "vitest";
import {
  assertCompleteApprovalItemIds,
  assertCompleteDeliveryItemIds,
  assertUniqueApprovalItemIds,
  getDeliveryStockAdjustment,
} from "../lib/request-approval-validation";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("integridade da entrega de solicitações", () => {
  it("bloqueia IDs de linha repetidos", () => {
    expect(() => assertUniqueApprovalItemIds([{ itemId: "a" }, { itemId: "a" }])).toThrow(/mesma linha/i);
    expect(() => assertUniqueApprovalItemIds([{ itemId: "a" }, { itemId: "b" }])).not.toThrow();
  });

  it("exige todas as linhas aprovadas, sem itens inesperados", () => {
    expect(() => assertCompleteDeliveryItemIds(
      [{ itemId: "a" }, { itemId: "b" }],
      [{ itemId: "a" }, { itemId: "b" }],
    )).not.toThrow();
    expect(() => assertCompleteDeliveryItemIds(
      [{ itemId: "a" }, { itemId: "b" }],
      [{ itemId: "a" }],
    )).toThrow(/todas as linhas aprovadas/i);
    expect(() => assertCompleteDeliveryItemIds(
      [{ itemId: "a" }],
      [{ itemId: "x" }],
    )).toThrow(/todas as linhas aprovadas/i);
    expect(() => assertCompleteDeliveryItemIds([], [])).not.toThrow();
    expect(() => assertCompleteDeliveryItemIds([], [{ itemId: "x" }])).toThrow(/todas as linhas aprovadas/i);
  });

  it("baixa do físico o entregue e libera toda a reserva aprovada", () => {
    expect(getDeliveryStockAdjustment(10, 7)).toEqual({
      physicalToRemove: 7,
      reservedToRelease: 10,
      unusedReservation: 3,
    });
  });

  it("rejeita quantidades inválidas", () => {
    expect(() => getDeliveryStockAdjustment(0, 1)).toThrow(/aprovada inválida/i);
    expect(() => getDeliveryStockAdjustment(10, 0)).toThrow(/maior que zero/i);
    expect(() => getDeliveryStockAdjustment(10, 11)).toThrow(/não pode exceder/i);
    expect(() => getDeliveryStockAdjustment(10, Number.NaN)).toThrow(/maior que zero/i);
  });
});

describe("integração de entrega com o livro-razão lote/local", () => {
  const source = readFileSync(resolve(__dirname, "../convex/requests.ts"), "utf8");
  const start = source.indexOf("export const deliver = mutation({");
  const end = source.indexOf("export const cancel = mutation({", start);
  const block = source.slice(start, end);

  it("valida credencial única e linhas completas antes da primeira escrita", () => {
    const credentialGuard = block.indexOf("if (passwordRecords.length !== 1)");
    const completeGuard = block.indexOf("assertCompleteDeliveryItemIds(");
    const firstWrite = Math.min(
      ...["ctx.db.patch(", "ctx.db.insert("]
        .map((needle) => block.indexOf(needle))
        .filter((index) => index >= 0),
    );
    expect(credentialGuard).toBeGreaterThan(-1);
    expect(completeGuard).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(completeGuard);
  });

  it("libera a reserva aprovada integralmente sem baixar do físico o não entregue", () => {
    expect(block).toContain("getDeliveryStockAdjustment(requestItem.quantityApproved, input.quantityDelivered)");
    expect(block).toContain("freshStock.physicalQuantity - adjustment.physicalToRemove");
    expect(block).toContain("freshStock.reservedQuantity - adjustment.reservedToRelease");
    expect(block).toContain("consumeLotLocationStock(ctx");
    expect(block).toContain("Reserva não utilizada liberada");
    expect(block).toContain("const approvedRequestItems = allRequestItems.filter((item: any) => item.quantityApproved > 0)");
    expect(block).toContain("return total + approved - input.quantityDelivered");
  });
});


describe("integração da aprovação sem reserva duplicada", () => {
  it("rejeita IDs de item repetidos antes da primeira escrita", () => {
    const source = readFileSync(resolve(__dirname, "../convex/requests.ts"), "utf8");
    const start = source.indexOf("export const approve = mutation({");
    const end = source.indexOf("export const reject = mutation({", start);
    const block = source.slice(start, end);
    const guard = block.indexOf("assertUniqueApprovalItemIds(args.items)");
    const firstWrite = Math.min(
      ...["ctx.db.patch(", "ctx.db.insert("]
        .map((needle) => block.indexOf(needle))
        .filter((index) => index >= 0),
    );
    expect(guard).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(guard);
  });
});


describe("integridade da aprovação de solicitações", () => {
  it("exige todas as linhas da solicitação e rejeita linhas inesperadas ou repetidas", () => {
    expect(() => assertCompleteApprovalItemIds(
      [{ itemId: "a" }, { itemId: "b" }],
      [{ itemId: "a" }, { itemId: "b" }],
    )).not.toThrow();
    expect(() => assertCompleteApprovalItemIds(
      [{ itemId: "a" }, { itemId: "b" }],
      [{ itemId: "a" }],
    )).toThrow(/todas as linhas da solicitação/i);
    expect(() => assertCompleteApprovalItemIds(
      [{ itemId: "a" }],
      [{ itemId: "x" }],
    )).toThrow(/todas as linhas da solicitação/i);
    expect(() => assertCompleteApprovalItemIds(
      [{ itemId: "a" }],
      [{ itemId: "a" }, { itemId: "a" }],
    )).toThrow(/mais de uma vez/i);
  });

  it("consulta e valida o registro global único antes de reservar estoque", () => {
    const source = readFileSync(resolve(__dirname, "../convex/requests.ts"), "utf8");
    const start = source.indexOf("export const approve = mutation({");
    const end = source.indexOf("export const reject = mutation({", start);
    const block = source.slice(start, end);
    expect(block).toContain("assertCompleteApprovalItemIds(");
    expect(block).toContain('.withIndex("by_product"');
    expect(block).toContain(".collect()");
    expect(block).toContain("requireSingleValidGlobalStock(stockRows, productId)");
    expect(block).toContain("requireSingleValidGlobalStock(freshStockRows, String(requestItem.productId))");
    expect(block).not.toContain(".first();");
  });
});
