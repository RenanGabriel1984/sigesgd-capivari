/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE REPOSIÇÃO (PARAM-01..14).
 *
 * Cobre a semântica `null` ≠ `0`, o status único de reposição, a sugestão
 * `max(ideal − disponível, 0)`, a edição em lote e as PROIBIÇÕES: salvar
 * parâmetros não pode criar movimentação, tocar lote nem alterar quantidade.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhum dado real alterado,
 * nenhuma movimentação fictícia criada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  readReplenishmentParameters,
  isParametrized,
  replenishmentStatus,
  suggestedReplenishmentQuantity,
  estimatedMonthlyNeed,
  buildStockParameterRow,
  diffParameterDraft,
  draftFromParameters,
  draftFromInputs,
  parseParameterInput,
  computeParameterCounters,
  applyParameterFilters,
  validateParameters,
  EMPTY_PARAMETER_FILTERS,
  REPLENISHMENT_STATUS_LABELS,
  REPLENISHMENT_STATUS_LONG,
  type ReplenishmentParameters,
  type ParameterDraft,
} from "@/lib/stock-parameters";
import { roleHasPermission, type AppRole } from "@/lib/rbac";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const backend = read("src/convex/stockParameters.ts");
const schema = read("src/convex/schema.ts");
const page = read("src/pages/StockParameters.tsx");

/** Parâmetros completos de exemplo. */
const params = (over: Partial<ReplenishmentParameters> = {}): ReplenishmentParameters => ({
  minimumStock: null,
  idealStock: null,
  monthlyConsumptionTarget: null,
  replenishmentEnabled: false,
  replenishmentNote: null,
  ...over,
});

/** Corpo de uma mutation/query do módulo, delimitado pelo próximo export. */
function block(name: string): string {
  const start = backend.indexOf(`export const ${name} =`);
  expect(start, `${name} não encontrado`).toBeGreaterThan(-1);
  const rest = backend.slice(start);
  const next = rest.slice(1).search(/\nexport const /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/**
 * Bloco SEM COMENTÁRIOS. As asserções negativas (ex.: "não toca em stock")
 * precisam olhar o código executável: a documentação da função seguinte pode
 * citar `db.patch` ao explicar o que ela NÃO faz, e isso não é uma escrita.
 */
function code(name: string): string {
  return block(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ─────────────────────────────────────────────────────────────────────────────

describe("PARAM — Semântica dos parâmetros", () => {
  it("PARAM-01: produto sem parâmetros é identificado como não parametrizado", () => {
    const p = readReplenishmentParameters({});
    expect(p.minimumStock).toBeNull();
    expect(p.idealStock).toBeNull();
    expect(p.monthlyConsumptionTarget).toBeNull();
    expect(isParametrized(p)).toBe(false);

    expect(replenishmentStatus(0, p)).toBe("not_parametrized");
    expect(replenishmentStatus(999, p)).toBe("not_parametrized");

    // Um único parâmetro já configura o produto.
    expect(isParametrized(params({ minimumStock: 2 }))).toBe(true);
    expect(isParametrized(params({ monthlyConsumptionTarget: 5 }))).toBe(true);
  });

  it("PARAM-01b: null e zero são estados DIFERENTES (não-parametrizado ≠ zero real)", () => {
    // Zero é um valor REAL configurado.
    const zero = readReplenishmentParameters({ minimumStock: 0 });
    expect(zero.minimumStock).toBe(0);
    expect(isParametrized(zero)).toBe(true);

    // Ausente é "não parametrizado".
    const absent = readReplenishmentParameters({});
    expect(absent.minimumStock).toBeNull();
    expect(isParametrized(absent)).toBe(false);

    // Campo em branco no formulário vira null (não 0).
    expect(parseParameterInput("")).toBeNull();
    expect(parseParameterInput("   ")).toBeNull();
    expect(parseParameterInput("0")).toBe(0);
    expect(parseParameterInput("5")).toBe(5);
    // Negativo é inválido → null.
    expect(parseParameterInput("-3")).toBeNull();
    expect(parseParameterInput("abc")).toBeNull();
  });

  it("PARAM-01c: valor negativo no banco é normalizado para não parametrizado", () => {
    const p = readReplenishmentParameters({ minimumStock: -5, idealStock: -1 });
    expect(p.minimumStock).toBeNull();
    expect(p.idealStock).toBeNull();
  });
});

describe("PARAM — Gravação dos campos", () => {
  it("PARAM-02: minimumStock é salvo corretamente", () => {
    const draft = draftFromInputs({ minimum: "2", ideal: "", monthly: "", enabled: false, note: "" });
    expect(draft.minimumStock).toBe(2);

    // E o backend grava o valor recebido.
    expect(backend).toContain("minimumStock: v.union(v.number(), v.null())");
    expect(code("updateMany")).toContain("assign(\"minimumStock\", update.minimumStock)");
  });

  it("PARAM-03: idealStock é salvo corretamente", () => {
    const draft = draftFromInputs({ minimum: "", ideal: "50", monthly: "", enabled: false, note: "" });
    expect(draft.idealStock).toBe(50);
    expect(code("updateMany")).toContain("assign(\"idealStock\", update.idealStock)");
  });

  it("PARAM-04: consumo mensal é salvo SEPARADAMENTE", () => {
    const draft = draftFromInputs({
      minimum: "1",
      ideal: "3",
      monthly: "10",
      enabled: true,
      note: "Consumo da secretaria",
    });
    // Campo próprio — não é derivado de mínimo/ideal.
    expect(draft.monthlyConsumptionTarget).toBe(10);
    expect(draft.minimumStock).toBe(1);
    expect(draft.idealStock).toBe(3);
    expect(draft.replenishmentEnabled).toBe(true);
    expect(draft.replenishmentNote).toBe("Consumo da secretaria");

    // Existência independente no schema.
    expect(schema).toContain("monthlyConsumptionTarget: v.optional(v.number())");
    expect(schema).toContain("replenishmentEnabled: v.optional(v.boolean())");
    expect(schema).toContain("replenishmentNote: v.optional(v.string())");

    // E a necessidade estimada usa-o como PARÂMETRO, nunca como cálculo.
    const need = estimatedMonthlyNeed(params({ monthlyConsumptionTarget: 7 }));
    expect(need).toEqual({ quantity: 7, source: "parameter" });
    // Sem parâmetro: NADA é inventado.
    expect(estimatedMonthlyNeed(params())).toEqual({ quantity: 0, source: "none" });
  });
});

describe("PARAM — Edição em lote", () => {
  it("PARAM-05: edição de múltiplos produtos salva somente as alterações", () => {
    const current: ParameterDraft = {
      minimumStock: 2,
      idealStock: 5,
      monthlyConsumptionTarget: null,
      replenishmentEnabled: false,
      replenishmentNote: null,
    };
    const unchanged: ParameterDraft = { ...current };
    expect(diffParameterDraft("p1", current, unchanged)).toEqual([]);

    // Produto A: mínimo 2 / ideal 5 (inalterado) → nada a salvar.
    expect(diffParameterDraft("pA", current, draftFromInputs({
      minimum: "2", ideal: "5", monthly: "", enabled: false, note: "",
    }))).toEqual([]);

    // Produto C: mínimo 10 / ideal 50 → duas alterações.
    const changesC = diffParameterDraft("pC", current, draftFromInputs({
      minimum: "10", ideal: "50", monthly: "", enabled: false, note: "",
    }));
    expect(changesC.map((c) => [c.productId, c.field])).toEqual([
      ["pC", "minimumStock"],
      ["pC", "idealStock"],
    ]);
    expect(changesC[0]).toMatchObject({ before: 2, after: 10 });
    expect(changesC[1]).toMatchObject({ before: 5, after: 50 });

    // Trocar apenas o switch também é alteração.
    const onlyToggle = diffParameterDraft("pB", current, { ...current, replenishmentEnabled: true });
    expect(onlyToggle).toEqual([
      { productId: "pB", field: "replenishmentEnabled", before: false, after: true },
    ]);

    // Rascunho inicial é reversível a partir dos parâmetros salvos.
    expect(draftFromParameters(readReplenishmentParameters({ minimumStock: 3 })).minimumStock).toBe(3);
  });

  it("PARAM-05b: o backend ignora linhas sem alteração efetiva", () => {
    const body = code("updateMany");
    expect(body).toContain("if (changes.length === 0)");
    expect(body).toContain("skipped++");
    // Só o que mudou chega ao patch.
    expect(body).toContain("if (before === next) return;");
  });
});

describe("PARAM — Salvar parâmetros NÃO movimenta estoque", () => {
  it("PARAM-06: quantidade física permanece inalterada", () => {
    const body = code("updateMany");
    // O único `db.patch` é em `products` (parâmetros). Nenhum em `stock`.
    expect(body).toContain("db.patch(update.productId");
    expect(body).not.toContain('db.patch("stock"');
    expect(body).not.toContain("physicalQuantity");
    expect(body).not.toContain("reservedQuantity");
    // Nenhuma escrita em lote/local/movimentação.
    for (const forbidden of ['db.insert("lots"', 'db.patch("lots"', 'db.insert("stockMovements"', 'db.patch("stockByLocation"']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("PARAM-07: nenhuma stockMovement é criada", () => {
    const body = code("updateMany");
    expect(body).not.toContain('db.insert("stockMovements"');
    expect(body).not.toContain('db.delete("stockMovements"');
    // A auditoria é o ÚNICO insert de registro além do patch.
    expect(body).toContain('db.insert("auditLogs"');
  });

  it("PARAM-08: nenhum lote é alterado", () => {
    const body = code("updateMany");
    expect(body).not.toContain('db.patch("lots"');
    expect(body).not.toContain('db.insert("lots"');
    expect(body).not.toContain("quantityAvailable");
    // A listagem LÊ lotes só para descobrir a área do produto.
    const listBody = code("list");
    expect(listBody).toContain('ctx.db.query("lots").collect()');
    expect(listBody).not.toContain("db.patch");
    expect(listBody).not.toContain("db.insert");
  });
});

describe("PARAM — Sugestão e status de reposição", () => {
  it("PARAM-09: sugestão = max(ideal − disponível, 0)", () => {
    // Exemplo do requisito: estoque 3, ideal 6 → sugestão 3.
    expect(suggestedReplenishmentQuantity(3, params({ idealStock: 6 }))).toBe(3);
    expect(suggestedReplenishmentQuantity(0, params({ idealStock: 6 }))).toBe(6);
    // Já cobreu o ideal → 0 (nunca negativo).
    expect(suggestedReplenishmentQuantity(10, params({ idealStock: 6 }))).toBe(0);
    expect(suggestedReplenishmentQuantity(6, params({ idealStock: 6 }))).toBe(0);
    // Sem ideal → 0 (informativa, não inventa número).
    expect(suggestedReplenishmentQuantity(3, params({ minimumStock: 1 }))).toBe(0);

    // A linha da tabela usa DISPONÍVEL (físico − reservado), não o físico.
    const row = buildStockParameterRow({
      productId: "p1",
      productName: "Toner",
      categoryName: "Suprimentos de Impressão",
      areaName: "Impressoras",
      unitOfMeasure: "un",
      physicalStock: 10,
      reservedStock: 4,
      parameters: params({ minimumStock: 2, idealStock: 12 }),
    });
    expect(row.availableStock).toBe(6);
    expect(row.suggestedQuantity).toBe(6); // 12 − 6
  });

  it("PARAM-10: abaixo do mínimo gera status de reposição NECESSÁRIA", () => {
    expect(replenishmentStatus(1, params({ minimumStock: 2 }))).toBe("replenish_required");
    // Igual ao mínimo também é "necessária" (<=).
    expect(replenishmentStatus(2, params({ minimumStock: 2 }))).toBe("replenish_required");
    // Mesmo tendo ideal muito acima, o status abaixo do mínimo PREVALECE.
    expect(replenishmentStatus(0, params({ minimumStock: 2, idealStock: 100 }))).toBe(
      "replenish_required"
    );
    expect(REPLENISHMENT_STATUS_LONG.replenish_required).toBe("Reposição necessária");
  });

  it("PARAM-11: entre mínimo e ideal gera sugestão de reposição", () => {
    expect(replenishmentStatus(3, params({ minimumStock: 2, idealStock: 6 }))).toBe(
      "replenish_suggested"
    );
    expect(REPLENISHMENT_STATUS_LONG.replenish_suggested).toBe("Reposição sugerida");
    // Só com mínimo definido e acima dele, sem ideal → normal.
    expect(replenishmentStatus(5, params({ minimumStock: 2 }))).toBe("normal");
  });

  it("PARAM-12: acima do ideal gera status normal", () => {
    expect(replenishmentStatus(6, params({ minimumStock: 2, idealStock: 6 }))).toBe("normal");
    expect(replenishmentStatus(50, params({ minimumStock: 2, idealStock: 6 }))).toBe("normal");
    expect(REPLENISHMENT_STATUS_LONG.normal).toBe("Normal");
  });

  it("PARAM-12b: classificação é ÚNICA e sem conflito (precedência fixa)", () => {
    const cases: Array<[number, ReplenishmentParameters]> = [
      [0, params()],
      [1, params({ minimumStock: 2 })],
      [2, params({ minimumStock: 2 })],
      [3, params({ minimumStock: 2, idealStock: 6 })],
      [6, params({ minimumStock: 2, idealStock: 6 })],
    ];
    for (const [available, p] of cases) {
      const status = replenishmentStatus(available, p);
      // Exatamente um rótulo, sempre presente no mapa.
      expect(REPLENISHMENT_STATUS_LABELS[status]).toBeTruthy();
      expect(REPLENISHMENT_STATUS_LONG[status]).toBeTruthy();
    }
    expect(Object.keys(REPLENISHMENT_STATUS_LABELS)).toHaveLength(4);
  });
});

describe("PARAM — Auditoria e RBAC", () => {
  it("PARAM-13: auditoria registra alteração de parâmetro (antes → novos)", () => {
    // Evento específico no schema.
    expect(schema).toContain('STOCK_PARAMETER_UPDATE: "stock_parameter_update"');
    expect(schema).toContain('v.literal(AUDIT_ACTIONS.STOCK_PARAMETER_UPDATE)');

    const body = code("updateMany");
    expect(body).toContain('action: "stock_parameter_update"');
    expect(body).toContain('entity: "products"');
    // Usuário, data/hora, valores anteriores e novos.
    expect(body).toContain("userId");
    expect(body).toContain("timestamp: now");
    expect(body).toContain("${fieldLabels[field]}");
    expect(body).toContain("${before === null ? \"não parametrizado\" : String(before)}");
    expect(body).toContain("→");
    // NUNCA em stockMovements.
    expect(body).not.toContain('db.insert("stockMovements"');
    // E a própria auditoria afirma que não é movimentação.
    expect(body).toContain("NÃO é movimentação de estoque");
  });

  it("PARAM-14: RBAC impede alteração por Diretor/Técnico", () => {
    // Backend: consulta exige .view, escrita exige .manage.
    expect(code("list")).toContain('requirePermission(ctx, "stock_parameters.view"');
    expect(code("updateMany")).toContain('requirePermission(ctx, "stock_parameters.manage"');

    const roles: AppRole[] = ["admin", "secretary", "stock_manager", "director", "technician"];
    //.Visualizam: todos menos o técnico.
    expect(roles.filter((r) => roleHasPermission(r, "stock_parameters.view")).sort()).toEqual([
      "admin",
      "director",
      "secretary",
      "stock_manager",
    ]);
    // Editam: somente administrador, secretário e gestor de estoque.
    expect(roles.filter((r) => roleHasPermission(r, "stock_parameters.manage")).sort()).toEqual([
      "admin",
      "secretary",
      "stock_manager",
    ]);
    // Técnico não acessa a administração de parâmetros.
    expect(roleHasPermission("technician", "stock_parameters.view")).toBe(false);
    expect(roleHasPermission("technician", "stock_parameters.manage")).toBe(false);
  });
});

describe("PARAM — Filtros e contadores da tela", () => {
  const rows = [
    buildStockParameterRow({
      productId: "p1", productName: "Toner A", categoryName: "Suprimentos", areaName: "Impressoras",
      unitOfMeasure: "un", physicalStock: 1, reservedStock: 0,
      parameters: params({ minimumStock: 2, idealStock: 5 }),
    }),
    buildStockParameterRow({
      productId: "p2", productName: "Switch 8p", categoryName: "Redes", areaName: null,
      unitOfMeasure: "un", physicalStock: 3, reservedStock: 0, parameters: params(),
    }),
    buildStockParameterRow({
      productId: "p3", productName: "Teclado", categoryName: "Periféricos", areaName: null,
      unitOfMeasure: "un", physicalStock: 9, reservedStock: 0,
      parameters: params({ minimumStock: 2, idealStock: 4, replenishmentEnabled: true }),
    }),
  ];

  it("PARAM-04b: contadores são dinâmicos e cobrem a base inteira", () => {
    const counters = computeParameterCounters(rows);
    expect(counters.total).toBe(3);
    expect(counters.parametrized).toBe(2);
    expect(counters.notParametrized).toBe(1);
    expect(counters.needsReplenishment).toBe(1); // p1

    // A tela exibe os contadores sobre o conjunto TODO, não sobre o filtro.
    const filtered = applyParameterFilters(rows, {
      ...EMPTY_PARAMETER_FILTERS,
      onlyUnparametrized: true,
    });
    expect(filtered.map((r) => r.productId)).toEqual(["p2"]);
    expect(computeParameterCounters(rows).total).toBe(3);
  });

  it("PARAM-04c: filtros de busca, categoria, área e flags funcionam", () => {
    expect(applyParameterFilters(rows, { ...EMPTY_PARAMETER_FILTERS, search: "toner" }).map((r) => r.productId))
      .toEqual(["p1"]);
    expect(applyParameterFilters(rows, { ...EMPTY_PARAMETER_FILTERS, categoryName: "Redes" }).map((r) => r.productId))
      .toEqual(["p2"]);
    expect(applyParameterFilters(rows, { ...EMPTY_PARAMETER_FILTERS, areaName: "Impressoras" }).map((r) => r.productId))
      .toEqual(["p1"]);
    expect(applyParameterFilters(rows, { ...EMPTY_PARAMETER_FILTERS, onlyBelowMinimum: true }).map((r) => r.productId))
      .toEqual(["p1"]);
    expect(applyParameterFilters(rows, { ...EMPTY_PARAMETER_FILTERS, onlyReplenishmentEnabled: true }).map((r) => r.productId))
      .toEqual(["p3"]);
  });
});

describe("PARAM — Tela e dados reais", () => {
  it("PARAM-03b: a tela edita mínimo/ideal/consumo direto na tabela", () => {
    expect(page).toContain("Parametrização de Estoque");
    // Os três campos editáveis ficam na própria tabela.
    expect(page).toContain('aria-label="Estoque mínimo"');
    expect(page).toContain('aria-label="Estoque ideal"');
    expect(page).toContain('aria-label="Consumo mensal"');
    expect(page).toContain("Salvar alterações");
    // Colunas exigidas.
    for (const header of ["Produto", "Categoria", "Área", "Estoque disponível", "Mínimo", "Ideal", "Consumo mensal", "Reposição", "Status"]) {
      expect(page).toContain(`<TableHead className="text-xs${header === "Estoque disponível" ? " text-right" : header === "Mínimo" || header === "Ideal" || header === "Consumo mensal" || header === "Reposição" ? " text-center" : ""}">${header}</TableHead>`);
    }
  });

  it("PARAM-09b: a tela NÃO carrega uma carga automática de parâmetros", () => {
    // Nenhuma mutation de seed/precarga na tela nem no módulo de parâmetros.
    expect(backend).not.toContain("seed");
    expect(backend).not.toContain("bulkDefault");
    expect(page).not.toContain("seed");
    // A tela apenas LÊ o que já existe.
    expect(page).toContain("api.stockParameters.list");
    expect(page).toContain("api.stockParameters.updateMany");
  });

  it("PARAM-01d: nenhum parâmetro real foi inventado para os produtos", () => {
    // A tela de parâmetros não faz carga inicial: apenas edita o que existir.
    const body = code("list");
    expect(body).not.toContain("db.insert");
    expect(body).not.toContain("db.patch");
    // E a rota protege-se pela permissão central.
    expect(read("src/lib/rbac.ts")).toContain('"/stock-parameters": "stock_parameters.view"');
  });

  it("PARAM-10b: validação mínima/ideal é informativa, não bloqueante", () => {
    expect(validateParameters(params({ minimumStock: 5, idealStock: 2 }))).toContain("ideal menor");
    expect(validateParameters(params({ minimumStock: 2, idealStock: 5 }))).toBeNull();
    expect(validateParameters(params({ monthlyConsumptionTarget: 0 }))).toContain("Consumo mensal 0");
  });
});
