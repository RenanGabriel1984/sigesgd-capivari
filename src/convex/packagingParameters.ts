/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE EMBALAGENS (backend).
 *
 * Módulo de CADASTRO. Deliberadamente separado de movimentações: nenhuma
 * função aqui cria lote, entrada, saída, movimentação, reserva ou alteração de
 * saldo. A única escrita possível é `db.patch` em campos de EMBALAGEM de
 * `products` (baseUnit / packagingUnit / conversionFactor), sempre com
 * auditoria `product_packaging_update`.
 *
 * CONVERSÃO É SÓ APRESENTAÇÃO:
 *   "1 caixa = 30 rolos"  +  estoque 180 rolos
 *   → a tela mostra "180 rolos ≈ 6 caixas", mas o saldo continua 180 rolos.
 *   Nenhum saldo, lote, quantidade fiscal de NF-e ou histórico é reescrito.
 *
 * RBAC:
 *   list → packaging_parameters.view  (Diretor consulta)
 *   save → packaging_parameters.manage (Diretor e Técnico não editam)
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import {
  buildPackagingRow,
  computePackagingCounters,
  validatePackagingConfig,
  normalizePackagingInput,
  diffPackagingDraft,
  describePackagingValue,
  type PackagingRow,
} from "../lib/packaging-parameters";

/* ═══ Consulta (somente leitura) ════════════════════════════════════════════ */

/**
 * Lista de produtos com saldo REAL e a configuração de embalagem vigente.
 *
 * O saldo vem de `stock` (físico e reservado) e é devolvido intacto: a tela
 * apenas mostra o equivalente em embalagens. Nenhum total é convertido aqui.
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<{
    rows: PackagingRow[];
    counters: ReturnType<typeof computePackagingCounters>;
    categoryNames: string[];
  }> => {
    await requirePermission(ctx, "packaging_parameters.view", { entity: "products" });

    const [products, stockRows, categories] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("stock").collect(),
      ctx.db.query("categories").collect(),
    ]);

    const categoryNameById = new Map(categories.map((c) => [c._id, c.name]));
    const stockByProduct = new Map(
      stockRows.map((s) => [
        s.productId,
        { physicalQuantity: s.physicalQuantity, reservedQuantity: s.reservedQuantity },
      ])
    );

    const rows = products.map((p) =>
      buildPackagingRow({
        productId: p._id,
        productName: p.name,
        categoryName: categoryNameById.get(p.categoryId) ?? null,
        unitOfMeasure: p.unitOfMeasure,
        physicalStock: stockByProduct.get(p._id)?.physicalQuantity ?? 0,
        reservedStock: stockByProduct.get(p._id)?.reservedQuantity ?? 0,
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
      counters: computePackagingCounters(rows),
      categoryNames: [...new Set(rows.map((r) => r.categoryName).filter((n): n is string => !!n))].sort(),
    };
  },
});

/* ═══ Gravação da configuração ═════════════════════════════════════════════ */

const packagingSaveValidator = v.object({
  productId: v.id("products"),
  baseUnit: v.union(v.string(), v.null()),
  packagingUnit: v.union(v.string(), v.null()),
  conversionFactor: v.union(v.number(), v.null()),
});

/**
 * SALVA a configuração de embalagem de UM produto (edição individual).
 *
 * GARANTIAS DESTA MUTATION:
 *  - grava APENAS `baseUnit`/`packagingUnit`/`conversionFactor` do produto;
 *  - NUNCA toca em `stock`, `stockByLocation`, `lots`, `entries`, `entryItems`
 *    ou `stockMovements` — não há uma única referência a essas tabelas aqui;
 *  - NUNCA converte quantidade alguma: 180 rolos continuam 180 rolos;
 *  - NUNCA reescreve a quantidade fiscal de NF-e;
 *  - IDEMPOTENTE: salvar exatamente a mesma configuração não gera patch nem
 *    auditoria (retorna `unchanged`);
 *  - auditoria `product_packaging_update` com valores ANTERIORES e NOVOS.
 */
export const save = mutation({
  args: { update: packagingSaveValidator },
  handler: async (ctx, args) => {
    const { productId, baseUnit, packagingUnit, conversionFactor } = args.update;
    const { userId } = await requirePermission(ctx, "packaging_parameters.manage", {
      entity: "products",
      entityId: productId,
    });

    const product = await ctx.db.get(productId);
    if (!product) throw new Error("Produto não encontrado");

    // Validação CENTRALIZADA (mesma regra da tela).
    const validation = validatePackagingConfig({
      baseUnit,
      packagingUnit,
      conversionFactor,
    });
    if (!validation.ok) {
      throw new Error(validation.error ?? "Configuração de embalagem inválida");
    }

    const current = {
      baseUnit: product.baseUnit ?? null,
      packagingUnit: product.packagingUnit ?? null,
      conversionFactor: product.conversionFactor ?? null,
    };

    const changes = diffPackagingDraft(current, {
      baseUnit: baseUnit ?? "",
      packagingUnit: packagingUnit ?? "",
      conversionFactor: conversionFactor === null ? "" : String(conversionFactor),
    });

    // ── Idempotência: nada mudou ⇒ nem patch, nem auditoria nova ──
    if (changes.length === 0) {
      return { updated: false, unchanged: true, changes: 0 };
    }

    const normalized = normalizePackagingInput({
      baseUnit,
      packagingUnit,
      conversionFactor,
    });

    // ── ÚNICA escrita de dados: campos de EMBALAGEM do produto ──
    // `undefined` remove o campo (voltando a "não parametrizado"), preservando
    // a distinção entre "ausente" e zero.
    await ctx.db.patch(productId, {
      baseUnit: normalized.baseUnit ?? undefined,
      packagingUnit: normalized.packagingUnit ?? undefined,
      conversionFactor: normalized.conversionFactor ?? undefined,
    } as never);

    const detail = changes
      .map(
        (c) =>
          `${describePackagingValue(c.before, c.field)} → ${describePackagingValue(c.after, c.field)}`
      )
      .join(" | ");

    const stockBefore = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .first();

    // ── Auditoria específica (NUNCA em stockMovements) ──
    await ctx.db.insert("auditLogs", {
      userId,
      action: "product_packaging_update",
      entity: "products",
      entityId: productId,
      details:
        `Embalagem de "${product.name}" — ${detail}. ` +
        `Estoque permanece em ${stockBefore?.physicalQuantity ?? 0} ` +
        `${normalized.baseUnit ?? product.unitOfMeasure} (unidade base). ` +
        "Alteração de embalagem NÃO é movimentação: nenhuma quantidade, lote ou NF-e foi alterada.",
      timestamp: Date.now(),
    } as never);

    return { updated: true, unchanged: false, changes: changes.length };
  },
});

/**
 * PRÉVIA da configuração salva, lida do próprio produto.
 *
 * Não grava nada: devolve como o estoque ATUAL (intacto) apareceria na
 * unidade de embalagem. Ex.: 180 rolos com 1 caixa = 30 rolos → "≈ 6 caixas".
 */
export const preview = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "packaging_parameters.view", { entity: "products" });

    const product = await ctx.db.get(args.productId);
    if (!product) return null;

    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();

    const available = Math.max(
      (stock?.physicalQuantity ?? 0) - (stock?.reservedQuantity ?? 0),
      0
    );

    const row = buildPackagingRow({
      productId: product._id,
      productName: product.name,
      unitOfMeasure: product.unitOfMeasure,
      physicalStock: stock?.physicalQuantity ?? 0,
      reservedStock: stock?.reservedQuantity ?? 0,
      packaging: {
        baseUnit: product.baseUnit ?? null,
        packagingUnit: product.packagingUnit ?? null,
        conversionFactor: product.conversionFactor ?? null,
      },
    });

    return { available, unit: row.preview?.baseUnit ?? product.unitOfMeasure, preview: row.preview };
  },
});
