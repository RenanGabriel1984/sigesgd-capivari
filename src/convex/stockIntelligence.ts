/**
 * Gestão de Estoque SGGD — INTELIGÊNCIA DE ESTOQUE (backend, somente leitura).
 *
 * Este módulo responde a DUAS perguntas operacionais e NÃO escreve nada:
 *
 *   1. PLANEJAMENTO DE REPOSIÇÃO — quais produtos estão abaixo do mínimo ou
 *      entre o mínimo e o ideal E têm `replenishmentEnabled = true`.
 *      Nenhum item aqui vira pedido, entrada, solicitação ou fornecedor.
 *
 *   2. HISTÓRICO DE CONSUMO — quanto foi REALMENTE consumido em um período,
 *      calculado exclusivamente das movimentações de SAÍDA registradas.
 *      Entrada, transferência, ajuste, devolução e movimento cancelado não
 *      contam. Sem histórico, a resposta é "Sem histórico suficiente" — nunca
 *      um zero inventado nem uma estimativa.
 *
 * RBAC:
 *   replenishment            → stock_parameters.view (Diretor consulta)
 *   consumption              → stock_parameters.view
 *   consumptionByOrganization → stock_parameters.view
 */

import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requirePermission } from "./rbac";
import {
  readReplenishmentParameters,
  buildStockParameterRow,
  type StockParameterRow,
} from "../lib/stock-parameters";
import {
  buildReplenishmentAlertRows,
  computeReplenishmentCounters,
  type ReplenishmentAlertRow,
  type ReplenishmentCounters,
} from "../lib/replenishment";
import {
  getConsumptionPeriod,
  consumptionPeriodStart,
  summarizeConsumption,
  isConsumptionMovement,
  monthlyConsumptionSeries,
  type ConsumptionPeriodKey,
  type ConsumableMovement,
  type ConsumptionSummary,
} from "../lib/consumption-history";
import {
  buildPeriodConsumptionReport,
  COST_UNAVAILABLE_LABEL,
  type ConsumptionAggregate,
  type OrganizationalMovement,
} from "../lib/consumption-organization";

const periodArg = v.union(
  v.literal("30d"),
  v.literal("60d"),
  v.literal("90d"),
  v.literal("6m"),
  v.literal("12m")
);

/* ─── Leitura compartilhada (nunca escreve) ─────────────────────────────────── */

async function loadStockParameterRows(ctx: QueryCtx): Promise<StockParameterRow[]> {
  const [products, stockRows, categories, areas, lots] = await Promise.all([
    ctx.db.query("products").collect(),
    ctx.db.query("stock").collect(),
    ctx.db.query("categories").collect(),
    ctx.db.query("stockAreas").collect(),
    ctx.db.query("lots").collect(),
  ]);

  const categoryNameById = new Map(categories.map((c) => [c._id, c.name]));
  const areaNameById = new Map(areas.map((a) => [a._id, a.name]));
  const stockByProduct = new Map(
    stockRows.map((s) => [s.productId, { physicalQuantity: s.physicalQuantity, reservedQuantity: s.reservedQuantity }])
  );

  const areaByProduct = new Map<string, Set<string>>();
  for (const lot of lots) {
    if (!lot.areaId) continue;
    const name = areaNameById.get(lot.areaId);
    if (!name) continue;
    const set = areaByProduct.get(lot.productId) ?? new Set<string>();
    set.add(name);
    areaByProduct.set(lot.productId, set);
  }

  const rows = products.map((p) =>
    buildStockParameterRow({
      productId: p._id,
      productName: p.name,
      categoryName: categoryNameById.get(p.categoryId) ?? null,
      areaName: [...(areaByProduct.get(p._id) ?? [])].sort().join(", ") || null,
      unitOfMeasure: p.unitOfMeasure,
      // Saldo REAL lido — nenhuma soma é convertida ou ajustada aqui.
      physicalStock: stockByProduct.get(p._id)?.physicalQuantity ?? 0,
      reservedStock: stockByProduct.get(p._id)?.reservedQuantity ?? 0,
      parameters: readReplenishmentParameters(p),
      packaging: {
        baseUnit: p.baseUnit ?? null,
        packagingUnit: p.packagingUnit ?? null,
        conversionFactor: p.conversionFactor ?? null,
      },
    })
  );

  rows.sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR"));
  return rows;
}

/* ═══ 1. ALERTAS DE PLANEJAMENTO DE REPOSIÇÃO ════════════════════════════════ */

/**
 * Linhas de alerta + contadores dos cards do Dashboard.
 *
 * Regras de contagem (produtos não parametrizados NUNCA contam):
 *   • "Reposição necessária": mínimo configurado + planejamento ativo +
 *     disponível <= mínimo;
 *   • "Reposição sugerida": mínimo e ideal configurados + planejamento ativo +
 *     disponível > mínimo e < ideal.
 */
export const replenishment = query({
  args: {},
  handler: async (ctx): Promise<{
    rows: ReplenishmentAlertRow[];
    counters: ReplenishmentCounters;
  }> => {
    await requirePermission(ctx, "stock_parameters.view", { entity: "products" });
    const alerts = buildReplenishmentAlertRows(await loadStockParameterRows(ctx));
    alerts.sort((a, b) => b.needToIdeal - a.needToIdeal || a.productName.localeCompare(b.productName, "pt-BR"));
    return { rows: alerts, counters: computeReplenishmentCounters(alerts) };
  },
});

/* ═══ 2. HISTÓRICO DE CONSUMO REAL ═══════════════════════════════════════════ */

/**
 * Consumo real por produto em um período.
 *
 * `hasHistory` distingue "consumo calculado" de "sem histórico suficiente": a
 * tela nunca mostra zero como se fosse um cálculo feito.
 */
export const consumption = query({
  args: { period: v.optional(periodArg) },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "stock_parameters.view", { entity: "products" });
    const now = Date.now();
    const period = getConsumptionPeriod((args.period ?? "30d") as ConsumptionPeriodKey);

    const [products, categories, movements] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("categories").collect(),
      ctx.db.query("stockMovements").collect(),
    ]);
    const categoryNameById = new Map(categories.map((c) => [c._id, c.name]));

    const consumable: ConsumableMovement[] = movements.map((m) => ({
      _id: m._id,
      productId: m.productId,
      type: m.type,
      quantity: m.quantity,
      timestamp: m.timestamp,
      canceled: m.canceled,
      exitMovementId: m.exitMovementId,
      requestId: m.requestId,
    }));

    const summaries = products
      .map((p) => {
        const summary: ConsumptionSummary = summarizeConsumption(
          consumable.filter((m) => m.productId === p._id),
          period,
          now
        );
        return {
          productId: p._id,
          productName: p.name,
          baseUnit: p.baseUnit || p.unitOfMeasure,
          categoryName: categoryNameById.get(p.categoryId) ?? null,
          ...summary,
        };
      })
      .filter((s) => s.exitCount > 0)
      .sort((a, b) => b.quantity - a.quantity);

    return {
      period: period.key,
      periodLabel: period.label,
      summaries,
      totalQuantity: summaries.reduce((sum, s) => sum + s.quantity, 0),
      totalExits: summaries.reduce((sum, s) => sum + s.exitCount, 0),
      withoutHistory: summaries.length === 0,
      series: monthlyConsumptionSeries(consumable, now, period.months),
    };
  },
});

/**
 * Consumo consolidado por Secretaria / Departamento / Unidade / Produto /
 * Categoria no período escolhido.
 *
 * Saídas sem solicitação vinculada NÃO são atribuídas a nenhuma Secretaria:
 * aparecem como "Sem solicitação vinculada".
 */
export const consumptionByOrganization = query({
  args: { period: v.optional(periodArg) },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "stock_parameters.view", { entity: "products" });
    const now = Date.now();
    const period = getConsumptionPeriod((args.period ?? "12m") as ConsumptionPeriodKey);
    const startMs = consumptionPeriodStart(period, now);

    const [movements, products, categories, lots, requests] = await Promise.all([
      ctx.db.query("stockMovements").collect(),
      ctx.db.query("products").collect(),
      ctx.db.query("categories").collect(),
      ctx.db.query("lots").collect(),
      ctx.db.query("requests").collect(),
    ]);

    const productById = new Map(products.map((p) => [p._id, p]));
    const categoryNameById = new Map(categories.map((c) => [c._id, c.name]));
    const requestById = new Map(requests.map((r) => [r._id, r]));

    // Custo unitário CONFIAVEL: apenas o `unitCost` do lote de origem já
    // cadastrado. Nenhum preço médio é estimado.
    const unitCostByLot = new Map<string, number>();
    for (const lot of lots) {
      if (typeof lot.unitCost === "number" && lot.unitCost > 0) {
        unitCostByLot.set(lot.lotNumber, lot.unitCost);
      }
    }

    const orgNames = async (orgId: Id<"organizations"> | undefined): Promise<string | null> => {
      if (!orgId) return null;
      const org = await ctx.db.get(orgId);
      return org?.name ?? null;
    };

    const enriched: OrganizationalMovement[] = [];
    for (const m of movements) {
      if (!isConsumptionMovement(m)) continue;
      const product = productById.get(m.productId);
      const request = m.requestId ? requestById.get(m.requestId) : null;
      const [secretariaName, departamentoName, unidadeName] = await Promise.all([
        orgNames(request?.secretariaId),
        orgNames(request?.departamentoId),
        orgNames(request?.unidadeId),
      ]);
      const productDoc = product as
        | (typeof products)[number]
        | undefined;
      enriched.push({
        _id: m._id,
        productId: m.productId,
        type: m.type,
        quantity: m.quantity,
        timestamp: m.timestamp,
        canceled: m.canceled,
        exitMovementId: m.exitMovementId,
        requestId: m.requestId,
        productName: productDoc?.name ?? "Produto não identificado",
        categoryName: productDoc ? categoryNameById.get(productDoc.categoryId) : undefined,
        secretariaName,
        departamentoName,
        unidadeName,
        unitCost: m.lotId ? unitCostByLot.get(m.lotId) ?? null : null,
      });
    }

    const report = buildPeriodConsumptionReport(enriched, period, startMs);
    return {
      bySecretaria: report.bySecretaria as ConsumptionAggregate[],
      byDepartment: report.byDepartment,
      byUnit: report.byUnit,
      byProduct: report.byProduct,
      byCategory: report.byCategory,
      costLabel: COST_UNAVAILABLE_LABEL,
      withoutHistory: report.withoutHistory,
      note: report.note,
    };
  },
});
