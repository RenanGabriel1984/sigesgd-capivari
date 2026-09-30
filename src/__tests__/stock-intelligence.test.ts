/**
 * Gestão de Estoque SGGD — INTELIGÊNCIA DE ESTOQUE (rodada: consumo, reposição,
 *não tocar o saldo).
 *
 * Regras verificadas aqui:
 *  - "Participa do planejamento de reposição" é OPT-IN: desligado o produto
 *    continua visível com sua situação, mas não gera alerta;
 *  - a situação de estoque segue mínimo/ideal exatamente como especificado;
 *  - a necessidade até o ideal é max(ideal − disponível, 0) e é INFORMATIVA;
 *  - consumo é calculado SÓ das saídas reais: entrada, transferência, ajuste,
 *    devolução e movimento cancelado NUNCA contam;
 *  - sem histórico ⇒ "Sem histórico suficiente" (nunca zero inventado);
 *  - custo só aparece quando existe custo confiável; senão "Custo não informado";
 *  - kits/packs são apresentados como CONVERSÃO AUXILIAR (o saldo base nunca é
 *    substituído) e a composição física do protetor de crachá é preservada;
 *  - nenhuma destas regras escreve em stock, lots, stockMovements ou entries.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhum dado real alterado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  REPLENISHMENT_PLANNING_LABEL,
  REPLENISHMENT_PLANNING_HELP,
  CONSUMPTION_AUTO_NOTICE,
  participatesInPlanning,
  planningParticipationLabel,
  needToReachIdeal,
  buildReplenishmentAlertRow,
  buildReplenishmentAlertRows,
  computeReplenishmentCounters,
  applyReplenishmentAlertFilter,
  replenishmentAlertHref,
  readReplenishmentAlertFilter,
  type ReplenishmentAlertRow,
} from "@/lib/replenishment";
import {
  readReplenishmentParameters,
  replenishmentStatus,
  suggestedReplenishmentQuantity,
  buildStockParameterRow,
  draftFromInputs,
  type ReplenishmentParameters,
  type StockParameterRow,
} from "@/lib/stock-parameters";
import {
  CONSUMPTION_PERIODS,
  CONSUMPTION_INSUFFICIENT_LABEL,
  CONSUMPTION_PENDING_LABEL,
  consumptionPeriodStart,
  getConsumptionPeriod,
  isConsumptionMovement,
  consumptionExclusionReason,
  selectConsumptionMovements,
  summarizeConsumption,
  summarizeProductConsumption,
  monthlyConsumptionSeries,
  type ConsumableMovement,
} from "@/lib/consumption-history";
import {
  NO_ORGANIZATION_LABEL,
  COST_UNAVAILABLE_LABEL,
  organizationOf,
  resolveConsumptionUnitCost,
  describeConsumptionCost,
  aggregateConsumptionBy,
  aggregateConsumptionByOrganizationAndProduct,
  buildPeriodConsumptionReport,
  type OrganizationalMovement,
} from "@/lib/consumption-organization";
import {
  LIMPA_CONTATO_PRESENTATION_FIX,
  SPRAY_PRESENTATION_NOTE,
  isPhysicalPresentation,
  presentationRole,
  describePackComposition,
  summarizePhysicalComposition,
  decidePresentationUnitFix,
} from "@/lib/presentation-units";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const replenishmentLib = read("src/lib/replenishment.ts");
const consumptionLib = read("src/lib/consumption-history.ts");
const organizationLib = read("src/lib/consumption-organization.ts");
const presentationLib = read("src/lib/presentation-units.ts");
const intelligenceBackend = read("src/convex/stockIntelligence.ts");
const parameterBackend = read("src/convex/stockParameters.ts");
const packagingBackend = read("src/convex/packagingParameters.ts");
const dashboardPage = read("src/pages/Dashboard.tsx");
const stockParametersPage = read("src/pages/StockParameters.tsx");
const appShell = read("src/components/AppShell.tsx");

const DAY = 24 * 60 * 60 * 1000;
/** Instante fixo: nenhum teste depende do relógio real. */
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

/* ─── Fixtures ──────────────────────────────────────────────────────────────── */

/** Parâmetros de reposição com mínimo/ideal e opt-in explícito. */
function params(
  overrides: Partial<ReplenishmentParameters> = {}
): ReplenishmentParameters {
  return readReplenishmentParameters({
    minimumStock: null,
    idealStock: null,
    replenishmentEnabled: false,
    replenishmentNote: null,
    ...overrides,
  });
}

/** Linha da parametrização já com saldo real (físico − reservado). */
function row(
  productId: string,
  available: number,
  overrides: Partial<ReplenishmentParameters> = {}
): StockParameterRow {
  return buildStockParameterRow({
    productId,
    productName: `Produto ${productId}`,
    categoryName: "Papelaria",
    areaName: "SGGD",
    unitOfMeasure: "un",
    physicalStock: available,
    reservedStock: 0,
    parameters: params(overrides),
  });
}

/** Movimentação real com tipo explícito (nunca inventada). */
function movement(
  overrides: Partial<ConsumableMovement> & { type: ConsumableMovement["type"] }
): ConsumableMovement {
  return {
    ...overrides,
    _id: overrides._id ?? "m1",
    productId: overrides.productId ?? "p1",
    type: overrides.type,
    quantity: overrides.quantity ?? 1,
    timestamp: overrides.timestamp ?? NOW - 2 * DAY,
  };
}

/** Saída de consumo enrichida com a hierarquia organizacional. */
function orgMovement(
  overrides: Partial<OrganizationalMovement> & { type: OrganizationalMovement["type"] }
): OrganizationalMovement {
  const base = movement(overrides);
  return {
    ...base,
    productName: overrides.productName,
    categoryName: overrides.categoryName,
    secretariaName: overrides.secretariaName,
    departamentoName: overrides.departamentoName,
    unidadeName: overrides.unidadeName,
    unitCost: overrides.unitCost,
  };
}

/** Remove comentários de bloco/linha para asserções negativas sobre o código. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/* ─── §1 · O opt-in "Participa do planejamento de reposição" ─────────────────── */

describe("INTEL-01 — Participa do planejamento de reposição (opt-in)", () => {
  it("o campo é booleano e tem o texto de UX exigido", () => {
    expect(REPLENISHMENT_PLANNING_LABEL).toBe("Participa do planejamento de reposição");
    expect(REPLENISHMENT_PLANNING_HELP).toBe(
      "Quando ativado, o produto participa dos alertas e do planejamento de reposição ao atingir o estoque mínimo.",
    );
    expect(CONSUMPTION_AUTO_NOTICE).toBe(
      "Consumo será calculado automaticamente a partir das saídas registradas no SIGESGD.",
    );
  });

  it("o nome interno no banco continua sendo replenishmentEnabled (sem migração)", () => {
    // A flag é lida/escrita pelo mesmo campo; só o TEXTO mudou.
    expect(stockParametersPage).toContain("replenishmentEnabled");
    expect(participatesInPlanning(params({ replenishmentEnabled: true }))).toBe(true);
    expect(participatesInPlanning(params({ replenishmentEnabled: false }))).toBe(false);
  });

  it("o rótulo curto da coluna é Sim/Não", () => {
    expect(planningParticipationLabel(params({ replenishmentEnabled: true }))).toBe("Sim");
    expect(planningParticipationLabel(params({ replenishmentEnabled: false }))).toBe("Não");
  });

  it("marcar o campo NÃO move estoque: o módulo puro é só classificação", () => {
    const lib = stripComments(replenishmentLib + consumptionLib + organizationLib + presentationLib);
    for (const proibido of ["ctx.db", "ctx.insert", "ctx.patch", "ctx.delete", "fetch("]) {
      expect(lib).not.toContain(proibido);
    }
  });
});

/* ─── §2 · Situação de estoque × planejamento ───────────────────────────────── */

describe("INTEL-02 — Regras de situação de estoque", () => {
  it("sem mínimo/ideal configurados ⇒ Não parametrizado", () => {
    expect(replenishmentStatus(0, params())).toBe("not_parametrized");
    expect(replenishmentStatus(999, params())).toBe("not_parametrized");
  });

  it("disponível <= mínimo ⇒ Reposição necessária", () => {
    expect(replenishmentStatus(10, params({ minimumStock: 10 }))).toBe("replenish_required");
    expect(replenishmentStatus(3, params({ minimumStock: 10, idealStock: 50 }))).toBe("replenish_required");
  });

  it("disponível > mínimo e < ideal ⇒ Reposição sugerida", () => {
    expect(replenishmentStatus(25, params({ minimumStock: 10, idealStock: 50 }))).toBe("replenish_suggested");
  });

  it("disponível >= ideal ⇒ Normal", () => {
    expect(replenishmentStatus(50, params({ minimumStock: 10, idealStock: 50 }))).toBe("normal");
    expect(replenishmentStatus(120, params({ minimumStock: 10, idealStock: 50 }))).toBe("normal");
  });

  it("com planejamento DESATIVADO a situação continua visível, mas não gera alerta", () => {
    // Caso do enunciado: estoque 8 · mínimo 10 · ideal 50 · planejamento = NÃO.
    const alert = buildReplenishmentAlertRow({
      productId: "p1",
      productName: "Cooler",
      baseUnit: "un",
      availableStock: 8,
      parameters: params({ minimumStock: 10, idealStock: 50, replenishmentEnabled: false }),
    });
    expect(alert.situation).toBe("replenish_required");
    expect(alert.situationLabel).toBe("Abaixo do mínimo");
    expect(alert.participatesInPlanning).toBe(false);
    expect(alert.planningLevel).toBeNull();
    expect(alert.planningLabel).toBe("—");
    // Nada é escondido e nada é convertido.
    expect(alert.availableStock).toBe(8);
    expect(alert.needToIdeal).toBe(42);
  });

  it("com planejamento ATIVADO o mesmo produto vira item de reposição", () => {
    const alert = buildReplenishmentAlertRow({
      productId: "p1",
      productName: "Cooler",
      baseUnit: "un",
      availableStock: 8,
      parameters: params({ minimumStock: 10, idealStock: 50, replenishmentEnabled: true }),
    });
    expect(alert.planningLevel).toBe("necessary");
    expect(alert.planningLabel).toBe("Reposição necessária");
  });
});

/* ─── §3 · Contadores e visão filtrada do Dashboard ────────────────────────── */

describe("INTEL-03 — Contadores do Dashboard e visão filtrada", () => {
  const rows: StockParameterRow[] = [
    // abaixo do mínimo COM planejamento
    row("a", 3, { minimumStock: 10, idealStock: 50, replenishmentEnabled: true }),
    // entre mínimo e ideal COM planejamento
    row("b", 30, { minimumStock: 10, idealStock: 50, replenishmentEnabled: true }),
    // normal COM planejamento
    row("c", 80, { minimumStock: 10, idealStock: 50, replenishmentEnabled: true }),
    // abaixo do mínimo SEM planejamento
    row("d", 1, { minimumStock: 10, idealStock: 50, replenishmentEnabled: false }),
    // não parametrizado (nunca conta como alerta)
    row("e", 0),
    row("f", 12),
  ];
  const alerts = buildReplenishmentAlertRows(rows);
  const counters = computeReplenishmentCounters(alerts);

  it("necessário = mínimo + planejamento ativo + disponível <= mínimo", () => {
    expect(counters.necessary).toBe(1);
    expect(computeReplenishmentCounters([alerts[0]]).necessary).toBe(1);
  });

  it("sugerido = mínimo e ideal + planejamento ativo + entre os dois", () => {
    expect(counters.suggested).toBe(1);
    expect(applyReplenishmentAlertFilter(alerts, "suggested").map((r: ReplenishmentAlertRow) => r.productId)).toEqual(["b"]);
  });

  it("produtos não parametrizados NUNCA são contados", () => {
    expect(counters.notParametrized).toBe(2);
    const naoParametrizados = applyReplenishmentAlertFilter(alerts, "necessary").filter((r) => !r.parametrized);
    expect(naoParametrizados).toEqual([]);
  });

  it("produto abaixo do mínimo sem planejamento aparece em contagem própria", () => {
    expect(counters.belowMinimumWithoutPlanning).toBe(1);
    expect(counters.participating).toBe(3);
    expect(applyReplenishmentAlertFilter(alerts, "without_planning").map((r) => r.productId)).toEqual(["d"]);
  });

  it("a necessidade para atingir o ideal é max(ideal − disponível, 0)", () => {
    expect(needToReachIdeal(8, params({ minimumStock: 10, idealStock: 50 }))).toBe(42);
    expect(needToReachIdeal(50, params({ minimumStock: 10, idealStock: 50 }))).toBe(0);
    expect(needToReachIdeal(80, params({ minimumStock: 10, idealStock: 50 }))).toBe(0);
    // Sem ideal configurado, não há necessidade a informar.
    expect(suggestedReplenishmentQuantity(3, params({ minimumStock: 10 }))).toBe(0);
    expect(alerts.map((r) => r.needToIdeal)).toEqual([47, 20, 0, 49, 0, 0]);
  });

  it("o card navega para a visão filtrada (sem criar compra nem entrada)", () => {
    expect(replenishmentAlertHref("necessary")).toBe("/stock-parameters?situacao=necessary");
    expect(replenishmentAlertHref("suggested")).toBe("/stock-parameters?situacao=suggested");
    expect(replenishmentAlertHref("without_planning")).toBe("/stock-parameters?situacao=without_planning");
    expect(replenishmentAlertHref("all")).toBe("/stock-parameters");
    expect(readReplenishmentAlertFilter("?situacao=necessary")).toBe("necessary");
    expect(readReplenishmentAlertFilter("?situacao=inventado")).toBe("all");
    expect(readReplenishmentAlertFilter("")).toBe("all");
  });

  it("a listagem do Dashboard traz Produto, Categoria, Área, estoque, mínimo, ideal, necessidade e situação", () => {
    for (const coluna of [
      "Produto",
      "Categoria",
      "Área",
      "Estoque atual",
      "Mínimo",
      "Ideal",
      "Necessidade p/ o ideal",
      "Situação",
    ]) {
      expect(dashboardPage).toContain(coluna);
    }
    expect(dashboardPage).toContain("Reposição necessária");
    expect(dashboardPage).toContain("Reposição sugerida");
    expect(dashboardPage).toContain("api.stockIntelligence.replenishment");
    expect(dashboardPage).toContain("Nenhuma compra, entrada ou solicitação é criada automaticamente.");
  });
});

/* ─── §4 · O consumo mensal deixa de ser digitado ───────────────────────────── */

describe("INTEL-04 — Consumo mensal não é mais parâmetro obrigatório", () => {
  it("a tela não oferece input de consumo mensal", () => {
    expect(stockParametersPage).not.toContain('aria-label="Consumo mensal"');
    expect(stockParametersPage).toContain("CONSUMPTION_AUTO_NOTICE");
    expect(stockParametersPage).toContain('value="consumo"');
  });

  it("editar a linha preserva o valor legado já cadastrado (não apaga nem inventa)", () => {
    const legado = params({ monthlyConsumptionTarget: 7 });
    const draft = draftFromInputs({ minimum: "2", ideal: "5", enabled: false, note: "" }, legado);
    expect(draft.monthlyConsumptionTarget).toBe(7);
    // Sem cadastro anterior, continua "não parametrizado" (não vira zero).
    const semLegado = draftFromInputs({ minimum: "2", ideal: "5", enabled: false, note: "" });
    expect(semLegado.monthlyConsumptionTarget).toBeNull();
  });
});

/* ─── §5 · Histórico de consumo: SOMENTE saídas reais ───────────────────────── */

describe("INTEL-05 — O que conta como consumo", () => {
  it("saída não cancelada conta", () => {
    expect(isConsumptionMovement(movement({ type: "exit" }))).toBe(true);
  });

  it("entrada, transferência e ajuste NUNCA contam como consumo", () => {
    for (const type of ["entry", "transfer", "adjustment"] as const) {
      const m = movement({ type });
      expect(isConsumptionMovement(m)).toBe(false);
      expect(consumptionExclusionReason(m)).not.toBeNull();
    }
  });

  it("devolução NUNCA conta como consumo", () => {
    const devolucao = movement({ type: "return", exitMovementId: "m0" });
    expect(isConsumptionMovement(devolucao)).toBe(false);
    expect(consumptionExclusionReason(devolucao)).toBe("devolução");
    // Nem uma saída vinculada a devolução.
    expect(isConsumptionMovement(movement({ type: "exit", exitMovementId: "m0" }))).toBe(false);
  });

  it("movimentação cancelada nunca conta", () => {
    expect(isConsumptionMovement(movement({ type: "exit", canceled: true }))).toBe(false);
    expect(consumptionExclusionReason(movement({ type: "exit", canceled: true }))).toBe("movimentação cancelada");
  });

  it("consumo SEM movimentações ⇒ Sem histórico suficiente (nunca zero inventado)", () => {
    const resumo = summarizeConsumption([], getConsumptionPeriod("30d"), NOW);
    expect(resumo.hasHistory).toBe(false);
    expect(resumo.quantity).toBe(0);
    expect(resumo.exitCount).toBe(0);
    expect(resumo.statusLabel).toBe(CONSUMPTION_INSUFFICIENT_LABEL);
    expect(resumo.statusLabel).not.toBe("0");
    expect(CONSUMPTION_PENDING_LABEL).toBe("Aguardando movimentações");
  });

  it("consumo COM saídas soma apenas as saídas do período", () => {
    const resumo = summarizeConsumption(
      [
        movement({ _id: "m1", type: "exit", quantity: 5, timestamp: NOW - 3 * DAY }),
        movement({ _id: "m2", type: "exit", quantity: 2, timestamp: NOW - 10 * DAY }),
        movement({ _id: "m3", type: "transfer", quantity: 99, timestamp: NOW - 4 * DAY }),
        movement({ _id: "m4", type: "entry", quantity: 100, timestamp: NOW - 1 * DAY }),
      ],
      getConsumptionPeriod("30d"),
      NOW
    );
    expect(resumo.hasHistory).toBe(true);
    expect(resumo.quantity).toBe(7);
    expect(resumo.exitCount).toBe(2);
    expect(resumo.excludedCount).toBe(2);
    expect(resumo.monthlyAverage).toBe(7);
    expect(resumo.lastExitAt).toBe(NOW - 3 * DAY);
    expect(resumo.firstExitAt).toBe(NOW - 10 * DAY);
  });

  it("summarizeProductConsumption isola o produto", () => {
    const movimentos = [
      movement({ _id: "m1", productId: "p1", type: "exit", quantity: 4 }),
      movement({ _id: "m2", productId: "p2", type: "exit", quantity: 9 }),
    ];
    const resumo = summarizeProductConsumption("p1", movimentos, getConsumptionPeriod("30d"), NOW);
    expect(resumo.productId).toBe("p1");
    expect(resumo.quantity).toBe(4);
  });
});

/* ─── §5 · Períodos de 30/60/90 dias e 6/12 meses ─────────────────────────── */

describe("INTEL-06 — Períodos de consumo", () => {
  it("existem exatamente os cinco períodos com as durações esperadas", () => {
    expect(CONSUMPTION_PERIODS.map((p) => p.key)).toEqual(["30d", "60d", "90d", "6m", "12m"]);
    expect(CONSUMPTION_PERIODS.map((p) => p.days)).toEqual([30, 60, 90, 183, 365]);
    expect(CONSUMPTION_PERIODS.map((p) => p.months)).toEqual([1, 2, 3, 6, 12]);
  });

  it("30 dias: a saída de 31 dias atrás fica fora", () => {
    const movimentos = [
      movement({ _id: "dentro", type: "exit", quantity: 1, timestamp: NOW - 29 * DAY }),
      movement({ _id: "fora", type: "exit", quantity: 50, timestamp: NOW - 31 * DAY }),
    ];
    const resumo = summarizeConsumption(movimentos, getConsumptionPeriod("30d"), NOW);
    expect(resumo.quantity).toBe(1);
    expect(consumptionPeriodStart(getConsumptionPeriod("30d"), NOW)).toBe(NOW - 30 * DAY);
  });

  it("60 dias: inclui 45 dias, exclui 61", () => {
    const resumo = summarizeConsumption(
      [
        movement({ _id: "dentro", type: "exit", quantity: 2, timestamp: NOW - 45 * DAY }),
        movement({ _id: "fora", type: "exit", quantity: 77, timestamp: NOW - 61 * DAY }),
      ],
      getConsumptionPeriod("60d"),
      NOW
    );
    expect(resumo.quantity).toBe(2);
  });

  it("90 dias: inclui 80, exclui 95", () => {
    const resumo = summarizeConsumption(
      [
        movement({ _id: "dentro", type: "exit", quantity: 3, timestamp: NOW - 80 * DAY }),
        movement({ _id: "fora", type: "exit", quantity: 88, timestamp: NOW - 95 * DAY }),
      ],
      getConsumptionPeriod("90d"),
      NOW
    );
    expect(resumo.quantity).toBe(3);
  });

  it("6 meses (183 dias): inclui 170, exclui 200", () => {
    const resumo = summarizeConsumption(
      [
        movement({ _id: "dentro", type: "exit", quantity: 4, timestamp: NOW - 170 * DAY }),
        movement({ _id: "fora", type: "exit", quantity: 400, timestamp: NOW - 200 * DAY }),
      ],
      getConsumptionPeriod("6m"),
      NOW
    );
    expect(resumo.quantity).toBe(4);
  });

  it("12 meses (365 dias): inclui 300, exclui 400", () => {
    const resumo = summarizeConsumption(
      [
        movement({ _id: "dentro", type: "exit", quantity: 5, timestamp: NOW - 300 * DAY }),
        movement({ _id: "fora", type: "exit", quantity: 500, timestamp: NOW - 400 * DAY }),
      ],
      getConsumptionPeriod("12m"),
      NOW
    );
    expect(resumo.quantity).toBe(5);
  });

  it("a média mensal usa a duração do período", () => {
    const resumo = summarizeConsumption(
      [movement({ type: "exit", quantity: 12, timestamp: NOW - 10 * DAY })],
      getConsumptionPeriod("6m"),
      NOW
    );
    expect(resumo.monthlyAverage).toBe(2);
  });

  it("selectConsumptionMovements devolve só saídas dentro da janela", () => {
    const selecionados = selectConsumptionMovements(
      [
        movement({ _id: "a", type: "exit", timestamp: NOW - 5 * DAY }),
        movement({ _id: "b", type: "transfer", timestamp: NOW - 5 * DAY }),
        movement({ _id: "c", type: "exit", timestamp: NOW - 40 * DAY }),
      ],
      getConsumptionPeriod("30d"),
      NOW
    );
    expect(selecionados.map((m) => m._id)).toEqual(["a"]);
  });

  it("a série mensal só inclui meses com saída real", () => {
    const serie = monthlyConsumptionSeries(
      [movement({ type: "exit", quantity: 3, timestamp: NOW - 5 * DAY })],
      NOW,
      6
    );
    expect(serie).toHaveLength(6);
    expect(serie.reduce((s, p) => s + p.quantity, 0)).toBe(3);
  });
});

/* ─── §6 · Consumo por Secretaria / Departamento / Unidade ──────────────────── */

describe("INTEL-07 — Consumo por organização", () => {
  const movimentos: OrganizationalMovement[] = [
    orgMovement({ _id: "m1", productId: "pt", type: "exit", quantity: 5, productName: "Toner", categoryName: "Impressão", secretariaName: "Educação", departamentoName: "TI", unidadeName: "Escola Central", unitCost: 10 }),
    orgMovement({ _id: "m2", productId: "pt", type: "exit", quantity: 3, productName: "Toner", categoryName: "Impressão", secretariaName: "Educação", departamentoName: "Compras", unidadeName: "Escola Central", unitCost: 10 }),
    orgMovement({ _id: "m3", productId: "pv", type: "exit", quantity: 8, productName: "Cartão PVC", categoryName: "Identificação", secretariaName: "Saúde", departamentoName: "TI", unidadeName: "UBS Centro" }),
    // Ignoradas: não são saídas.
    orgMovement({ _id: "m4", productId: "pt", type: "transfer", quantity: 500, productName: "Toner", secretariaName: "Educação" }),
    orgMovement({ _id: "m5", productId: "pt", type: "exit", quantity: 400, productName: "Toner", secretariaName: "Educação", canceled: true }),
    orgMovement({ _id: "m6", productId: "pt", type: "return", quantity: 700, productName: "Toner", secretariaName: "Educação" }),
  ];

  it("agrupa por Secretaria somente com saídas reais", () => {
    const porSecretaria = aggregateConsumptionBy(movimentos, "secretaria");
    // Empate em quantidade (8 × 8) é desfeito pelo rótulo em pt-BR.
    expect(porSecretaria.map((a) => a.label)).toEqual(["Educação", "Saúde"]);
    expect(porSecretaria.find((a) => a.label === "Educação")?.quantity).toBe(8);
    expect(porSecretaria.find((a) => a.label === "Saúde")?.exitCount).toBe(1);
  });

  it("agrupa por Departamento", () => {
    const porDepartamento = aggregateConsumptionBy(movimentos, "departamento");
    expect(porDepartamento.map((a) => `${a.label}:${a.quantity}`)).toEqual(["TI:13", "Compras:3"]);
  });

  it("agrupa por Unidade", () => {
    const porUnidade = aggregateConsumptionBy(movimentos, "unidade");
    expect(porUnidade.find((a) => a.label === "Escola Central")?.quantity).toBe(8);
    expect(porUnidade.find((a) => a.label === "UBS Centro")?.quantity).toBe(8);
  });

  it("saída sem solicitação vinculada NÃO é atribuída a uma Secretaria inventada", () => {
    const semVinculo = orgMovement({ _id: "m7", productId: "pt", type: "exit", quantity: 1, productName: "Toner" });
    expect(organizationOf(semVinculo, "secretaria")).toBe(NO_ORGANIZATION_LABEL);
    const agregados = aggregateConsumptionBy([...movimentos, semVinculo], "secretaria");
    expect(agregados.some((a) => a.label === NO_ORGANIZATION_LABEL)).toBe(true);
  });

  it("responde “quanto a Secretaria X consumiu do produto Y”", () => {
    const cruzamento = aggregateConsumptionByOrganizationAndProduct(movimentos, "secretaria");
    const educacaoToner = cruzamento.find((a) => a.label === "Educação" && a.productName === "Toner");
    expect(educacaoToner?.quantity).toBe(8);
    expect(aggregateConsumptionByOrganizationAndProduct(movimentos, "departamento").map((a) => a.label)).toContain("TI");
  });

  it("agrupa por produto e por categoria", () => {
    expect(aggregateConsumptionBy(movimentos, "product").map((a) => `${a.label}:${a.quantity}`)).toEqual([
      "Cartão PVC:8",
      "Toner:8",
    ]);
    expect(aggregateConsumptionBy(movimentos, "category").map((a) => `${a.label}:${a.quantity}`)).toEqual([
      "Identificação:8",
      "Impressão:8",
    ]);
  });

  it("o relatório do período sinaliza ausência de histórico em vez de zero", () => {
    const semSaidas = buildPeriodConsumptionReport(
      [orgMovement({ type: "transfer", quantity: 50, productName: "Toner" })],
      getConsumptionPeriod("12m"),
      consumptionPeriodStart(getConsumptionPeriod("12m"), NOW)
    );
    expect(semSaidas.withoutHistory).toBe(true);
    expect(semSaidas.totalQuantity).toBe(0);
    expect(semSaidas.note).toContain("nada é estimado");

    const comSaidas = buildPeriodConsumptionReport(
      movimentos,
      getConsumptionPeriod("12m"),
      consumptionPeriodStart(getConsumptionPeriod("12m"), NOW)
    );
    expect(comSaidas.withoutHistory).toBe(false);
    expect(comSaidas.totalQuantity).toBe(16);
    expect(comSaidas.totalExitCount).toBe(3);
    expect(comSaidas.byCategory.map((a) => a.label).sort()).toEqual(["Identificação", "Impressão"]);
  });
});

/* ─── §7 · Custo de consumo ────────────────────────────────────────────────── */

describe("INTEL-08 — Custo só quando existe dado confiável", () => {
  it("sem custo unitário confiável ⇒ Custo não informado", () => {
    expect(COST_UNAVAILABLE_LABEL).toBe("Custo não informado");
    expect(resolveConsumptionUnitCost(orgMovement({ type: "exit" }))).toBeNull();
    expect(resolveConsumptionUnitCost(orgMovement({ type: "exit", unitCost: 0 }))).toBeNull();
    expect(resolveConsumptionUnitCost(orgMovement({ type: "exit", unitCost: -5 }))).toBeNull();
    const { total, label } = describeConsumptionCost(10, null);
    expect(total).toBeNull();
    expect(label).toBe(COST_UNAVAILABLE_LABEL);
  });

  it("usa o custo do lote quando ele existe", () => {
    expect(resolveConsumptionUnitCost(orgMovement({ type: "exit", unitCost: 12.5 }))).toBe(12.5);
    expect(describeConsumptionCost(4, 12.5).total).toBe(50);
  });

  it("grupo parcialmente sem custo é “Custo não informado” (nunca custo parcial)", () => {
    const agregados = aggregateConsumptionBy(
      [
        orgMovement({ _id: "a", type: "exit", quantity: 2, secretariaName: "Educação", unitCost: 10 }),
        orgMovement({ _id: "b", type: "exit", quantity: 3, secretariaName: "Educação" }),
      ],
      "secretaria"
    );
    expect(agregados[0].cost).toBeNull();
    expect(agregados[0].costLabel).toBe(COST_UNAVAILABLE_LABEL);
  });
});

/* ─── §10 · Kits e packs são apresentação auxiliar ─────────────────────────── */

describe("INTEL-09 — Kits e packs (conversão auxiliar)", () => {
  it("jogo de chaves 6 peças: 2 kits = 12 peças, sem substituir o saldo base", () => {
    const composicao = describePackComposition({ baseQuantity: 12, baseUnit: "peça", factor: 6, packagingUnit: "kit" });
    expect(composicao?.packs).toBe(2);
    expect(composicao?.baseQuantity).toBe(12);
    expect(composicao?.label).toBe("12 peças = 2 kits (1 kit = 6 peças)");
  });

  it("jogo de chaves 8 peças: 1 kit = 8 peças", () => {
    const composicao = describePackComposition({ baseQuantity: 8, baseUnit: "peça", factor: 8, packagingUnit: "kit" });
    expect(composicao?.packs).toBe(1);
    expect(composicao?.label).toBe("8 peças = 1 kit (1 kit = 8 peças)");
  });

  it("pilha AAA: 3 packs = 6 pilhas", () => {
    const composicao = describePackComposition({ baseQuantity: 6, baseUnit: "pilha", factor: 2, packagingUnit: "pack" });
    expect(composicao?.packs).toBe(3);
    expect(composicao?.label).toBe("6 pilhas = 3 packs (1 pack = 2 pilhas)");
  });

  it("fator inválido não produz conversão (nada é inventado)", () => {
    expect(describePackComposition({ baseQuantity: 2, baseUnit: "peça", factor: 0, packagingUnit: "kit" })).toBeNull();
    expect(describePackComposition({ baseQuantity: 2, baseUnit: "", factor: 6, packagingUnit: "kit" })).toBeNull();
  });
});

/* ─── §11 · Protetor de crachá: composição preservada ──────────────────────── */

describe("INTEL-10 — Protetor de crachá (13 caixas + 18 avulsas)", () => {
  const composicao = summarizePhysicalComposition(
    [
      { quantity: 13, unit: "caixa", factor: 50, baseUnit: "un" },
      { quantity: 18, unit: "un", baseUnit: "un" },
    ],
    "un"
  );

  it("preserva as 13 caixas separadas das 18 avulsas", () => {
    expect(composicao.partsLabel).toBe("13 caixas + 18 un avulsas");
    expect(composicao.components).toHaveLength(2);
    expect(composicao.components[0].quantity).toBe(13);
  });

  it("mostra o equivalente sem destruir a rastreabilidade", () => {
    expect(composicao.totalBase).toBe(668);
    expect(composicao.label).toBe("13 caixas + 18 un avulsas = 668 un");
  });
});

/* ─── §12 · Limpa contato: un + spray ──────────────────────────────────────── */

describe("INTEL-11 — Spray é apresentação, não unidade-base", () => {
  it("o limpador de contatos é “un” na base e “spray” na apresentação", () => {
    expect(LIMPA_CONTATO_PRESENTATION_FIX).toEqual({ from: "pote", to: "spray", baseUnit: "un" });
    const decisao = decidePresentationUnitFix({ baseUnit: "un", packagingUnit: "pote", conversionFactor: 1 });
    expect(decisao.shouldApply).toBe(true);
    // Patch único: SOMENTE o campo de apresentação.
    expect(decisao.patch).toEqual({ packagingUnit: "spray" });
    expect(decisao.after.baseUnit).toBe("un");
    expect(decisao.after.conversionFactor).toBe(1);
  });

  it("a correção é idempotente e nunca mexe em base/fator/conversão", () => {
    const jaCorrigido = decidePresentationUnitFix({ baseUnit: "un", packagingUnit: "spray", conversionFactor: 1 });
    expect(jaCorrigido.shouldApply).toBe(false);
    expect(jaCorrigido.patch).toBeNull();
    // Base inesperada ⇒ revisão manual, nada é gravado.
    expect(decidePresentationUnitFix({ baseUnit: "pote", packagingUnit: "pote" }).patch).toBeNull();
  });

  it("spray/pote/frasco/cartucho são sempre apresentação física", () => {
    for (const unit of ["spray", "pote", "frasco", "cartucho", "blister", "caixa", "pack"]) {
      expect(isPhysicalPresentation(unit)).toBe(true);
      expect(presentationRole(unit)).toBe("apresentacao");
    }
    expect(presentationRole("un")).toBe("base");
    expect(SPRAY_PRESENTATION_NOTE).toContain("APRESENTAÇÃO");
  });

  it("a correção cadastral não escreve em estoque, lote, movimentação ou NF-e", () => {
    const backend = stripComments(read("src/convex/presentationFixes.ts"));
    expect(backend).toContain("packagingUnit");
    for (const tabela of ["stock", "lots", "stockMovements", "entries", "entryItems", "stockByLocation"]) {
      expect(backend).not.toContain(`db.insert("${tabela}"`);
      expect(backend).not.toContain(`db.patch("${tabela}"`);
      expect(backend).not.toContain(`db.get("${tabela}"`);
    }
  });
});

/* ─── §13 · Menu lateral sem truncar nomes ─────────────────────────────────── */

describe("INTEL-12 — UX do menu lateral", () => {
  it("os itens usam rótulos curtos e uma seção de configuração de estoque", () => {
    expect(appShell).toContain('label: "Parâmetros de estoque"');
    expect(appShell).toContain('label: "Embalagens"');
    expect(appShell).toContain('title: "Configuração de Estoque"');
    // Os títulos longos ficam dentro da página, não no menu.
    expect(stockParametersPage).toContain("Parametrização de Estoque");
  });

  it("nenhum nome do menu é truncado por overflow", () => {
    const link = stripComments(appShell.slice(appShell.indexOf("const SidebarLink"), appShell.indexOf("export function AppShell")));
    expect(link).not.toContain("truncate");
    // O `title` é complementar, não a única forma de ler o nome.
    expect(link).toContain("title={item.label}");
    expect(link).toContain("break-words");
  });
});

/* ─── §14 · Nada de escrita em estoque ─────────────────────────────────────── */

describe("INTEL-13 — Nenhuma alteração de saldo", () => {
  it("os módulos de inteligência são somente leitura (apenas query)", () => {
    const backend = stripComments(intelligenceBackend);
    expect(backend).toContain("query(");
    for (const escrita of ["db.insert", "db.patch", "db.replace", "db.delete", "mutation(", "internalMutation("]) {
      expect(backend).not.toContain(escrita);
    }
  });

  it("salvar parâmetros grava só campos cadastrais + auditoria", () => {
    const backend = stripComments(parameterBackend);
    expect(backend).toContain("db.patch(");
    for (const proibido of [
      'db.insert("lots"',
      'db.insert("stockMovements"',
      'db.insert("entries"',
      'db.insert("entryItems"',
      'db.get("stockMovements"',
      'db.get("lots"',
      "quantityAvailable",
      "quantityReceived",
    ]) {
      expect(backend).not.toContain(proibido);
    }
    expect(stockParametersPage).toContain("Nenhuma movimentação de estoque foi registrada.");
  });

  it("parametrização de embalagens também é só cadastro", () => {
    const backend = stripComments(packagingBackend);
    for (const escrita of [
      'db.insert("lots"',
      'db.insert("stock"',
      'db.insert("stockMovements"',
      'db.insert("entryItems"',
      'db.patch("stock"',
    ]) {
      expect(backend).not.toContain(escrita);
    }
  });
});