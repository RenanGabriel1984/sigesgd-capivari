/**
 * Gestão de Estoque SGGD — RASTREABILIDADE Entrada → EntryItem → Lote → Movimentação
 *
 * O `entries.confirm` criava o lote mas NÃO gravava o `lotId` de volta no
 * `entryItem`. Na NF 372043 isso deixou os 8 itens sem vínculo com o lote que
 * eles geraram (enquanto a carga inicial ENT-2026-000001 tinha o vínculo).
 *
 * A chain completa deve ser:
 *   Entrada → EntryItem → Lote → StockMovement
 *
 * Este teste é de NÍVEL DE FONTE: verifica o comportamento da mutation
 * `entries.confirm` lendo o próprio módulo que a implementa. Não escreve no
 * banco e não depende do runtime Convex.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENTRIES_SOURCE = readFileSync(
  resolve(__dirname, "../convex/entries.ts"),
  "utf8",
);

/** Extrai o corpo da mutation `confirm` para análise focada. */
function extractConfirmBody(): string {
  const start = ENTRIES_SOURCE.indexOf("export const confirm = mutation(");
  expect(start).toBeGreaterThan(-1);

  // A mutation `confirm` termina na próxima declaração `export const`.
  const next = ENTRIES_SOURCE.indexOf("\nexport const ", start + 1);
  return ENTRIES_SOURCE.slice(start, next === -1 ? undefined : next);
}

describe("entries.confirm: cadeia de rastreabilidade completa", () => {
  const body = extractConfirmBody();

  it("captura o ID do lote criado (não apenas o insert)", () => {
    // O insert precisa ser atribuído a uma variável para poder ser gravado
    // no entryItem.
    expect(body).toMatch(/const\s+lotId\s*=\s*await\s+ctx\.db\.insert\(\s*"lots"/);
  });

  it("persiste o lotId no entryItem correspondente", () => {
    // Back-patch: EntryItem → Lote.
    expect(body).toMatch(/await\s+ctx\.db\.patch\(\s*item\._id\s*,\s*\{\s*lotId/);
  });

  it("o back-patch ocorre DEPOIS de criar o lote (usa o lote real)", () => {
    const insertIdx = body.indexOf('ctx.db.insert("lots"');
    const patchIdx = body.search(/ctx\.db\.patch\(\s*item\._id/);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(insertIdx);
  });

  it("o lotId persistido é o do lote criado (não um lotNumber)", () => {
    const patch = body.match(/ctx\.db\.patch\(\s*item\._id\s*,\s*\{\s*lotId:\s*([^}]+)\}/);
    expect(patch).not.toBeNull();
    // Precisa ser o lotId capturado, não o número textual do lote.
    expect(patch![1]).toMatch(/lotId/);
    expect(patch![1]).not.toMatch(/lotNumber/);
  });

  it("a área da entrada continua propagada para o lote", () => {
    expect(body).toMatch(/areaId:\s*entry\.areaId/);
  });

  it("o tipo de material da entrada continua propagado para o lote", () => {
    expect(body).toMatch(/materialType:\s*entry\.materialType/);
  });

  it("a movimentação de entrada referencia o lote criado", () => {
    // Lote → StockMovement.
    expect(body).toMatch(/type:\s*"entry"/);
    expect(body).toMatch(/lotId:\s*lotNumber/);
    expect(body).toMatch(/entryId:\s*args\.entryId/);
  });

  it("o back-patch NÃO altera quantidade nem localização do item", () => {
    const patch = body.match(/ctx\.db\.patch\(\s*item\._id\s*,\s*\{\s*lotId[^}]*\}/);
    expect(patch).not.toBeNull();
    // O patch do entryItem toca SOMENTE em lotId.
    expect(patch![0]).not.toMatch(/quantity/i);
    expect(patch![0]).not.toMatch(/locationId/i);
  });
});

describe("entries.create: materialType nunca é rebaixado", () => {
  it("preserva 'permanent' quando o usuário escolheu material permanente", () => {
    const insert = ENTRIES_SOURCE.match(
      /await\s+ctx\.db\.insert\(\s*"entries"\s*,\s*\{[\s\S]*?\}\s*\)/,
    );
    expect(insert).not.toBeNull();
    // O default só pode ser aplicado quando o valor é AUSENTE (??), nunca
    // quando o valor enviado é "permanent".
    expect(insert![0]).toMatch(/materialType:\s*args\.materialType\s*\?\?\s*"consumption"/);
    // E não existe um ternário que converta "permanent" em "consumption".
    expect(insert![0]).not.toMatch(/===?\s*"permanent"\s*\?\s*"consumption"/);
  });
});

describe("entradas antigas: o patch do entryItem é aditivo", () => {
  it("não há remoção/limpeza de entryItems em confirm", () => {
    const body = extractConfirmBody();
    expect(body).not.toMatch(/ctx\.db\.delete\("entryItems"/);
    expect(body).not.toMatch(/ctx\.db\.delete\("lots"/);
  });

  it("confirm não altera entradas antigas sem passar por status draft", () => {
    // A mutation já exige status "draft"; nada percorre a carga inicial.
    const body = extractConfirmBody();
    expect(body).toMatch(/if\s*\(entry\.status\s*!==\s*"draft"\)/);
  });
});
