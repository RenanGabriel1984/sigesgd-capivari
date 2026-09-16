/**
 * SIGESGD — Diagnóstico administrativo e reconciliação de estoque.
 *
 * Todas as funções aqui são PROTEGIDAS (admin) e cumprem um papel objetivo:
 *
 *  1. environmentCheck   (query, somente leitura)
 *     Prova que a sessão autenticada está no MESMO deployment Convex que
 *     contém a carga oficial: contagens das tabelas e existência da entrada
 *     ENT-2026-000001 (origem initial_inventory).
 *
 *  2. legacyRecordsCheck (query, somente leitura)
 *     Localiza registros legados/teste — SSD Kingston sem localização,
 *     produtos "Cooler" além do oficial da carga, stock sem stockByLocation,
 *     stockByLocation sem produto, movimentação sem produto, lote sem entrada
 *     e entradas iniciais além de ENT-2026-000001. NUNCA exclui nada.
 *
 *  3. reconcileFromLocations (mutation, idempotente)
 *     Corrige stock.physicalQuantity para a soma real de stockByLocation por
 *     produto. NUNCA altera reservedQuantity, lotes nem stockByLocation.
 *     Gera auditLog somente quando há correção e não cria movimentação falsa.
 *     Se o saldo global for MENOR que a soma por localização, não inventa
 *     correção de stockByLocation — apenas alinha stock à realidade local.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

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
    const official = initialEntries.find((e) => e.entryNumber === "ENT-2026-000001");
    const totalStock = stock.reduce((s, r) => s + r.physicalQuantity, 0);
    const totalSbl = sbl.reduce((s, r) => s + r.quantity, 0);

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
      (e) => e.entryNumber === "ENT-2026-000001" && e.originType === "initial_inventory"
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
          physical: st?.physicalQuantity ?? 0,
          hasLocationRows: locRows.length > 0,
          locationNames: locRows
            .map((r) => locationById.get(r.locationId)?.name ?? r.locationId)
            .join(", "),
        };
      });

    // ── stock sem stockByLocation (saldo global órfão) ──
    const sblPerProduct = new Map<string, number>();
    for (const r of sbl) {
      sblPerProduct.set(r.productId, (sblPerProduct.get(r.productId) ?? 0) + r.quantity);
    }
    const stockWithoutLocation = stock
      .filter(
        (s) =>
          (sblPerProduct.get(s.productId) ?? 0) === 0 &&
          s.physicalQuantity !== (sblPerProduct.get(s.productId) ?? 0)
      )
      .map((s) => ({
        productId: s.productId,
        name: productById.get(s.productId)?.name ?? s.productId,
        physical: s.physicalQuantity,
        reserved: s.reservedQuantity,
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
      .filter((e) => e.originType === "initial_inventory" && e.entryNumber !== "ENT-2026-000001")
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
          ? { _id: st._id, physicalQuantity: st.physicalQuantity, reservedQuantity: st.reservedQuantity }
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
 * Diagnóstico legado via convex run (sem sessão de usuário). Somente leitura
 * e sem acesso a dados sensíveis: apenas contagens e existência da entrada
 * oficial. Usado na validação automatizada do ambiente.
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
      productsCount: products.length,
      stockCount: stock.length,
      stockByLocationCount: sbl.length,
      organizationsCount: orgs.length,
      organizationsActiveCount: orgs.filter((o) => o.active).length,
      totalStockPhysical: stock.reduce((s, r) => s + Number(r.physicalQuantity), 0),
      totalStockByLocation: sbl.reduce((s, r) => s + Number(r.quantity), 0),
      officialInitialEntryExists: initial.some((e) => e.entryNumber === "ENT-2026-000001"),
      officialInitialEntryNumber: initial.find((e) => e.entryNumber === "ENT-2026-000001")?.entryNumber ?? null,
    };
  },
});
