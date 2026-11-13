import { requirePermission } from "./rbac";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { inspectProductStockIntegrity } from "../lib/stock-read-integrity";

async function requireUser(ctx: any) {
  // RBAC central: dashboard exige permissão de visualização.
  return requirePermission(ctx, "dashboard.view");
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
    const [stockRows, locationRows, lots] = await Promise.all([
      ctx.db.query("stock").collect(),
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("lots").collect(),
    ]);
    const stockRowsByProduct = new Map<string, typeof stockRows>();
    const locationRowsByProduct = new Map<string, typeof locationRows>();
    const lotsByProduct = new Map<string, typeof lots>();
    for (const row of stockRows) {
      const key = String(row.productId);
      const rows = stockRowsByProduct.get(key) ?? [];
      rows.push(row);
      stockRowsByProduct.set(key, rows);
    }
    for (const row of locationRows) {
      const key = String(row.productId);
      const rows = locationRowsByProduct.get(key) ?? [];
      rows.push(row);
      locationRowsByProduct.set(key, rows);
    }
    for (const lot of lots) {
      const key = String(lot.productId);
      const rows = lotsByProduct.get(key) ?? [];
      rows.push(lot);
      lotsByProduct.set(key, rows);
    }
    const stockIntegrityByProduct = new Map<string, ReturnType<typeof inspectProductStockIntegrity>>();
    for (const product of products) {
      stockIntegrityByProduct.set(
        String(product._id),
        inspectProductStockIntegrity(
          stockRowsByProduct.get(String(product._id)) ?? [],
          locationRowsByProduct.get(String(product._id)) ?? [],
          lotsByProduct.get(String(product._id)) ?? [],
          product.name,
        ),
      );
    }
    const integrityAlerts = products.flatMap((product) => {
      const integrity = stockIntegrityByProduct.get(String(product._id))!;
      return integrity.consistent ? [] : [{
        productId: product._id,
        productName: product.name,
        issues: integrity.issues,
      }];
    });
    const stockForProduct = (product: (typeof products)[number]) =>
      stockIntegrityByProduct.get(String(product._id))!;

    // Critical stock count: divergências ficam em alerta próprio.
    let criticalStock = 0;
    for (const p of products) {
      const integrity = stockForProduct(p);
      const qty = integrity.globalStock?.physicalQuantity ?? 0;
      if (integrity.consistent && qty <= (p.minimumStock ?? 0)) criticalStock++;
    }
    const divergentStock = integrityAlerts.length;

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

    // Urgent alerts: somente saldos conciliados; divergências aparecem separadas.
    const urgentAlerts = [];
    for (const p of products) {
      const integrity = stockForProduct(p);
      const qty = integrity.globalStock?.physicalQuantity ?? 0;
      if (integrity.consistent && qty <= (p.minimumStock ?? 0)) {
        const category = await ctx.db.get(p.categoryId);
        urgentAlerts.push({
          _id: p._id,
          name: p.name,
          brand: p.brand,
          model: p.model,
          currentStock: qty,
          minimumStock: p.minimumStock ?? 0,
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
      divergentStock,
      integrityAlerts,
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
    await requirePermission(ctx, "reports.view", { entity: "reports", entityId: "stockPosition" });
    const [products, stockRows, locationRows, lots, categories, areas, storageLocations] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("stock").collect(),
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("lots").collect(),
      ctx.db.query("categories").collect(),
      ctx.db.query("stockAreas").collect(),
      ctx.db.query("storageLocations").collect(),
    ]);

    const stockByProduct = new Map<string, typeof stockRows>();
    const locationsByProduct = new Map<string, typeof locationRows>();
    const lotsByProduct = new Map<string, typeof lots>();
    for (const row of stockRows) {
      const key = String(row.productId);
      const group = stockByProduct.get(key) ?? [];
      group.push(row);
      stockByProduct.set(key, group);
    }
    for (const row of locationRows) {
      const key = String(row.productId);
      const group = locationsByProduct.get(key) ?? [];
      group.push(row);
      locationsByProduct.set(key, group);
    }
    for (const lot of lots) {
      const key = String(lot.productId);
      const group = lotsByProduct.get(key) ?? [];
      group.push(lot);
      lotsByProduct.set(key, group);
    }

    const categoryById = new Map(categories.map((category) => [String(category._id), category.name]));
    const areaById = new Map(areas.map((area) => [String(area._id), area.name]));
    const locationById = new Map(storageLocations.map((location) => [String(location._id), location.name]));

    return products.map((product) => {
      const productStocks = stockByProduct.get(String(product._id)) ?? [];
      const productLocations = locationsByProduct.get(String(product._id)) ?? [];
      const productLots = lotsByProduct.get(String(product._id)) ?? [];
      const integrity = inspectProductStockIntegrity(
        productStocks,
        productLocations,
        productLots,
        product.name,
      );
      const stock = integrity.globalStock;
      const quantity = stock
        ? stock.physicalQuantity
        : integrity.issues.length === 0 ? 0 : null;
      let status: string = "Normal";
      if (!integrity.consistent) status = "Divergente";
      else if (quantity === null || quantity === 0) status = "Zerado";
      else if (quantity <= (product.minimumStock ?? 0)) status = "Crítico";
      else if (quantity <= (product.idealStock ?? 0)) status = "Baixo";

      const productLotsWithLocation = productLots.filter((lot) =>
        typeof lot.quantityAvailable === "number" &&
        Number.isFinite(lot.quantityAvailable) &&
        lot.quantityAvailable > 0
      );
      const locationIds = new Set<string>([
        ...productLocations.map((row) => String(row.locationId)),
        ...productLotsWithLocation.filter((lot) => lot.locationId).map((lot) => String(lot.locationId)),
      ]);
      const locationBreakdown = [...locationIds].map((locationId) => {
        const physicalRows = productLocations.filter((row) => String(row.locationId) === locationId);
        const physicalQuantity = physicalRows.length > 0 &&
          physicalRows.every((row) => typeof row.quantity === "number" && Number.isFinite(row.quantity) && row.quantity >= 0)
          ? physicalRows.reduce((sum, row) => sum + row.quantity, 0)
          : null;
        const areaQuantities = new Map<string, { areaName: string; quantity: number }>();
        for (const lot of productLotsWithLocation.filter((candidate) => String(candidate.locationId) === locationId)) {
          const areaKey = lot.areaId ? String(lot.areaId) : "__NO_AREA__";
          const existing = areaQuantities.get(areaKey) ?? {
            areaName: lot.areaId ? areaById.get(String(lot.areaId)) ?? "Área não encontrada" : "Sem área",
            quantity: 0,
          };
          existing.quantity += lot.quantityAvailable;
          areaQuantities.set(areaKey, existing);
        }
        const locationName = locationById.get(locationId) ?? "Local não encontrado";
        return {
          locationName,
          quantity: physicalQuantity,
          areaBreakdown: [...areaQuantities.values()].sort((a, b) => a.areaName.localeCompare(b.areaName, "pt-BR")),
        };
      }).sort((a, b) => a.locationName.localeCompare(b.locationName, "pt-BR"));

      return {
        _id: product._id,
        name: product.name,
        internalCode: product.internalCode ?? "",
        categoryName: categoryById.get(String(product.categoryId)) ?? "",
        unitOfMeasure: product.unitOfMeasure,
        currentStock: quantity,
        reservedQuantity: stock?.reservedQuantity ?? 0,
        minimumStock: product.minimumStock ?? 0,
        idealStock: product.idealStock ?? 0,
        maximumStock: product.maximumStock,
        status,
        brand: product.brand,
        model: product.model,
        active: product.active,
        locationBreakdown,
        integrityIssues: integrity.issues,
      };
    });
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
