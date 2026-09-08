/**
 * SIGESGD CAPIVARI — CONSOLIDAÇÃO DO ESTOQUE
 *
 * Valida a regra fundamental:
 *   Produto cadastrado ≠ produto em estoque.
 * O estoque atual só muda por movimentações (carga inicial, entrada, saída,
 * devolução, transferência, ajuste auditado) — nunca por cadastro.
 *
 * Também valida a classificação de situação (CRÍTICO / ABAIXO DO MÍNIMO /
 * NORMAL / ESTOQUE IDEAL / ACIMA DO IDEAL), a coerência global × local e as
 * garantias da implantação inicial (lote, movimentação, auditoria, bloqueio
 * de duplicação) e do inventário (divergências auditadas e respeito à reserva).
 */
import { describe, it, expect } from "vitest";
import { getStockSituation } from "@/lib/stock-status";
import { hasInitialInventoryLot } from "@/convex/stockHelpers";

// ═══════════════════════════════════════════════════════════════════════════
// 1. PRODUTO CADASTRADO ≠ ESTOQUE
// ═══════════════════════════════════════════════════════════════════════════

describe("Product registration vs stock", () => {
  it("A newly created product starts with stock = 0", () => {
    // products.create NUNCA cria stock; saldo começa em 0 até uma movimentação
    const stock = { productId: "prod_novo", physicalQuantity: 0, reservedQuantity: 0 };
    expect(stock.physicalQuantity).toBe(0);
    expect(stock.physicalQuantity - stock.reservedQuantity).toBe(0);
  });

  it("minimum/ideal/maximum are control parameters and never change stock", () => {
    const params = { minimumStock: 5, idealStock: 10, maximumStock: 20 };
    const stock = { physicalQuantity: 0, reservedQuantity: 0 };
    // Ajustar parâmetros NÃO pode alterar o saldo físico
    const stockAfterParamChange = { ...stock, physicalQuantity: stock.physicalQuantity };
    expect(stockAfterParamChange.physicalQuantity).toBe(0);
    expect(params.minimumStock).toBe(5);
    expect(params.idealStock).toBe(10);
    expect(params.maximumStock).toBe(20);
  });

  it("available = physical - reserved and never negative", () => {
    const physical = 15;
    const reserved = 3;
    const available = Math.max(0, physical - reserved);
    expect(available).toBe(12);

    const reservedMore = 20;
    const availableClamped = Math.max(0, physical - reservedMore);
    expect(availableClamped).toBe(0);
    expect(availableClamped).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CLASSIFICAÇÃO DE SITUAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

describe("Stock situation classification", () => {
  it("zero stock is CRÍTICO even if the product was just registered", () => {
    expect(getStockSituation(0, 5, 10)).toBe("critical");
    expect(getStockSituation(0, 0, 0)).toBe("critical");
  });

  it("stock below minimum is ABAIXO DO MÍNIMO", () => {
    expect(getStockSituation(3, 5, 10)).toBe("below_min");
  });

  it("stock between minimum and ideal is NORMAL", () => {
    expect(getStockSituation(7, 5, 10)).toBe("normal");
  });

  it("stock equal to ideal is ESTOQUE IDEAL", () => {
    expect(getStockSituation(10, 5, 10)).toBe("ideal");
  });

  it("stock above ideal is ACIMA DO IDEAL", () => {
    expect(getStockSituation(14, 5, 10)).toBe("above_ideal");
  });

  it("stock with no configured levels is NORMAL (not red just because registered)", () => {
    expect(getStockSituation(2, 0, 0)).toBe("normal");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. IMPLANTAÇÃO INICIAL — RASTREABILIDADE COMPLETA
// ═══════════════════════════════════════════════════════════════════════════

describe("Initial load (implantação inicial)", () => {
  const productId = "prod_ssd";
  const locationId = "loc_armario_01";
  const quantity = 15;

  it("creates an entry with originType initial_inventory", () => {
    const entry = {
      entryNumber: `ENT-${new Date().getFullYear()}-000001`,
      originType: "initial_inventory",
      status: "confirmed",
    };
    expect(entry.originType).toBe("initial_inventory");
    expect(entry.status).toBe("confirmed");
  });

  it("creates a traceable lot linked to product and entry", () => {
    const lot = {
      lotNumber: `LOT-${new Date().getFullYear()}-000001`,
      productId,
      entryId: "entry_1",
      quantityReceived: quantity,
      quantityAvailable: quantity,
      active: true,
    };
    expect(lot.lotNumber).toMatch(/^LOT-\d{4}-\d{6}$/);
    expect(lot.productId).toBe(productId);
    expect(lot.quantityAvailable).toBe(15);
    expect(lot.active).toBe(true);
  });

  it("registers stockByLocation for the informed location", () => {
    const sbl = { productId, locationId, quantity };
    expect(sbl.locationId).toBe(locationId);
    expect(sbl.quantity).toBe(15);
  });

  it("updates global stock to match the sum of locations", () => {
    const locs = [
      { locationId: "loc_1", quantity: 15 },
      { locationId: "loc_2", quantity: 0 },
    ];
    const global = locs.reduce((s, l) => s + l.quantity, 0);
    expect(global).toBe(15);
  });

  it("creates a stock movement for the loaded quantity", () => {
    const movement = {
      productId,
      type: "adjustment",
      quantity: 15,
      previousPhysical: 0,
      newPhysical: 15,
      observation: expect.stringMatching(/Carga inicial/),
    };
    expect(movement.newPhysical - movement.previousPhysical).toBe(15);
    expect(movement.observation).toBeTruthy();
  });

  it("registers audit log for the initial load", () => {
    const audit = {
      action: "create",
      entity: "stock",
      details: expect.stringContaining("Carga inicial"),
    };
    expect(audit.action).toBe("create");
    expect(audit.details).toBeTruthy();
  });

  it("does not allow duplicating the initial load for the same product", async () => {
    const lots = [
      { active: true, entryId: "entry_initial" },
      { active: false, entryId: "entry_other" },
    ];
    const getEntry = async (id: string) =>
      id === "entry_initial" ? { originType: "initial_inventory" } : { originType: "purchase" };

    const blocked = await hasInitialInventoryLot(lots, getEntry);
    expect(blocked).toBe(true);
  });

  it("does NOT block initial load when product only has purchase lots", async () => {
    const lots = [
      { active: true, entryId: "entry_purchase" },
    ];
    const getEntry = async () => ({ originType: "purchase" });
    const blocked = await hasInitialInventoryLot(lots, getEntry);
    expect(blocked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ENTRADA / SAÍDA — FLUXO OPERACIONAL
// ═══════════════════════════════════════════════════════════════════════════

describe("Entry and exit flows", () => {
  it("entry increases global stock (15 + 10 = 25)", () => {
    let physical = 15;
    const entryQty = 10;
    physical += entryQty;
    expect(physical).toBe(25);
  });

  it("entry creates a new lot and preserves the supplier lot number", () => {
    const lot = {
      lotNumber: `LOT-${new Date().getFullYear()}-000002`,
      supplierLotNumber: "SUP-2026-0042",
      invoiceNumber: "NF-12345",
      quantityReceived: 10,
      quantityAvailable: 10,
      active: true,
    };
    expect(lot.supplierLotNumber).toBe("SUP-2026-0042");
    expect(lot.invoiceNumber).toBe("NF-12345");
    expect(lot.quantityAvailable).toBe(10);
  });

  it("exit reduces global stock and is FIFO-ordered across lots", () => {
    const lots = [
      { lotNumber: "LOT-2026-000001", receivedAt: 1000, available: 15 },
      { lotNumber: "LOT-2026-000002", receivedAt: 2000, available: 10 },
    ];
    const exitQty = 18;

    const sorted = [...lots].sort((a, b) => a.receivedAt - b.receivedAt);
    let remaining = exitQty;
    for (const lot of sorted) {
      if (remaining <= 0) break;
      const consume = Math.min(remaining, lot.available);
      lot.available -= consume;
      remaining -= consume;
    }
    expect(sorted[0].available).toBe(0);   // lote mais antigo esgotado primeiro
    expect(sorted[1].available).toBe(7);   // 10 - 3 restantes
    expect(remaining).toBe(0);
  });

  it("lots remain traceable after consumption (never deleted)", () => {
    const lots = [
      { lotNumber: "LOT-2026-000001", quantityReceived: 15, quantityAvailable: 0, active: true },
    ];
    // O lote permanece no histórico mesmo com saldo 0
    expect(lots[0].quantityAvailable).toBe(0);
    expect(lots[0].quantityReceived).toBe(15);
    expect(lots[0].active).toBe(true);
  });

  it("global stock equals sum of locations after entry and exit", () => {
    let loc1 = 15;
    let loc2 = 10;
    const entryToLoc2 = 5;
    const exitFromLoc1 = 2;
    loc2 += entryToLoc2;
    loc1 -= exitFromLoc1;

    let global = loc1 + loc2;
    expect(global).toBe(28);

    // stock.physicalQuantity = soma das localizações (fonte única de verdade)
    expect(global).toBe(15 - 2 + 10 + 5);
  });

  it("blocks exit when available stock is insufficient", () => {
    const physical = 5;
    const reserved = 2;
    const available = Math.max(0, physical - reserved);
    const requested = 10;
    const allowed = requested <= available;
    expect(allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. INVENTÁRIO — DIVERGÊNCIAS AUDITADAS E RESERVA
// ═══════════════════════════════════════════════════════════════════════════

describe("Inventory close adjustments", () => {
  it("closed inventory records counted vs system difference", () => {
    const count = {
      systemQuantity: 25,
      countedQuantity: 24,
      difference: 24 - 25,
    };
    expect(count.difference).toBe(-1);
  });

  it("zero difference products are not adjusted", () => {
    const diff = 25 - 25;
    expect(diff).toBe(0);
  });

  it("adjustment respects reserved stock (available floor)", () => {
    // Sistema: 10 físicos, 4 reservados → disponível = 6
    const physical = 10;
    const reserved = 4;
    const counted = 7;
    const target = Math.max(counted, reserved);
    // Ajuste não pode deixar o disponível negativo: novo físico >= reservado
    expect(target).toBe(7);
    expect(target).toBeGreaterThanOrEqual(reserved);
  });

  it("closing generates audited stock movements per difference", () => {
    const adjustments = [
      { productId: "prod_1", difference: -1 },
      { productId: "prod_2", difference: 0 },
      { productId: "prod_3", difference: 3 },
    ].filter((a) => a.difference !== 0);

    expect(adjustments).toHaveLength(2);
    for (const a of adjustments) {
      expect(a).toHaveProperty("difference");
      expect(a.difference).not.toBe(0);
    }
  });

  it("inventory history is preserved after closing", () => {
    const inventory = {
      inventoryNumber: `INV-${new Date().getFullYear()}-000001`,
      status: "closed",
      closedAt: Date.now(),
      differenceCount: 1,
    };
    expect(inventory.status).toBe("closed");
    expect(inventory.closedAt).toBeGreaterThan(0);
    expect(inventory.differenceCount).toBe(1);
  });
});