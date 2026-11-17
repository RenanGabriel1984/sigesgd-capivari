import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const backend = readFileSync(resolve(__dirname, "../convex/diagnostics.ts"), "utf8");
const start = backend.indexOf("export const stockMovementTraceabilityAuditInternal = internalQuery({");
const end = backend.indexOf("export const applyStockMovementLocationCorrectionsInternal =", start);
const block = backend.slice(start, end > start ? end : undefined);
const correctionStart = backend.indexOf("export const applyStockMovementLocationCorrectionsInternal = internalMutation({");
const correctionBlock = backend.slice(correctionStart);

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
    expect(block).toContain("missingProductMovements");
    expect(block).toContain("invalidEntryMovements");
  });

  it("separa evidência histórica da posição atual do lote", () => {
    expect(block).toContain("evidenceEntryIds");
    expect(block).toContain("entryItemLocationEvidence");
    expect(block).toContain("allocationLocationEvidence");
    expect(block).toContain("currentLotLocationSnapshot");
    expect(block).toContain("não deve ser tratada como localização histórica");
  });

  it("expõe divergências na soma das alocações sem corrigir registros", () => {
    expect(block).toContain("allocationQuantityMismatchMovements");
    expect(block).toContain("allocationQuantityMatchesMovement");
    expect(block).toContain("invalidAllocationReferences");
    expect(block).toContain("movementProductMatchesAllocation");
    expect(block).toContain("missingProductReference");
    expect(block).toContain("invalidEntryReference");
    expect(block).toContain("não grava dados");
  });
});


describe("correção controlada de localização histórica", () => {
  it("é uma mutação interna separada da consulta somente leitura", () => {
    expect(correctionStart).toBeGreaterThanOrEqual(0);
    expect(correctionBlock).toContain("internalMutation({");
  });

  it("exige confirmação explícita e exatamente 61 identificadores únicos", () => {
    expect(correctionBlock).toContain("APLICAR-61-CORRECOES-LOCALIZACAO");
    expect(correctionBlock).toContain("EXPECTED_COUNT = 61");
    expect(correctionBlock).toContain("new Set(expectedIds).size !== EXPECTED_COUNT");
  });

  it("revalida todos os candidatos antes do primeiro patch e aborta se a lista mudar", () => {
    const validation = correctionBlock.indexOf("const actualIds =");
    const firstPatch = correctionBlock.indexOf("ctx.db.patch(");
    expect(validation).toBeGreaterThanOrEqual(0);
    expect(firstPatch).toBeGreaterThan(validation);
    expect(correctionBlock).toContain("Nenhuma alteração foi aplicada");
  });

  it("altera somente a localização do movimento e grava auditoria individual", () => {
    expect(correctionBlock).toContain("ctx.db.patch(candidate.movement._id, { locationId: candidate.locationId })");
    expect(correctionBlock).toContain('ctx.db.insert("auditLogs"');
    expect(correctionBlock).toContain('entity: "stockMovement"');
    expect(correctionBlock).toContain('operation: "historical_location_backfill"');
    expect(correctionBlock).toContain("userId omitido deliberadamente");
  });

  it("mantém saídas, devoluções e transferências fora da correção automática", () => {
    expect(correctionBlock).toContain('movement.type !== "entry" && movement.type !== "adjustment"');
    expect(correctionBlock).toContain('["exit", "return", "transfer"]');
  });
});
