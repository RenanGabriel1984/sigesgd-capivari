/**
 * Gestão de Estoque SGGD — SUPRIMENTOS DE IMPRESSÃO (backend).
 *
 * A área "Impressoras" é um RECORTE operacional do estoque real — não há
 * segundo estoque. Toda quantidade vem de `stock`/`lots`/`stockMovements`.
 *
 * ─── Migração histórica autorizada (idempotente) ─────────────────────────────
 * `migrateTIGeralToImpressoras`: move `lots.areaId` de TI Geral/"Sem área" para
 * Impressoras SOMENTE para produtos da categoria "Suprimentos de Impressão"
 * que ainda não estejam na área. Preserva produto, lote, quantidades, datas,
 * fornecedor, NF e documentos. Não cria nem destrói estoque. Auditada.
 * A proteção de saldo compara os totais ANTES × DEPOIS e lança erro
 * (revertendo a mutation) se qualquer total mudar.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { getOptionalSingleValidGlobalStock, requireSingleValidGlobalStock, validateUniqueScopedStockRows } from "../lib/stock-read-integrity";
import { consumeLotLocationStock, recordLotMovementAllocations, resolveWithdrawalLocation } from "./lotLocationLedger";
import {
  buildSupplyRow,
  computeCardTotals,
  computeMonthlyConsumption,
  monthWindow,
  validateWithdrawal,
  classifySupplyType,
  readPackagingConversion,
  buildSupplyFamilies,
  planPackOperation,
  deriveFamilyKey,
  type SupplyFamilyInput,
} from "../lib/print-supplies";

/** Área "Impressoras" (recorte operacional de suprimentos de impressão). */
export const PRINT_AREA_ID = "q97b7737gv98ajm8qqpmjmzjs18ezb58";
/** Área "TI Geral". */
export const TI_GERAL_AREA_ID = "q971w9jkmz8rsqr3vsr2as0dps8eyqns";
/** Categoria "Suprimentos de Impressão". */
export const SUPPLY_CATEGORY_ID = "k57fk85xwpj3b3xj9dc31jwqpd8dgk3a";

/**
 * Snapshot histórico da reconciliação inicial (não é limite operacional).
 * As mutations validam relações entre os livros-razão atuais; o total físico
 * pode mudar legitimamente após entradas e saídas.
 */export const GLOBAL_INVARIANTS = {
  physical: 3338,
  reserved: 0,
  stockByLocation: 3338,
  lotsAvailable: 3338,
} as const;

/* ── Guardas de invariante global (ANTES × DEPOIS em 4 livros-razão) ────── */

interface GlobalTotals {
  physical: number;
  reserved: number;
  stockByLocation: number;
  lotsAvailable: number;
  lotLocationBalances: number;
}

const STOCK_EPSILON = 1e-9;

/** Snapshot SOMENTE-LEITURA dos 5 livros-razão globais. */
async function readGlobalTotals(ctx: any, productIds?: string[]): Promise<GlobalTotals> {
  const [stock, sbl, lots, lotLocationBalances] = await Promise.all([
    ctx.db.query("stock").collect(),
    ctx.db.query("stockByLocation").collect(),
    ctx.db.query("lots").collect(),
    ctx.db.query("lotLocationBalances").collect(),
  ]);
  const allowed = productIds ? new Set(productIds.map(String)) : null;
  const scopedStock = allowed ? stock.filter((row: any) => allowed.has(String(row.productId))) : stock;
  const scopedLocations = allowed ? sbl.filter((row: any) => allowed.has(String(row.productId))) : sbl;
  const scopedLots = allowed ? lots.filter((row: any) => allowed.has(String(row.productId))) : lots;
  const scopedBalances = allowed ? lotLocationBalances.filter((row: any) => allowed.has(String(row.productId))) : lotLocationBalances;
  return {
    physical: scopedStock.reduce((s: number, x: any) => s + x.physicalQuantity, 0),
    reserved: scopedStock.reduce((s: number, x: any) => s + x.reservedQuantity, 0),
    stockByLocation: scopedLocations.reduce((s: number, x: any) => s + x.quantity, 0),
    lotsAvailable: scopedLots.reduce((s: number, l: any) => s + l.quantityAvailable, 0),
    lotLocationBalances: scopedBalances.reduce((s: number, b: any) => s + b.quantityAvailable, 0),
  };
}

/** Valida relações atuais, sem comparar o saldo vivo com o snapshot histórico 3.338. */
function invariantDivergences(t: GlobalTotals): string[] {
  const div: string[] = [];
  const values = [t.physical, t.reserved, t.stockByLocation, t.lotsAvailable, t.lotLocationBalances];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    div.push("há quantidade negativa ou não finita em um dos livros-razão");
  }
  if (Math.abs(t.physical - t.stockByLocation) > STOCK_EPSILON) {
    div.push(`physical=${t.physical} difere de stockByLocation=${t.stockByLocation}`);
  }
  if (Math.abs(t.physical - t.lotsAvailable) > STOCK_EPSILON) {
    div.push(`physical=${t.physical} difere de lotsAvailable=${t.lotsAvailable}`);
  }
  if (Math.abs(t.physical - t.lotLocationBalances) > STOCK_EPSILON) {
    div.push(`physical=${t.physical} difere de lotLocationBalances=${t.lotLocationBalances}`);
  }
  if (t.reserved > t.physical + STOCK_EPSILON) {
    div.push(`reserved=${t.reserved} excede physical=${t.physical}`);
  }
  return div;
}

/* ═══ Migração histórica (idempotente, auditada, com guarda de saldo) ═══════ */

export const migrateTIGeralToImpressoras = mutation({
  args: {},
  handler: async (ctx) => migrateTIGeralToImpressorasImpl(ctx),
});

/**
 * Variante INTERNAL para execução assistida via CLI (`convex run`), que não
 * possui sessão de usuário. Mesma migração, mesmas guardas, mesma auditoria —
 * apenas dispensa a sessão autenticada, registrando o contexto na auditoria.
 */
export const migrateTIGeralToImpressorasInternal = internalMutation({
  args: {},
  handler: async (ctx) => migrateTIGeralToImpressorasImpl(ctx, { viaCli: true }),
});

async function migrateTIGeralToImpressorasImpl(
  ctx: any,
  opts: { viaCli?: boolean } = {},
) {
  {
    let userId: string | null = null;
    if (!opts.viaCli) {
      const auth = await requirePermission(ctx, "stock.mutate", { entity: "lots" });
      userId = auth.userId as string;
    } else {
      userId = await getAuthUserId(ctx).catch(() => null);
    }

    // Snapshot ANTES (soma global de todos os saldos — deve permanecer igual).
    const stockBefore = (await ctx.db.query("stock").collect()) as Array<{ physicalQuantity: number; reservedQuantity: number }>;
    const lotsBefore = (await ctx.db.query("lots").collect()) as Array<{ quantityAvailable: number }>;
    const totalsBefore = {
      physical: stockBefore.reduce((s: number, x: { physicalQuantity: number }) => s + x.physicalQuantity, 0),
      reserved: stockBefore.reduce((s: number, x: { reservedQuantity: number }) => s + x.reservedQuantity, 0),
      lotsAvailable: lotsBefore.reduce((s: number, l: { quantityAvailable: number }) => s + l.quantityAvailable, 0),
    };

    const supplyProducts = new Set(
      ((await ctx.db.query("products").collect()) as Array<{ _id: string; categoryId: string }>)
        .filter((p: { categoryId: string }) => p.categoryId === SUPPLY_CATEGORY_ID)
        .map((p: { _id: string }) => p._id),
    );
    if (supplyProducts.size === 0) {
      return { applied: false, reason: "Nenhum produto na categoria Suprimentos de Impressão.", moved: [] };
    }

    // Lotes elegíveis: da categoria alvo, área != Impressoras.
    const allLots = (await ctx.db.query("lots").collect()) as Array<{
      _id: string; productId: string; areaId?: string | null; lotNumber: string;
    }>;
    const lots = allLots.filter(
      (l) => supplyProducts.has(l.productId) && l.areaId !== PRINT_AREA_ID,
    );

    // Idempotência: nada a fazer se todos já estão na área.
    if (lots.length === 0) {
      return {
        applied: false,
        reason: "Todos os lotes de Suprimentos de Impressão já estão na área Impressoras — nada a fazer.",
        moved: [],
        totalsBefore,
        totalsAfter: totalsBefore,
      };
    }

    const moved: Array<{ lotNumber: string; productName: string; from: string }> = [];
    for (const lot of lots) {
      await ctx.db.patch(lot._id, { areaId: PRINT_AREA_ID as never });
      const product = await ctx.db.get(lot.productId);
      moved.push({
        lotNumber: lot.lotNumber,
        productName: product?.name ?? lot.productId,
        from: lot.areaId ?? "Sem área",
      });
    }

    // Guarda absoluta: a migração não pode alterar nenhum saldo global.
    const stockAfter = (await ctx.db.query("stock").collect()) as Array<{ physicalQuantity: number; reservedQuantity: number }>;
    const lotsAfter = (await ctx.db.query("lots").collect()) as Array<{ quantityAvailable: number }>;
    const totalsAfter = {
      physical: stockAfter.reduce((s: number, x: { physicalQuantity: number }) => s + x.physicalQuantity, 0),
      reserved: stockAfter.reduce((s: number, x: { reservedQuantity: number }) => s + x.reservedQuantity, 0),
      lotsAvailable: lotsAfter.reduce((s: number, l: { quantityAvailable: number }) => s + l.quantityAvailable, 0),
    };
    if (
      totalsAfter.physical !== totalsBefore.physical ||
      totalsAfter.reserved !== totalsBefore.reserved ||
      totalsAfter.lotsAvailable !== totalsBefore.lotsAvailable
    ) {
      throw new Error(
        `VIOLAÇÃO DE SALDO na migração histórica: antes=${JSON.stringify(totalsBefore)} depois=${JSON.stringify(totalsAfter)}. ` +
        "A mutation foi abortada após o patch — verifique manualmente antes de reexecutar.",
      );
    }

    await ctx.db.insert("auditLogs", {
      userId: userId as never,
      action: "transfer_stock",
      entity: "lots",
      entityId: PRINT_AREA_ID,
      details:
        `Migração histórica de área: ${moved.length} lote(s) de Suprimentos de Impressão realocados para a área "Impressoras" ` +
        `(${moved.map((m) => m.lotNumber).join(", ")}). ` +
        `Origem: ${[...new Set(moved.map((m) => m.from))].join(", ")}. ` +
        `Quantidades, produtos, lotes, fornecedores, NFs e documentos preservados. ` +
        `Saldos globais conferidos antes/depois: physical=${totalsBefore.physical}, reserved=${totalsBefore.reserved}, ` +
        `lotsAvailable=${totalsBefore.lotsAvailable} — inalterados. Operação idempotente.`,
      timestamp: Date.now(),
    });

    return { applied: true, moved, totalsBefore, totalsAfter };
  }
}

/* ═══ Painel: estoque da área Impressoras ═══════════════════════════════════ */

export const getSupplyDashboard = query({
  args: {},
  handler: async (ctx) => {
    // Consulta: técnico vê (stock.view); operação (withdraw) segue exigindo
    // stock.mutate — nenhum ganho de permissão por esta tela.
    await requirePermission(ctx, "stock.view");

    const [products, stock, lots] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("stock").collect(),
      ctx.db.query("lots").collect(),
    ]);

    const supplyProducts = products.filter((p) => p.categoryId === SUPPLY_CATEGORY_ID);
    const supplyIds = new Set(supplyProducts.map((p) => p._id));

    // Lotes da área Impressoras por produto (recorte operacional).
    const areaLots = new Map<string, number>();
    for (const lot of lots) {
      if (lot.areaId !== PRINT_AREA_ID || !supplyIds.has(lot.productId)) continue;
      areaLots.set(lot.productId, (areaLots.get(lot.productId) ?? 0) + lot.quantityAvailable);
    }

    // Estoque global por produto (o recorte é sobre lotes; o saldo exibido
    // permanece o estoque real do produto).
    const stockByProduct = new Map<string, { physical: number; reserved: number }>();
    for (const s of stock) {
      stockByProduct.set(s.productId, { physical: s.physicalQuantity, reserved: s.reservedQuantity });
    }

    const rows = supplyProducts
      .map((p) => {
        const current = stockByProduct.get(p._id)?.physical ?? 0;
        const inArea = areaLots.get(p._id) ?? 0;
        return buildSupplyRow({
          productId: p._id as string,
          productName: p.name,
          brand: p.brand ?? null,
          model: p.model ?? null,
          unitOfMeasure: p.unitOfMeasure,
          currentStock: current,
          minimumStock: p.minimumStock ?? 0,
          idealStock: p.idealStock ?? 0,
          inArea: inArea,
        });
      })
      .sort((a, b) => a.type.localeCompare(b.type) || a.productName.localeCompare(b.productName));

    // Agrupamento por FAMÍLIA física (ex.: Protetor de crachá 13 caixas + 18 un
    // → 668 unidades-base). Conversão só entra quando explicitamente
    // configurada no produto; sem conversão, família de 1 (comportamento anterior).
    const familyInputs: SupplyFamilyInput[] = supplyProducts.map((p) => {
      const current = stockByProduct.get(p._id)?.physical ?? 0;
      const inArea = areaLots.get(p._id) ?? 0;
      return {
        productId: p._id as string,
        productName: p.name,
        brand: p.brand ?? null,
        model: p.model ?? null,
        unitOfMeasure: p.unitOfMeasure,
        currentStock: current,
        minimumStock: p.minimumStock ?? 0,
        idealStock: p.idealStock ?? 0,
        // Parâmetro MANUAL de consumo mensal (nunca calculado aqui).
        monthlyConsumptionTarget: p.monthlyConsumptionTarget ?? null,
        inArea,
        packaging: readPackagingConversion(p),
      };
    });
    const families = buildSupplyFamilies(familyInputs);

    return {
      rows,
      families,
      totals: computeCardTotals(rows),
      areaId: PRINT_AREA_ID,
      areaQuantity: rows.reduce((s, r) => s + (r.inArea ?? 0), 0),
    };
  },
});

/* ═══ Consumo mensal ════════════════════════════════════════════════════════ */

export const getMonthlyConsumption = query({
  args: {
    year: v.number(),
    month: v.number(), // 1..12
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "stock.view");

    const [products, movements, stock] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("stockMovements").withIndex("by_timestamp").order("desc").take(2000).then((r) => r.reverse()),
      ctx.db.query("stock").collect(),
    ]);

    const supplyProducts = new Map(
      products.filter((p) => p.categoryId === SUPPLY_CATEGORY_ID).map((p) => [p._id, p]),
    );

    const meta = new Map<string, { name: string; brand: string | null | undefined; unitOfMeasure: string }>();
    for (const [id, p] of supplyProducts) {
      meta.set(id, { name: p.name, brand: p.brand ?? null, unitOfMeasure: p.unitOfMeasure });
    }
    const currentStock = new Map<string, number>(
      stock.filter((s) => supplyProducts.has(s.productId)).map((s) => [s.productId, s.physicalQuantity]),
    );

    const lines = computeMonthlyConsumption(
      movements.map((m) => ({
        type: m.type,
        productId: m.productId as string,
        quantity: m.quantity,
        timestamp: m.timestamp,
      })),
      meta,
      currentStock,
      monthWindow(args.year, args.month),
    );

    // Consumo por organização (secretaria/departamento/unidade) a partir das
    // requisições entregues no período (origem real do consumo operacional).
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_created")
      .order("desc")
      .take(500)
      .then((r) => r.reverse());

    const delivered = requests.filter((r) => r.status === "delivered" && r.deliveredAt != null && r.deliveredAt >= monthWindow(args.year, args.month).start && r.deliveredAt < monthWindow(args.year, args.month).end);

    const byOrg: Array<{ orgName: string; productLabel: string; type: string; quantity: number }> = [];
    for (const r of delivered) {
      const items = await ctx.db
        .query("requestItems")
        .withIndex("by_request", (q) => q.eq("requestId", r._id))
        .collect();
      const org = r.secretariaId ? await ctx.db.get(r.secretariaId) : null;
      const orgName = org?.name ?? "Sem secretaria";
      for (const item of items) {
        const p = supplyProducts.get(item.productId);
        if (!p) continue;
        const qty = item.quantityDelivered ?? item.quantityApproved ?? 0;
        if (qty <= 0) continue;
        byOrg.push({ orgName, productLabel: p.name, type: classifySupplyType(p.name), quantity: qty });
      }
    }

    return { lines, byOrg, period: monthWindow(args.year, args.month) };
  },
});

/* ═══ Retirada rápida (reutiliza as regras da saída rápida) ═════════════════ */

export const withdraw = mutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
    locationId: v.optional(v.id("storageLocations")),
    secretariaId: v.optional(v.id("organizations")),
    departamentoId: v.optional(v.id("organizations")),
    unidadeId: v.optional(v.id("organizations")),
    reason: v.optional(v.string()),
    osNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // RBAC: mesma permissão da saída rápida/estoque — sem exceção de papel.
    const { userId } = await requirePermission(ctx, "stock.mutate", { entity: "stockMovements" });

    args = { ...args, quantity: Number(args.quantity) };
    const check = validateWithdrawal(args.quantity, Infinity); // forma; o limite real é validado abaixo
    if (!check.ok) throw new Error(check.reason!);

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (product.categoryId !== SUPPLY_CATEGORY_ID) {
      throw new Error('Produto não pertence à categoria "Suprimentos de Impressão".');
    }

    // ── Mesmas regras da saída rápida existente (stockSetup.quickExit) ──
    const stockRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const stock = getOptionalSingleValidGlobalStock(stockRows, product.name);
    const available = (stock?.physicalQuantity ?? 0) - (stock?.reservedQuantity ?? 0);
    if (args.quantity > available) {
      throw new Error(`Estoque insuficiente. Disponível: ${available} ${product.unitOfMeasure}`);
    }

    const sourceLocationId = await resolveWithdrawalLocation(ctx, args.productId, args.locationId);
    const lotConsumption = await consumeLotLocationStock(ctx, {
      productId: args.productId,
      locationId: sourceLocationId,
      quantity: args.quantity,
    });
    const sourceLocation = await ctx.db.get(sourceLocationId as Id<"storageLocations">);
    const consumedLots = lotConsumption.allocations.map((allocation) => ({
      lotId: String(allocation.lotId),
      lotNumber: allocation.lotNumber,
      qty: allocation.quantity,
    }));

    const now = Date.now();
    const previousPhysical = stock!.physicalQuantity;
    const newPhysical = previousPhysical - args.quantity;
    await ctx.db.patch(stock!._id, { physicalQuantity: newPhysical });

    // Movimentação com lotId estruturado (1º lote consumido) + observation
    // preservando o padrão legado "Lotes: N(qty)".
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      previousPhysical,
      newPhysical,
      previousReserved: stock!.reservedQuantity,
      newReserved: stock!.reservedQuantity,
      lotId: consumedLots[0].lotId as never,
      locationId: sourceLocationId,
      userId,
      exitNumber: `SAI-${new Date(now).getFullYear()}-SUP-${now}`,
      observation:
        `Retirada de suprimento — ${args.reason ?? "Sem motivo"} ` +
        `| Armário: ${sourceLocation?.name ?? sourceLocationId} ` +
        `| O.S.: ${args.osNumber ?? "—"} | Destino: ${args.secretariaId ?? "—"} ` +
        `| Lotes retirados: ${consumedLots.map((item) => `${item.lotNumber}(${item.qty})`).join(", ")}` +
        (args.observation ? ` | Obs: ${args.observation}` : ""),
      timestamp: now,
    } as never);

    await recordLotMovementAllocations(ctx, {
      movementId, productId: args.productId, locationId: sourceLocationId,
      allocations: lotConsumption.allocations,
    });

    await ctx.db.insert("auditLogs", {
      userId: userId as never,
      action: "move_stock",
      entity: "stockMovements",
      entityId: movementId,
      details:
        `Retirada rápida de suprimento de impressão: ${args.quantity} ${product.unitOfMeasure} de "${product.name}". ` +
        `Lotes retirados: ${consumedLots.map((item) => `${item.lotNumber}(${item.qty})`).join(", ")}. ` +
        `Motivo: ${args.reason ?? "—"}; O.S.: ${args.osNumber ?? "—"}; Destino: ${args.secretariaId ?? "—"}.` +
        (args.observation ? ` Obs: ${args.observation}` : ""),
      timestamp: now,
    });

    return { movementId, consumedLots, newPhysical };
  },
});

/* ═══ Configuração de conversão de embalagem (EXPLÍCITA; nunca inferida) ═══ */

/**
 * Configura a conversão de embalagem de um produto (1 embalagem = N unidades-base).
 * Não altera saldos, lotes, movimentos nem registros históricos — apenas metadados.
 * Limpa com `null` quando não aplicável. Auditada.
 */
export const configurePackaging = mutation({
  args: {
    productId: v.id("products"),
    baseUnit: v.optional(v.string()),
    packagingUnit: v.optional(v.string()),
    conversionFactor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "products.manage", { entity: "products", entityId: args.productId });
    return configurePackagingImpl(ctx, userId as string, args.productId, {
      baseUnit: args.baseUnit,
      packagingUnit: args.packagingUnit,
      conversionFactor: args.conversionFactor,
    });
  },
});

async function configurePackagingImpl(
  ctx: any,
  userId: string,
  productId: string,
  packaging: { baseUnit?: string | null; packagingUnit?: string | null; conversionFactor?: number | null },
) {
  const product = await ctx.db.get(productId);
  if (!product) throw new Error("Produto não encontrado");
  if (product.categoryId !== SUPPLY_CATEGORY_ID) {
    throw new Error('Produto não pertence à categoria "Suprimentos de Impressão".');
  }

  const updates: { baseUnit?: string | null; packagingUnit?: string | null; conversionFactor?: number | null } = {};
  const { baseUnit, packagingUnit, conversionFactor } = packaging;

  if (baseUnit === null) updates.baseUnit = null;
  else if (baseUnit != null) {
    if (!baseUnit.trim()) throw new Error("Unidade-base inválida");
    updates.baseUnit = baseUnit.trim();
  }
  if (packagingUnit === null) updates.packagingUnit = null;
  else if (packagingUnit != null) {
    if (!packagingUnit.trim()) throw new Error("Unidade de embalagem inválida");
    updates.packagingUnit = packagingUnit.trim();
  }
  if (conversionFactor === null) updates.conversionFactor = null;
  else if (conversionFactor != null) {
    if (!Number.isFinite(conversionFactor) || conversionFactor <= 0 || !Number.isInteger(conversionFactor)) {
      throw new Error("Fator de conversão deve ser inteiro positivo");
    }
    updates.conversionFactor = conversionFactor;
  }      // Consistência: a conversão só é considerada válida com os TRÊS campos.
  const candidate = {
    baseUnit: updates.baseUnit ?? (product as any).baseUnit ?? null,
    packagingUnit: updates.packagingUnit ?? (product as any).packagingUnit ?? null,
    conversionFactor: updates.conversionFactor ?? (product as any).conversionFactor ?? null,
  };
  const present = [candidate.baseUnit, candidate.packagingUnit, candidate.conversionFactor];
  const partiallySet = present.some((x) => x != null) && present.some((x) => x == null);
  if (partiallySet) {
    throw new Error(
      "Conversão incompleta: informe unidade-base, unidade de embalagem e fator juntos (ou limpe todos com null).",
    );
  }
  if (candidate.conversionFactor != null && candidate.baseUnit === candidate.packagingUnit) {
    throw new Error("Unidade-base e unidade de embalagem devem ser distintas");
  }

  await ctx.db.patch(productId, updates);
  await ctx.db.insert("auditLogs", {
    userId: userId as never,
    action: "update",
    entity: "products",
    entityId: productId,
    details:
      `Conversão de embalagem configurada para "${product.name}": ` +
      `baseUnit=${updates.baseUnit ?? null}, packagingUnit=${updates.packagingUnit ?? null}, ` +
      `conversionFactor=${updates.conversionFactor ?? null}. ` +
      "Somente metadados — saldos, lotes, movimentos e histórico preservados.",
    timestamp: Date.now(),
  });
  return updates;
}

/**
 * Configuração assistida do PROTETOR DE CRACHÁ (marca Reflex):
 * "caixa fechada" → 1 caixa = 50 unidades. Idempotente (reexecutar não altera
 * nada quando já configurado igual) e auditada. Metadados APENAS.
 */
export const configureBadgeProtectorPackaging = internalMutation({
  args: {},
  handler: async (ctx) => {
    const products = (await ctx.db.query("products").collect()) as Array<{
      _id: string; name: string; brand?: string | null; categoryId: string;
      baseUnit?: string | null; packagingUnit?: string | null; conversionFactor?: number | null;
    }>;
    const targets = products.filter(
      (p) => p.categoryId === SUPPLY_CATEGORY_ID &&
        (p.brand ?? "").toLowerCase() === "reflex" &&
        /protetor de crach/i.test(p.name),
    );
    if (targets.length !== 2) {
      return { applied: false, reason: `Esperados 2 produtos Protetor (Reflex); encontrados ${targets.length}.` };
    }
    const closed = targets.find((p) => /caixa fechada/i.test(p.name));
    const loose = targets.find((p) => /unidade avulsa/i.test(p.name));
    if (!closed || !loose) {
      return { applied: false, reason: "Produtos Protetor sem os sufixos esperados (caixa fechada / unidade avulsa)." };
    }
    const already =
      closed.baseUnit === "un" && closed.packagingUnit === "caixa" && closed.conversionFactor === 50 &&
      loose.baseUnit == null && loose.packagingUnit == null && loose.conversionFactor == null;
    if (already) {
      return { applied: false, reason: "Protetor de crachá já configurado (1 caixa = 50 un) — idempotente." };
    }
    await configurePackagingImpl(ctx, null as unknown as string, closed._id, {
      baseUnit: "un", packagingUnit: "caixa", conversionFactor: 50,
    });
    await ctx.db.insert("auditLogs", {
      userId: undefined,
      action: "update",
      entity: "products",
      entityId: closed._id,
      details:
        `Configuração assistida de conversão de embalagem: "${closed.name}" (Reflex) → 1 caixa = 50 unidades. ` +
        `"${loose.name}" permanece sem conversão (1 unidade = 1 unidade). ` +
        "Operação idempotente; nenhum saldo, lote ou registro histórico alterado.",
      timestamp: Date.now(),
    });
    return { applied: true, configured: [closed.name], untouched: [loose.name] };
  },
});

/* ═══ Retirada por FAMÍLIA (unidade-base; composição preservada) ═══════════ */

/**
 * Retirada em unidades-base de um membro configurado de uma família física.
 * Utiliza as MESMAS regras centrais da saída rápida (stock/lot FIFO, movement
 * exit, auditoria) e preserva a composição logística:
 *  - sai primeiro das unidades avulsas (FIFO físico);
 *  - abrir caixa é evento EXPLÍCITO e INTEGRAL: a caixa fechada correspondente
 *    é transferida para o registro "unidade avulsa" (open_pack);
 *  - retirada de caixa fechada integral usa take_pack (nunca desmonta);
 *  - guarda de invariante: a soma global físico+reservado NÃO MUDA além da
 *    saída autorizada (abertura é apenas reclassificação entre registros).
 */
export const withdrawFamily = mutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(), // em unidades-base
    locationId: v.id("storageLocations"),
    secretariaId: v.optional(v.id("organizations")),
    departamentoId: v.optional(v.id("organizations")),
    unidadeId: v.optional(v.id("organizations")),
    reason: v.optional(v.string()),
    osNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "stock.mutate", { entity: "stockMovements" });

    args = { ...args, quantity: Number(args.quantity) };
    const form = validateWithdrawal(args.quantity, Infinity);
    if (!form.ok) throw new Error(form.reason!);

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (product.categoryId !== SUPPLY_CATEGORY_ID) {
      throw new Error('Produto não pertence à categoria "Suprimentos de Impressão".');
    }

    const stockRows = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const stock = requireSingleValidGlobalStock(stockRows, product.name);

    // Família: todos os produtos da categoria com a mesma chave canônica.
    const conv = readPackagingConversion(product);
    if (!conv) {
      throw new Error("Produto sem conversão de embalagem configurada — use a retirada em unidade de estoque.");
    }
    const all = (await ctx.db.query("products").collect()) as Array<{
      _id: string; name: string; brand?: string | null; categoryId: string;
      unitOfMeasure: string; baseUnit?: string | null; packagingUnit?: string | null; conversionFactor?: number | null;
    }>;
    const familyKey = deriveFamilyKey(product.name, product.brand ?? null);
    const members = all.filter(
      (p) => p.categoryId === SUPPLY_CATEGORY_ID && deriveFamilyKey(p.name, p.brand ?? null) === familyKey,
    );
    const closedMember = members.find((p) => !!readPackagingConversion(p));
    const looseMember = members.find((p) => !readPackagingConversion(p));
    if (!closedMember || !looseMember || closedMember._id !== product._id) {
      throw new Error("Família inválida para retirada em unidades: configure a conversão no produto de embalagem (caixa fechada).");
    }

    // Concilia somente os dois produtos desta família. Um lote legado de outra
    // área não deve bloquear uma retirada independente, mas qualquer divergência
    // entre os livros-razão destes dois produtos bloqueia a operação.
    const familyProductIds = [closedMember._id, looseMember._id];
    const before = await readGlobalTotals(ctx, familyProductIds);
    const preDivergences = invariantDivergences(before);
    if (preDivergences.length > 0) {
      throw new Error(`INTEGRIDADE: estoque da família divergente antes da operação (${preDivergences.join("; ")}). Operação abortada.`);
    }

    const stockOf = async (productId: string, productName: string) => {
      const rows = await ctx.db.query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", productId))
        .collect();
      return getOptionalSingleValidGlobalStock(rows, productName);
    };
    const closedStock = await stockOf(closedMember._id, closedMember.name);
    const looseStock = await stockOf(looseMember._id, looseMember.name);
    const closedPhys = closedStock?.physicalQuantity ?? 0;
    const closedRes = closedStock?.reservedQuantity ?? 0;
    const loosePhys = looseStock?.physicalQuantity ?? 0;
    const looseRes = looseStock?.reservedQuantity ?? 0;
    const closedAvailable = closedPhys - closedRes;
    const looseAvailable = loosePhys - looseRes;

    // Disponibilidade da FAMÍLIA em unidades-base (fechadas × fator + avulsas).
    const familyAvailable = closedAvailable * conv.factor + looseAvailable;
    if (args.quantity > familyAvailable) {
      throw new Error(`Estoque insuficiente. Disponível: ${familyAvailable} ${conv.baseUnit}`);
    }

    // Composição FÍSICA (registros): fechadas = saldo do produto-caixa; avulsas = saldo do produto-unidade.
    const plan = planPackOperation(args.quantity, { closedPacks: closedAvailable, looseUnits: looseAvailable, factor: conv.factor });
    if (!plan) {
      throw new Error(
        `Composição insuficiente: ${looseAvailable} un. avulsas + ${closedAvailable} ${conv.packagingUnit}(s) de ${conv.factor} un. ` +
        `Não atende a ${args.quantity} ${conv.baseUnit}.`,
      );
    }

    const now = Date.now();
    const consumedLots: Array<{ lotId: any; lotNumber: string; qty: number; productId: any }> = [];
    const reclassifiedFromLots: Array<{ lotId: any; lotNumber: string; qty: number }> = [];
    const consumeAtLocation = async (productId: string, quantity: number, locationId: any) => {
      if (quantity <= 0) return { allocations: [] as any[] };
      return consumeLotLocationStock(ctx, { productId, locationId, quantity });
    };
    const appendWithdrawalAllocations = (productId: any, allocations: Array<any>) => {
      consumedLots.push(...allocations.map((allocation) => ({
        lotId: allocation.lotId,
        lotNumber: allocation.lotNumber,
        qty: allocation.quantity,
        productId,
      })));
    };

    let closedExitUnits = 0; // quantidade de EMBALAGENS fechadas retiradas
    let looseExitUnits = 0; // quantidade de unidades-base efetivamente retirada
    let newClosedPhys = closedPhys;
    let newLoosePhys = loosePhys;

    if (plan.operation === "take_pack") {
      // Primeiro consome avulsas; o restante só pode sair como embalagens inteiras.
      looseExitUnits = Math.min(looseAvailable, args.quantity);
      closedExitUnits = Math.floor((args.quantity - looseExitUnits) / conv.factor);
      if (looseExitUnits > 0) {
        const loose = await consumeAtLocation(looseMember._id, looseExitUnits, args.locationId);
        appendWithdrawalAllocations(looseMember._id, loose.allocations);
        newLoosePhys = loosePhys - looseExitUnits;
      }
      if (closedExitUnits > 0) {
        const closed = await consumeAtLocation(closedMember._id, closedExitUnits, args.locationId);
        appendWithdrawalAllocations(closedMember._id, closed.allocations);
        newClosedPhys = closedPhys - closedExitUnits;
      }
    } else {
      // Abrir embalagens é reclassificação física, não saída das unidades todas.
      // Cada lote de embalagem consumido origina lote avulso próprio, preservando
      // a cadeia de origem mesmo quando a abertura atravessa mais de um lote.
      const openPacks = plan.packs;
      const openedUnits = openPacks * conv.factor;
      const opened = await consumeAtLocation(closedMember._id, openPacks, args.locationId);
      newClosedPhys = closedPhys - openPacks;
      reclassifiedFromLots.push(...opened.allocations.map((allocation: any) => ({
        lotId: allocation.lotId,
        lotNumber: allocation.lotNumber,
        qty: allocation.quantity,
      })));

      for (const sourceAllocation of opened.allocations) {
        const sourceLot = await ctx.db.get(sourceAllocation.lotId as Id<"lots">);
        if (!sourceLot?.entryId) {
          throw new Error("Falha de rastreabilidade: lote de origem da embalagem aberta não encontrado. Nenhuma reclassificação registrada.");
        }
        const childQuantity = sourceAllocation.quantity * conv.factor;
        const reclassifiedLotId = await ctx.db.insert("lots", {
          lotNumber: `REC-${now}-${sourceLot.lotNumber}`,
          productId: looseMember._id as Id<"products">,
          entryId: sourceLot.entryId,
          brand: looseMember.brand ?? undefined,
          quantityReceived: childQuantity,
          quantityAvailable: childQuantity,
          receivedAt: now,
          supplierId: sourceLot.supplierId,
          invoiceNumber: sourceLot.invoiceNumber,
          active: true,
          materialType: sourceLot.materialType,
          areaId: (sourceLot.areaId ?? PRINT_AREA_ID) as never,
          originLotId: sourceLot._id,
          observation: `Reclassificação de ${sourceAllocation.quantity} embalagem(ns) de "${closedMember.name}" para "${looseMember.name}". Origem: ${sourceLot.lotNumber}.`,
        } as never);
        await ctx.db.insert("lotLocationBalances", {
          lotId: reclassifiedLotId as Id<"lots">,
          productId: looseMember._id as Id<"products">,
          locationId: args.locationId,
          quantityAvailable: childQuantity,
          updatedAt: now,
        });
      }

      const looseLocationRows = await ctx.db.query("stockByLocation")
        .withIndex("by_product", (q: any) => q.eq("productId", looseMember._id))
        .collect();
      validateUniqueScopedStockRows(looseLocationRows, looseMember.name);
      const looseLocationRow = looseLocationRows.find((row: any) => row.locationId === args.locationId);
      if (looseLocationRow) {
        await ctx.db.patch(looseLocationRow._id, { quantity: looseLocationRow.quantity + openedUnits });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: looseMember._id as Id<"products">,
          locationId: args.locationId,
          quantity: openedUnits,
        });
      }
      newLoosePhys = loosePhys + openedUnits;

      // Agora a saída real consome as unidades avulsas (antigas primeiro,
      // e só depois os lotes recém-abertos, conforme FIFO por data).
      looseExitUnits = args.quantity;
      const loose = await consumeAtLocation(looseMember._id, looseExitUnits, args.locationId);
      appendWithdrawalAllocations(looseMember._id, loose.allocations);
      newLoosePhys -= looseExitUnits;
    }

    // Atualiza os dois saldos globais. Embalagens e unidades-base são produtos
    // distintos; a equivalência física é conferida em unidade-base abaixo.
    if (closedExitUnits > 0 || plan.operation === "open_pack") {
      if (!closedStock) throw new Error("Saldo global do produto em embalagem fechada não encontrado.");
      await ctx.db.patch(closedStock._id as Id<"stock">, { physicalQuantity: newClosedPhys });
    }
    if (looseExitUnits > 0 || plan.operation === "open_pack") {
      if (looseStock) {
        await ctx.db.patch(looseStock._id as Id<"stock">, { physicalQuantity: newLoosePhys });
      } else if (newLoosePhys > 0) {
        await ctx.db.insert("stock", {
          productId: looseMember._id as Id<"products">,
          physicalQuantity: newLoosePhys,
          reservedQuantity: 0,
        });
      }
    }

    // Guarda de invariante: a soma global NÃO MUDA além da saída autorizada.
    const after = await readGlobalTotals(ctx, familyProductIds);
    const physicalDelta = after.physical - before.physical;
    const closedDelta = newClosedPhys - closedPhys;
    const looseDelta = newLoosePhys - loosePhys;
    const expectedRawDelta = closedDelta + looseDelta;
    const baseUnitDelta = closedDelta * conv.factor + looseDelta;
    if (Math.abs(physicalDelta - expectedRawDelta) > STOCK_EPSILON) {
      throw new Error(
        `VIOLAÇÃO DE SALDO na reclassificação/retirada: Δglobal=${physicalDelta}, esperado=${expectedRawDelta}.`,
      );
    }
    if (Math.abs(baseUnitDelta + args.quantity) > STOCK_EPSILON) {
      throw new Error(
        `VIOLAÇÃO DE SALDO em unidade-base: Δ=${baseUnitDelta}, esperado=${-args.quantity}.`,
      );
    }
    if (Math.abs(after.reserved - before.reserved) > STOCK_EPSILON) {
      throw new Error("VIOLAÇÃO DE SALDO: reservado global alterado indevidamente. Operação abortada.");
    }
    const afterDivergences = invariantDivergences(after);
    if (afterDivergences.length > 0) {
      throw new Error(
        `VIOLAÇÃO DE SALDO após retirada (${afterDivergences.join("; ")}). Operação abortada.`,
      );
    }

    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId,
      type: "exit",
      quantity: args.quantity,
      // Campos do movimento expressos em UNIDADES-BASE da família:
      previousPhysical: closedPhys * conv.factor + loosePhys,
      newPhysical: closedPhys * conv.factor + loosePhys - args.quantity,
      previousReserved: closedRes * conv.factor + looseRes,
      newReserved: closedRes * conv.factor + looseRes,
      lotId: consumedLots.find((allocation) => allocation.productId === args.productId)?.lotId as never,
      locationId: args.locationId,
      userId,
      exitNumber: `SAI-${new Date(now).getFullYear()}-SUP-${now}`,
      observation:
        `Retirada por família (${conv.baseUnit}) — ${args.reason ?? "Sem motivo"} ` +
        `| Operação: ${plan.operation === "open_pack" ? `abertura integral de ${plan.packs} ${conv.packagingUnit}(s)` : `${plan.packs > 0 ? `${plan.packs} ${conv.packagingUnit}(s) fechada(s)` : ""}${plan.packs > 0 && looseExitUnits > 0 ? " + " : ""}${looseExitUnits} ${conv.baseUnit}. avulsa(s)`} ` +
        `| Composição antes: ${closedAvailable} ${conv.packagingUnit}(s) fechada(s) + ${looseAvailable} ${conv.baseUnit}. avulsa(s) ` +
        `| O.S.: ${args.osNumber ?? "—"} | Destino: ${args.secretariaId ?? "—"} ` +
        `| Lotes retirados: ${consumedLots.map((item) => `${item.lotNumber}(${item.qty})`).join(", ")}` +
        (reclassifiedFromLots.length ? ` | Embalagens abertas: ${reclassifiedFromLots.map((item) => `${item.lotNumber}(${item.qty})`).join(", ")}` : "") +
        (args.observation ? ` | Obs: ${args.observation}` : ""),
      timestamp: now,
    } as never);

    const withdrawalGroups = new Map<string, { productId: any; allocations: Array<{ lotId: any; quantity: number }> }>();
    for (const allocation of consumedLots) {
      const key = String(allocation.productId);
      const group = withdrawalGroups.get(key) ?? { productId: allocation.productId, allocations: [] };
      group.allocations.push({ lotId: allocation.lotId, quantity: allocation.qty });
      withdrawalGroups.set(key, group);
    }
    for (const group of withdrawalGroups.values()) {
      await recordLotMovementAllocations(ctx, {
        movementId, productId: group.productId, locationId: args.locationId,
        allocations: group.allocations,
        allocationType: "withdrawal",
      });
    }
    if (reclassifiedFromLots.length > 0) {
      await recordLotMovementAllocations(ctx, {
        movementId, productId: closedMember._id, locationId: args.locationId,
        allocations: reclassifiedFromLots.map((allocation) => ({
          lotId: allocation.lotId, quantity: allocation.qty,
        })),
        allocationType: "reclassification",
      });
    }

    await ctx.db.insert("auditLogs", {
      userId,
      action: "move_stock",
      entity: "stockMovements",
      entityId: movementId,
      details:
        `Retirada por família em unidades-base: ${args.quantity} ${conv.baseUnit} de "${product.name}". ` +
        `Operação ${plan.operation === "open_pack" ? `open_pack(${plan.packs} ${conv.packagingUnit})` : `take_pack(${plan.packs} ${conv.packagingUnit}, ${looseExitUnits} ${conv.baseUnit} avulsas)`}. ` +
        `Lotes retirados: ${consumedLots.map((item) => `${item.lotNumber}(${item.qty})`).join(", ")}. ` +
        (reclassifiedFromLots.length ? `Lotes reclassificados: ${reclassifiedFromLots.map((item) => `${item.lotNumber}(${item.qty})`).join(", ")}. ` : "") +
        `Motivo: ${args.reason ?? "—"}; O.S.: ${args.osNumber ?? "—"}; Destino: ${args.secretariaId ?? "—"}. ` +
        `Invariante global preservado (Δphysical=${-args.quantity}, Δreserved=0).`,
      timestamp: now,
    });

    return { movementId, plan, consumedLots, compositionAfter: { closedPacks: closedPhys - closedExitUnits, looseUnits: newLoosePhys - looseRes } };
  },
});

/* ═══ Integridade global (consulta read-only) ═══════════════════════════════ */

/**
 * SIMULAÇÃO read-only da retirada por família: valida a composição real e o
 * plano de operação (take_pack/open_pack) SEM alterar nenhum saldo.
 */
export const previewFamilyWithdrawal = query({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "stock.view");
    return previewFamilyWithdrawalImpl(ctx, args);
  },
});

/** Variante INTERNAL (CLI, sem sessão) da MESMA simulação read-only. */
export const previewFamilyWithdrawalInternal = internalQuery({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => previewFamilyWithdrawalImpl(ctx, args),
});

async function previewFamilyWithdrawalImpl(ctx: any, args: { productId: string; quantity: number }) {
    const quantity = Number(args.quantity);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (product.categoryId !== SUPPLY_CATEGORY_ID) {
      throw new Error('Produto não pertence à categoria "Suprimentos de Impressão".');
    }
    const conv = readPackagingConversion(product);
    if (!conv) throw new Error("Produto sem conversão de embalagem configurada.");

    const all = (await ctx.db.query("products").collect()) as Array<{
      _id: string; name: string; brand?: string | null; categoryId: string;
      unitOfMeasure: string; baseUnit?: string | null; packagingUnit?: string | null; conversionFactor?: number | null;
    }>;
    const familyKey = deriveFamilyKey(product.name, product.brand ?? null);
    const members = all.filter(
      (p) => p.categoryId === SUPPLY_CATEGORY_ID && deriveFamilyKey(p.name, p.brand ?? null) === familyKey,
    );
    const closedMember = members.find((p) => !!readPackagingConversion(p));
    const looseMember = members.find((p) => !readPackagingConversion(p));

    const stockOf = async (productId: string, productName: string) => {
      const rows = await ctx.db.query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", productId))
        .collect();
      return getOptionalSingleValidGlobalStock(rows, productName);
    };
    const closedStock = closedMember ? await stockOf(closedMember._id, closedMember.name) : null;
    const looseStock = looseMember ? await stockOf(looseMember._id, looseMember.name) : null;
    const closedAvailable = (closedStock?.physicalQuantity ?? 0) - (closedStock?.reservedQuantity ?? 0);
    const looseAvailable = (looseStock?.physicalQuantity ?? 0) - (looseStock?.reservedQuantity ?? 0);
    const familyAvailable = closedAvailable * conv.factor + looseAvailable;
    const plan = quantity > 0 && quantity <= familyAvailable
      ? planPackOperation(quantity, { closedPacks: closedAvailable, looseUnits: looseAvailable, factor: conv.factor })
      : null;

    return {
      familyKey,
      productName: product.name,
      conversion: conv,
      composition: {
        closedPacks: closedAvailable,
        looseUnits: looseAvailable,
        factor: conv.factor,
        familyAvailable,
      },
      quantity,
      plan,
      balanceAfter: quantity > 0 && quantity <= familyAvailable ? familyAvailable - quantity : null,
    };
}

/** Compara os 4 livros-razão globais com os invariantes esperados. */
export const getGlobalIntegrity = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "stock.view");
    const totals = await readGlobalTotals(ctx);
    return {
      totals,
      expected: GLOBAL_INVARIANTS,
      divergences: invariantDivergences(totals),
      ok: invariantDivergences(totals).length === 0,
    };
  },
});

/* ═══ Parâmetros mín/ideal por produto ══════════════════════════════════════ */

export const updateStockParameters = mutation({
  args: {
    productId: v.id("products"),
    minimumStock: v.optional(v.number()),
    idealStock: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "products.manage", { entity: "products", entityId: args.productId });

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (product.categoryId !== SUPPLY_CATEGORY_ID) {
      throw new Error('Produto não pertence à categoria "Suprimentos de Impressão".');
    }

    const updates: { minimumStock?: number; idealStock?: number } = {};
    if (args.minimumStock != null) {
      if (args.minimumStock < 0) throw new Error("Estoque mínimo não pode ser negativo");
      updates.minimumStock = args.minimumStock;
    }
    if (args.idealStock != null) {
      if (args.idealStock < 0) throw new Error("Estoque ideal não pode ser negativo");
      if (args.minimumStock != null && args.idealStock < args.minimumStock) {
        throw new Error("Estoque ideal deve ser >= mínimo");
      } else if (args.minimumStock == null && product.minimumStock != null && args.idealStock < product.minimumStock) {
        throw new Error("Estoque ideal deve ser >= mínimo atual do produto");
      }
      updates.idealStock = args.idealStock;
    }
    if (Object.keys(updates).length === 0) throw new Error("Nada a atualizar");

    await ctx.db.patch(args.productId, updates);

    await ctx.db.insert("auditLogs", {
      userId: userId as never,
      action: "update",
      entity: "products",
      entityId: args.productId,
      details:
        `Parâmetros de suprimento atualizados: mínimo=${updates.minimumStock ?? product.minimumStock}, ` +
        `ideal=${updates.idealStock ?? product.idealStock} (produto "${product.name}").`,
      timestamp: Date.now(),
    });

    return updates;
  },
});
