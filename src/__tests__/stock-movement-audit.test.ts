import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const backend = readFileSync(resolve(__dirname, "../convex/diagnostics.ts"), "utf8");
const start = backend.indexOf("export const stockMovementTraceabilityAuditInternal = internalQuery({");
const block = backend.slice(start);

describe("auditoria histórica de rastreabilidade das movimentações", () => {
  it("é uma consulta interna e somente leitura", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain("internalQuery({");
    for (const write of ["insert", "patch", "replace", "delete"]) {
      expect(block).not.toContain(`ctx.db.${write}(`);
    }
  });

  it("identifica movimentos sem local e referências inválidas", () => {
    expect(block).toContain("missingLocationMovements");
    expect(block).toContain("invalidLocationMovements");
    expect(block).toContain("missingLocationByType");
    expect(block).toContain("recordedLocationReferenceValid");
  });

  it("confere lote, produto, entrada e usuário sem presumir correspondência", () => {
    expect(block).toContain("ambiguous_requires_review");
    expect(block).toContain("unresolvedLotMovements");
    expect(block).toContain("productLotMismatchMovements");
    expect(block).toContain("entryLotMismatchMovements");
    expect(block).toContain("missingUserMovements");
  });

  it("separa evidência histórica da posição atual do lote", () => {
    expect(block).toContain("entryItemLocationEvidence");
    expect(block).toContain("allocationLocationEvidence");
    expect(block).toContain("currentLotLocationSnapshot");
    expect(block).toContain("não deve ser tratada como localização histórica");
  });

  it("expõe divergências na soma das alocações sem corrigir registros", () => {
    expect(block).toContain("allocationQuantityMismatchMovements");
    expect(block).toContain("allocationQuantityMatchesMovement");
    expect(block).toContain("não grava dados");
  });
});
