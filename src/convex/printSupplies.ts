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
import { query, mutation, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
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
 * Invariantes GLOBAIS inegociáveis do estoque (snapshot oficial da
 * reconciliação): physical 3338 · reserved 0 · available 3338 ·
 * stockByLocation 3338 · soma dos lotes 3338. Toda mutation que mexe em
 * saldos compara ANTES × DEPOIS nestas 5 representações e aborta em
 * QUALQUER divergência além da saída autorizada.
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
}

/** Snapshot SOMENTE-LEITURA dos 4 livros-razão globais. */
async function readGlobalTotals(ctx: any): Promise<GlobalTotals> {
  const [stock, sbl, lots] = await Promise.all([
    ctx.db.query("stock").collect(),
    ctx.db.query("stockByLocation").collect(),
    ctx.db.query("lots").collect(),
  ]);
  return {
    physical: stock.reduce((s: number, x: any) => s + x.physicalQuantity, 0),
    reserved: stock.reduce((s: number, x: any) => s + x.reservedQuantity, 0),
    stockByLocation: sbl.reduce((s: number, x: any) => s + x.quantity, 0),
    lotsAvailable: lots.reduce((s: number, l: any) => s + l.quantityAvailable, 0),
  };
}

/** Divergências entre o snapshot e os invariantes esperados (vazio = ok). */
function invariantDivergences(t: GlobalTotals): string[] {
  const div: string[] = [];
  if (t.physical !== GLOBAL_INVARIANTS.physical) div.push(`physical=${t.physical} (esperado ${GLOBAL_INVARIANTS.physical})`);
  if (t.reserved !== GLOBAL_INVARIANTS.reserved) div.push(`reserved=${t.reserved} (esperado ${GLOBAL_INVARIANTS.reserved})`);
  if (t.stockByLocation !== GLOBAL_INVARIANTS.stockByLocation) div.push(`stockByLocation=${t.stockByLocation} (esperado ${GLOBAL_INVARIANTS.stockByLocation})`);
  if (t.lotsAvailable !== GLOBAL_INVARIANTS.lotsAvailable) div.push(`lotsAvailable=${t.lotsAvailable} (esperado ${GLOBAL_INVARIANTS.lotsAvailable})`);
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
          minimumStock: p.minimumStock,
          idealStock: p.idealStock,
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
        minimumStock: p.minimumStock,
        idealStock: p.idealStock,
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
    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    const available = (stock?.physicalQuantity ?? 0) - (stock?.reservedQuantity ?? 0);
    if (args.quantity > available) {
      throw new Error(`Estoque insuficiente. Disponível: ${available} ${product.unitOfMeasure}`);
    }

    const now = Date.now();
    const previousPhysical = stock!.physicalQuantity;
    const newPhysical = previousPhysical - args.quantity;

    // Lotes disponíveis do produto, ordenados (FIFO por recebimento).
    const lotList = (await ctx.db.query("lots").collect())
      .filter((l) => l.productId === args.productId && l.quantityAvailable > 0 && l.active !== false)
      .sort((a, b) => a.receivedAt - b.receivedAt);
    const remaining = args.quantity;
    let consumed = 0;
    const consumedLots: Array<{ lotId: string; lotNumber: string; qty: number }> = [];

    for (const lot of lotList) {
      if (consumed >= remaining) break;
      const take = Math.min(lot.quantityAvailable, remaining - consumed);
      await ctx.db.patch(lot._id, { quantityAvailable: lot.quantityAvailable - take });
      consumedLots.push({ lotId: lot._id as string, lotNumber: lot.lotNumber, qty: take });
      consumed += take;
      if (consumed >= remaining) break;
    }

    if (consumed < remaining) {
      throw new Error(
        `Falha de consistência: lotes insuficientes (${consumed}/${remaining}). Nenhuma saída registrada.`,
      );
    }

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
      userId,
      exitNumber: `SAI-${new Date(now).getFullYear()}-SUP-${now}`,
      observation:
        `Retirada de suprimento — ${args.reason ?? "Sem motivo"} ` +
        `| O.S.: ${args.osNumber ?? "—"} | Destino: ${args.secretariaId ?? "—"} ` +
        `| Lotes: ${consumedLots.map((c) => `${c.lotNumber}(${c.qty})`).join(", ")}` +
        (args.observation ? ` | Obs: ${args.observation}` : ""),
      timestamp: now,
    } as never);

    await ctx.db.insert("auditLogs", {
      userId: userId as never,
      action: "move_stock",
      entity: "stockMovements",
      entityId: movementId,
      details:
        `Retirada rápida de suprimento de impressão: ${args.quantity} ${product.unitOfMeasure} de "${product.name}". ` +
        `Lotes: ${consumedLots.map((c) => `${c.lotNumber}(${c.qty})`).join(", ")}. ` +
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

    // Snapshot ANTES (invariantes globais).
    const before = await readGlobalTotals(ctx);
    const preDivergences = invariantDivergences(before);
    if (preDivergences.length > 0) {
      throw new Error(`INTEGRIDADE: estoque global divergente antes da operação (${preDivergences.join("; ")}). Operação abortada.`);
    }

    const stock = await ctx.db
      .query("stock")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    if (!stock) throw new Error("Estoque do produto não encontrado");

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

    const stockOf = async (productId: string) =>
      ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", productId)).first();
    const closedStock = (await stockOf(closedMember._id)) as { _id: string; physicalQuantity: number; reservedQuantity: number } | null;
    const looseStock = (await stockOf(looseMember._id)) as { _id: string; physicalQuantity: number; reservedQuantity: number } | null;
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
    const consumedLots: Array<{ lotId: string; lotNumber: string; qty: number }> = [];

    // FIFO central de lotes de um produto (por recebimento) + patch do lote.
    const consumeFifo = async (productId: string, quantity: number, physicalBefore: number) => {
      const lotList = ((await ctx.db.query("lots").collect()) as Array<any>)
        .filter((l) => l.productId === productId && l.quantityAvailable > 0 && l.active !== false)
        .sort((a, b) => a.receivedAt - b.receivedAt);
      let consumed = 0;
      for (const lot of lotList) {
        if (consumed >= quantity) break;
        const take = Math.min(lot.quantityAvailable, quantity - consumed);
        await ctx.db.patch(lot._id, { quantityAvailable: lot.quantityAvailable - take });
        consumedLots.push({ lotId: lot._id as string, lotNumber: lot.lotNumber, qty: take });
        consumed += take;
      }
      if (consumed < quantity) {
        throw new Error(`Falha de consistência: lotes insuficientes (${consumed}/${quantity}). Nenhuma saída registrada.`);
      }
      return physicalBefore - quantity;
    };

    let closedExitUnits = 0;
    let looseExitUnits = 0;
    let newClosedPhys = closedPhys;
    let newLoosePhys = loosePhys;

    if (plan.operation === "take_pack") {
      // Retirada direta: avulsas primeiro, depois caixas fechadas INTEGRAIS.
      const fromLoose = Math.min(looseAvailable, args.quantity);
      const fromClosedPacks = Math.floor((args.quantity - fromLoose) / conv.factor);
      closedExitUnits = fromClosedPacks * conv.factor;
      looseExitUnits = args.quantity - closedExitUnits;
      if (looseExitUnits > 0) newLoosePhys = await consumeFifo(looseMember._id, looseExitUnits, loosePhys);
      if (closedExitUnits > 0) newClosedPhys = await consumeFifo(closedMember._id, closedExitUnits, closedPhys);
    } else {
      // open_pack: sai das avulsas e abre caixas fechadas INTEGRAIS para cobrir o resto.
      const openPacks = plan.packs;
      // Abertura INTEGRAL: consumir openPacks caixas fechadas (lotes FIFO) e
      // transferir as unidades para o registro "unidade avulsa".
      newClosedPhys = await consumeFifo(closedMember._id, openPacks * conv.factor, closedPhys);
      const openedUnits = openPacks * conv.factor;
      if (openedUnits > 0) {
        // Rastreabilidade: o lote de reclassificação herda a ENTRADA do 1º lote
        // de caixa fechada consumido (origem histórica preservada).
        const firstClosedLot = consumedLots.length > 0 ? await ctx.db.get(consumedLots[0].lotId as Id<"lots">) : null;
        const inheritEntryId = (firstClosedLot as { entryId?: string } | null)?.entryId ?? undefined;
        const looseLotList = ((await ctx.db.query("lots").collect()) as Array<any>)
          .filter((l) => l.productId === looseMember._id)
          .sort((a, b) => a.receivedAt - b.receivedAt);
        let remaining = openedUnits;
        // Incrementa lotes EXISTENTES do produto avulso (FIFO); se faltar
        // cobertura, cria lote de reclassificação vinculado à entrada de origem.
        for (const lot of looseLotList) {
          if (remaining <= 0) break;
          const add = Math.min(remaining, conv.factor * 100);
          await ctx.db.patch(lot._id, { quantityAvailable: lot.quantityAvailable + add });
          remaining -= add;
        }
        if (remaining > 0) {
          if (!inheritEntryId) {
            throw new Error("Falha de rastreabilidade: lote de origem da abertura não encontrado. Nenhuma reclassificação registrada.");
          }
          await ctx.db.insert("lots", {
            lotNumber: `REC-${now}-${remaining}`,
            productId: looseMember._id,
            entryId: inheritEntryId,
            brand: looseMember.brand ?? undefined,
            quantityReceived: remaining,
            quantityAvailable: remaining,
            receivedAt: now,
            active: true,
            areaId: PRINT_AREA_ID as never,
            observation: `Reclassificação de ${openPacks} ${conv.packagingUnit}(s) aberta(s) de "${closedMember.name}" (1 ${conv.packagingUnit} = ${conv.factor} ${conv.baseUnit}).`,
          } as never);
        }
        newLoosePhys = loosePhys + openedUnits;
      }
      // Saída TOTAL em unidades do produto avulso (inclui as recém-abertas).
      looseExitUnits = args.quantity;
      newLoosePhys = await consumeFifo(looseMember._id, looseExitUnits, newLoosePhys);
    }

    // Patches de saldo por produto.
    if (closedExitUnits > 0 || plan.operation === "open_pack") {
      await ctx.db.patch(closedStock!._id as Id<"stock">, { physicalQuantity: newClosedPhys });
    }
    if (plan.operation === "take_pack") {
      if (looseExitUnits > 0) await ctx.db.patch(looseStock!._id as Id<"stock">, { physicalQuantity: newLoosePhys });
    } else {
      await ctx.db.patch(looseStock!._id as Id<"stock">, { physicalQuantity: newLoosePhys });
    }

    // Guarda de invariante: a soma global NÃO MUDA além da saída autorizada.
    const after = await readGlobalTotals(ctx);
    const physicalDelta = after.physical - before.physical;
    if (physicalDelta !== -args.quantity) {
      throw new Error(
        `VIOLAÇÃO DE SALDO na retirada: Δphysical=${physicalDelta} (esperado ${-args.quantity}). ` +
        "Operação abortada após patches — verifique lotes e saldos manualmente.",
      );
    }
    if (after.reserved !== before.reserved) {
      throw new Error("VIOLAÇÃO DE SALDO: reservado global alterado indevidamente. Operação abortada.");
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
      lotId: consumedLots[0]?.lotId as never,
      userId,
      exitNumber: `SAI-${new Date(now).getFullYear()}-SUP-${now}`,
      observation:
        `Retirada por família (${conv.baseUnit}) — ${args.reason ?? "Sem motivo"} ` +
        `| Operação: ${plan.operation === "open_pack" ? `abertura integral de ${plan.packs} ${conv.packagingUnit}(s)` : `${plan.packs > 0 ? `${plan.packs} ${conv.packagingUnit}(s) fechada(s)` : ""}${plan.packs > 0 && looseExitUnits > 0 ? " + " : ""}${looseExitUnits} ${conv.baseUnit}. avulsa(s)`} ` +
        `| Composição antes: ${closedAvailable} ${conv.packagingUnit}(s) fechada(s) + ${looseAvailable} ${conv.baseUnit}. avulsa(s) ` +
        `| O.S.: ${args.osNumber ?? "—"} | Destino: ${args.secretariaId ?? "—"} ` +
        `| Lotes: ${consumedLots.map((c) => `${c.lotNumber}(${c.qty})`).join(", ")}` +
        (args.observation ? ` | Obs: ${args.observation}` : ""),
      timestamp: now,
    } as never);

    await ctx.db.insert("auditLogs", {
      userId,
      action: "move_stock",
      entity: "stockMovements",
      entityId: movementId,
      details:
        `Retirada por família em unidades-base: ${args.quantity} ${conv.baseUnit} de "${product.name}". ` +
        `Operação ${plan.operation === "open_pack" ? `open_pack(${plan.packs} ${conv.packagingUnit})` : `take_pack(${plan.packs} ${conv.packagingUnit}, ${looseExitUnits} ${conv.baseUnit} avulsas)`}. ` +
        `Lotes: ${consumedLots.map((c) => `${c.lotNumber}(${c.qty})`).join(", ")}. ` +
        `Motivo: ${args.reason ?? "—"}; O.S.: ${args.osNumber ?? "—"}; Destino: ${args.secretariaId ?? "—"}. ` +
        `Invariante global preservado (Δphysical=${-args.quantity}, Δreserved=0).`,
      timestamp: now,
    });

    return { movementId, plan, consumedLots, compositionAfter: { closedPacks: closedPhys - closedExitUnits - (plan.operation === "open_pack" ? plan.packs : 0), looseUnits: newLoosePhys - looseRes } };
  },
});

/* ═══ Integridade global (consulta read-only) ═══════════════════════════════ */

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
