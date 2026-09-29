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
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import {
  buildSupplyRow,
  computeCardTotals,
  computeMonthlyConsumption,
  monthWindow,
  validateWithdrawal,
  classifySupplyType,
} from "../lib/print-supplies";

/** Área "Impressoras" (recorte operacional de suprimentos de impressão). */
export const PRINT_AREA_ID = "q97b7737gv98ajm8qqpmjmzjs18ezb58";
/** Área "TI Geral". */
export const TI_GERAL_AREA_ID = "q971w9jkmz8rsqr3vsr2as0dps8eyqns";
/** Categoria "Suprimentos de Impressão". */
export const SUPPLY_CATEGORY_ID = "k57fk85xwpj3b3xj9dc31jwqpd8dgk3a";

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

    return {
      rows,
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
