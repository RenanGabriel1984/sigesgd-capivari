import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const transfers = readFileSync(
  resolve(__dirname, "../convex/stockTransfers.ts"),
  "utf-8",
);
const createStart = transfers.indexOf("export const create = mutation({");
const create = transfers.slice(createStart);

describe("integridade de transferências de estoque", () => {
  it("bloqueia materiais permanentes/serializados em movimentação agregada", () => {
    expect(create).toContain("product.hasSerial");
    expect(create).toContain('lot.materialType === "permanent"');
    expect(create).toContain("cadastro individual de equipamentos");
  });

  it("não aceita saldos duplicados de origem ou destino", () => {
    expect(create).toContain("sourceRows.length !== 1");
    expect(create).toContain("destinationRows.length > 1");
  });

  it("confere saldos físicos de origem e destino com os lotes", () => {
    expect(create).toContain("sourceLotTotal");
    expect(create).toContain("destinationLotTotal");
    expect(create).toContain("diverge dos lotes registrados");
  });

  it("rejeita reservas órfãs, inválidas ou incompatíveis com o lote", () => {
    expect(create).toContain("Há reserva inválida ou sem lote correspondente");
    expect(create).toContain("reservation.areaId !== lot.areaId");
    expect(create).toContain("remaining > Number(lot.quantityAvailable)");
  });
});
