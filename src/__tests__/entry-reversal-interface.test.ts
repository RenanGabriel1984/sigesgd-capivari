import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const page = readFileSync(resolve(ROOT, "src/pages/Entries.tsx"), "utf-8");

describe("interface de estorno de entradas", () => {
  it("diferencia visualmente entradas confirmadas, rascunhos e estornadas", () => {
    expect(page).toContain('entry.status === "confirmed"');
    expect(page).toContain('entry.status === "reversed"');
    expect(page).toContain('"Estornada"');
    expect(page).toContain('"Confirmada"');
    expect(page).toContain('"Rascunho"');
  });

  it("oferece estorno somente para entradas confirmadas", () => {
    expect(page).toContain(') : entry.status === "confirmed" ? (');
    expect(page).toContain("setEntryToReverse({");
    expect(page).toContain("<RotateCcw");
    expect(page).toContain("Estornar");
  });

  it("exige justificativa e impede envio vazio ou repetido", () => {
    expect(page).toContain("if (!reason) {");
    expect(page).toContain("disabled={reversingEntry || !reverseReason.trim()}");
    expect(page).toContain("setReversingEntry(true)");
    expect(page).toContain("setReversingEntry(false)");
    expect(page).toContain("reverseEntry({ entryId: entryToReverse.id as any, reason })");
  });

  it("apresenta as condições de bloqueio antes da confirmação", () => {
    expect(page).toContain("lote tiver sido consumido ou reservado");
    expect(page).toContain("localização original não puder ser identificada");
    expect(page).toContain("unidade já tombada/vinculada ao Patrimônio");
  });

  it("mantém o diálogo aberto em caso de falha e informa a mensagem do backend", () => {
    expect(page).toContain("error instanceof Error");
    expect(page).toContain("Nenhuma alteração foi confirmada.");
    expect(page).toContain("setEntryToReverse(null)");
  });
});
