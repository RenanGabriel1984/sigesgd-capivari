import { describe, expect, it } from "vitest";
import {
  assertLotLocationBalanceMatchesExpected,
  inspectLotLocationBalances,
  planLotLocationBalanceChange,
  planLotLocationBalanceLocationChange,
} from "../lib/lot-location-balance";

const base = {
  lotId: "lot_1",
  productId: "product_1",
  locationId: "location_1",
  quantityAvailable: 10,
  _id: "balance_1",
};

describe("planLotLocationBalanceChange", () => {
  it("ignora lotes legados sem localização física, mas ainda valida a variação", () => {
    expect(planLotLocationBalanceChange({
      rows: [], lotId: "lot_1", productId: "product_1", delta: -2,
    })).toEqual({ kind: "skip" });
    expect(() => planLotLocationBalanceChange({
      rows: [], lotId: "lot_1", productId: "product_1", delta: Number.NaN,
    })).toThrow(/finita/);
  });

  it("cria saldo somente quando a operação declara que o lote é novo", () => {
    expect(planLotLocationBalanceChange({
      rows: [], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", delta: 10, allowCreate: true,
    })).toEqual({ kind: "insert", quantityAvailable: 10 });
    expect(() => planLotLocationBalanceChange({
      rows: [], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", delta: 10,
    })).toThrow(/não existe/);
  });

  it("impede baixa sem saldo mapeado", () => {
    expect(() => planLotLocationBalanceChange({
      rows: [], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", delta: -1,
    })).toThrow(/não tem saldo/);
  });

  it("atualiza um vínculo existente sem alterar a localização", () => {
    expect(planLotLocationBalanceChange({
      rows: [base], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", delta: -3,
    })).toEqual({ kind: "patch", rowId: "balance_1", quantityAvailable: 7 });
  });

  it("bloqueia saldo negativo, duplicidade e vínculo de produto/local divergente", () => {
    expect(() => planLotLocationBalanceChange({
      rows: [base], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", delta: -11,
    })).toThrow(/negativo/);
    expect(() => planLotLocationBalanceChange({
      rows: [base, { ...base, _id: "balance_2" }],
      lotId: "lot_1", productId: "product_1", locationId: "location_1", delta: -1,
    })).toThrow(/duplicados/);
    expect(() => planLotLocationBalanceChange({
      rows: [base], lotId: "lot_1", productId: "product_1",
      locationId: "location_2", delta: -1,
    })).toThrow(/não corresponde/);
  });

  it("rejeita variações não finitas e saldos atuais inválidos", () => {
    expect(() => planLotLocationBalanceChange({
      rows: [base], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", delta: Number.NaN,
    })).toThrow(/finita/);
    expect(() => planLotLocationBalanceChange({
      rows: [{ ...base, quantityAvailable: Number.NaN }],
      lotId: "lot_1", productId: "product_1", locationId: "location_1", delta: 1,
    })).toThrow(/inválido/);
  });
});

describe("planLotLocationBalanceLocationChange", () => {
  it("move apenas a localização do vínculo, preservando a quantidade", () => {
    expect(planLotLocationBalanceLocationChange({
      rows: [base], lotId: "lot_1", productId: "product_1",
      locationId: "location_2", quantityAvailable: 10,
    })).toEqual({
      kind: "patch", rowId: "balance_1",
      locationId: "location_2", quantityAvailable: 10,
    });
  });

  it("cria o vínculo somente em classificação explícita e bloqueia divergências", () => {
    expect(planLotLocationBalanceLocationChange({
      rows: [], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", quantityAvailable: 4, allowCreate: true,
    })).toEqual({ kind: "insert", locationId: "location_1", quantityAvailable: 4 });
    expect(() => planLotLocationBalanceLocationChange({
      rows: [], lotId: "lot_1", productId: "product_1",
      locationId: "location_1", quantityAvailable: 4,
    })).toThrow(/não existe/);
    expect(() => planLotLocationBalanceLocationChange({
      rows: [base], lotId: "lot_1", productId: "product_1",
      locationId: "location_2", quantityAvailable: 9,
    })).toThrow(/diverge/);
  });
});

describe("inspectLotLocationBalances", () => {
  const lot = {
    _id: "lot_1",
    productId: "product_1",
    lotNumber: "LOT-001",
    quantityAvailable: 10,
    locationId: "location_1",
    active: true,
  };
  const row = {
    _id: "balance_1",
    lotId: "lot_1",
    productId: "product_1",
    locationId: "location_1",
    quantityAvailable: 10,
  };

  it("confirma correspondência exata entre lote e vínculo derivado", () => {
    expect(inspectLotLocationBalances([lot], [row])).toEqual({
      consistent: true,
      fullyReconciled: true,
      checkedLots: 1,
      checkedRows: 1,
      matchedLots: 1,
      issues: [],
      limitations: [],
    });
  });

  it("detecta divergência de quantidade, produto e localização", () => {
    const result = inspectLotLocationBalances(
      [lot],
      [{ ...row, productId: "product_2", locationId: "location_2", quantityAvailable: 8 }],
    );
    expect(result.consistent).toBe(false);
    expect(result.fullyReconciled).toBe(false);
    expect(result.issues.join(" ")).toContain("outro produto");
    expect(result.issues.join(" ")).toContain("localização registrada");
    expect(result.issues.join(" ")).toContain("diverge do saldo atual");
  });

  it("detecta duplicidades de vínculo por lote", () => {
    const result = inspectLotLocationBalances([lot], [
      row,
      { ...row, _id: "balance_2" },
    ]);
    expect(result.issues.join(" ")).toContain("vínculos lote × local duplicados");
    expect(result.fullyReconciled).toBe(false);
  });

  it("detecta vínculos órfãos, saldos inválidos e lotes inativos com saldo", () => {
    const result = inspectLotLocationBalances(
      [{ ...lot, active: false }],
      [
        { ...row, quantityAvailable: -1 },
        { ...row, _id: "balance_orphan", lotId: "lot_missing" },
      ],
    );
    expect(result.issues.join(" ")).toContain("saldo lote × local");
    expect(result.issues.join(" ")).toContain("lote inexistente");
    expect(result.issues.join(" ")).toContain("inativo com saldo positivo");
  });

  it("trata lote legado sem localização e sem vínculo como limitação, sem inventar armário", () => {
    const result = inspectLotLocationBalances(
      [{ ...lot, locationId: undefined }],
      [],
    );
    expect(result.consistent).toBe(true);
    expect(result.fullyReconciled).toBe(false);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0]).toContain("sem localização atual explícita");
  });

  it("identifica lote positivo com localização explícita e sem vínculo como inconsistência", () => {
    const result = inspectLotLocationBalances([lot], []);
    expect(result.consistent).toBe(false);
    expect(result.issues.join(" ")).toContain("não possui vínculo lote × local");
  });
});

describe("assertLotLocationBalanceMatchesExpected", () => {
  it("permite a variação quando o saldo derivado coincide com o lote", () => {
    expect(() => assertLotLocationBalanceMatchesExpected({
      rows: [base],
      lotId: "lot_1",
      expectedQuantityBefore: 10,
    })).not.toThrow();
  });

  it("bloqueia divergência de quantidade antes da movimentação", () => {
    expect(() => assertLotLocationBalanceMatchesExpected({
      rows: [{ ...base, quantityAvailable: 8 }],
      lotId: "lot_1",
      expectedQuantityBefore: 10,
    })).toThrow(/diverge do saldo do lote/);
  });

  it("bloqueia ausência de vínculo para lote que já possui saldo", () => {
    expect(() => assertLotLocationBalanceMatchesExpected({
      rows: [],
      lotId: "lot_1",
      expectedQuantityBefore: 10,
    })).toThrow(/já possui saldo/);
  });

  it("aceita ausência de vínculo somente quando o saldo anterior esperado é zero", () => {
    expect(() => assertLotLocationBalanceMatchesExpected({
      rows: [],
      lotId: "lot_1",
      expectedQuantityBefore: 0,
    })).not.toThrow();
  });

  it("bloqueia vínculos duplicados e saldos esperados inválidos", () => {
    expect(() => assertLotLocationBalanceMatchesExpected({
      rows: [base, { ...base, _id: "balance_2" }],
      lotId: "lot_1",
      expectedQuantityBefore: 10,
    })).toThrow(/duplicados/);
    expect(() => assertLotLocationBalanceMatchesExpected({
      rows: [base],
      lotId: "lot_1",
      expectedQuantityBefore: Number.NaN,
    })).toThrow(/esperado do lote/);
  });
});
