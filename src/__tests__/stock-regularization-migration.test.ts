import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const migration = read("src/convex/stockRegularization.ts");
const manifest = read("src/lib/stock-regularization-manifest.ts");

describe("regularização histórica de área/local", () => {
  it("separa prévia somente leitura da mutation de aplicação", () => {
    expect(migration).toContain('export const preview = query({');
    expect(migration).toContain('export const apply = mutation({');
    expect(migration).toContain('await requirePermission(ctx, "stock.view"');
    expect(migration).toContain('await requirePermission(ctx, "stock.mutate"');
    expect(migration).toContain('role !== "admin"');
    expect(migration).toContain('v.literal(CONFIRMATION)');
  });

  it("bloqueia a aplicação quando qualquer pré-validação falha", () => {
    expect(migration).toContain("if (plan.blockers.length > 0)");
    expect(migration).toContain("Regularização interrompida; nenhuma alteração foi aplicada.");
    expect(migration).toContain("approvedRequests");
    expect(migration).toContain("quantityApproved");
    expect(migration).toContain("quantityDelivered");
  });

  it("valida reservas por lote e preserva a trilha de movimentações multi-lote", () => {
    expect(migration).toContain('ctx.db.query("requestItemReservations")');
    expect(migration).toContain('ctx.db.query("stockMovementLots")');
    expect(migration).toContain("movementLotPatches");
    expect(migration).toContain("keyOf(lot.productId as string, lot.lotNumber as string)");
    expect(migration).toContain("return byId.get(reference) ?? (productId ? byNumber.get(keyOf(productId, reference)) : null) ?? null;");
    expect(migration).toContain("returnedByExitLot");
    expect(migration).toContain("informe/vincule o lote exato consumido pela saída original.");
  });

  it("preserva saldos globais, lotes e quantidades das movimentações", () => {
    expect(migration).toContain("stockGlobalQuantitiesWillChange: false");
    expect(migration).toContain("stockReservedQuantitiesWillChange: false");
    expect(migration).toContain("lotQuantitiesWillChange: false");
    expect(migration).toContain("entryQuantitiesWillChange: false");
    expect(migration).toContain("movementQuantitiesWillChange: false");
    expect(migration).toContain("stockByLocationPairTotalsWillChange: false");
    expect(migration).not.toContain('ctx.db.delete("lots"');
    expect(migration).not.toContain('ctx.db.delete("stock"');
  });

  it("confere soma por produto/local antes de dividir o saldo entre áreas", () => {
    expect(migration).toContain("Math.abs(existingTotal - expectedTotal)");
    expect(migration).toContain("stockByLocationPairTotalsWillChange: false");
    expect(migration).toContain("stockByLocationUpdates");
    expect(migration).toContain("stockByLocationInserts");
  });

  it("identifica a origem documental das 53 linhas da carga inicial", () => {
    expect(manifest).toContain('INITIAL_ENTRY_NUMBER = "ENT-2026-000001"');
    expect(manifest).toContain('GOMAQ_INVOICE_NUMBER = "372043"');
    expect(manifest).toContain("INITIAL_STOCK_MANIFEST");
    expect(manifest).toContain("printerRows");
    expect(manifest).toContain("generalRows");
    expect(manifest).toContain('"Impressoras"');
    expect(manifest).toContain('"TI Geral"');
  });

  it("é idempotente e não repete a escrita quando os metadados já estão corretos", () => {
    expect(migration).toContain("idempotentNoOp: plan.changes.totalWrites === 0");
    expect(migration).toContain("if (plan.changes.totalWrites > 0)");
  });
});
