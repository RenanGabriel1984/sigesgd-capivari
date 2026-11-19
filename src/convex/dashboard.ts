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

    // Concilia as três representações sem escolher arbitrariamente linhas
    // duplicadas nem transformar saldos inválidos em zero.
    const [stockRows, locationRows, lots] = await Promise.all([
      ctx.db.query("stock").collect(),
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("lots").collect(),
    ]);
    const byProduct = <T extends { productId: any }>(rows: T[]) => {
      const grouped = new Map<string, T[]>();
      for (const row of rows) {
        const key = String(row.productId);
        const current = grouped.get(key) ?? [];
        current.push(row);
        grouped.set(key, current);
      }
      return grouped;
    };
    const stockGroups = byProduct(stockRows);
    const locationGroups = byProduct(locationRows);
    const lotGroups = byProduct(lots);
    const integrityByProduct = new Map<string, ReturnType<typeof inspectProductStockIntegrity>>();
    const stockByProduct = new Map<any, any>();
    const integrityAlerts = [];
    for (const product of products) {
      const integrity = inspectProductStockIntegrity(
        stockGroups.get(String(product._id)) ?? [],
        locationGroups.get(String(product._id)) ?? [],
        lotGroups.get(String(product._id)) ?? [],
        product.name,
      );
      integrityByProduct.set(String(product._id), integrity);
      if (integrity.globalStock) stockByProduct.set(product._id, integrity.globalStock);
      if (!integrity.consistent) {
        integrityAlerts.push({
          productId: product._id,
          productName: product.name,
          issues: integrity.issues,
          limitations: integrity.limitations,
        });
      }
    }

    // Produtos com divergência não entram no cálculo de criticidade.
    let criticalStock = 0;
    for (const p of products) {
      const integrity = integrityByProduct.get(String(p._id))!;
      const qty = integrity.globalStock?.physicalQuantity;
      if (integrity.consistent && qty !== undefined && qty <= (p.minimumStock ?? 0)) criticalStock++;
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

    // Urgent alerts (items at or below minimum)
    const urgentAlerts = [];
    for (const p of products) {
      const stock: any = stockByProduct.get(p._id);
      const integrity = integrityByProduct.get(String(p._id))!;
      if (!integrity.consistent || !stock) continue;
      const qty = stock.physicalQuantity;
      if (qty <= (p.minimumStock ?? 0)) {
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
      const gomaqExchanges = await ctx.db
        .query("gomaQExchanges")
        .withIndex("by_date", (q) => q.gte("exchangedAt", monthStartMs).lte("exchangedAt", Date.now()))
        .collect();
      gomaqExchangesThisMonth = gomaqExchanges.length;
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
    const [products, stockRows, locationRows, lots] = await Promise.all([
      ctx.db.query("products").collect(),
      ctx.db.query("stock").collect(),
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("lots").collect(),
    ]);

    const groupByProduct = <T extends { productId: any }>(rows: T[]) => {
      const grouped = new Map<string, T[]>();
      for (const row of rows) {
        const key = String(row.productId);
        const current = grouped.get(key) ?? [];
        current.push(row);
        grouped.set(key, current);
      }
      return grouped;
    };
    const stocksByProduct = groupByProduct(stockRows);
    const locationsByProduct = groupByProduct(locationRows);
    const lotsByProduct = groupByProduct(lots);

    return Promise.all(products.map(async (product) => {
      const category = await ctx.db.get(product.categoryId);
      const integrity = inspectProductStockIntegrity(
        stocksByProduct.get(String(product._id)) ?? [],
        locationsByProduct.get(String(product._id)) ?? [],
        lotsByProduct.get(String(product._id)) ?? [],
        product.name,
      );
      const validStock = integrity.consistent ? integrity.globalStock : null;
      const qty = validStock?.physicalQuantity ?? (integrity.consistent ? 0 : null);
      let status = "Normal";
      if (!integrity.consistent) status = "Inconsistente";
      else if (qty === 0) status = "Zerado";
      else if (qty !== null && qty <= (product.minimumStock ?? 0)) status = "Crítico";
      else if (qty !== null && qty <= (product.idealStock ?? 0)) status = "Baixo";
      return {
        _id: product._id,
        name: product.name,
        internalCode: product.internalCode ?? "",
        categoryName: category?.name ?? "",
        unitOfMeasure: product.unitOfMeasure,
        currentStock: qty,
        reservedQuantity: validStock?.reservedQuantity ?? (integrity.consistent ? 0 : null),
        minimumStock: product.minimumStock ?? 0,
        idealStock: product.idealStock ?? 0,
        maximumStock: product.maximumStock,
        status,
        integrityIssues: integrity.issues,
        integrityLimitations: integrity.limitations,
        brand: product.brand,
        model: product.model,
        active: product.active,
      };
    }));
  },
});

/**
 * Posição física detalhada por produto × área × local.
 * Usa stockByLocation como fonte operacional; registros legados sem área
 * permanecem visíveis como "Sem área (legado)" e nunca são inferidos pelo armário.
 */
export const stockPositionByArea = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "reports.view", { entity: "reports", entityId: "stockPositionByArea" });
    const [balances, reservations] = await Promise.all([
      ctx.db.query("stockByLocation").collect(),
      ctx.db.query("requestItemReservations").collect(),
    ]);

    const reservationTotals = new Map<string, number>();
    for (const reservation of reservations) {
      const remaining = Number(reservation.quantityRemaining ?? 0);
      if (!Number.isFinite(remaining) || remaining <= 0) continue;
      const key = [reservation.productId, reservation.areaId, reservation.locationId].join("|");
      reservationTotals.set(key, (reservationTotals.get(key) ?? 0) + remaining);
    }

    const grouped = new Map<string, { productId: any; areaId?: any; locationId: any; physicalQuantity: number; sourceRows: number }>();
    for (const balance of balances) {
      const key = [balance.productId, balance.areaId ?? "legacy", balance.locationId].join("|");
      const current = grouped.get(key) ?? {
        productId: balance.productId,
        areaId: balance.areaId,
        locationId: balance.locationId,
        physicalQuantity: 0,
        sourceRows: 0,
      };
      current.physicalQuantity += Number(balance.quantity ?? 0);
      current.sourceRows += 1;
      grouped.set(key, current);
    }

    return Promise.all(Array.from(grouped.values()).map(async (row) => {
      const product: any = await ctx.db.get(row.productId);
      const area: any = row.areaId ? await ctx.db.get(row.areaId) : null;
      const location: any = await ctx.db.get(row.locationId);
      const key = [row.productId, row.areaId ?? "legacy", row.locationId].join("|");
      const reservedQuantity = reservationTotals.get(key) ?? 0;
      const physicalQuantity = row.physicalQuantity;
      const hasDuplicateRows = row.sourceRows > 1;
      const validPhysicalQuantity = !hasDuplicateRows && Number.isFinite(physicalQuantity) && physicalQuantity >= 0;
      const validAvailableQuantity = validPhysicalQuantity &&
        Number.isFinite(reservedQuantity) && reservedQuantity >= 0 && reservedQuantity <= physicalQuantity;
      const integrityIssues = [
        ...(hasDuplicateRows ? ["Há linhas duplicadas para o mesmo produto, área e local físico; o saldo agregado não é apresentado como confiável."] : []),
        ...(!Number.isFinite(physicalQuantity) || physicalQuantity < 0 ? ["O saldo físico está inválido."] : []),
        ...(!Number.isFinite(reservedQuantity) || reservedQuantity < 0 ? ["O saldo reservado está inválido."] : []),
        ...(Number.isFinite(physicalQuantity) && Number.isFinite(reservedQuantity) && reservedQuantity > physicalQuantity
          ? ["O saldo reservado excede o saldo físico."] : []),
      ];
      return {
        _id: key,
        productId: row.productId,
        productName: product?.name ?? "Produto não encontrado",
        internalCode: product?.internalCode ?? "",
        unitOfMeasure: product?.unitOfMeasure ?? "",
        areaName: area?.name ?? (row.areaId ? "Área não encontrada" : "Sem área (legado)"),
        locationName: location?.name ?? "Local não encontrado",
        physicalQuantity: validPhysicalQuantity ? physicalQuantity : null,
        reservedQuantity,
        availableQuantity: validAvailableQuantity ? physicalQuantity - reservedQuantity : null,
        duplicateRows: row.sourceRows,
        integrityIssues,
        inconsistent: integrityIssues.length > 0,
      };
    })).then((rows) => rows.sort((a, b) =>
      a.productName.localeCompare(b.productName, "pt-BR") ||
      a.areaName.localeCompare(b.areaName, "pt-BR") ||
      a.locationName.localeCompare(b.locationName, "pt-BR")
    ));
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
    await requirePermission(ctx, "reports.view", { entity: "reports", entityId: "movementReport" });
    const startDate = args.startDate;
    const endDate = args.endDate;
    if (startDate !== undefined && !Number.isSafeInteger(startDate)) {
      throw new Error("A data inicial do relatório é inválida.");
    }
    if (endDate !== undefined && !Number.isSafeInteger(endDate)) {
      throw new Error("A data final do relatório é inválida.");
    }
    if (startDate !== undefined && endDate !== undefined && startDate > endDate) {
      throw new Error("A data inicial não pode ser posterior à data final.");
    }
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_timestamp", (idx) => {
        if (startDate !== undefined && endDate !== undefined) {
          return idx.gte("timestamp", startDate).lte("timestamp", endDate);
        }
        if (startDate !== undefined) return idx.gte("timestamp", startDate);
        if (endDate !== undefined) return idx.lte("timestamp", endDate);
        return idx;
      })
      .order("desc")
      .take(501);
    return Promise.all(
      movements.map(async (m) => {
        const product = await ctx.db.get(m.productId);
        const user = await ctx.db.get(m.userId);
        const supplier = m.supplierId ? await ctx.db.get(m.supplierId) : null;
        const area = m.areaId ? await ctx.db.get(m.areaId) : null;
        const location = m.locationId ? await ctx.db.get(m.locationId) : null;
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
          areaName: area?.name ?? (m.areaId ? "Área não encontrada" : "Sem área (legado)"),
          locationName: location?.name ?? (m.locationId ? "Local não encontrado" : "Sem local registrado"),
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
    await requirePermission(ctx, "reports.view", { entity: "reports", entityId: "consumptionByOrg" });
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
