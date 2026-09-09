import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { v } from "convex/values";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

/**
 * Dashboard KPIs:
 * - totalProducts
 * - criticalStock (below minimum)
 * - pendingThisMonth (requests created this month with status pending)
 * - entriesThisMonth (total entry quantity this month)
 * - exitsThisMonth (total exit quantity this month)
 * - consumptionBySecretaria (top 5 secretarias by delivered request count)
 */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    // Total active products
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    // Critical stock count
    let criticalStock = 0;
    for (const p of products) {
      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q) => q.eq("productId", p._id))
        .first();
      const qty = stock?.physicalQuantity ?? 0;
      if (qty <= p.minimumStock) criticalStock++;
    }

    // Pending requests this month
    const allPending = await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const pendingThisMonth = allPending.filter(
      (r) => r.createdAt >= monthStartMs
    ).length;

    // Entries & exits this month
    const recentMovements = await ctx.db
      .query("stockMovements")
      .withIndex("by_timestamp")
      .filter((q) => q.gte(q.field("timestamp"), monthStartMs))
      .collect();

    let entriesThisMonth = 0;
    let exitsThisMonth = 0;
    for (const m of recentMovements) {
      if (m.canceled) continue;
      if (m.type === "entry") entriesThisMonth += m.quantity;
      if (m.type === "exit") exitsThisMonth += m.quantity;
    }

    // Consumption by secretaria (top 5)
    // Count delivered requests per secretaria
    const deliveredRequests = await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "delivered"))
      .collect();

    const secretariaCounts: Record<string, { name: string; count: number; items: number }> = {};
    for (const r of deliveredRequests) {
      const key = r.secretariaId;
      if (!secretariaCounts[key]) {
        const org = await ctx.db.get(r.secretariaId);
        secretariaCounts[key] = { name: org?.name ?? "Desconhecida", count: 0, items: 0 };
      }
      secretariaCounts[key].count++;
      // Count total items delivered
      const items = await ctx.db
        .query("requestItems")
        .withIndex("by_request", (q) => q.eq("requestId", r._id))
        .collect();
      secretariaCounts[key].items += items.reduce((sum, i) => sum + i.quantityDelivered, 0);
    }

    const topSecretarias = Object.values(secretariaCounts)
      .sort((a, b) => b.items - a.items)
      .slice(0, 5);

    // Urgent alerts (items at or below minimum)
    const urgentAlerts = [];
    for (const p of products) {
      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q) => q.eq("productId", p._id))
        .first();
      const qty = stock?.physicalQuantity ?? 0;
      if (qty <= p.minimumStock) {
        const category = await ctx.db.get(p.categoryId);
        urgentAlerts.push({
          _id: p._id,
          name: p.name,
          brand: p.brand,
          model: p.model,
          currentStock: qty,
          minimumStock: p.minimumStock,
          categoryName: category?.name ?? "",
        });
      }
    }
    urgentAlerts.sort((a, b) => a.currentStock - b.minimumStock);

    // GOMAQ: cartridges awaiting collection (use index for efficiency)
    let cartridgesAwaitingCount = 0;
    try {
      const awaitingCartridges = await ctx.db
        .query("gomaQEmptyCartridges")
        .withIndex("by_status", (q) => q.eq("status", "awaiting_collection"))
        .collect();
      cartridgesAwaitingCount = awaitingCartridges.reduce((sum: number, c: any) => sum + c.quantity, 0);
    } catch { /* table may not exist yet */ }

    // GOMAQ: exchanges this month
    let gomaqExchangesThisMonth = 0;
    try {
      const gomaqExchanges = await ctx.db.query("gomaQExchanges").order("desc").take(500);
      gomaqExchangesThisMonth = gomaqExchanges.filter((e: any) => e.exchangedAt >= monthStartMs).length;
    } catch { /* table may not exist yet */ }

    // Assets in maintenance
    let maintenanceAssetsCount = 0;
    try {
      const maintenanceAssets = await ctx.db
        .query("assets")
        .withIndex("by_status", (q) => q.eq("status", "maintenance"))
        .collect();
      maintenanceAssetsCount = maintenanceAssets.length;
    } catch { /* table may not exist yet */ }

    // Licenses expiring within 30 days
    let expiringLicensesCount = 0;
    try {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const allLicenses = await ctx.db.query("licenses").collect();
      expiringLicensesCount = allLicenses.filter((l: any) => {
        if (!l.expirationDate || !l.active) return false;
        const expMs = new Date(l.expirationDate).getTime();
        return expMs >= nowMs && expMs <= nowMs + thirtyDaysMs;
      }).length;
    } catch { /* table may not exist yet */ }

    return {
      totalProducts: products.length,
      criticalStock,
      pendingThisMonth,
      entriesThisMonth,
      exitsThisMonth,
      topSecretarias,
      urgentAlerts,
      cartridgesAwaitingCount,
      gomaqExchangesThisMonth,
      maintenanceAssetsCount,
      expiringLicensesCount,
    };
  },
});

/**
 * Stock Position Report: all products with stock info
 */
export const stockPosition = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const products = await ctx.db.query("products").collect();
    return Promise.all(
      products.map(async (p) => {
        const category = await ctx.db.get(p.categoryId);
        const stock = await ctx.db
          .query("stock")
          .withIndex("by_product", (q) => q.eq("productId", p._id))
          .first();
        const qty = stock?.physicalQuantity ?? 0;
        let status: string = "Normal";
        if (qty === 0) status = "Zerado";
        else if (qty <= p.minimumStock) status = "Crítico";
        else if (qty <= p.idealStock) status = "Baixo";
        return {
          _id: p._id,
          name: p.name,
          internalCode: p.internalCode ?? "",
          categoryName: category?.name ?? "",
          unitOfMeasure: p.unitOfMeasure,
          currentStock: qty,
          reservedQuantity: stock?.reservedQuantity ?? 0,
          minimumStock: p.minimumStock,
          idealStock: p.idealStock,
          maximumStock: p.maximumStock,
          status,
          brand: p.brand,
          model: p.model,
          active: p.active,
        };
      })
    );
  },
});

/**
 * Movement Report: all movements with full info
 */
export const movementReport = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let q = ctx.db.query("stockMovements").withIndex("by_timestamp").order("desc");
    if (args.startDate) {
      q = ctx.db.query("stockMovements").withIndex("by_timestamp", (idx) =>
        idx.gte("timestamp", args.startDate!)
      ).order("desc");
    }
    const movements = await q.take(500);
    let filtered = movements;
    if (args.endDate) {
      filtered = movements.filter((m) => m.timestamp <= args.endDate!);
    }
    return Promise.all(
      filtered.map(async (m) => {
        const product = await ctx.db.get(m.productId);
        const user = await ctx.db.get(m.userId);
        const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
        return {
          _id: m._id,
          type: m.type,
          quantity: m.quantity,
          previousPhysical: m.previousPhysical,
          newPhysical: m.newPhysical,
          documentNumber: m.documentNumber ?? "",
          observation: m.observation ?? "",
          canceled: m.canceled ?? false,
          timestamp: m.timestamp,
          productName: product?.name ?? "",
          productCode: product?.internalCode ?? "",
          userName: user?.name ?? "",
          supplierName: supplier?.legalName ?? "",
          supplierTrade: supplier?.tradeName ?? "",
        };
      })
    );
  },
});

/**
 * Consumption by Organization: delivered requests for a specific org
 */
export const consumptionByOrg = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const delivered = await ctx.db
      .query("requests")
      .withIndex("by_secretaria", (q) => q.eq("secretariaId", args.organizationId))
      .filter((q) => q.eq(q.field("status"), "delivered"))
      .order("desc")
      .collect();

    return Promise.all(
      delivered.map(async (r) => {
        const requester = await ctx.db.get(r.requesterId);
        const items = await ctx.db
          .query("requestItems")
          .withIndex("by_request", (q) => q.eq("requestId", r._id))
          .collect();
        const itemsWithProduct = await Promise.all(
          items.map(async (item) => {
            const product = await ctx.db.get(item.productId);
            return {
              name: product?.name ?? "Item",
              quantityDelivered: item.quantityDelivered,
              serialNumbers: item.deliveredSerialNumbers ?? [],
            };
          })
        );
        return {
          _id: r._id,
          requesterName: requester?.name ?? "—",
          deliveredAt: r.deliveredAt ?? r.updatedAt,
          reason: r.reason,
          items: itemsWithProduct,
          totalItems: itemsWithProduct.reduce((sum, i) => sum + i.quantityDelivered, 0),
        };
      })
    );
  },
});
