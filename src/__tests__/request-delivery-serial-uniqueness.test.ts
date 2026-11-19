import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("entrega de solicitações — identificadores seriais", () => {
  it("rejeita números de série/patrimônio repetidos ignorando espaços e caixa", () => {
    const source = readFileSync(resolve(__dirname, "../convex/requests.ts"), "utf8");
    const start = source.indexOf("export const deliver =");
    const end = source.indexOf("\nexport const ", start + 1);
    const mutation = source.slice(start, end === -1 ? undefined : end);

    expect(mutation).toContain("const seenSerialNumbers = new Set<string>()");
    expect(mutation).toContain('serial.trim().toLocaleLowerCase("pt-BR")');
    expect(mutation).toContain("seenSerialNumbers.has(normalized)");
    expect(mutation).toContain("está duplicado nesta entrega");

    const validation = mutation.indexOf("seenSerialNumbers.has(normalized)");
    const firstWrite = mutation.search(/ctx\.db\.(insert|patch)\(/);
    expect(validation).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(validation);
  });
});


describe("entrega de solicitação legada — estado do lote após consumo", () => {
  it("atualiza active conforme o saldo remanescente do lote", () => {
    const source = readFileSync(resolve(__dirname, "../convex/requests.ts"), "utf8");
    const start = source.indexOf("export const deliver = mutation({");
    const end = source.indexOf("\\nexport const ", start + 1);
    const mutation = source.slice(start, end === -1 ? undefined : end);
    expect(mutation).toContain("const nextLotQuantity = lot.quantityAvailable - consume");
    expect(mutation).toContain("active: nextLotQuantity > 0");
  });
});
