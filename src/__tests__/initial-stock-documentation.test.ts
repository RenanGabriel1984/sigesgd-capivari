import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const inventoryCsv = readFileSync(
  resolve(__dirname, "../../docs/planilha-carga-inicial.csv"),
  "utf8",
);

type InventoryRow = {
  location: string;
  product: string;
  quantity: number;
  unit: string;
};

function parseInventory(csv: string): InventoryRow[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("A planilha oficial de carga inicial está vazia.");

  return lines.slice(1).map((line, index) => {
    // A observação pode conter ';'. Somente os cinco primeiros separadores
    // definem localização, produto, marca, quantidade e unidade.
    const fields = line.split(";");
    const quantity = Number(fields[3]?.trim());
    if (
      !fields[0]?.trim() ||
      !fields[1]?.trim() ||
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      !fields[4]?.trim()
    ) {
      throw new Error(`Linha inválida na planilha oficial: ${index + 2}`);
    }
    return {
      location: fields[0].trim(),
      product: fields[1].trim(),
      quantity,
      unit: fields[4].trim(),
    };
  });
}

const rows = parseInventory(inventoryCsv);

describe("documentação oficial da carga inicial dos armários", () => {
  it("preserva os 53 registros e a distribuição documental dos armários", () => {
    expect(rows).toHaveLength(53);
    expect(rows.filter((row) => row.location === "Armário TI 01")).toHaveLength(34);
    expect(rows.filter((row) => row.location === "Armário TI 02")).toHaveLength(19);
    expect(rows.every((row) =>
      ["Armário TI 01", "Armário TI 02"].includes(row.location),
    )).toBe(true);
  });

  it("preserva as quantidades documentadas por armário e no total", () => {
    const sum = (location: string) =>
      rows
        .filter((row) => row.location === location)
        .reduce((total, row) => total + row.quantity, 0);

    expect(sum("Armário TI 01")).toBe(2597);
    expect(sum("Armário TI 02")).toBe(206);
    expect(sum("Armário TI 01") + sum("Armário TI 02")).toBe(2803);
  });

  it("mantém kits como kits, sem converter peças em unidades avulsas", () => {
    expect(
      rows
        .filter((row) => row.product.startsWith("Jogo de chaves"))
        .map((row) => [row.product, row.quantity, row.unit]),
    ).toEqual([
      ["Jogo de chaves — 6 peças", 1, "kit"],
      ["Jogo de chaves — 8 peças", 1, "kit"],
    ]);
  });

  it("inclui o Toner Lexmark XM5365 no Armário TI 02", () => {
    expect(
      rows.filter((row) =>
        row.location === "Armário TI 02" &&
        row.product === "Toner Lexmark XM5365" &&
        row.quantity === 1 &&
        row.unit === "un",
      ),
    ).toHaveLength(1);
  });
});
