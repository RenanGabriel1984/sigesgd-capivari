import { describe, expect, it } from "vitest";
import { planLotReturnAllocations } from "../lib/return-lot-allocation";
import { planTransfer } from "../lib/transfer-rules";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const readSource = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");
const sourceAllocations = [
  { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 3 },
  { lotId: "lot-b", sourceLocationId: "cabinet-02", quantity: 2 },
];

describe("devolução: alocação limitada à saída original", () => {
  it("distribui a devolução entre lotes e armários exatos da saída", () => {
    expect(planLotReturnAllocations({
      requestedQuantity: 3, sourceAllocations,
      previouslyReturned: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 }],
      requestedAllocations: [
        { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 },
        { lotId: "lot-b", sourceLocationId: "cabinet-02", quantity: 2 },
      ],
    })).toEqual([
      { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 },
      { lotId: "lot-b", sourceLocationId: "cabinet-02", quantity: 2 },
    ]);
  });
  it("bloqueia lote/armário que não participou da saída", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 1, sourceAllocations, previouslyReturned: [],
      requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-02", quantity: 1 }],
    })).toThrow(/não participou/i);
  });
  it("bloqueia devolução acima da quantidade ainda disponível", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 3, sourceAllocations,
      previouslyReturned: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 2 }],
      requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 2 }],
    })).toThrow(/excede o saldo disponível/i);
  });
  it("bloqueia pares lote/armário duplicados", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 2, sourceAllocations, previouslyReturned: [],
      requestedAllocations: [
        { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 },
        { lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 },
      ],
    })).toThrow(/mais de uma vez/i);
  });
  it("exige soma exata das parcelas", () => {
    expect(() => planLotReturnAllocations({
      requestedQuantity: 3, sourceAllocations, previouslyReturned: [],
      requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 2 }],
    })).toThrow(/soma das quantidades/i);
  });
  it("bloqueia quantidades não finitas ou não positivas", () => {
    for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planLotReturnAllocations({
        requestedQuantity: quantity, sourceAllocations, previouslyReturned: [],
        requestedAllocations: [{ lotId: "lot-a", sourceLocationId: "cabinet-01", quantity: 1 }],
      })).toThrow();
    }
  });
});

describe("transferência: movimenta armários sem consumir o lote", () => {
  const common = {
    productName: "Cooler Intel", quantity: 2,
    fromLocationName: "Armário TI 01", toLocationName: "Armário TI 02",
    lotId: "lot-cooler", lotNumber: "LOT-2026-000001",
  };
  it("reduz origem e aumenta destino, preservando lote e movimento", () => {
    expect(planTransfer({ ...common, fromQuantity: 5, toQuantity: 4 })).toMatchObject({
      fromQuantityAfter: 3, toQuantityAfter: 6, keepsLot: true,
      lotId: "lot-cooler", movementType: "transfer",
    });
  });
  it("preserva o total físico distribuído entre armários", () => {
    const plan = planTransfer({ ...common, fromQuantity: 5, toQuantity: 4 });
    expect(plan.fromQuantityAfter + plan.toQuantityAfter).toBe(9);
  });
  it("bloqueia origem insuficiente, saldos inválidos e overflow", () => {
    expect(() => planTransfer({ ...common, fromQuantity: 1, toQuantity: 4 })).toThrow(/insuficiente/i);
    expect(() => planTransfer({ ...common, fromQuantity: Number.NaN, toQuantity: 4 })).toThrow(/finitos/i);
    expect(() => planTransfer({ ...common, fromQuantity: 5, toQuantity: -1 })).toThrow(/não negativos/i);
    expect(() => planTransfer({ ...common, fromQuantity: Number.MAX_VALUE, toQuantity: Number.MAX_VALUE, quantity: Number.MAX_VALUE })).toThrow(/limites numéricos/i);
  });
  it("bloqueia origem e destino idênticos", () => {
    expect(() => planTransfer({ ...common, fromQuantity: 5, toQuantity: 4, toLocationName: "Armário TI 01" })).toThrow(/mesmo local/i);
  });
});

describe("integração das devoluções e transferências no livro-razão", () => {
  const returns = readSource("convex/returns.ts");
  const transfers = readSource("convex/stockTransfers.ts");
  it("devolução disponível exige conciliação global, armário, lote e reserva antes de gravar", () => {
    const block = returns.slice(returns.indexOf("export const create = mutation"), returns.indexOf("export const resolveQuarantine = mutation"));
    expect(block).toContain("assertProductLedgerConsistent(ctx, exit.productId, product.name)");
    expect(block).toContain("assertProductReservationConsistent(ctx, exit.productId, product.name, stock)");
    expect(block).toContain("planLotReturnAllocations");
    expect(block).toContain('ctx.db.insert("returnLotAllocations"');
    expect(block).toContain("quantityAvailable: lot.quantityAvailable + allocation.quantity");
  });
  it("quarentena não aumenta o saldo disponível", () => {
    const start = returns.indexOf("if (!returnConditionReturnsToAvailableStock(condition))");
    const end = returns.indexOf("// 2) Repor estoque físico global", start);
    const block = returns.slice(start, end);
    expect(block).toContain("destino: quarentena; não incorporado ao saldo disponível");
    expect(block).not.toContain('ctx.db.patch(stock._id');
    expect(block).not.toContain('ctx.db.insert("stockByLocation"');
    expect(block).not.toContain("quantityAvailable: lot.quantityAvailable + allocation.quantity");
  });
  it("liberação de quarentena revalida ledger e audita inspeção", () => {
    const block = returns.slice(returns.indexOf("export const resolveQuarantine = mutation"));
    expect(block).toContain("assertProductLedgerConsistent(ctx, returned.productId, product.name)");
    expect(block).toContain('stockDisposition: args.disposition');
    expect(block).toContain("inspectedByUserId: userId");
    expect(block).toContain('ctx.db.insert("auditLogs"');
  });
  it("transferência exige conciliação e mantém global sem alteração", () => {
    const block = transfers.slice(transfers.indexOf("export const create = mutation"));
    expect(block).toContain("assertProductLedgerConsistent(ctx, args.productId, product.name)");
    expect(block).toContain("lotDoc.active === false");
    expect(block).toContain("quantityAvailable: lotLocationPlan!.sourceQuantityAfter");
    expect(block).toContain("quantityAvailable: lotLocationPlan!.destinationQuantityAfter");
    expect(block).toContain('type: "transfer"');
    expect(block).toContain("locationId: args.fromLocationId");
    expect(block).toContain("lotId: lotDoc?.lotNumber");
    expect(block).not.toContain('ctx.db.patch(globalStock._id, { physicalQuantity');
  });
  it("telas dão controle por lote de origem e armário", () => {
    const returnPage = readSource("pages/Returns.tsx");
    const transferPage = readSource("pages/StockTransfers.tsx");
    expect(returnPage).toContain("lotAllocations");
    expect(returnPage).toContain("Armário de destino");
    expect(returnPage).toContain("resolveQuarantine");
    expect(transferPage).toContain("api.lots.listActiveByProduct");
    expect(transferPage).toContain("Selecione o lote que será transferido");
    expect(transferPage).toContain("fromLocationId");
    expect(transferPage).toContain("toLocationId");
  });
});


describe("rastreabilidade de devoluções e transferências no ledger", () => {
  const schema = readSource("convex/schema.ts");
  const returns = readSource("convex/returns.ts");
  const transfers = readSource("convex/stockTransfers.ts");

  it("vincula a devolução disponível ao movimento reversor e preserva a área da saída", () => {
    const block = returns.slice(
      returns.indexOf("export const create = mutation"),
      returns.indexOf("export const resolveQuarantine = mutation"),
    );
    expect(block).toContain("areaId: exit.areaId");
    expect(block).toContain("returnId,");
    expect(block).toContain("const stockMovementId = await ctx.db.insert(\"stockMovements\"");
    expect(block).toContain("await ctx.db.patch(returnId, { stockMovementId })");
    expect(schema).toContain('stockMovementId: v.optional(v.id("stockMovements"))');
    expect(schema).toContain('returnId: v.optional(v.id("returns"))');
  });

  it("vincula a liberação da quarentena ao movimento e não cria movimento no descarte", () => {
    const block = returns.slice(returns.indexOf("export const resolveQuarantine = mutation"));
    expect(block).toContain("const stockMovementId = await ctx.db.insert(\"stockMovements\"");
    expect(block).toContain("await ctx.db.patch(args.returnId, { stockMovementId })");
    expect(block).toContain('args.disposition === "available"');
  });

  it("registra transferência com área, origem, destino e vínculo reversível ao movimento", () => {
    expect(transfers).toContain("areaId: lotDoc?.areaId");
    expect(transfers).toContain("transferId,");
    expect(transfers).toContain("fromLocationId: args.fromLocationId");
    expect(transfers).toContain("toLocationId: args.toLocationId");
    expect(transfers).toContain("await ctx.db.patch(transferId, { stockMovementId })");
    expect(schema).toContain('transferId: v.optional(v.id("stockTransfers"))');
    expect(schema).toContain('fromLocationId: v.optional(v.id("storageLocations"))');
    expect(schema).toContain('toLocationId: v.optional(v.id("storageLocations"))');
  });

  it("expõe a área nas consultas e nas telas de devolução e transferência", () => {
    expect(returns).toContain("const area: any = m.areaId ? await ctx.db.get(m.areaId) : null");
    expect(transfers).toContain("const area = t.areaId ? await ctx.db.get(t.areaId) : null");
    expect(readSource("pages/Returns.tsx")).toContain("<TableHead>Área</TableHead>");
    expect(readSource("pages/StockTransfers.tsx")).toContain("<TableHead>Área</TableHead>");
  });
});
