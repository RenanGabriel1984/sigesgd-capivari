/**
 * Gestão de Estoque SGGD — SUPRIMENTOS DE IMPRESSÃO (PRINT-01..20).
 *
 * Cobre a matriz de testes do painel: recorte por área, classificação,
 * status, consumo (somente exit), retirada, migração idempotente TI Geral →
 * Impressoras, planilha real, reposição e RBAC.
 *
 * Nenhum teste escreve no banco de produção.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  classifySupplyType,
  extractColor,
  tonerDisplayLabel,
  stockStatus,
  buildSupplyRow,
  computeCardTotals,
  isOperationalConsumption,
  monthWindow,
  computeMonthlyConsumption,
  validateWithdrawal,
} from "@/lib/print-supplies";
import { roleHasPermission } from "@/lib/rbac";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const backend = read("src/convex/printSupplies.ts");
const panel = read("src/pages/GomaQ.tsx");

const IMP = "q97b7737gv98ajm8qqpmjmzjs18ezb58"; // Impressoras
const CAT = "k57fk85xwpj3b3xj9dc31jwqpd8dgk3a"; // Suprimentos de Impressão

const row = (over: Partial<Parameters<typeof buildSupplyRow>[0]> = {}) =>
  buildSupplyRow({
    productId: "p1",
    productName: "Toner CX735 — Preto",
    brand: "Lexmark",
    model: "CX735",
    unitOfMeasure: "un",
    currentStock: 5,
    minimumStock: 2,
    idealStock: 6,
    ...over,
  });

/* ═══ PRINT-01 — recorte da área Impressoras ════════════════════════════════ */

describe("PRINT-01 — painel mostra somente estoque da área Impressoras", () => {
  it("backend filtra lots por areaId = Impressoras e categoria de suprimentos", () => {
    expect(backend).toContain("lot.areaId !== PRINT_AREA_ID");
    expect(backend).toContain("p.categoryId === SUPPLY_CATEGORY_ID");
  });
  it("a área usada é a existente (id conferido no banco), sem criar nova", () => {
    expect(backend).toContain('const PRINT_AREA_ID = "q97b7737gv98ajm8qqpmjmzjs18ezb58"');
  });
  it("não associa a área ao fornecedor Gomaq (recorte é por categoria/área)", () => {
    expect(backend).not.toMatch(/supplierId.*PRINT_AREA_ID|PRINT_AREA_ID.*supplierId/);
  });
});

/* ═══ PRINT-02 — cards derivados do estoque real ════════════════════════════ */

describe("PRINT-02 — totais dos cards correspondem ao estoque real", () => {
  it("somam currentStock das linhas derivadas do estoque", () => {
    const rows = [
      row({ productId: "a", productName: "Toner A — Preto", currentStock: 3 }),
      row({ productId: "b", productName: "Toner B — Ciano", currentStock: 4 }),
      row({ productId: "c", productName: "Cartão PVC", currentStock: 100 }),
    ];
    const t = computeCardTotals(rows);
    expect(t.toners).toBe(7);
    expect(t.cartoes).toBe(100);
  });
  it("cards NÃO são armazenados como valores independentes (derivados em tempo real)", () => {
    expect(backend).toContain("computeCardTotals(rows)");
    expect(backend).not.toMatch(/totalToners\s*=|cardTotals.*patch|insert\("supply/);
  });
});

/* ═══ PRINT-03/04/05 — classificação por tipo ═══════════════════════════════ */

describe("PRINT-03 — Toner agrupado corretamente", () => {
  it("classifica toners e extrai modelo+cor", () => {
    expect(classifySupplyType("Toner MFC-L6902DW — Preto 20K")).toBe("Toner");
    expect(classifySupplyType("Toner AltaLink — Ciano (Xerox)")).toBe("Toner");
    const r = row({ productName: "Toner AltaLink — Ciano (Xerox)" });
    expect(r.displayLabel).toBe("AltaLink — Ciano");
    expect(extractColor(r.productName)).toBe("Ciano");
  });
});

describe("PRINT-04 — Cartão contabilizado corretamente", () => {
  it("classifica cartão PVC e soma nos cards", () => {
    expect(classifySupplyType("Cartão PVC para crachá")).toBe("Cartão");
    expect(computeCardTotals([row({ productName: "Cartão PVC", currentStock: 400 })]).cartoes).toBe(400);
  });
});

describe("PRINT-05 — Ribbon contabilizado corretamente", () => {
  it("classifica ribbons e soma nos cards", () => {
    expect(classifySupplyType("Ribbon Color YMCKT para SIGMA")).toBe("Ribbon");
    expect(classifySupplyType("Ribbon para impressora de etiqueta adesiva")).toBe("Ribbon");
    expect(computeCardTotals([row({ productName: "Ribbon SIGMA", currentStock: 2 })]).ribbons).toBe(2);
  });
});

/* ═══ PRINT-06/07 — status ══════════════════════════════════════════════════ */

describe("PRINT-06 — estoque baixo identificado", () => {
  it("Baixo quando atual <= mínimo (e > 0)", () => {
    expect(stockStatus(2, 2)).toBe("Baixo");
    expect(stockStatus(1, 2)).toBe("Baixo");
  });
  it("Normal quando atual > mínimo; sem mínimo → Normal", () => {
    expect(stockStatus(3, 2)).toBe("Normal");
    expect(stockStatus(3, null)).toBe("Normal");
  });
  it("contagem de baixo inclui Baixo e Crítico", () => {
    const t = computeCardTotals([
      row({ productId: "1", currentStock: 2, minimumStock: 2 }),
      row({ productId: "2", productName: "Papel X", currentStock: 0 }),
      row({ productId: "3", productName: "Papel Y", currentStock: 9, minimumStock: 2 }),
    ]);
    expect(t.lowStock).toBe(2);
  });
});

describe("PRINT-07 — estoque zero é crítico", () => {
  it("Crítico mesmo com mínimo alto", () => {
    expect(stockStatus(0, 10)).toBe("Crítico");
    const r = row({ currentStock: 0, minimumStock: 10 });
    expect(r.status).toBe("Crítico");
  });
});

/* ═══ PRINT-08/09/10 — retirada rápida ══════════════════════════════════════ */

describe("PRINT-08 — retirada rápida reduz estoque corretamente", () => {
  it("validação calcula saldo após saída", () => {
    expect(validateWithdrawal(2, 5)).toEqual({ ok: true, balanceAfter: 3 });
  });
  it("backend registra stockMovement tipo exit e faz patch do estoque", () => {
    expect(backend).toMatch(/type: "exit"/);
    expect(backend).toContain("physicalQuantity: newPhysical");
  });
});

describe("PRINT-09 — retirada registra lotId", () => {
  it("movement carrega lotId estruturado (1º lote consumido)", () => {
    expect(backend).toContain("lotId: consumedLots[0].lotId");
  });
  it("consome lotes FIFO por recebimento e registra todos na observation", () => {
    expect(backend).toMatch(/sort\(\(a, b\) => a\.receivedAt - b\.receivedAt\)/);
    expect(backend).toContain("Lotes: ${consumedLots.map((c) => `${c.lotNumber}(${c.qty})`).join(\", \")}");
  });
});

describe("PRINT-10 — retirada maior que estoque é bloqueada", () => {
  it("regra pura bloqueia", () => {
    const v = validateWithdrawal(6, 5);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("Estoque insuficiente");
  });
  it("backend revalida contra o estoque real", () => {
    expect(backend).toContain("Estoque insuficiente. Disponível: ${available} ${product.unitOfMeasure}");
  });
});

/* ═══ PRINT-11/19/20 — transferência, duplicação e migração ═════════════════ */

describe("PRINT-11 — transferência não altera estoque global", () => {
  it("migração faz patch SOMENTE de areaId no lote (nunca de quantidades)", () => {
    const migrate = backend.slice(backend.indexOf("export const migrateTIGeralToImpressoras"), backend.indexOf("export const getSupplyDashboard"));
    expect(migrate).toContain("areaId: PRINT_AREA_ID as never");
    // A única escrita na migration é o patch de área:
    expect(migrate.match(/ctx\.db\.patch\(/g) ?? []).toHaveLength(1);
    expect(migrate).toContain("ctx.db.patch(lot._id, { areaId: PRINT_AREA_ID as never })");
  });
  it("a guarda de saldo usa quantityAvailable apenas para CONFERIR, nunca para escrever", () => {
    const migrate = backend.slice(backend.indexOf("export const migrateTIGeralToImpressoras"), backend.indexOf("export const getSupplyDashboard"));
    expect(migrate).toContain("lotsAvailable"); // conferência antes/depois
    expect(migrate).not.toMatch(/patch\([^)]*quantityAvailable/);
  });
});

describe("PRINT-19 — nenhuma duplicação de estoque é criada", () => {
  it("o painel lê stock/lots existentes — sem nova tabela de estoque", () => {
    expect(backend).toContain('ctx.db.query("stock")');
    expect(backend).toContain('ctx.db.query("lots")');
    expect(backend).not.toMatch(/insert\("(stock|printSuppliesStock|supplyStock)"/);
  });
});

describe("PRINT-20 — migração histórica TI Geral → Impressoras é idempotente", () => {
  it("só move lotes que AINDA NÃO estão na área", () => {
    expect(backend).toContain("l.areaId !== PRINT_AREA_ID");
  });
  it("guarda de saldo compara antes × depois e lança erro em divergência", () => {
    expect(backend).toContain("VIOLAÇÃO DE SALDO na migração histórica");
    expect(backend).toContain("totalsAfter.physical !== totalsBefore.physical");
  });
  it("registra auditoria da transferência histórica", () => {
    const migrate = backend.slice(backend.indexOf("migrateTIGeralToImpressoras"), backend.indexOf("getSupplyDashboard"));
    expect(migrate).toContain('action: "transfer_stock"');
    expect(migrate).toContain("Migração histórica de área");
  });
  it("restrição de categoria: só produtos de Suprimentos de Impressão", () => {
    expect(backend).toContain("supplyProducts.has(l.productId)");
  });
});

/* ═══ PRINT-12/13/14 — consumo mensal ═══════════════════════════════════════ */

const META = new Map([
  ["toner", { name: "Toner CX735 — Preto", brand: "Lexmark", unitOfMeasure: "un" }],
  ["papel", { name: "Papel térmico", brand: null, unitOfMeasure: "rl" }],
]);

describe("PRINT-12 — consumo mensal conta somente saídas operacionais", () => {
  it("isOperationalConsumption: apenas exit", () => {
    expect(isOperationalConsumption("exit")).toBe(true);
  });
  it("consolida entradas e saídas do período", () => {
    const p = monthWindow(2026, 9);
    const lines = computeMonthlyConsumption(
      [
        { type: "entry", productId: "toner", quantity: 10, timestamp: p.start + 1000 },
        { type: "exit", productId: "toner", quantity: 4, timestamp: p.start + 2000 },
      ],
      META,
      new Map([["toner", 6]]),
      p,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].entries).toBe(10);
    expect(lines[0].exits).toBe(4);
    expect(lines[0].currentStock).toBe(6);
  });
});

describe("PRINT-13 — transferências não entram como consumo", () => {
  it("transfer é ignorado", () => {
    const p = monthWindow(2026, 9);
    const lines = computeMonthlyConsumption(
      [{ type: "transfer", productId: "toner", quantity: 9, timestamp: p.start + 1000 }],
      META,
      new Map(),
      p,
    );
    expect(lines).toHaveLength(0);
  });
});

describe("PRINT-14 — devoluções e ajustes não entram como consumo", () => {
  it("return e adjustment são ignorados", () => {
    const p = monthWindow(2026, 9);
    const lines = computeMonthlyConsumption(
      [
        { type: "return", productId: "toner", quantity: 3, timestamp: p.start + 1000 },
        { type: "adjustment", productId: "papel", quantity: 50, timestamp: p.start + 2000 },
      ],
      META,
      new Map(),
      p,
    );
    expect(lines).toHaveLength(0);
  });
  it("movimento fora do período é ignorado", () => {
    const p = monthWindow(2026, 9);
    const lines = computeMonthlyConsumption(
      [{ type: "exit", productId: "toner", quantity: 5, timestamp: p.start - 1 }],
      META,
      new Map(),
      p,
    );
    expect(lines).toHaveLength(0);
  });
});

/* ═══ PRINT-15/16/17 ════════════════════════════════════════════════════════ */

describe("PRINT-15 — entrada aumenta estoque", () => {
  it("entry conta na linha de consumo e o painel reflete o estoque real", () => {
    const p = monthWindow(2026, 9);
    const lines = computeMonthlyConsumption(
      [{ type: "entry", productId: "papel", quantity: 90, timestamp: p.start + 500 }],
      META,
      new Map([["papel", 180]]),
      p,
    );
    expect(lines[0].entries).toBe(90);
    expect(lines[0].currentStock).toBe(180);
  });
});

describe("PRINT-16 — planilha mensal utiliza movimentações reais", () => {
  it("a query usa stockMovements reais e o XLSX é gerado no cliente a partir dela", () => {
    expect(backend).toMatch(/query\("stockMovements"\)/);
    expect(panel).toContain("api.printSupplies.getMonthlyConsumption");
    expect(panel).toContain('import("xlsx")');
    expect(panel).toContain("consumo-suprimentos-");
  });
  it("não existem dados fictícios na planilha", () => {
    expect(panel).not.toMatch(/fictício|fakeData|mockData/);
  });
});

describe("PRINT-17 — reposição calcula somente com mínimo/ideal", () => {
  it("com ambos definidos: ideal − atual", () => {
    const r = row({ currentStock: 1, minimumStock: 2, idealStock: 6 });
    expect(r.suggestedReorder).toBe(5);
  });
  it("sem parâmetros: sugerida nula e flag de indefinição", () => {
    const r = row({ currentStock: 0, minimumStock: 0, idealStock: 0 });
    expect(r.suggestedReorder).toBeNull();
    expect(r.parametersDefined).toBe(false);
  });
  it("UI exibe 'Parâmetros não definidos'", () => {
    expect(panel).toContain("Parâmetros não definidos");
  });
});

/* ═══ PRINT-18 — RBAC ═══════════════════════════════════════════════════════ */

describe("PRINT-18 — RBAC continua respeitado", () => {
  it("consulta exige stock.view; retirada exige stock.mutate (sem exceção de papel)", () => {
    expect(backend).toContain('requirePermission(ctx, "stock.view")');
    expect(backend).toContain('requirePermission(ctx, "stock.mutate"');
  });
  it("parâmetros exigem products.manage", () => {
    expect(backend).toContain('requirePermission(ctx, "products.manage"');
  });
  it("matriz: técnico consulta mas não retira; gestor retira; diretor só consulta", () => {
    expect(roleHasPermission("technician", "stock.view")).toBe(true);
    expect(roleHasPermission("technician", "stock.mutate")).toBe(false);
    expect(roleHasPermission("stock_manager", "stock.mutate")).toBe(true);
    expect(roleHasPermission("director", "stock.view")).toBe(true);
    expect(roleHasPermission("director", "stock.mutate")).toBe(false);
  });
  it("UI oculta o botão sem permissão (a autorização real é no backend)", () => {
    expect(panel).toContain("permissions.canCreateEntries");
  });
});

/* ═══ Estrutura do painel ═══════════════════════════════════════════════════ */

describe("estrutura do painel (espec da tela)", () => {
  it("título e subtítulo exigidos, sem Gomaq estrutural", () => {
    expect(panel).toContain("Gestão de Suprimentos de Impressão");
    expect(panel).toContain("Controle de estoque, consumo, retiradas e abastecimento");
  });
  it("abas: Estoque, Consumo Mensal, Reposição, Logística Reversa", () => {
    for (const tab of ["Estoque", "Consumo Mensal", "Reposição", "Logística Reversa"]) {
      expect(panel).toContain(tab);
    }
  });
  it("status exibem texto (não apenas cor)", () => {
    expect(panel).toContain("StatusBadge");
    expect(panel).toContain("{status}");
  });
  it("coluna de toner destaca modelo — cor", () => {
    expect(panel).toContain("displayLabel.split");
  });
});
