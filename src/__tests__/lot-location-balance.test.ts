import { describe, expect, it } from "vitest";
import { planLotLocationBalanceChange } from "../lib/lot-location-balance";

const base = {
  lotId: "lot_1",
  productId: "product_1",
  locationId: "location_1",
  quantityAvailable: 10,
  _id: "balance_1",
};

describe("planLotLocationBalanceChange", () => {
  it("ignora lotes legados sem localização física", () => {
    expect(planLotLocationBalanceChange({
      rows: [], lotId: "lot_1", productId: "product_1", delta: -2,
    })).toEqual({ kind: "skip" });
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
