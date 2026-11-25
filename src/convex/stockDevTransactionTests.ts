import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const PREFIX = "__SIGESGD_DEV_TXN__";
const DEPLOYMENT_HOST = "first-herring-264.convex.cloud";

function assertDevDeployment() {
  const cloudUrl = process.env.CONVEX_CLOUD_URL ?? "";
  if (!cloudUrl.includes(DEPLOYMENT_HOST)) {
    throw new Error("Fixture transacional bloqueada: deployment diferente do Convex DEV autorizado.");
  }
}

function fixtureName(runId: string, suffix: string) {
  return `${PREFIX}${runId}__${suffix}`;
}

function validateRunId(runId: string) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(runId)) {
    throw new Error("Identificador de execução inválido para fixture DEV.");
  }
}

export const seed = internalMutation({
  args: {
    runId: v.string(),
    operatorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertDevDeployment();
    validateRunId(args.runId);

    const operator = await ctx.db.get(args.operatorId);
    if (!operator || operator.active === false || operator.isAnonymous === true ||
        !["admin", "stock_manager"].includes(String(operator.role))) {
      throw new Error("O operador de teste precisa ser um usuário ativo e autorizado (admin/stock_manager).");
    }

    const productName = fixtureName(args.runId, "PRODUCT");
    const existing = await ctx.db.query("products")
      .withIndex("by_name", (q) => q.eq("name", productName)).first();
    if (existing) throw new Error("Já existe fixture para esta execução; faça a limpeza antes de repetir.");

    const category = await ctx.db.query("categories")
      .withIndex("by_active", (q) => q.eq("active", true)).first();
    if (!category) throw new Error("Não existe categoria ativa para criar o produto de teste.");

    const now = Date.now();
    const areaId = await ctx.db.insert("stockAreas", {
      name: fixtureName(args.runId, "AREA"),
      description: "Fixture temporária de validação transacional DEV",
      active: true,
    });
    const fromLocationId = await ctx.db.insert("storageLocations", {
      name: fixtureName(args.runId, "CABINET_A"),
      description: "Origem temporária — remover ao fim do teste",
      active: true,
    });
    const toLocationId = await ctx.db.insert("storageLocations", {
      name: fixtureName(args.runId, "CABINET_B"),
      description: "Destino temporário — remover ao fim do teste",
      active: true,
    });
    const productId = await ctx.db.insert("products", {
      name: productName,
      description: "Produto descartável exclusivo de teste transacional no Convex DEV.",
      categoryId: category._id,
      unitOfMeasure: "un",
      active: true,
      maximumStock: 100,
      observation: "FIXTURE DEV — não usar em operação.",
    });
    const entryId = await ctx.db.insert("entries", {
      entryNumber: fixtureName(args.runId, "ENTRY"),
      receivedAt: now,
      originType: "other",
      responsibleUserId: args.operatorId,
      observation: "Fixture DEV exclusiva para validar devoluções e transferências.",
      status: "confirmed",
      materialType: "consumption",
      areaId,
      createdAt: now,
      updatedAt: now,
    });
    const lotId = await ctx.db.insert("lots", {
      lotNumber: fixtureName(args.runId, "LOT"),
      productId,
      entryId,
      quantityReceived: 60,
      quantityAvailable: 53,
      receivedAt: now,
      active: true,
      observation: "Fixture DEV — 7 unidades baixadas nas saídas sintéticas de teste.",
      materialType: "consumption",
      areaId,
    });
    await ctx.db.insert("stock", {
      productId,
      physicalQuantity: 53,
      reservedQuantity: 0,
    });
    await ctx.db.insert("stockByLocation", {
      productId,
      locationId: fromLocationId,
      quantity: 33,
    });
    await ctx.db.insert("stockByLocation", {
      productId,
      locationId: toLocationId,
      quantity: 20,
    });
    await ctx.db.insert("lotLocationBalances", {
      lotId,
      productId,
      locationId: fromLocationId,
      quantityAvailable: 33,
      updatedAt: now,
    });
    await ctx.db.insert("lotLocationBalances", {
      lotId,
      productId,
      locationId: toLocationId,
      quantityAvailable: 20,
      updatedAt: now,
    });

    // Saídas sintéticas legítimas, isoladas na fixture, para exercitar as
    // mutations reais de devolução sem tocar no sequencial de saídas do sistema.
    const exitSpecs = [
      { suffix: "EXIT_1", quantity: 4, previous: 60, next: 56 },
      { suffix: "EXIT_2", quantity: 2, previous: 56, next: 54 },
      { suffix: "EXIT_3", quantity: 1, previous: 54, next: 53 },
    ];
    const exitIds: string[] = [];
    for (const spec of exitSpecs) {
      const movementId = await ctx.db.insert("stockMovements", {
        productId,
        type: "exit",
        quantity: spec.quantity,
        previousPhysical: spec.previous,
        newPhysical: spec.next,
        previousReserved: 0,
        newReserved: 0,
        userId: args.operatorId,
        areaId,
        lotId: String(lotId),
        locationId: fromLocationId,
        exitNumber: fixtureName(args.runId, spec.suffix),
        observation: "Saída sintética de teste — fixture isolada DEV.",
        timestamp: now + exitIds.length,
      });
      exitIds.push(String(movementId));
      await ctx.db.insert("stockMovementLotAllocations", {
        movementId,
        productId,
        lotId,
        locationId: fromLocationId,
        quantity: spec.quantity,
        allocationType: "withdrawal",
        createdAt: now + exitIds.length,
      });
    }

    return {
      runId: args.runId,
      productId,
      areaId,
      fromLocationId,
      toLocationId,
      lotId,
      entryId,
      operatorId: args.operatorId,
      exitIds,
      baseline: { global: 53, from: 33, to: 20, lot: 53 },
    };
  },
});

export const inspect = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    assertDevDeployment();
    validateRunId(args.runId);
    const productName = fixtureName(args.runId, "PRODUCT");
    const product = await ctx.db.query("products")
      .withIndex("by_name", (q) => q.eq("name", productName)).first();
    if (!product) return { exists: false, runId: args.runId };

    const [stocks, locations, lots, transfers, returns, movements, lotBalances, movementAllocations] = await Promise.all([
      ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockByLocation").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("lots").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockTransfers").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("returns").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("lotLocationBalances").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockMovementLotAllocations").withIndex("by_product_location", (q) => q.eq("productId", product._id)).collect(),
    ]);
    const returnAllocations = (await Promise.all(returns.map((row) =>
      ctx.db.query("returnLotAllocations").withIndex("by_return", (q) => q.eq("returnId", row._id)).collect(),
    ))).flat();
    const global = stocks.reduce((sum, row) => sum + row.physicalQuantity, 0);
    const local = locations.reduce((sum, row) => sum + row.quantity, 0);
    const lot = lots.reduce((sum, row) => sum + row.quantityAvailable, 0);
    const lotLocal = lotBalances.reduce((sum, row) => sum + row.quantityAvailable, 0);
    const locationTotals = locations.map((row) => ({
      locationId: row.locationId,
      quantity: row.quantity,
      lotQuantity: lotBalances.filter((balance) => balance.locationId === row.locationId)
        .reduce((sum, balance) => sum + balance.quantityAvailable, 0),
    }));
    return {
      exists: true,
      runId: args.runId,
      productId: product._id,
      global,
      local,
      lot,
      lotLocal,
      reserved: stocks.reduce((sum, row) => sum + row.reservedQuantity, 0),
      ledgerBalanced: stocks.length === 1 && lots.length === 1 &&
        Math.abs(global - local) < 1e-9 && Math.abs(global - lot) < 1e-9 &&
        Math.abs(lot - lotLocal) < 1e-9 &&
        locationTotals.every((row) => Math.abs(row.quantity - row.lotQuantity) < 1e-9),
      locationTotals,
      transferCount: transfers.length,
      returnCount: returns.length,
      quarantineCount: returns.filter((row) => row.stockDisposition === "quarantine").length,
      movementCounts: {
        exit: movements.filter((row) => row.type === "exit").length,
        transfer: movements.filter((row) => row.type === "transfer").length,
        return: movements.filter((row) => row.type === "return").length,
      },
      transferLinksValid: transfers.every((transfer) =>
        Boolean(transfer.movementId) && movements.some((movement) =>
          movement._id === transfer.movementId && movement.transferId === transfer._id &&
          movement.type === "transfer" && movement.locationId === transfer.fromLocationId &&
          movement.toLocationId === transfer.toLocationId)),
      transferAllocations: movementAllocations.filter((row) => row.allocationType === "reclassification").length,
      returnAllocations: returnAllocations.length,
      returnReversalAllocations: movementAllocations.filter((row) => row.allocationType === "reversal").length,
      unresolvedReturnMovements: returns.filter((returned) =>
        returned.stockDisposition === "available" &&
        !movements.some((movement) => movement.type === "return" &&
          movement.exitMovementId === returned.exitMovementId &&
          movement.quantity === returned.quantity)).length,
    };
  },
});

export const cleanup = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    assertDevDeployment();
    validateRunId(args.runId);
    const productName = fixtureName(args.runId, "PRODUCT");
    const [product, area, fromLocation, toLocation, entry] = await Promise.all([
      ctx.db.query("products").withIndex("by_name", (q) => q.eq("name", productName)).first(),
      ctx.db.query("stockAreas").withIndex("by_name", (q) => q.eq("name", fixtureName(args.runId, "AREA"))).first(),
      ctx.db.query("storageLocations").withIndex("by_active", (q) => q.eq("active", true)).collect()
        .then((rows) => rows.find((row) => row.name === fixtureName(args.runId, "CABINET_A")) ?? null),
      ctx.db.query("storageLocations").withIndex("by_active", (q) => q.eq("active", true)).collect()
        .then((rows) => rows.find((row) => row.name === fixtureName(args.runId, "CABINET_B")) ?? null),
      ctx.db.query("entries").withIndex("by_number", (q) => q.eq("entryNumber", fixtureName(args.runId, "ENTRY"))).first(),
    ]);
    if (!product) {
      if (fromLocation) await ctx.db.delete(fromLocation._id);
      if (toLocation) await ctx.db.delete(toLocation._id);
      if (area) await ctx.db.delete(area._id);
      if (entry) await ctx.db.delete(entry._id);
      return { runId: args.runId, cleaned: true, productFound: false };
    }

    const [stocks, locations, lots, transfers, returns, movements, lotBalances, movementAllocations] = await Promise.all([
      ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockByLocation").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("lots").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockTransfers").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("returns").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("lotLocationBalances").withIndex("by_product", (q) => q.eq("productId", product._id)).collect(),
      ctx.db.query("stockMovementLotAllocations").withIndex("by_product_location", (q) => q.eq("productId", product._id)).collect(),
    ]);
    const returnAllocations = (await Promise.all(returns.map((row) =>
      ctx.db.query("returnLotAllocations").withIndex("by_return", (q) => q.eq("returnId", row._id)).collect(),
    ))).flat();
    const entityIds = new Set<string>([
      String(product._id), String(entry?._id ?? ""),
      ...transfers.map((row) => String(row._id)),
      ...returns.map((row) => String(row._id)),
      ...movements.map((row) => String(row._id)),
    ]);
    const auditRows = await ctx.db.query("auditLogs").collect();
    for (const audit of auditRows) {
      if (audit.entityId && entityIds.has(audit.entityId)) await ctx.db.delete(audit._id);
    }
    for (const row of returnAllocations) await ctx.db.delete(row._id);
    for (const row of movementAllocations) await ctx.db.delete(row._id);
    for (const row of returns) await ctx.db.delete(row._id);
    for (const row of transfers) await ctx.db.delete(row._id);
    for (const row of movements) await ctx.db.delete(row._id);
    for (const row of lotBalances) await ctx.db.delete(row._id);
    for (const row of lots) await ctx.db.delete(row._id);
    for (const row of locations) await ctx.db.delete(row._id);
    for (const row of stocks) await ctx.db.delete(row._id);
    await ctx.db.delete(product._id);
    if (entry) await ctx.db.delete(entry._id);
    if (fromLocation) await ctx.db.delete(fromLocation._id);
    if (toLocation) await ctx.db.delete(toLocation._id);
    if (area) await ctx.db.delete(area._id);

    return {
      runId: args.runId,
      cleaned: true,
      deleted: {
        auditLogs: auditRows.filter((row) => row.entityId && entityIds.has(row.entityId)).length,
        returns: returns.length,
        transfers: transfers.length,
        movements: movements.length,
        lots: lots.length,
        locationBalances: lotBalances.length + locations.length,
        stockRows: stocks.length + locations.length,
        product: 1,
        entry: entry ? 1 : 0,
        storageLocations: Number(Boolean(fromLocation)) + Number(Boolean(toLocation)),
        area: Number(Boolean(area)),
      },
    };
  },
});
