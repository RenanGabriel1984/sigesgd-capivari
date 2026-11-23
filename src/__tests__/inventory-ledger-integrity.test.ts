import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const inventory = readFileSync(resolve(ROOT, "src/convex/inventory.ts"), "utf-8");
const closeStart = inventory.indexOf("export const close = mutation({");
const closeEnd = inventory.indexOf("/** Cancel an inventory", closeStart);
const close = inventory.slice(closeStart, closeEnd);

describe("integridade do fechamento de inventário", () => {
  it("confere o saldo global com lotes e reservas antes de ajustar", () => {
    expect(close).toContain('ctx.db.query("lots")');
    expect(close).toContain("const lotTotal = lots.reduce");
    expect(close).toContain("diverge dos lotes");
    expect(close).toContain('ctx.db.query("requestItemReservations")');
    expect(close).toContain("divergem do saldo reservado global");
  });

  it("confere área/local e não mistura saldos de armários diferentes", () => {
    expect(close).toContain("row.areaId ??");
    expect(close).toContain("row.locationId");
    expect(close).toContain("lot.areaId === inv.areaId && lot.locationId === inv.locationId");
    expect(close).toContain("Lotes de");
    expect(close).toContain("scopeTotal");
  });

  it("redução de contagem consome somente quantidade livre de lotes FIFO", () => {
    expect(close).toContain("reservedByLot");
    expect(close).toContain("const free = Number(lot.quantityAvailable) - reserved");
    expect(close).toContain("plannedReductions");
    expect(close).toContain("lot.quantityAvailable");
    expect(close).toContain("reservedByLot.get(String(lot._id))");
    expect(close).toContain("await ctx.db.patch(reduction.lot._id");
  });

  it("bloqueia ajuste positivo em inventário geral sem destino área/local", () => {
    expect(close).toContain("delta > 0 && !inv.locationId");
    expect(close).toContain("exige inventário por área e local físico");
  });

  it("aumento de contagem em inventário localizado cria entrada/lote rastreável", () => {
    expect(close).toContain('ctx.db.insert("entries"');
    expect(close).toContain('originType: "other"');
    expect(close).toContain('ctx.db.insert("entryItems"');
    expect(close).toContain('ctx.db.insert("lots"');
    expect(close).toContain("quantityReceived: delta");
    expect(close).toContain("lotId: adjustmentLotId as string");
  });

  it("toda diferença gera movimento e vínculo com cada lote ajustado", () => {
    expect(close).toContain('ctx.db.insert("stockMovements"');
    expect(close).toContain('ctx.db.insert("stockMovementLots"');
    expect(close).toContain("quantity: reduction.quantity");
    expect(close).toContain("Ajuste via inventário");
  });
});


describe("integridade da abertura de inventário", () => {
  it("concilia área/local com lotes em vez de somar buckets físicos", () => {
    const createStart = inventory.indexOf("export const create = mutation({");
    const closeStart = inventory.indexOf("export const close = mutation({", createStart);
    const create = inventory.slice(createStart, closeStart);
    expect(create).toContain("resolveScopedInventoryQuantity(");
    expect(create).toContain('ctx.db.query("stockByLocation")');
    expect(create).toContain('ctx.db.query("lots")');
    expect(create).not.toContain(".reduce((sum: number, s: any) => sum + s.quantity, 0)");
  });
});

describe("trilha de auditoria do ciclo de inventário", () => {
  it("registra o operador e a transição para revisão após validar todas as contagens", () => {
    const reviewStart = inventory.indexOf("export const startReview = mutation({");
    const closeStart = inventory.indexOf("export const close = mutation({", reviewStart);
    const review = inventory.slice(reviewStart, closeStart);
    expect(review).toContain("const { userId } = await requireStockManagerOrAdmin(ctx)");
    expect(review).toContain('if (inv.status !== "counting")');
    expect(review).toContain("const uncounted = counts.filter");
    expect(review).toContain('status: "review", updatedAt: now');
    expect(review).toContain('ctx.db.insert("auditLogs", {');
    expect(review).toContain('action: "count_inventory"');
    expect(review).toContain('entity: "inventories"');
    expect(review).toContain("entityId: args.inventoryId");
    expect(review).toContain("userId,");
    expect(review).toContain("contagem concluída e encaminhada para revisão");
    expect(review).toContain("timestamp: now");
    expect(review.indexOf("if (uncounted.length > 0)")).toBeLessThan(review.indexOf('ctx.db.insert("auditLogs")'));
  });
});
