/**
 * SIGESGD CAPIVARI — ESTOQUE DE IMPLANTAÇÃO (data 15/09/2026)
 *
 * A carga inicial (originType "initial_inventory", 53 itens físicos) é o
 * ESTOQUE DE IMPLANTAÇÃO do SIGESGD. A partir da implantação o sistema opera
 * normalmente sobre esse saldo: saídas consomem os lotes e novos recebimentos
 * entram como Entrada de Material.
 *
 * Estes testes garantem que a revisão operacional é:
 *  SI-01..SI-06 — carimbo de implantação: data, texto, idempotência e
 *                 preservação da observação original (funções puras);
 *  SI-07..SI-10 — ligação no pipeline de carga inicial e no utilitário interno;
 *  SI-11..SI-12 — o ajuste é SOMENTE de metadados: nenhuma escrita em estoque,
 *                 lotes, saldos por localização ou movimentações;
 *  SI-13..SI-14 — interface exibe a implantação (Estoque e Entradas).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyImplementationStockStamp,
  IMPLEMENTATION_STOCK_DATE,
  IMPLEMENTATION_STOCK_STAMP,
  isImplementationStockStamped,
} from "@/convex/stockHelpers";

const root = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(root, p), "utf-8");

/** Corpo de `async function NOME(` até a chave de fechamento na coluna 0. */
function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  const end = src.indexOf("\n}", start);
  return src.slice(start, end === -1 ? src.length : end);
}

/** Corpo de `export const NOME = <kind>({` até o `\n});` final. */
function convexFunctionBody(src: string, declaration: string): string {
  const start = src.indexOf(declaration);
  if (start === -1) return "";
  const end = src.indexOf("\n});", start);
  return src.slice(start, end === -1 ? src.length : end);
}

// ═══════════════════════════════════════════════════════════════════════════
// SI-01..SI-06. CARIMBO DE IMPLANTAÇÃO (funções puras)
// ═══════════════════════════════════════════════════════════════════════════

describe("SI — carimbo de estoque de implantação", () => {
  it("SI-01: data de implantação é 15/09/2026", () => {
    expect(IMPLEMENTATION_STOCK_DATE).toBe("15/09/2026");
  });

  it("SI-02: carimbo identifica o estoque de implantação do SIGESGD", () => {
    expect(IMPLEMENTATION_STOCK_STAMP).toContain("ESTOQUE DE IMPLANTAÇÃO DO SIGESGD");
    expect(IMPLEMENTATION_STOCK_STAMP).toContain(IMPLEMENTATION_STOCK_DATE);
  });

  it("SI-03: preserva a observação original e acrescenta o carimbo", () => {
    const original = "Importação da planilha de inventário físico";
    const stamped = applyImplementationStockStamp(original);
    expect(stamped.startsWith(original)).toBe(true);
    expect(stamped).toContain(IMPLEMENTATION_STOCK_STAMP);
    expect(stamped).not.toBe(original);
  });

  it("SI-04: observação ausente/vazia recebe apenas o carimbo", () => {
    expect(applyImplementationStockStamp(undefined)).toBe(IMPLEMENTATION_STOCK_STAMP);
    expect(applyImplementationStockStamp("")).toBe(IMPLEMENTATION_STOCK_STAMP);
    expect(applyImplementationStockStamp("   ")).toBe(IMPLEMENTATION_STOCK_STAMP);
  });

  it("SI-05: carimbo é idempotente (aplicar duas vezes não duplica)", () => {
    const once = applyImplementationStockStamp("Carga inicial — 53 itens");
    const twice = applyImplementationStockStamp(once);
    expect(twice).toBe(once);
    expect(once.match(/ESTOQUE DE IMPLANTAÇÃO DO SIGESGD/g)).toHaveLength(1);
  });

  it("SI-06: detecção do carimbo em observações", () => {
    expect(isImplementationStockStamped(undefined)).toBe(false);
    expect(isImplementationStockStamped("Carga inicial de estoque")).toBe(false);
    expect(isImplementationStockStamped(applyImplementationStockStamp("x"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SI-07..SI-10. LIGAÇÃO NO PIPELINE DE CARGA INICIAL
// ═══════════════════════════════════════════════════════════════════════════

describe("SI — carga inicial tratada como implantação", () => {
  it("SI-07: performInitialLoad carimba a entrada de carga inicial", () => {
    const body = functionBody(read("convex/stockSetup.ts"), "async function performInitialLoad(");
    expect(body).toContain('originType: "initial_inventory"');
    expect(body).toContain("applyImplementationStockStamp(observation)");
  });

  it("SI-08: utilitário interno carimba a carga inicial existente com confirmação explícita", () => {
    const src = read("convex/opsGoLive.ts");
    expect(src).toContain("export const stampImplementationStock = internalMutation({");
    const body = convexFunctionBody(src, "export const stampImplementationStock = internalMutation({");
    expect(body).toContain('v.literal("ESTOQUE-DE-IMPLANTACAO")');
    expect(body).toContain('e.originType === "initial_inventory"');
    expect(body).toContain("applyImplementationStockStamp(entry.observation)");
    expect(body).toContain("isImplementationStockStamped(entry.observation)");
  });

  it("SI-09: carimbo é função interna (sem rota pública para o cliente)", () => {
    const src = read("convex/opsGoLive.ts");
    expect(src).not.toMatch(/export const stampImplementationStock = mutation\(/);
    expect(src).not.toMatch(/export const stampImplementationStock = query\(/);
  });

  it("SI-10: validação de implantação é somente leitura e exige autenticação", () => {
    const src = read("convex/stockSetup.ts");
    const body = convexFunctionBody(src, "export const implementationStockStatus = query({");
    expect(body).not.toBe("");
    expect(body).toContain("await requireUser(ctx)");
    expect(body).not.toContain("ctx.db.insert(");
    expect(body).not.toContain("ctx.db.patch(");
    expect(body).not.toContain("ctx.db.delete(");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SI-11..SI-12. AJUSTE APENAS DE METADADOS (INTEGRIDADE PRESERVADA)
// ═══════════════════════════════════════════════════════════════════════════

describe("SI — ajuste não altera saldo, lotes nem movimentações", () => {
  it("SI-11: carimbo não toca estoque, lotes, localizações ou movimentações", () => {
    const body = convexFunctionBody(
      read("convex/opsGoLive.ts"),
      "export const stampImplementationStock = internalMutation({"
    );
    for (const table of ["stock", "lots", "stockByLocation", "stockMovements", "entryItems", "products"]) {
      expect(body).not.toContain(`"${table}"`);
    }
    // A alteração é de observação da entrada + auditoria.
    expect(body).toContain('"auditLogs"');
    expect(body).toContain('action: "update"');
  });

  it("SI-12: carga inicial continua sendo protegida contra duplicação", () => {
    const src = read("convex/stockSetup.ts");
    expect(src).toContain("hasInitialInventoryLot");
    const body = functionBody(src, "async function performInitialLoad(");
    expect(body).toContain("já possui carga inicial confirmada");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SI-13..SI-14. INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

describe("SI — interface exibe o estoque de implantação", () => {
  it("SI-13: tela de Estoque mostra data, itens e conferência de saldos", () => {
    const src = read("pages/Stock.tsx");
    expect(src).toContain("api.stockSetup.implementationStockStatus");
    expect(src).toContain("Estoque de implantação");
    expect(src).toContain("implementationDate");
  });

  it("SI-14: tela de Entradas rotula a carga inicial como estoque de implantação", () => {
    const src = read("pages/Entries.tsx");
    expect(src).toContain("IMPLEMENTATION_STOCK_DATE");
    expect(src).toContain("Estoque de implantação");
  });
});
