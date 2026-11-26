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
import { getOptionalSingleValidGlobalStock } from "../lib/stock-read-integrity";
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
  aggregateConsumptionHierarchy,
  COST_UNAVAILABLE_LABEL,
  type ConsumptionAggregate,
  type OrganizationalMovement,
} from "../lib/consumption-organization";

const periodArg = v.union(
  v.literal("15d"),
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
    products.map((product) => {
      const rows = stockRows.filter((row) => row.productId === product._id);
      const stock = getOptionalSingleValidGlobalStock(rows, product.name);
      return [product._id, {
        physicalQuantity: stock?.physicalQuantity ?? 0,
        reservedQuantity: stock?.reservedQuantity ?? 0,
      }] as const;
    })
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
    const currentStartMs = consumptionPeriodStart(period, now);
    const previousStartMs = currentStartMs - period.days * 24 * 60 * 60 * 1000;

    // Leitura limitada à janela atual + janela imediatamente anterior.
    const [movements, products, categories, allocations] = await Promise.all([
      ctx.db.query("stockMovements")
        .withIndex("by_timestamp", (q) => q.gte("timestamp", previousStartMs))
        .collect(),
      ctx.db.query("products").collect(),
      ctx.db.query("categories").collect(),
      ctx.db.query("stockMovementLotAllocations")
        .withIndex("by_created_at", (q) => q.gte("createdAt", previousStartMs))
        .collect(),
    ]);

    const relevantMovements = movements.filter((movement) =>
      isConsumptionMovement(movement) &&
      movement.timestamp >= previousStartMs &&
      movement.timestamp <= now
    );
    const movementIds = new Set(relevantMovements.map((movement) => String(movement._id)));
    const withdrawalsByMovement = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      const movementId = String(allocation.movementId);
      if (allocation.allocationType !== "withdrawal" || !movementIds.has(movementId)) continue;
      const rows = withdrawalsByMovement.get(movementId) ?? [];
      rows.push(allocation);
      withdrawalsByMovement.set(movementId, rows);
    }

    const requestIds = [...new Set(
      relevantMovements.flatMap((movement) => movement.requestId ? [String(movement.requestId)] : [])
    )];
    const requestDocs = await Promise.all(
      requestIds.map((id) => ctx.db.get(id as Id<"requests">))
    );
    const requestById = new Map<string, NonNullable<(typeof requestDocs)[number]>>();
    for (const request of requestDocs) {
      if (request) requestById.set(String(request._id), request);
    }

    const organizationIds = new Set<Id<"organizations">>();
    for (const request of requestById.values()) {
      organizationIds.add(request.secretariaId);
      if (request.departamentoId) organizationIds.add(request.departamentoId);
      if (request.unidadeId) organizationIds.add(request.unidadeId);
    }
    const organizationDocs = await Promise.all(
      [...organizationIds].map((id) => ctx.db.get(id))
    );
    const organizationNameById = new Map<string, string>();
    for (const organization of organizationDocs) {
      if (organization) organizationNameById.set(String(organization._id), organization.name);
    }

    // Uma saída pode consumir vários lotes FIFO. O custo só é considerado
    // completo quando todas as parcelas da saída têm custo e fecham a quantidade.
    const lotIds = new Set<string>();
    for (const [movementId, rows] of withdrawalsByMovement) {
      if (!movementIds.has(movementId)) continue;
      for (const allocation of rows) lotIds.add(String(allocation.lotId));
    }
    for (const movement of relevantMovements) {
      if (!withdrawalsByMovement.has(String(movement._id)) && movement.lotId) {
        lotIds.add(String(movement.lotId));
      }
    }
    const lotDocs = await Promise.all(
      [...lotIds].map((id) => ctx.db.get(id as Id<"lots">))
    );
    const unitCostByLotId = new Map<string, number | null>();
    for (const lot of lotDocs) {
      if (!lot) continue;
      unitCostByLotId.set(
        String(lot._id),
        typeof lot.unitCost === "number" && Number.isFinite(lot.unitCost) && lot.unitCost > 0
          ? lot.unitCost
          : null
      );
    }

    const productById = new Map(products.map((product) => [String(product._id), product]));
    const categoryNameById = new Map(categories.map((category) => [String(category._id), category.name]));

    const enriched: OrganizationalMovement[] = relevantMovements.map((movement) => {
      const request = movement.requestId
        ? requestById.get(String(movement.requestId))
        : undefined;
      const product = productById.get(String(movement.productId));
      const allocationsForMovement = withdrawalsByMovement.get(String(movement._id)) ?? [];
      let unitCost: number | null = null;

      if (allocationsForMovement.length > 0) {
        let allocatedQuantity = 0;
        let allocatedCost = 0;
        let allCostsKnown = true;
        for (const allocation of allocationsForMovement) {
          const quantity = Math.max(allocation.quantity, 0);
          allocatedQuantity += quantity;
          const lotUnitCost = unitCostByLotId.get(String(allocation.lotId));
          if (lotUnitCost == null) allCostsKnown = false;
          else allocatedCost += quantity * lotUnitCost;
        }
        if (
          allCostsKnown &&
          allocatedQuantity > 0 &&
          Math.abs(allocatedQuantity - movement.quantity) <= 0.000001
        ) {
          unitCost = allocatedCost / allocatedQuantity;
        }
      } else if (movement.lotId) {
        unitCost = unitCostByLotId.get(String(movement.lotId)) ?? null;
      }

      return {
        _id: String(movement._id),
        productId: String(movement.productId),
        type: movement.type,
        quantity: movement.quantity,
        timestamp: movement.timestamp,
        canceled: movement.canceled,
        exitMovementId: movement.exitMovementId ? String(movement.exitMovementId) : undefined,
        requestId: movement.requestId ? String(movement.requestId) : undefined,
        productName: product?.name ?? "Produto não identificado",
        categoryName: product ? categoryNameById.get(String(product.categoryId)) : undefined,
        secretariaId: request?.secretariaId ? String(request.secretariaId) : null,
        departamentoId: request?.departamentoId ? String(request.departamentoId) : null,
        unidadeId: request?.unidadeId ? String(request.unidadeId) : null,
        secretariaName: request?.secretariaId
          ? organizationNameById.get(String(request.secretariaId)) ?? null
          : null,
        departamentoName: request?.departamentoId
          ? organizationNameById.get(String(request.departamentoId)) ?? null
          : null,
        unidadeName: request?.unidadeId
          ? organizationNameById.get(String(request.unidadeId)) ?? null
          : null,
        unitCost,
      };
    });

    const buildWindow = (startMs: number, endMs: number) => {
      const windowMovements = enriched.filter(
        (movement) => movement.timestamp >= startMs && movement.timestamp <= endMs
      );
      const report = buildPeriodConsumptionReport(windowMovements, period, startMs);
      return {
        bySecretaria: report.bySecretaria,
        byDepartment: report.byDepartment,
        byUnit: report.byUnit,
        byProduct: report.byProduct,
        byCategory: report.byCategory,
        hierarchy: aggregateConsumptionHierarchy(windowMovements),
        totalQuantity: report.totalQuantity,
        totalExitCount: report.totalExitCount,
        withoutHistory: report.withoutHistory,
        note: report.note,
      };
    };

    return {
      period: period.key,
      periodLabel: period.label,
      generatedAt: now,
      current: buildWindow(currentStartMs, now),
      previous: buildWindow(previousStartMs, currentStartMs - 1),
      costLabel: COST_UNAVAILABLE_LABEL,
    };
  },
});
