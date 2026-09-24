import { describe, expect, it } from "vitest";
import {
  PATRIMONY_STATUS_LABELS,
  isPermanent,
  unitsSectionLabel,
  validateEntryUnits,
  type PatrimonyUnitDraft,
} from "@/lib/material-types";

describe("MATERIAL-01..08", () => {
  it("MATERIAL-01: consumível é registrado sem exigir patrimônio individual", () => {
    expect(validateEntryUnits({ materialType: "consumption", quantity: 90, units: [] })).toBeNull();
  });

  it("MATERIAL-02: permanente é classificado e validado separadamente", () => {
    expect(isPermanent("permanent")).toBe(true);
    expect(validateEntryUnits({ materialType: "permanent", quantity: 1, units: [{ patrimonyNumber: "100001" }] })).toBeNull();
  });

  it("MATERIAL-03: permanente permite uma unidade individual por quantidade", () => {
    const units = [{ patrimonyNumber: "100001" }, { patrimonyNumber: "100002" }, { patrimonyNumber: "100003" }];
    expect(validateEntryUnits({ materialType: "permanent", quantity: 3, units })).toBeNull();
    expect(unitsSectionLabel(3)).toContain("(3)");
  });

  it("MATERIAL-04: duas unidades do mesmo produto podem ter patrimônios diferentes", () => {
    const units: PatrimonyUnitDraft[] = [
      { patrimonyNumber: "100001", serialNumber: "AAA111" },
      { patrimonyNumber: "100002", serialNumber: "BBB222" },
    ];
    expect(new Set(units.map((unit) => unit.patrimonyNumber)).size).toBe(2);
    expect(validateEntryUnits({ materialType: "permanent", quantity: 2, units })).toBeNull();
  });

  it("MATERIAL-05: serial é individual e opcional, mas preservado por unidade", () => {
    const units: PatrimonyUnitDraft[] = [
      { patrimonyNumber: "100001", serialNumber: "SER-A" },
      { patrimonyNumber: "100002", serialNumber: "SER-B" },
    ];
    expect(units.map((unit) => unit.serialNumber)).toEqual(["SER-A", "SER-B"]);
  });

  it("MATERIAL-06: patrimônio não pertence ao produto global", () => {
    const product = { id: "switch-tp-link", name: "Switch TP-Link", hasSerial: true };
    const units = [
      { productId: product.id, patrimonyNumber: "100001" },
      { productId: product.id, patrimonyNumber: "100002" },
    ];
    expect(product).not.toHaveProperty("patrimonyNumber");
    expect(units.every((unit) => unit.productId === product.id && unit.patrimonyNumber)).toBe(true);
  });

  it("MATERIAL-07: classificação não altera nem recalcula a quantidade física", () => {
    const stock = { physicalQuantity: 10, reservedQuantity: 2 };
    const quantity = 10;
    validateEntryUnits({ materialType: "permanent", quantity, units: Array.from({ length: 10 }, (_, i) => ({ patrimonyNumber: String(100001 + i) })) });
    expect(quantity).toBe(10);
    expect(stock).toEqual({ physicalQuantity: 10, reservedQuantity: 2 });
    expect(stock.physicalQuantity - stock.reservedQuantity).toBe(8);
  });

  it("MATERIAL-08: campos contábeis são apenas registrados e nenhuma depreciação é calculada", () => {
    const unit: PatrimonyUnitDraft = {
      patrimonyNumber: "100001",
      acquisitionValue: "1000",
      accountingValue: "900",
      residualValue: "100",
      accumulatedDepreciation: "100",
      netBookValue: "900",
      patrimonyStatus: "in_stock",
    };
    const snapshot = JSON.parse(JSON.stringify(unit));
    expect(unit).toEqual(snapshot);
    expect(unit.acquisitionValue).toBe("1000");
    expect(PATRIMONY_STATUS_LABELS.in_stock).toBe("Em estoque");
    expect(PATRIMONY_STATUS_LABELS.disposed).toBe("Baixado");
    expect(PATRIMONY_STATUS_LABELS).not.toHaveProperty("auctioned");
  });
});
