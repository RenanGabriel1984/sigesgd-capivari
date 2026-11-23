import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const printSupplies = readFileSync(resolve(root, "src/convex/printSupplies.ts"), "utf-8");
const gomaq = readFileSync(resolve(root, "src/convex/gomaQ.ts"), "utf-8");

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, "trecho inicial ausente: " + startMarker).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, "trecho final ausente: " + endMarker).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("integridade do estoque global nos suprimentos de impressão", () => {
  it("ledger operacional rejeita estoque global duplicado e quantidades inválidas", () => {
    const ledger = blockBetween(
      printSupplies,
      "async function readSupplyAreaLedger(",
      "async function changeSupplyLocationQuantity(",
    );
    expect(ledger).toContain('.withIndex("by_product", (q: any) => q.eq("productId", productId)).collect()');
    expect(ledger).toContain("getOptionalSingleValidGlobalStock(stockRows, productId)");
    expect(ledger).toContain("Number.isFinite(Number(lot.quantityAvailable))");
    expect(ledger).toContain("Number.isFinite(Number(row.quantity))");
    expect(ledger).toContain("reservation.areaId !== lot.areaId");
    expect(ledger).toContain("reservation.locationId !== lot.locationId");
    expect(ledger).toContain("nextReserved > Number(lot.quantityAvailable)");
    expect(ledger).not.toContain('.withIndex("by_product", (q: any) => q.eq("productId", productId)).first()');
  });

  it("painel não sobrescreve duplicidades globais pela ordem de leitura", () => {
    const dashboard = blockBetween(
      printSupplies,
      "export const getSupplyDashboard = query({",
      "/* ═══ Parâmetros mín/ideal por produto",
    );
    expect(dashboard).toContain("stockRowsByProduct");
    expect(dashboard).toContain("getOptionalSingleValidGlobalStock(");
    expect(dashboard).toContain("reservationTotalsByLot");
    expect(dashboard).toContain("reservationTotalsByProduct");
    expect(dashboard).toContain("areaLotsByLocation");
    expect(dashboard).toContain("areaRowsByProduct");
    expect(dashboard).toContain("buckets duplicados de área/local");
    expect(dashboard).toContain("diverge dos lotes");
    expect(dashboard).toContain("Consulta Gomaq bloqueada");
    expect(dashboard).not.toContain("stockByProduct.set(s.productId");
  });

  it("prévia de retirada por família exige saldo global único", () => {
    const preview = blockBetween(
      printSupplies,
      "async function previewFamilyWithdrawalImpl(",
      "export const getGlobalIntegrity = query({",
    );
    expect(preview).toContain(".collect()");
    expect(preview).toContain("closedMembers.length !== 1");
    expect(preview).toContain("looseMembers.length !== 1");
    expect(preview).toContain("getOptionalSingleValidGlobalStock(rows, productName)");
    expect(preview).not.toContain('.withIndex("by_product", (q: any) => q.eq("productId", productId)).first()');
  });

  it("retirada por família exige exatamente um produto fechado e um avulso", () => {
    const withdrawal = blockBetween(
      printSupplies,
      "export const withdrawFamily = mutation({",
      "/* ═══ Integridade global",
    );
    expect(withdrawal).toContain("closedMembers.length !== 1");
    expect(withdrawal).toContain("looseMembers.length !== 1");
    expect(withdrawal).toContain("Família ambígua");
  });

  it("pedido mensal Gomaq bloqueia duplicidade e concilia saldos, lotes e reservas", () => {
    const monthlyOrder = blockBetween(
      gomaq,
      "export const monthlyOrder = query({",
      "// ═══════════════════════════════════════════════════════════════════════════\n// MUTATIONS",
    );
    expect(monthlyOrder).toContain("getOptionalSingleValidGlobalStock(stockRows, product.name)");
    expect(monthlyOrder).toContain("lotsPhysical");
    expect(monthlyOrder).toContain("reservationsTotal");
    expect(monthlyOrder).toContain("reservationTotalsByLot");
    expect(monthlyOrder).toContain("reservedForLot > Number(lot.quantityAvailable)");
    expect(monthlyOrder).toContain("reservation.areaId !== lot.areaId");
    expect(monthlyOrder).toContain("reservation.locationId !== lot.locationId");
    expect(monthlyOrder).toContain("reservationsTotal - reserved");
    expect(monthlyOrder).not.toContain('.withIndex("by_product", (q: any) => q.eq("productId", pid)).first()');
  });
});
