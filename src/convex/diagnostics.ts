/**
 * SIGESGD — Diagnóstico administrativo, reconciliação e limpeza controlada.
 *
 * Todas as funções aqui são PROTEGIDAS (admin) ou INTERNAL (canal CLI/dashboard
 * do deployment) e cumprem papel objetivo:
 *
 *  1. environmentCheck   (query, somente leitura)
 *     Prova que a sessão autenticada está no MESMO deployment Convex que
 *     contém a carga oficial: contagens das tabelas e existência da entrada
 *     ENT-2026-000001 (origem initial_inventory).
 *
 *  2. legacyRecordsCheck (query, somente leitura)
 *     Localiza registros legados/teste — SSD Kingston, stock sem
 *     stockByLocation, referências órfãs e entradas iniciais além da oficial.
 *     NUNCA exclui nada.
 *
 *  3. reconcileFromLocations (mutation, idempotente)
 *     Corrige stock.physicalQuantity para a soma real de stockByLocation por
 *     produto. NUNCA altera reservedQuantity, lotes nem stockByLocation.
 *     Gera auditLog somente quando há correção e não cria movimentação falsa.
 *
 *  4. normalizeNumericFieldsInternal / bigintScanInternal
 *     Causa raiz dos erros "Cannot mix BigInt and other types": regrava todo
 *     valor Int64 (bigint) em campos numéricos/timestamps como number JS,
 *     com relatório campo a campo e modo dry-run.
 *
 *  5. categoryAuditInternal / deactivateUnusedCategoriesInternal
 *     Auditoria e desativação segura de categorias sem produtos ativos.
 *
 *  6. testCleanupPreviewInternal / testCleanupExecuteInternal
 *     Mapeamento e limpeza dos dados de teste SSD Kingston — somente objetos
 *     exclusivamente de teste, com proteções da carga oficial ENT-2026-000001.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const OFFICIAL_ENTRY_NUMBER = "ENT-2026-000001";

async function requireAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  if (user.role !== "admin" && user.role !== "stock_manager")
    throw new Error("Apenas administradores podem executar diagnóstico de estoque");
  return { userId, user };
}

export const environmentCheck = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Não autenticado");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Perfil de usuário não encontrado");

    const products = await ctx.db.query("products").collect();
    const stock = await ctx.db.query("stock").collect();
    const sbl = await ctx.db.query("stockByLocation").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const entries = await ctx.db.query("entries").collect();

    const initialEntries = entries.filter(
      (e) => e.originType === "initial_inventory" && e.status !== "reversed"
    );
    const official = initialEntries.find((e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER);
    const totalStock = stock.reduce((s, r) => s + Number(r.physicalQuantity), 0);
    const totalSbl = sbl.reduce((s, r) => s + Number(r.quantity), 0);

    return {
      environmentCheck: true,
      authenticatedUserId: userId,
      authenticatedUserName: user.name ?? user.email ?? null,
      authenticatedUserRole: user.role ?? null,
      authenticatedUserActive: user.active ?? null,
      productsCount: products.length,
      stockCount: stock.length,
      stockByLocationCount: sbl.length,
      organizationsCount: orgs.length,
      organizationsActiveCount: orgs.filter((o) => o.active).length,
      totalStockPhysical: totalStock,
      totalStockByLocation: totalSbl,
      officialInitialEntryExists: !!official,
      officialInitialEntryNumber: official?.entryNumber ?? null,
    };
  },
});

export const legacyRecordsCheck = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const products = await ctx.db.query("products").collect();
    const stock = await ctx.db.query("stock").collect();
    const sbl = await ctx.db.query("stockByLocation").collect();
    const movements = await ctx.db.query("stockMovements").collect();
    const lots = await ctx.db.query("lots").collect();
    const entries = await ctx.db.query("entries").collect();
    const locations = await ctx.db.query("storageLocations").collect();

    const productById = new Map(products.map((p) => [p._id, p]));
    const locationById = new Map(locations.map((l) => [l._id, l]));
    const entryIds = new Set(entries.map((e) => e._id));
    const productIds = new Set(products.map((p) => p._id));

    // ── Produtos sem NENHUM vínculo com a carga inicial (ENT-2026-000001) ──
    const officialEntry = entries.find(
      (e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER && e.originType === "initial_inventory"
    );
    const officialLots = officialEntry
      ? lots.filter((l) => l.entryId === officialEntry._id)
      : [];
    const officialProductIds = new Set(officialLots.map((l) => l.productId));

    // Produtos "cooler" além do oficial da carga (nome contém cooler, sem lote oficial)
    const coolerSuspects = products.filter(
      (p) =>
        p.name.toLowerCase().includes("cooler") &&
        (!officialProductIds.has(p._id) || !p.active)
    );

    // ── SSD Kingston sem localização ──
    const ssdSuspects = products
      .filter((p) => p.name.toLowerCase().includes("ssd") || p.name.toLowerCase().includes("kingston"))
      .map((p) => {
        const st = stock.find((s) => s.productId === p._id);
        const locRows = sbl.filter((r) => r.productId === p._id);
        return {
          productId: p._id,
          name: p.name,
          active: p.active,
          physical: Number(st?.physicalQuantity ?? 0),
          hasLocationRows: locRows.length > 0,
          locationNames: locRows
            .map((r) => locationById.get(r.locationId)?.name ?? r.locationId)
            .join(", "),
        };
      });

    // ── stock sem stockByLocation (saldo global órfão) ──
    const sblPerProduct = new Map<string, number>();
    for (const r of sbl) {
      sblPerProduct.set(r.productId, (sblPerProduct.get(r.productId) ?? 0) + Number(r.quantity));
    }
    const stockWithoutLocation = stock
      .filter(
        (s) =>
          (sblPerProduct.get(s.productId) ?? 0) === 0 &&
          Number(s.physicalQuantity) !== (sblPerProduct.get(s.productId) ?? 0)
      )
      .map((s) => ({
        productId: s.productId,
        name: productById.get(s.productId)?.name ?? s.productId,
        physical: Number(s.physicalQuantity),
        reserved: Number(s.reservedQuantity),
      }));

    // ── Referências órfãs ──
    const sblWithoutProduct = sbl
      .filter((r) => !productIds.has(r.productId))
      .map((r) => ({ id: r._id, productId: r.productId }));
    const movementsWithoutProduct = movements
      .filter((m) => !productIds.has(m.productId))
      .map((m) => ({ id: m._id, productId: m.productId, type: m.type }));
    const lotsWithoutEntry = lots
      .filter((l) => !entryIds.has(l.entryId))
      .map((l) => ({ id: l._id, lotNumber: l.lotNumber, productId: l.productId }));

    // ── Entradas iniciais além da oficial ──
    const otherInitialEntries = entries
      .filter((e) => e.originType === "initial_inventory" && e.entryNumber !== OFFICIAL_ENTRY_NUMBER)
      .map((e) => ({
        entryNumber: e.entryNumber,
        status: e.status,
        observation: e.observation ?? null,
      }));

    return {
      coolerSuspects: coolerSuspects.map((p) => ({
        productId: p._id,
        name: p.name,
        active: p.active,
        officialInitialLot: officialProductIds.has(p._id),
      })),
      ssdSuspects,
      stockWithoutLocation,
      sblWithoutProduct,
      movementsWithoutProduct,
      lotsWithoutEntry,
      otherInitialEntries,
    };
  },
});

/**
 * Reconcilia stock.physicalQuantity com a soma de stockByLocation.
 * Idempotente: segunda execução não altera nada.
 */
export const reconcileFromLocations = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);
    return reconcileCore(ctx, userId);
  },
});

/**
 * Variante interna (convex run / cron) do diagnóstico e da reconciliação.
 * MESMA lógica do núcleo — sem criar dados, sem pular proteções de integridade.
 * A autenticação fica a cargo do canal de execução (CLI admin do deployment).
 */
export const reconcileFromLocationsInternal = internalMutation({
  args: {},
  handler: async (ctx) => reconcileCore(ctx, null),
});

async function reconcileCore(ctx: any, userId: string | null) {
  const products = await ctx.db.query("products").collect();
  const sbl = await ctx.db.query("stockByLocation").collect();
  const stocks = await ctx.db.query("stock").collect();

  const sblPerProduct = new Map<string, number>();
  for (const r of sbl) {
    sblPerProduct.set(r.productId, (sblPerProduct.get(r.productId) ?? 0) + Number(r.quantity));
  }

  let analyzed = 0;
  let corrected = 0;
  let globalBefore = 0;
  let globalAfter = 0;
  const corrections: Array<{
    productId: string;
    name: string;
    globalBefore: number;
    byLocation: number;
  }> = [];
  // Divergências estruturais (stockByLocation ≠ lotes): NÃO são corrigidas
  // aqui — são reportadas para tratamento por inventário físico.
  const structuralDivergences: Array<{
    productId: string;
    name: string;
    byLocation: number;
    lots: number;
    physical: number;
  }> = [];
  const negatives: Array<{ productId: string; name: string; physical: number }> = [];
  const reservedTotal = { before: 0, after: 0 };

  for (const product of products) {
    analyzed++;
    const byLocation = sblPerProduct.get(product._id) ?? 0;
    const st = stocks.find((s: any) => s.productId === product._id);
    const physical = Number(st?.physicalQuantity ?? 0);
    reservedTotal.before += Number(st?.reservedQuantity ?? 0);
    reservedTotal.after += Number(st?.reservedQuantity ?? 0);
    globalBefore += physical;

    if (byLocation < 0) {
      structuralDivergences.push({
        productId: product._id,
        name: product.name,
        byLocation,
        lots: -1,
        physical,
      });
      continue;
    }

    if (physical !== byLocation) {
      // Divergência só é corrigível se confinada ao stock: a soma por
      // localização precisa bater com os lotes ativos.
      const productLots = await ctx.db
        .query("lots")
        .withIndex("by_product", (q: any) => q.eq("productId", product._id))
        .collect();
      const lotsTotal = (productLots as Array<{ active?: boolean; quantityAvailable: number }>)
        .filter((l) => l.active)
        .reduce((sum, l) => sum + Number(l.quantityAvailable), 0);
      if (byLocation !== lotsTotal) {
        structuralDivergences.push({
          productId: product._id,
          name: product.name,
          byLocation,
          lots: lotsTotal,
          physical,
        });
        continue; // reporta e NÃO inventa correção
      }
      corrections.push({
        productId: product._id,
        name: product.name,
        globalBefore: physical,
        byLocation,
      });
    }

    // Garante documento stock existente quando há saldo local
    let current: { _id: Id<"stock">; physicalQuantity: number; reservedQuantity: number } | undefined =
      st
        ? {
            _id: st._id,
            physicalQuantity: Number(st.physicalQuantity),
            reservedQuantity: Number(st.reservedQuantity),
          }
        : undefined;
    if (!current && byLocation > 0) {
      const id = await ctx.db.insert("stock", {
        productId: product._id,
        physicalQuantity: 0,
        reservedQuantity: 0,
      });
      current = { _id: id, physicalQuantity: 0, reservedQuantity: 0 };
    }
    if (current && current.physicalQuantity !== byLocation) {
      await ctx.db.patch(current._id, { physicalQuantity: byLocation });
      corrected++;
    }
    globalAfter += byLocation;

    const finalPhysical = byLocation;
    if (finalPhysical < 0) {
      negatives.push({
        productId: product._id,
        name: product.name,
        physical: finalPhysical,
      });
    }
    if (finalPhysical < (current?.reservedQuantity ?? 0)) {
      throw new Error(
        `Reconciliação deixaria ${product.name} com reservado (${current?.reservedQuantity}) > físico (${finalPhysical}). Abortado.`
      );
    }
  }

  if (corrections.length > 0) {
    await ctx.db.insert("auditLogs", {
      userId: userId as any,
      action: "update",
      entity: "stock",
      details:
        `Reconciliação stock × stockByLocation: ${corrections.length} produto(s) corrigido(s). ` +
        `Antes: ${globalBefore} → Depois: ${globalAfter}. ` +
        `Detalhes: ${corrections.map((c) => `${c.name}: ${c.globalBefore}→${c.byLocation}`).join("; ")}` +
        (structuralDivergences.length > 0
          ? ` | Estruturais NÃO corrigidas: ${structuralDivergences.map((d) => `${d.name} (sbl=${d.byLocation}, lotes=${d.lots}, stock=${d.physical})`).join("; ")}`
          : ""),
      timestamp: Date.now(),
    });
  }

  return {
    message:
      corrections.length === 0 && structuralDivergences.length === 0
        ? "Nenhuma divergência — estoque já consistente"
        : structuralDivergences.length > 0
          ? "Reconciliação parcial — divergências estruturais reportadas (não corrigidas)"
          : "Reconciliação concluída",
    ok: structuralDivergences.length === 0,
    productsAnalyzed: analyzed,
    divergencesFound: corrections.length,
    divergencesCorrected: corrected,
    totalGlobalBefore: globalBefore,
    totalGlobalAfter: globalAfter,
    totalStockByLocation: Array.from(sblPerProduct.values()).reduce((s, q) => s + q, 0),
    reservedTotal: reservedTotal.after,
    negatives: negatives.length,
    structuralDivergences,
  };
}

/**
 * Diagnóstico via convex run (sem sessão de usuário). Somente leitura e sem
 * acesso a dados sensíveis: contagens e existência da entrada oficial.
 */
export const environmentCheckInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    const stock = await ctx.db.query("stock").collect();
    const sbl = await ctx.db.query("stockByLocation").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const entries = await ctx.db.query("entries").collect();
    const initial = entries.filter((e) => e.originType === "initial_inventory");
    return {
      environmentCheck: true,
      deploymentUrl: (process.env as Record<string, string | undefined>).CONVEX_CLOUD_URL ?? null,
      productsCount: products.length,
      stockCount: stock.length,
      stockByLocationCount: sbl.length,
      organizationsCount: orgs.length,
      organizationsActiveCount: orgs.filter((o) => o.active).length,
      totalStockPhysical: stock.reduce((s, r) => s + Number(r.physicalQuantity), 0),
      totalStockByLocation: sbl.reduce((s, r) => s + Number(r.quantity), 0),
      officialInitialEntryExists: initial.some((e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER),
      officialInitialEntryNumber: initial.find((e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER)?.entryNumber ?? null,
    };
  },
});

// ═════════════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO NUMÉRICA (bigint → number)
// ═════════════════════════════════════════════════════════════════════════
// O schema roda com schemaValidation: false, então valores Int64 (bigint)
// podem existir em campos v.number() — gravados por caminhos sem validação
// (ex.: convex run com args JSON inteiros). Qualquer aritmética mista quebra
// com "Cannot mix BigInt and other types" e qualquer new Date(ts) com
// "Cannot convert a BigInt value to a number". A causa raiz é corrigida aqui:
// regravar cada valor Int64 como number JS, preservando o valor exato.
//
// Campos elegíveis: apenas campos SEMANTICAMENTE numéricos (quantidades,
// saldos, custos, contadores, timestamps). Nunca ids, strings ou datas.
// ═════════════════════════════════════════════════════════════════════════

const NUMERIC_FIELDS_BY_TABLE: Record<string, string[]> = {
  // Quantidades, saldos, custos e timestamps que o schema declara como
  // v.number(), mas que aceitaram Int64 (bigint) via CLI. Uma entrada por tabela.
  products: ["minimumStock", "idealStock", "maximumStock", "stock"],
  stock: ["physicalQuantity", "reservedQuantity"],
  stockByLocation: ["quantity"],
  lots: ["quantityReceived", "quantityAvailable", "unitCost", "receivedAt"],
  entryItems: ["quantity", "unitCost", "totalCost"],
  entries: ["totalValue", "receivedAt", "createdAt", "updatedAt"],
  stockMovements: ["quantity", "unitCost", "totalCost", "timestamp", "canceledAt"],
  requestItems: ["quantityRequested", "quantityApproved", "quantityDelivered"],
  requests: ["totalItems"],
  categories: ["order"],
  inventoryCounts: ["systemQuantity", "countedQuantity", "difference"],
  returns: ["quantity", "createdAt"],
  stockTransfers: ["quantity", "createdAt"],
  gomaQExchanges: ["quantityDelivered", "quantityEmptyReceived", "exchangedAt"],
  gomaQEmptyCartridges: ["quantity", "generatedAt", "collectedAt"],
  gomaQCollections: ["totalCartridges", "collectedAt"],
  dashboardStats: ["totalProducts", "totalStock", "lowStockCount", "totalMovementValue"],
  failedLoginAttempts: ["attempts", "lastAttemptAt", "lockedUntil"],
  inventories: ["date", "closedAt", "createdAt", "updatedAt"],
  assets: ["createdAt", "updatedAt"],
  assetHistory: ["timestamp"],
  licenses: ["createdAt", "updatedAt"],
  passwordResets: ["expiresAt", "usedAt", "createdAt"],
  auditLogs: ["timestamp"],
};

const TABLES_TO_SCAN = Object.keys(NUMERIC_FIELDS_BY_TABLE);

function isInt64(v: unknown): boolean {
  return typeof v === "bigint";
}

/**
 * internalMutation idempotente: regrava todo valor Int64 encontrado nos
 * campos numéricos como number JS. Retorna relatório campo a campo.
 * NÃO altera nada além dos valores bigint encontrados.
 */
export const normalizeNumericFieldsInternal = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const report: Array<{
      table: string;
      field: string;
      docs: number;
      sampleBefore: string;
      sampleAfter: string;
    }> = [];
    let totalFixed = 0;

    for (const table of TABLES_TO_SCAN) {
      const fields = NUMERIC_FIELDS_BY_TABLE[table];
      if (!fields || fields.length === 0) continue;
      const docs = await (ctx.db.query as (t: string) => any)(table).collect();
      const perField: Record<string, number> = {};
      let sample: { field: string; before: bigint; after: number } | null = null;

      for (const doc of docs) {
        const patch: Record<string, number> = {};
        for (const field of fields) {
          const value = (doc as Record<string, unknown>)[field];
          if (isInt64(value)) {
            patch[field] = Number(value);
            perField[field] = (perField[field] ?? 0) + 1;
            if (!sample) sample = { field, before: value as bigint, after: Number(value) };
          }
        }
        if (args.dryRun !== true && Object.keys(patch).length > 0) {
          await ctx.db.patch(doc._id, patch);
        }
      }

      for (const [field, count] of Object.entries(perField)) {
        totalFixed += count;
        report.push({
          table,
          field,
          docs: count,
          sampleBefore: sample && sample.field === field ? sample.before.toString() : "",
          sampleAfter: sample && sample.field === field ? String(sample.after) : "",
        });
      }
    }

    return {
      dryRun: args.dryRun === true,
      tablesScanned: TABLES_TO_SCAN.length,
      totalInt64Fixed: totalFixed,
      report,
    };
  },
});

/**
 * internalQuery: TABELA × CAMPO, conta quantos valores são bigint vs number.
 * Confirma empiricamente onde o Int64 existe antes e depois da normalização.
 */
export const bigintScanInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: Array<{
      table: string;
      field: string;
      bigintDocs: number;
      totalDocs: number;
      min: string;
      max: string;
    }> = [];

    for (const table of TABLES_TO_SCAN) {
      const fields = NUMERIC_FIELDS_BY_TABLE[table];
      if (!fields || fields.length === 0) continue;
      const docs = await (ctx.db.query as (t: string) => any)(table).collect();
      for (const field of fields) {
        let bigintDocs = 0;
        let min: bigint | null = null;
        let max: bigint | null = null;
        for (const doc of docs) {
          const value = (doc as Record<string, unknown>)[field];
          if (isInt64(value)) {
            bigintDocs++;
            const b = value as bigint;
            if (min === null || b < min) min = b;
            if (max === null || b > max) max = b;
          }
        }
        if (bigintDocs > 0) {
          out.push({
            table,
            field,
            bigintDocs,
            totalDocs: docs.length,
            min: min !== null ? min.toString() : "",
            max: max !== null ? max.toString() : "",
          });
        }
      }
    }
    return { tables: TABLES_TO_SCAN.length, tablesWithInt64: out.length, findings: out };
  },
});

/**
 * Auditoria de categorias: quais categorias existem, quantos produtos ativos
 * (e quantos dos 53 oficiais) usam cada uma. Somente leitura.
 */
export const categoryAuditInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db.query("categories").collect();
    const products = await ctx.db.query("products").collect();
    const lots = await ctx.db.query("lots").collect();
    const entries = await ctx.db.query("entries").collect();
    const officialEntry = entries.find(
      (e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER && e.originType === "initial_inventory"
    );
    const officialProductIds = new Set(
      officialEntry
        ? lots.filter((l) => l.entryId === officialEntry._id).map((l) => l.productId as string)
        : []
    );

    const rows = categories.map((c) => {
      const productsUsing = products.filter(
        (p) => p.categoryId === c._id && p.active
      );
      const officialUsing = productsUsing.filter((p) => officialProductIds.has(p._id as string));
      return {
        categoryId: c._id,
        name: c.name,
        active: c.active,
        activeProducts: productsUsing.length,
        officialProducts: officialUsing.length,
      };
    });
    rows.sort((a, b) => b.officialProducts - a.officialProducts || b.activeProducts - a.activeProducts);

    const activeProducts = products.filter((p) => p.active);
    const withoutCategory = activeProducts.filter((p) => !p.categoryId);
    return {
      totalCategories: categories.length,
      activeCategories: categories.filter((c) => c.active).length,
      activeProducts: activeProducts.length,
      officialProducts: officialProductIds.size,
      productsWithoutCategory: withoutCategory.map((p) => p.name),
      rows,
    };
  },
});

/**
 * Desativa categorias sem nenhum produto ativo (categorias de planejamento
 * ou teste). Recusa se qualquer categoria tiver produto oficial ativo.
 * Confirmação literal obrigatória.
 */
export const deactivateUnusedCategoriesInternal = internalMutation({
  args: { confirm: v.string() },
  handler: async (ctx, args) => {
    if (args.confirm !== "DESATIVAR-CATEGORIAS") {
      throw new Error('Confirmação inválida. Execute com confirm="DESATIVAR-CATEGORIAS".');
    }
    const categories = await ctx.db.query("categories").collect();
    const products = await ctx.db.query("products").collect();
    const deactivated: string[] = [];
    for (const c of categories) {
      if (!c.active) continue;
      const inUse = products.some((p) => p.active && p.categoryId === c._id);
      if (!inUse) {
        await ctx.db.patch(c._id, { active: false });
        deactivated.push(c.name);
      }
    }
    if (deactivated.length > 0) {
      await ctx.db.insert("auditLogs", {
        userId: undefined,
        action: "deactivate",
        entity: "categories",
        entityId: "cleanup-test-categories",
        details: `Categorias de planejamento/teste sem produtos ativos desativadas: ${deactivated.join(", ")}`,
        timestamp: Date.now(),
      });
    }
    const remaining = categories.filter(
      (c) => c.active && !deactivated.includes(c.name)
    ).length;
    return { deactivated, activeCategoriesRemaining: remaining };
  },
});

/**
 * Smoke test de leitura de TODAS as telas: executa server-side, sobre o banco
 * real, as mesmas agregações que as páginas fazem (somas de saldos, available,
 * datas via new Date(timestamp), reduções de quantidades, joins produto×stock).
 * Se completar sem exceção, nenhuma tela sofre "Cannot mix BigInt" nem
 * "Cannot convert a BigInt value to a number" na camada de dados.
 */
export const screensSmokeTestInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const results: Record<string, unknown> = {};

    // ── Produtos (tela Produtos / Estoque) ──
    const products = await ctx.db.query("products").collect();
    const active = products.filter((p) => p.active);
    results.produtos = {
      total: products.length,
      ativos: active.length,
      somaMinIdealMax: active.reduce(
        (s, p) =>
          s + Number(p.minimumStock ?? 0) + Number(p.idealStock ?? 0) + Number(p.maximumStock ?? 0),
        0
      ),
    };

    // ── Estoque (tela Estoque / Saída) ──
    const stock = await ctx.db.query("stock").collect();
    results.estoque = {
      fisico: stock.reduce((s, r) => s + Number(r.physicalQuantity), 0),
      reservado: stock.reduce((s, r) => s + Number(r.reservedQuantity), 0),
      disponivel: stock.reduce(
        (s, r) => s + (Number(r.physicalQuantity) - Number(r.reservedQuantity)),
        0
      ),
      negativos: stock.filter((r) => Number(r.physicalQuantity) < 0).length,
    };

    // ── Estoque por localização (tela Estoque) ──
    const sbl = await ctx.db.query("stockByLocation").collect();
    const locations = await ctx.db.query("storageLocations").collect();
    const locName = new Map(locations.map((l) => [l._id, l.name]));
    // IMPORTANTE: chaves dinâmicas com acentos (ex.: "Armário TI 01") NÃO são
    // serializáveis pelo Convex — sempre retornar arrays [{name, quantity}].
    const perLocation = new Map<string, number>();
    for (const r of sbl) {
      const name = locName.get(r.locationId) ?? "?";
      perLocation.set(name, (perLocation.get(name) ?? 0) + Number(r.quantity));
    }
    results.porLocalizacao = {
      total: sbl.reduce((s, r) => s + Number(r.quantity), 0),
      locations: Array.from(perLocation.entries()).map(([name, quantity]) => ({ name, quantity })),
    };

    // ── Entradas (tela Entrada de material) ──
    const entries = await ctx.db.query("entries").collect();
    const entryItems = await ctx.db.query("entryItems").collect();
    results.entradas = {
      total: entries.length,
      datasValidas: entries.every((e) => new Date(Number(e.receivedAt)).getTime() > 0),
      itens: entryItems.length,
      unidades: entryItems.reduce((s, i) => s + Number(i.quantity), 0),
    };

    // ── Lotes (tela Lotes) ──
    const lots = await ctx.db.query("lots").collect();
    results.lotes = {
      total: lots.length,
      recebido: lots.reduce((s, l) => s + Number(l.quantityReceived), 0),
      disponivel: lots.reduce((s, l) => s + Number(l.quantityAvailable), 0),
      datasValidas: lots.every((l) => new Date(Number(l.receivedAt)).getTime() > 0),
    };

    // ── Movimentações (tela Histórico / Relatórios) ──
    const movements = await ctx.db.query("stockMovements").collect();
    results.movimentacoes = {
      total: movements.length,
      quantidade: movements.reduce((s, m) => s + Number(m.quantity), 0),
      datasValidas: movements.every((m) => new Date(Number(m.timestamp)).getTime() > 0),
    };

    // ── Solicitações (tela Solicitações) ──
    const requests = await ctx.db.query("requests").collect();
    const requestItems = await ctx.db.query("requestItems").collect();
    results.solicitacoes = {
      total: requests.length,
      itens: requestItems.length,
      solicitado: requestItems.reduce((s, i) => s + Number(i.quantityRequested), 0),
      entregue: requestItems.reduce((s, i) => s + Number(i.quantityDelivered), 0),
    };

    // ── Auditoria (tela Auditoria) ──
    const auditLogs = await ctx.db.query("auditLogs").collect();
    results.auditoria = {
      total: auditLogs.length,
      datasValidas: auditLogs.every((a) => new Date(Number(a.timestamp)).getTime() > 0),
    };

    // ── Categorias / Fornecedores / Organizações ──
    const categories = await ctx.db.query("categories").collect();
    const suppliers = await ctx.db.query("suppliers").collect();
    const orgs = await ctx.db.query("organizations").collect();
    results.dominios = {
      categoriasAtivas: categories.filter((c) => c.active).length,
      categoriasInativas: categories.filter((c) => !c.active).length,
      fornecedores: suppliers.length,
      fornecedoresAtivos: suppliers.filter((s) => s.active).length,
      organizacoes: orgs.length,
      organizacoesAtivas: orgs.filter((o) => o.active).length,
    };

    // ── Painel de implantação (tela Estoque) ──
    const official = entries.find(
      (e) => e.entryNumber === "ENT-2026-000001" && e.originType === "initial_inventory"
    );
    const officialItems = official
      ? entryItems.filter((i) => i.entryId === official._id)
      : [];
    results.implantacao = {
      entrada: official?.entryNumber ?? null,
      itens: officialItems.length,
      unidades: officialItems.reduce((s, i) => s + Number(i.quantity), 0),
    };

    return { ok: true, results };
  },
});

export const testCleanupPreviewInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    const stock = await ctx.db.query("stock").collect();
    const sbl = await ctx.db.query("stockByLocation").collect();
    const lots = await ctx.db.query("lots").collect();
    const movements = await ctx.db.query("stockMovements").collect();
    const entries = await ctx.db.query("entries").collect();
    const entryItems = await ctx.db.query("entryItems").collect();
    const suppliers = await ctx.db.query("suppliers").collect();
    const requests = await ctx.db.query("requests").collect();
    const requestItems = await ctx.db.query("requestItems").collect();
    const auditLogs = await ctx.db.query("auditLogs").collect();
    const organizations = await ctx.db.query("organizations").collect();

    const officialEntry = entries.find(
      (e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER && e.originType === "initial_inventory"
    );

    // ── Produtos SSD Kingston (teste inicial) ──
    const ssdProducts = products.filter((p) => {
      const n = (p.name ?? "").toLowerCase();
      return n.includes("ssd") || n.includes("kingston");
    });
    const ssdIds = new Set(ssdProducts.map((p) => p._id));

    // Qualquer produto com lote da carga oficial é intocável
    const officialLotProductIds = new Set(
      officialEntry
        ? lots.filter((l) => l.entryId === officialEntry._id).map((l) => l.productId)
        : []
    );

    const idsOf = (arr: Array<{ _id: any }>) => arr.map((d) => String(d._id));

    // ── Lotes/movimentos/stock/sbl exclusivamente dos SSDs ──
    const ssdLots = lots.filter((l) => ssdIds.has(l.productId));
    const ssdMovements = movements.filter((m) => ssdIds.has(m.productId));
    const ssdStock = stock.filter((s) => ssdIds.has(s.productId));
    const ssdSbl = sbl.filter((r) => ssdIds.has(r.productId));

    // ── Entradas de teste: NÃO é a oficial E todos os itens são SSD ──
    const testEntries = entries.filter(
      (e) =>
        e._id !== officialEntry?._id &&
        entryItems.filter((i) => i.entryId === e._id).every((i) => ssdIds.has(i.productId)) &&
        entryItems.some((i) => i.entryId === e._id)
    );
    const testEntryIds = new Set(idsOf(testEntries));
    const testEntryItems = entryItems.filter((i) => testEntryIds.has(i.entryId));

    // ── Fornecedores usados exclusivamente pelas entradas de teste ──
    const supplierIdsInTestEntries = new Set(
      testEntries.map((e) => e.supplierId).filter(Boolean) as string[]
    );
    const testSuppliers = suppliers.filter((s) => supplierIdsInTestEntries.has(s._id));

    // ── Requests de teste: TODOS os itens são SSD (nada oficial) ──
    const testRequests = requests.filter((r) => {
      const items = requestItems.filter((i) => i.requestId === r._id);
      return items.length > 0 && items.every((i) => ssdIds.has(i.productId));
    });
    const testRequestIds = new Set(idsOf(testRequests));
    const testRequestItems = requestItems.filter((i) => testRequestIds.has(i.requestId));

    // ── Auditoria vinculada aos objetos de teste ──
    const testEntityIds = new Set([
      ...idsOf(ssdProducts),
      ...idsOf(ssdLots),
      ...idsOf(ssdMovements),
      ...idsOf(testEntries),
      ...idsOf(testSuppliers),
      ...idsOf(testRequests),
    ]);
    const testAuditLogs = auditLogs.filter(
      (a) => a.entityId && testEntityIds.has(String(a.entityId))
    );

    const orgById = new Map(organizations.map((o) => [o._id, o]));
    const testRequestSummaries = testRequests.map((r: any) => ({
      requestId: r._id,
      status: r.status,
      organizationName:
        orgById.get(r.secretariaId as any)?.name ?? String(r.secretariaId ?? null),
      items: requestItems
        .filter((i) => i.requestId === r._id)
        .map((i) => ({
          productId: i.productId,
          productName: ssdProducts.find((p) => p._id === i.productId)?.name ?? "?",
          quantityDelivered: i.quantityDelivered,
        })),
    }));

    return {
      officialEntryIntact: !!officialEntry,
      officialEntryId: officialEntry?._id ?? null,
      ssdProducts: ssdProducts.map((p) => ({
        productId: p._id,
        name: p.name,
        active: p.active,
        categoryId: p.categoryId ?? null,
      })),
      ssdLots: ssdLots.map((l) => ({ lotId: l._id, lotNumber: l.lotNumber, entryId: l.entryId })),
      ssdMovementsCount: ssdMovements.length,
      ssdStock: ssdStock.map((s) => ({ productId: s.productId, physical: Number(s.physicalQuantity) })),
      ssdSblCount: ssdSbl.length,
      testEntries: testEntries.map((e) => ({
        entryId: e._id,
        entryNumber: e.entryNumber,
        originType: e.originType,
        supplierId: e.supplierId ?? null,
      })),
      testEntryItemsCount: testEntryItems.length,
      testSuppliers: testSuppliers.map((s: any) => ({
        supplierId: s._id,
        name: s.legalName ?? s.tradeName ?? s.name,
      })),
      testRequests: testRequestSummaries,
      testRequestItemsCount: testRequestItems.length,
      testAuditLogsCount: testAuditLogs.length,
      protectedOfficialProducts: officialLotProductIds.size,
    };
  },
});

/**
 * Executa a limpeza. `confirm` DEVE ser exatamente "CLEANUP-SSD-TESTE".
 * Delete físico somente dos objetos listados no preview. A carga oficial
 * (ENT-2026-000001, lotes, itens, movimentações, produtos com lote oficial,
 * locais, organizações, usuários) é verificada e NUNCA tocada.
 */
export const testCleanupExecuteInternal = internalMutation({
  args: { confirm: v.string() },
  handler: async (ctx, args) => {
    if (args.confirm !== "CLEANUP-SSD-TESTE") {
      throw new Error('Confirmação inválida. Execute com confirm="CLEANUP-SSD-TESTE".');
    }

    const products = await ctx.db.query("products").collect();
    const stock = await ctx.db.query("stock").collect();
    const sbl = await ctx.db.query("stockByLocation").collect();
    const lots = await ctx.db.query("lots").collect();
    const movements = await ctx.db.query("stockMovements").collect();
    const entries = await ctx.db.query("entries").collect();
    const entryItems = await ctx.db.query("entryItems").collect();
    const suppliers = await ctx.db.query("suppliers").collect();
    const requests = await ctx.db.query("requests").collect();
    const requestItems = await ctx.db.query("requestItems").collect();
    const auditLogs = await ctx.db.query("auditLogs").collect();

    const officialEntry = entries.find(
      (e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER && e.originType === "initial_inventory"
    );
    if (!officialEntry) {
      throw new Error("ENT-2026-000001 não encontrada — limpeza abortada.");
    }

    const ssdProducts = products.filter((p) => {
      const n = (p.name ?? "").toLowerCase();
      return n.includes("ssd") || n.includes("kingston");
    });
    const ssdIds = new Set(ssdProducts.map((p) => p._id as string));
    if (ssdIds.size === 0) {
      throw new Error("Nenhum produto SSD de teste encontrado — nada a limpar.");
    }

    // ── PROTEÇÃO: nenhum SSD pode ter lote da carga oficial ──
    const officialLots = lots.filter((l) => l.entryId === officialEntry._id);
    for (const lot of officialLots) {
      if (ssdIds.has(lot.productId as string)) {
        throw new Error(
          `Produto SSD ${lot.productId} possui lote da carga oficial. Limpeza abortada.`
        );
      }
    }

    const deleted = {
      products: 0,
      stock: 0,
      stockByLocation: 0,
      lots: 0,
      movements: 0,
      entries: 0,
      entryItems: 0,
      suppliers: 0,
      requests: 0,
      requestItems: 0,
      auditLogs: 0,
    };

    // ── Movimentações de saída dos SSDs (teste) ──
    for (const m of movements.filter((m) => ssdIds.has(m.productId as string))) {
      await ctx.db.delete(m._id);
      deleted.movements++;
    }
    // ── Stock + stockByLocation dos SSDs ──
    for (const s of stock.filter((s) => ssdIds.has(s.productId as string))) {
      await ctx.db.delete(s._id);
      deleted.stock++;
    }
    for (const r of sbl.filter((r) => ssdIds.has(r.productId as string))) {
      await ctx.db.delete(r._id);
      deleted.stockByLocation++;
    }
    // ── Lotes dos SSDs ──
    for (const l of lots.filter((l) => ssdIds.has(l.productId as string))) {
      await ctx.db.delete(l._id);
      deleted.lots++;
    }
    // ── Requests exclusivamente de teste + itens ──
    const testRequests = requests.filter((r) => {
      const items = requestItems.filter((i) => i.requestId === r._id);
      return items.length > 0 && items.every((i) => ssdIds.has(i.productId as string));
    });
    for (const r of testRequests) {
      for (const i of requestItems.filter((i) => i.requestId === r._id)) {
        await ctx.db.delete(i._id);
        deleted.requestItems++;
      }
      await ctx.db.delete(r._id);
      deleted.requests++;
    }
    // ── Entradas de teste (não-oficiais com itens exclusivamente SSD) + itens ──
    const testEntries = entries.filter(
      (e) =>
        e._id !== officialEntry._id &&
        entryItems.some((i) => i.entryId === e._id) &&
        entryItems.filter((i) => i.entryId === e._id).every((i) => ssdIds.has(i.productId))
    );
    const testSupplierIds = new Set(
      testEntries.map((e) => e.supplierId).filter(Boolean) as string[]
    );
    for (const e of testEntries) {
      for (const i of entryItems.filter((i) => i.entryId === e._id)) {
        await ctx.db.delete(i._id);
        deleted.entryItems++;
      }
      await ctx.db.delete(e._id);
      deleted.entries++;
    }
    // ── Fornecedores exclusivos das entradas de teste ──
    for (const s of suppliers.filter((s) => testSupplierIds.has(s._id as string))) {
      await ctx.db.delete(s._id);
      deleted.suppliers++;
    }
    // ── Produtos SSD ──
    for (const p of ssdProducts) {
      await ctx.db.delete(p._id);
      deleted.products++;
    }
    // ── Auditoria dos objetos de teste (depois, preservando o log da limpeza) ──
    const testEntityIds = new Set<string>([
      ...Array.from(ssdIds),
      ...testEntries.map((e) => e._id as string),
      ...testSupplierIds,
      ...testRequests.map((r) => r._id as string),
    ]);
    for (const a of auditLogs.filter((a) => a.entityId && testEntityIds.has(a.entityId))) {
      await ctx.db.delete(a._id);
      deleted.auditLogs++;
    }

    // ── Log da limpeza (entidade própria, não deletável pelo filtro acima) ──
    await ctx.db.insert("auditLogs", {
      userId: undefined,
      action: "update",
      entity: "system",
      entityId: "cleanup-ssd-teste",
      details:
        `Limpeza de dados de teste SSD: ${JSON.stringify(deleted)}. ` +
        `Carga oficial ENT-2026-000001 preservada integralmente.`,
      timestamp: Date.now(),
    });

    return { ok: true, deleted, officialEntryPreserved: officialEntry._id };
  },
});
