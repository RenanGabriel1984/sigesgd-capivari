import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIAG = readFileSync(resolve(__dirname, "../convex/diagnostics.ts"), "utf8");

describe("SIGESGD — Limpeza de dados de teste (SSD) e categorias", () => {
  it("LC-01: limpeza exige confirmação literal CLEANUP-SSD-TESTE", () => {
    expect(DIAG).toContain('args.confirm !== "CLEANUP-SSD-TESTE"');
  });

  it("LC-02: limpeza aborta se ENT-2026-000001 não existir", () => {
    expect(DIAG).toContain("limpeza abortada");
  });

  it("LC-03: limpeza recusa SSD com lote da carga oficial", () => {
    expect(DIAG).toContain("possui lote da carga oficial. Limpeza abortada.");
  });

  it("LC-04: preview mapeia todos os vínculos antes de apagar", () => {
    expect(DIAG).toContain("testCleanupPreviewInternal");
    expect(DIAG).toContain("testAuditLogsCount");
    expect(DIAG).toContain("testRequestItemsCount");
  });

  it("LC-05: desativação de categorias exige confirmação literal", () => {
    expect(DIAG).toContain('args.confirm !== "DESATIVAR-CATEGORIAS"');
  });

  it("LC-06: normalização numérica é idempotente com dry-run", () => {
    expect(DIAG).toContain("dryRun: v.optional(v.boolean())");
    expect(DIAG).toContain("args.dryRun !== true");
  });

  it("LC-07: smoke test das telas existe e valida datas + saldos", () => {
    expect(DIAG).toContain("screensSmokeTestInternal");
    expect(DIAG).toContain("datasValidas");
    expect(DIAG).toContain("negativos");
  });

  it("LC-08: nenhum resultado usa chaves de objeto com acentos (serialização Convex)", () => {
    // Chaves dinâmicas com acento quebram convexToJson (ex.: "Armário TI 01").
    // O smoke test deve retornar locations como array [{name, quantity}].
    expect(DIAG).toContain("locations: Array.from(perLocation.entries())");
    expect(DIAG).not.toMatch(/perLocation\[[a-zA-Z]/);
  });

  it("LC-09: reconciliation nunca altera reservedQuantity", () => {
    const start = DIAG.indexOf("async function reconcileCore");
    const end = DIAG.indexOf("export const environmentCheckInternal");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = DIAG.slice(start, end);
    expect(section).toContain("physicalQuantity: byLocation");
    // Nenhum patch toca reservedQuantity (só leituras/Number(...))
    expect(section).not.toMatch(/patch\([^)]*\{[^}]*reservedQuantity/);
  });

  it("LC-10: log da limpeza registra contagem de objetos deletados", () => {
    expect(DIAG).toContain("Limpeza de dados de teste SSD");
    expect(DIAG).toContain("Carga oficial ENT-2026-000001 preservada integralmente");
  });
});
