import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/stockSetup.ts"), "utf8");

describe("resumo de saldo por local — consultas de reservas em lote", () => {
  it("carrega todas as reservas uma vez e agrupa por produto", () => {
    const start = source.indexOf("export const productLocationSummary = query({");
    const end = source.indexOf("/**", start + 10);
    const block = source.slice(start, end > start ? end : undefined);

    expect(block).toContain('ctx.db.query("requestItemReservations").collect()');
    expect(block).toContain("const reservationsByProduct = new Map");
    expect(block).toContain("reservationsByProduct.get(String(row.productId))");
    expect(block).not.toContain('.withIndex("by_product", (q: any) => q.eq("productId", row.productId))');
  });

  it("não expõe saldo disponível negativo quando reservas excedem o saldo físico", () => {
    expect(source).toContain("quantity: Math.max(0, row.quantity - reserved)");
  });
});
