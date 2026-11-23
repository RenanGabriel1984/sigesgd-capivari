import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const requestsSource = readFileSync(
  resolve(__dirname, "../convex/requests.ts"),
  "utf-8",
);

describe("integração da proteção contra itens duplicados", () => {
  it("valida unicidade na aprovação antes da primeira escrita", () => {
    const start = requestsSource.indexOf("export const approve = mutation({");
    const end = requestsSource.indexOf("export const reject = mutation({", start);
    const block = requestsSource.slice(start, end);
    const guard = block.indexOf("assertUniqueApprovalItemIds(args.items)");
    const firstWrite = Math.min(
      ...["ctx.db.patch(", "ctx.db.insert("]
        .map((needle) => block.indexOf(needle))
        .filter((index) => index >= 0),
    );
    expect(start).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(guard);
  });

  it("valida unicidade na entrega antes da primeira escrita", () => {
    const start = requestsSource.indexOf("export const deliver = mutation({");
    const end = requestsSource.indexOf("export const cancel = mutation({", start);
    const block = requestsSource.slice(start, end);
    const guard = block.indexOf("assertUniqueApprovalItemIds(inputItems)");
    const firstWrite = Math.min(
      ...["ctx.db.patch(", "ctx.db.insert("]
        .map((needle) => block.indexOf(needle))
        .filter((index) => index >= 0),
    );
    expect(start).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(guard);
  });
});
