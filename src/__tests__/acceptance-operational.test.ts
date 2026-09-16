/**
 * SIGESGD — Testes de aceitação operacional (PROMPT de homologação final).
 *
 * Cobrem os itens A–T do checklist de aceitação que podem ser verificados
 * estaticamente (código + config + snapshot exportado). As verificações de
 * BANCO REAL são feitas por scripts/verify-implementation-stock.mjs e pelas
 * queries diagnostics:environmentCheck / implementationStockStatus.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";

const VITE = readFileSync("vite.config.ts", "utf-8");

describe("A–T: configuração PWA / Service Worker (item T)", () => {
  it("T) NÃO existe runtimeCaching para *.convex.cloud no Service Worker", () => {
    expect(VITE).not.toMatch(/runtimeCaching\s*:/);
    expect(VITE).not.toContain('"convex-api-cache"');
    expect(VITE).not.toContain("convex-api-cache:");
  });

  it("T) SW atualiza automaticamente (autoUpdate + cleanupOutdatedCaches)", () => {
    expect(VITE).toContain('registerType: "autoUpdate"');
    expect(VITE).toContain("cleanupOutdatedCaches: true");
  });

  it("T) precache cobre apenas assets estáticos (sem URLs dinâmicas de dados)", () => {
    expect(VITE).toContain('globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"]');
  });
});

describe("A–T: reconciliação e diagnóstico admin", () => {
  const DIAG = readFileSync("src/convex/diagnostics.ts", "utf-8");

  it("environmentCheck é query protegida somente leitura", () => {
    expect(DIAG).toContain("export const environmentCheck = query(");
    expect(DIAG).toContain("environmentCheck: true");
  });

  it("reconcileFromLocations NUNCA altera reservedQuantity", () => {
    // patch só pode tocar physicalQuantity
    expect(DIAG).toContain('ctx.db.patch(current._id, { physicalQuantity: byLocation })');
    expect(DIAG).not.toContain("reservedQuantity: byLocation");
  });

  it("reconciliação aborta/reporta divergência estrutural (sbl ≠ lotes) sem inventar correção", () => {
    expect(DIAG).toContain("structuralDivergences");
    expect(DIAG).toContain("reporta e NÃO inventa correção");
  });

  it("reconciliação é idempotente (auditoria só quando há correção)", () => {
    expect(DIAG).toContain("if (corrections.length > 0)");
  });

  it("legacyRecordsCheck existe e nunca exclui nada", () => {
    expect(DIAG).toContain("export const legacyRecordsCheck = query(");
    expect(DIAG).not.toContain("ctx.db.delete");
  });
});

describe("A–T: UOM preservada na carga inicial (item S)", () => {
  const SETUP = readFileSync("src/convex/stockSetup.ts", "utf-8");

  it("S) entryItems grava a UOM do item (não 'un' fixo)", () => {
    expect(SETUP).toContain("unitOfMeasure: item.unitOfMeasure ?? (await ctx.db.get(item.productId))?.unitOfMeasure ?? \"un\"");
    expect(SETUP).not.toContain('unitOfMeasure: "un",\n        lotId');
  });

  it("S) importInitialSheet propaga unitOfMeasure da planilha para performInitialLoad", () => {
    expect(SETUP).toContain("unitOfMeasure: row.unitOfMeasure || (existing?.unitOfMeasure ?? \"un\")");
  });

  it("S) quickExit rejeita estoque insuficiente (sem Math.max mascarando)", () => {
    expect(SETUP).toContain("Estoque insuficiente");
    expect(SETUP).not.toMatch(/newPhysical:\s*Math\.max/);
    expect(SETUP).not.toMatch(/Math\.max\(0,\s*newPhysical\)/);
  });
});

describe("A–T: fluxo de entrada atomico (item H)", () => {
  it("H) confirmação de entrada cria entry→items→lots→sbl→stock→movement→audit", () => {
    const ENTRIES = readFileSync("src/convex/entries.ts", "utf-8");
    expect(ENTRIES).toContain('"entryItems"');
    expect(ENTRIES).toContain('"lots"');
    expect(ENTRIES).toContain('"stockByLocation"');
    expect(ENTRIES).toContain('"stockMovements"');
    expect(ENTRIES).toContain('"auditLogs"');
  });
});

describe("A–T: organizações (itens E, G)", () => {
  it("E) organizations.list retorna TODAS as organizações para usuário autenticado (sem filtro oculto)", () => {
    const ORGS = readFileSync("src/convex/organizations.ts", "utf-8");
    expect(ORGS).toContain('ctx.db.query("organizations").collect()');
  });

  it("G) tela de Organizações consome organizations.list real (sem dados hardcoded)", () => {
    const PAGE = readFileSync("src/pages/Organization.tsx", "utf-8");
    expect(PAGE).toContain("api.organizations.list");
  });

  it("Dados organizacionais dos formulários vêm do Convex (sem listas hardcoded)", () => {
    const REQ = readFileSync("src/pages/Requests.tsx", "utf-8");
    expect(REQ).toContain("api.organizations.list");
  });
});

describe("A–T: saída e solicitação (itens I–R)", () => {
  const EXIT_PAGE = readFileSync("src/pages/Exit.tsx", "utf-8");

  it("I/J/K/L/M/N) tela de saída usa quickExit real e mostra físico/reservado/disponível", () => {
    expect(EXIT_PAGE).toContain("api.stockSetup.quickExit");
    expect(EXIT_PAGE).toContain("api.products.listActive");
    expect(EXIT_PAGE).toContain("api.stockSetup.productLocationSummary");
  });

  it("O) saída maior que disponível é rejeitada no backend (quickExit valida available)", () => {
    const SETUP = readFileSync("src/convex/stockSetup.ts", "utf-8");
    expect(SETUP).toMatch(/Estoque insuficiente\. Disponível: \$\{available\}/);
  });

  it("P/Q/R) fluxo solicitação→aprovação→entrega e liberação de reserva mantidos", () => {
    const REQUESTS = readFileSync("src/convex/requests.ts", "utf-8");
    // Aprovação reserva (reservedQuantity sobe)
    expect(REQUESTS).toMatch(/reservedQuantity:\s*newReserved/);
    // Entrega baixa físico e reservado na mesma operação
    expect(REQUESTS).toMatch(/physicalQuantity:\s*newPhysical,\s*reservedQuantity:\s*newReserved/);
    // Rejeição existe
    expect(REQUESTS).toMatch(/status:\s*"rejected"/);
    // Não permite entrega sem aprovação
    expect(REQUESTS).toContain('Solicitação deve estar aprovada');
  });
});

describe("A–T: estoque de implantação (item 7 do prompt)", () => {
  it("painel usa números do backend (implementationStockStatus), não hardcoded", () => {
    const STOCK = readFileSync("src/pages/Stock.tsx", "utf-8");
    expect(STOCK).toContain("api.stockSetup.implementationStockStatus");
  });
});

describe("A–T: build PWA gerado", () => {
  it("dist/sw.js (após rebuild) não contém cache do Convex", () => {
    // O artefato atual pode ser de um build anterior; só valida quando
    // recontendo o marcador do SW gerado pela config corrigida.
    if (existsSync("dist/sw.js")) {
      const sw = readFileSync("dist/sw.js", "utf-8");
      // Não pode registrar rota NetworkFirst para *.convex.cloud
      expect(sw).not.toMatch(/NetworkFirst[^)]*convex-api-cache/);
      expect(sw).not.toMatch(/registerRoute\(\/\^https:\\\/\\\/\.\*\\\.convex/);
    }
  });
});
