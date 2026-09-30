/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE REPOSIÇÃO (backend).
 *
 * Este módulo cuida de PARÂMETROS. Ele é deliberadamente separado das
 * movimentações: nenhuma função aqui cria lote, entrada, saída, movimentação,
 * reserva ou alteração de saldo. A única escrita possível é `db.patch` em
 * campos de PARAMETRIZAÇÃO de `products`, sempre acompanhada de auditoria.
 *
 * RBAC:
 *   list         → stock_parameters.view  (Diretor consulta)
 *   updateMany   → stock_parameters.manage (Diretor e Técnico não editam)
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import {
  readReplenishmentParameters,
  buildStockParameterRow,
  computeParameterCounters,
  type StockParameterRow,
} from "../lib/stock-parameters";

/* ═══ Consultas (somente leitura) ═══════════════════════════════════════════ */

/**
 * Lista de produtos com saldos REAIS e parâmetros de reposição.
 *
 * O saldo vem de `stock` (físico e reservado) e é devolvido intacto: a tela
 * apenas mostra. Nenhum total é estimado ou corrigido aqui.
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<{
    rows: StockParameterRow[];
    counters: ReturnType<typeof computeParameterCounters>;
    categoryNames: string[];
    areaNames: string[];
  }> => {
    await requirePermission(ctx, "stock_parameters.view", { entity: "products" });

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

    // Área operacional do produto: derivada dos LOTES (mesma origem usada pelo
    // painel de suprimentos). Produto sem lote fica sem área — nunca herdamos
    // a área de outro produto.
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
        physicalStock: stockByProduct.get(p._id)?.physicalQuantity ?? 0,
        reservedStock: stockByProduct.get(p._id)?.reservedQuantity ?? 0,
        parameters: readReplenishmentParameters(p),
        // Embalagem (somente leitura): usada para exibir o equivalente.
        // Os parâmetros continuam gravados/lidos na UNIDADE BASE.
        packaging: {
          baseUnit: p.baseUnit ?? null,
          packagingUnit: p.packagingUnit ?? null,
          conversionFactor: p.conversionFactor ?? null,
        },
      })
    );

    rows.sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR"));

    return {
      rows,
      counters: computeParameterCounters(rows),
      categoryNames: [...new Set(rows.map((r) => r.categoryName).filter((n): n is string => !!n))].sort(),
      areaNames: [...new Set(rows.map((r) => r.areaName).filter((n): n is string => !!n))].sort(),
    };
  },
});

/* ═══ Alteração de parâmetros ══════════════════════════════════════════════ */

/** Um produto com os parâmetros a gravar (valores já normalizados). */
const parameterUpdateValidator = v.object({
  productId: v.id("products"),
  minimumStock: v.union(v.number(), v.null()),
  idealStock: v.union(v.number(), v.null()),
  monthlyConsumptionTarget: v.union(v.number(), v.null()),
  replenishmentEnabled: v.boolean(),
  replenishmentNote: v.union(v.string(), v.null()),
});

/**
 * EDIÇÃO EM LOTE dos parâmetros de reposição.
 *
 * GARANTIAS DESTA MUTATION:
 *  - grava APENAS campos de parametrização (`db.patch` em `products`);
 *  - NUNCA toca em `stock`, `lots`, `stockByLocation` ou `stockMovements`;
 *  - auditoria `stock_parameter_update` com valores ANTERIORES e NOVOS;
 *  - `null` significa "não parametrizado" e é gravado como ausência do campo
 *    (nunca como 0), preservando a distinção `null` ≠ `0`.
 */
export const updateMany = mutation({
  args: { updates: v.array(parameterUpdateValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "stock_parameters.manage", {
      entity: "products",
    });

    if (args.updates.length === 0) {
      return { updated: 0, skipped: 0 };
    }

    const now = Date.now();
    const fieldLabels: Record<string, string> = {
      minimumStock: "Estoque mínimo",
      idealStock: "Estoque ideal",
      monthlyConsumptionTarget: "Consumo mensal",
      replenishmentEnabled: "Reposição habilitada",
      replenishmentNote: "Observação da reposição",
    };

    let updated = 0;
    let skipped = 0;

    for (const update of args.updates) {
      const product = await ctx.db.get(update.productId);
      if (!product) {
        skipped++;
        continue;
      }

      // Compara com o valor ATUAL e só grava o que realmente mudou — evita
      // auditoria ruidosa quando o operador salva sem editar nada.
      const patch: Record<string, unknown> = {};
      const changes: string[] = [];

      const assign = (
        field: "minimumStock" | "idealStock" | "monthlyConsumptionTarget" | "replenishmentNote",
        next: number | string | null
      ) => {
        const before = (product as Record<string, unknown>)[field] ?? null;
        if (before === next) return;
        // null = "não parametrizado" → grava ausência do campo, não zero.
        patch[field] = next === null ? undefined : next;
        changes.push(
          `${fieldLabels[field]}: ${before === null ? "não parametrizado" : String(before)} → ${
            next === null ? "não parametrizado" : String(next)
          }`,
        );
      };

      assign("minimumStock", update.minimumStock);
      assign("idealStock", update.idealStock);
      assign("monthlyConsumptionTarget", update.monthlyConsumptionTarget);
      assign("replenishmentNote", update.replenishmentNote);

      const enabledBefore = product.replenishmentEnabled === true;
      if (enabledBefore !== update.replenishmentEnabled) {
        patch.replenishmentEnabled = update.replenishmentEnabled;
        changes.push(
          `${fieldLabels.replenishmentEnabled}: ${enabledBefore ? "sim" : "não"} → ${
            update.replenishmentEnabled ? "sim" : "não"
          }`,
        );
      }

      if (changes.length === 0) {
        skipped++;
        continue;
      }

      // ── ÚNICA escrita de dados: campos de PARAMETRIZAÇÃO ──
      // `stock`, `lots`, `stockByLocation` e `stockMovements` não aparecem aqui.
      await ctx.db.patch(update.productId, patch as never);

      // Auditoria específica: valores anteriores e novos, usuário e data/hora.
      await ctx.db.insert("auditLogs", {
        userId,
        action: "stock_parameter_update",
        entity: "products",
        entityId: update.productId,
        details:
          `Parâmetros de reposição de "${product.name}" — ` +
          changes.join(" | ") +
          `. Alteração de parâmetro NÃO é movimentação de estoque: nenhuma quantidade foi alterada.`,
        timestamp: now,
      } as never);

      updated++;
    }

    return { updated, skipped };
  },
});
