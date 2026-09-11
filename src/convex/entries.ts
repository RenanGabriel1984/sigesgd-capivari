import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

async function requireStockManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar entradas");
  }
  return { userId, user };
}

/** Generate sequential entry number: ENT-ANO-SEQUENCIAL */
async function generateEntryNumber(ctx: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ENT-${year}-`;
  const existing = await ctx.db.query("entries").withIndex("by_number", (q: any) => q.gte("entryNumber", prefix)).collect();
  const maxNum = existing.reduce((max: number, e: any) => {
    const match = e.entryNumber.match(/^ENT-\d{4}-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `ENT-${year}-${String(maxNum + 1).padStart(6, "0")}`;
}

/** Generate sequential lot number: LOT-ANO-SEQUENCIAL */
async function generateLotNumber(ctx: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `LOT-${year}-`;
  const existing = await ctx.db.query("lots").withIndex("by_number", (q: any) => q.gte("lotNumber", prefix)).collect();
  const maxNum = existing.reduce((max: number, l: any) => {
    const match = l.lotNumber.match(/^LOT-\d{4}-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `LOT-${year}-${String(maxNum + 1).padStart(6, "0")}`;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const entries = await ctx.db.query("entries").withIndex("by_date").order("desc").take(100);
    return Promise.all(entries.map(async (e: any) => {
      const responsible = await ctx.db.get(e.responsibleUserId);
      const supplier = e.supplierId ? await ctx.db.get(e.supplierId) : null;
      const items = await ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", e._id)).collect();
      const itemsWithProduct = await Promise.all(items.map(async (item: any) => {
        const product = await ctx.db.get(item.productId);
        const location = item.locationId ? await ctx.db.get(item.locationId) : null;
        return { ...item, product, location };
      }));
      return { ...e, responsible, supplier, items: itemsWithProduct };
    }));
  },
});

export const get = query({
  args: { entryId: v.id("entries") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return null;
    const responsible = await ctx.db.get(entry.responsibleUserId);
    const supplier = entry.supplierId ? await ctx.db.get(entry.supplierId) : null;
    const items = await ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", entry._id)).collect();
    const itemsWithProduct = await Promise.all(items.map(async (item: any) => {
      const product = await ctx.db.get(item.productId);
      const location = item.locationId ? await ctx.db.get(item.locationId) : null;
      return { ...item, product, location };
    }));
    const lots = await ctx.db.query("lots").withIndex("by_entry", (q: any) => q.eq("entryId", entry._id)).collect();
    return { ...entry, responsible, supplier, items: itemsWithProduct, lots };
  },
});

export const getByLot = query({
  args: { lotNumber: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lot = await ctx.db.query("lots").withIndex("by_number", (q) => q.eq("lotNumber", args.lotNumber)).first();
    if (!lot) return null;
    const product = await ctx.db.get(lot.productId);
    const entry = await ctx.db.get(lot.entryId);
    const supplier = lot.supplierId ? await ctx.db.get(lot.supplierId) : null;
    return { ...lot, product, entry, supplier };
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Create a draft entry (multiple items). Does NOT modify stock. */
export const create = mutation({
  args: {
    receivedAt: v.number(),
    originType: v.union(
      v.literal("purchase"), v.literal("donation"), v.literal("transfer"),
      v.literal("return"), v.literal("initial_inventory"), v.literal("other")
    ),
    supplierId: v.optional(v.id("suppliers")),
    invoiceNumber: v.optional(v.string()),
    invoiceDate: v.optional(v.string()),
    purchaseAuthorizationNumber: v.optional(v.string()),
    processNumber: v.optional(v.string()),
    contractNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
    documentStorageId: v.optional(v.string()),
    // ── NF-e importada (XML) ──
    accessKey: v.optional(v.string()),
    series: v.optional(v.string()),
    totalValue: v.optional(v.number()),
    xmlStorageId: v.optional(v.string()),
    importedFromXml: v.optional(v.boolean()),
    items: v.array(v.object({
      productId: v.id("products"),
      quantity: v.number(),
      unitOfMeasure: v.string(),
      unitCost: v.optional(v.number()),
      totalCost: v.optional(v.number()),
      brand: v.optional(v.string()),
      model: v.optional(v.string()),
      specification: v.optional(v.string()),
      locationId: v.optional(v.id("storageLocations")),
      photoStorageId: v.optional(v.string()),
      supplierLotNumber: v.optional(v.string()),
      observation: v.optional(v.string()),
      // ── Identificadores originais da NF-e ──
      supplierCode: v.optional(v.string()),
      ncm: v.optional(v.string()),
      cfop: v.optional(v.string()),
      ean: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);

    if (args.items.length === 0) throw new Error("A entrada deve ter pelo menos um item");

    // NF-e: impedir importação/efetivação duplicada da mesma chave de acesso
    if (args.accessKey) {
      const accessKey = args.accessKey.trim();
      const existing = await ctx.db.query("entries").withIndex("by_access_key", (q: any) => q.eq("accessKey", accessKey)).first();
      if (existing) {
        throw new Error(`Esta NF-e já foi registrada (entrada ${existing.entryNumber}). Não é possível duplicar o estoque.`);
      }
    }

    // Validate each item
    for (const item of args.items) {
      if (item.quantity <= 0) throw new Error(`Quantidade inválida para o item ${item.productId}`);
      if (!isFinite(item.quantity)) throw new Error(`Quantidade não finita para o item ${item.productId}`);
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Produto não encontrado: ${item.productId}`);
      if (!product.active) throw new Error(`O produto "${product.name}" está inativo`);
    }

    const now = Date.now();
    const entryNumber = await generateEntryNumber(ctx);

    const entryId = await ctx.db.insert("entries", {
      entryNumber,
      receivedAt: args.receivedAt,
      originType: args.originType,
      supplierId: args.supplierId,
      invoiceNumber: args.invoiceNumber || undefined,
      invoiceDate: args.invoiceDate || undefined,
      purchaseAuthorizationNumber: args.purchaseAuthorizationNumber || undefined,
      processNumber: args.processNumber || undefined,
      contractNumber: args.contractNumber || undefined,
      responsibleUserId: userId,
      observation: args.observation || undefined,
      documentStorageId: args.documentStorageId || undefined,
      accessKey: args.accessKey ? args.accessKey.trim() : undefined,
      series: args.series || undefined,
      totalValue: args.totalValue,
      xmlStorageId: args.xmlStorageId || undefined,
      importedFromXml: args.importedFromXml || undefined,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    for (const item of args.items) {
      await ctx.db.insert("entryItems", {
        entryId,
        productId: item.productId,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        unitCost: item.unitCost,
        totalCost: item.totalCost,
        brand: item.brand,
        model: item.model,
        specification: item.specification,
        locationId: item.locationId,
        photoStorageId: item.photoStorageId,
        supplierLotNumber: item.supplierLotNumber || undefined,
        observation: item.observation,
        supplierCode: item.supplierCode || undefined,
        ncm: item.ncm || undefined,
        cfop: item.cfop || undefined,
        ean: item.ean || undefined,
      });
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "entries", entityId: entryId,
      details: `Entrada ${entryNumber} criada com ${args.items.length} item(ns) (rascunho)`,
      timestamp: now,
    });

    return entryId;
  },
});

/**
 * Confirm an entry: atomically creates lots, updates stock, creates movements.
 * This is an indivisible operation.
 */
export const confirm = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ser confirmadas");

    const items = await ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", args.entryId)).collect();
    if (items.length === 0) throw new Error("Entrada não possui itens");

    const now = Date.now();
    const confirmedItemDetails: string[] = [];

    for (const item of items) {
      // Validate product
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Produto não encontrado para item da entrada`);
      if (!product.active) throw new Error(`O produto "${product.name}" está inativo — não é possível confirmar entrada`);

      // Generate lot
      const lotNumber = await generateLotNumber(ctx);
      await ctx.db.insert("lots", {
        lotNumber,
        productId: item.productId,
        entryId: args.entryId,
        brand: item.brand,
        model: item.model,
        specification: item.specification,
        quantityReceived: item.quantity,
        quantityAvailable: item.quantity,
        unitCost: item.unitCost,
        receivedAt: entry.receivedAt,
        supplierId: entry.supplierId,
        invoiceNumber: entry.invoiceNumber,
        purchaseAuthorizationNumber: entry.purchaseAuthorizationNumber,
        photoStorageId: item.photoStorageId,
        supplierLotNumber: item.supplierLotNumber || undefined,
        active: true,
        observation: item.observation,
      });

      // Update stock (increase physicalQuantity)
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).first();
      const prevPhysical = stock?.physicalQuantity ?? 0;
      const prevReserved = stock?.reservedQuantity ?? 0;
      const newPhysical = prevPhysical + item.quantity;

      if (stock) {
        await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
      } else {
        await ctx.db.insert("stock", { productId: item.productId, physicalQuantity: item.quantity, reservedQuantity: 0 });
      }

      // Update stock by location (saldo por localização) — keeps global × location consistent
      if (item.locationId) {
        const sblList = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
        const sbl = sblList.find((s: any) => s.locationId === item.locationId);
        if (sbl) {
          await ctx.db.patch(sbl._id, { quantity: sbl.quantity + item.quantity });
        } else {
          await ctx.db.insert("stockByLocation", { productId: item.productId, locationId: item.locationId, quantity: item.quantity });
        }
      }

      // Create movement record
      await ctx.db.insert("stockMovements", {
        productId: item.productId,
        type: "entry",
        quantity: item.quantity,
        previousPhysical: prevPhysical,
        newPhysical,
        previousReserved: prevReserved,
        newReserved: prevReserved,
        userId,
        entryId: args.entryId,
        lotId: lotNumber,
        documentNumber: entry.invoiceNumber,
        observation: `Entrada ${entry.entryNumber} — Lote ${lotNumber}`,
        timestamp: now,
      });

      confirmedItemDetails.push(`${product.name}: +${item.quantity} (${lotNumber})`);
    }

    // Update entry status
    await ctx.db.patch(args.entryId, { status: "confirmed", updatedAt: now });

    // Audit log
    await ctx.db.insert("auditLogs", {
      userId, action: "confirm_entry", entity: "entries", entityId: args.entryId,
      details: `Entrada ${entry.entryNumber} confirmada. Itens: ${confirmedItemDetails.join("; ")}`,
      timestamp: now,
    });

    return args.entryId;
  },
});

// ─── Draft Item Management ──────────────────────────────────────────────────

/** Add an item to a draft entry. Does NOT modify stock. */
export const addItem = mutation({
  args: {
    entryId: v.id("entries"),
    productId: v.id("products"),
    quantity: v.number(),
    unitOfMeasure: v.string(),
    unitCost: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    specification: v.optional(v.string()),
    locationId: v.optional(v.id("storageLocations")),
    photoStorageId: v.optional(v.string()),
    supplierLotNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
    supplierCode: v.optional(v.string()),
    ncm: v.optional(v.string()),
    cfop: v.optional(v.string()),
    ean: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ter itens adicionados");
    if (args.quantity <= 0) throw new Error("A quantidade deve ser maior que zero");
    if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (!product.active) throw new Error(`O produto "${product.name}" está inativo`);

    const itemId = await ctx.db.insert("entryItems", {
      entryId: args.entryId,
      productId: args.productId,
      quantity: args.quantity,
      unitOfMeasure: args.unitOfMeasure,
      unitCost: args.unitCost,
      totalCost: args.totalCost,
      brand: args.brand,
      model: args.model,
      specification: args.specification,
      locationId: args.locationId,
      photoStorageId: args.photoStorageId,
      supplierLotNumber: args.supplierLotNumber || undefined,
      observation: args.observation,
      supplierCode: args.supplierCode || undefined,
      ncm: args.ncm || undefined,
      cfop: args.cfop || undefined,
      ean: args.ean || undefined,
    });

    await ctx.db.patch(args.entryId, { updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entryItems", entityId: itemId,
      details: `Item adicionado à entrada ${entry.entryNumber}: ${product.name} x${args.quantity}`,
      timestamp: Date.now(),
    });
    return itemId;
  },
});

/** Update an item in a draft entry. Does NOT modify stock. */
export const updateItem = mutation({
  args: {
    itemId: v.id("entryItems"),
    productId: v.optional(v.id("products")),
    quantity: v.optional(v.number()),
    unitOfMeasure: v.optional(v.string()),
    unitCost: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    specification: v.optional(v.string()),
    locationId: v.optional(v.id("storageLocations")),
    photoStorageId: v.optional(v.string()),
    supplierLotNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item não encontrado");

    const entry = await ctx.db.get(item.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ter itens alterados");

    if (args.quantity !== undefined) {
      if (args.quantity <= 0) throw new Error("A quantidade deve ser maior que zero");
      if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");
    }

    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product) throw new Error("Produto não encontrado");
      if (!product.active) throw new Error(`O produto "${product.name}" está inativo`);
    }

    const updates: Record<string, any> = {};
    if (args.productId !== undefined) updates.productId = args.productId;
    if (args.quantity !== undefined) updates.quantity = args.quantity;
    if (args.unitOfMeasure !== undefined) updates.unitOfMeasure = args.unitOfMeasure;
    if (args.unitCost !== undefined) updates.unitCost = args.unitCost;
    if (args.totalCost !== undefined) updates.totalCost = args.totalCost;
    if (args.brand !== undefined) updates.brand = args.brand;
    if (args.model !== undefined) updates.model = args.model;
    if (args.specification !== undefined) updates.specification = args.specification;
    if (args.locationId !== undefined) updates.locationId = args.locationId;
    if (args.photoStorageId !== undefined) updates.photoStorageId = args.photoStorageId;
    if (args.supplierLotNumber !== undefined) updates.supplierLotNumber = args.supplierLotNumber;
    if (args.observation !== undefined) updates.observation = args.observation;

    await ctx.db.patch(args.itemId, updates);
    await ctx.db.patch(item.entryId, { updatedAt: Date.now() });

    const product = args.productId ? await ctx.db.get(args.productId) : await ctx.db.get(item.productId);
    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entryItems", entityId: args.itemId,
      details: `Item atualizado na entrada ${entry.entryNumber}: ${product?.name ?? "—"} ${JSON.stringify(updates)}`,
      timestamp: Date.now(),
    });
  },
});

/** Remove an item from a draft entry. Does NOT modify stock. */
export const removeItem = mutation({
  args: { itemId: v.id("entryItems") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item não encontrado");

    const entry = await ctx.db.get(item.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ter itens removidos");

    // Prevent removing last item
    const allItems = await ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", item.entryId)).collect();
    if (allItems.length <= 1) throw new Error("A entrada deve ter pelo menos um item");

    const product = await ctx.db.get(item.productId);
    await ctx.db.delete(args.itemId);
    await ctx.db.patch(item.entryId, { updatedAt: Date.now() });

    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entryItems", entityId: args.itemId,
      details: `Item removido da entrada ${entry.entryNumber}: ${product?.name ?? "—"} x${item.quantity}`,
      timestamp: Date.now(),
    });
  },
});

/** Edit a draft entry (only draft entries can be edited). */
export const editDraft = mutation({
  args: {
    entryId: v.id("entries"),
    observation: v.optional(v.string()),
    invoiceNumber: v.optional(v.string()),
    invoiceDate: v.optional(v.string()),
    purchaseAuthorizationNumber: v.optional(v.string()),
    processNumber: v.optional(v.string()),
    contractNumber: v.optional(v.string()),
    documentStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ser editadas");

    const now = Date.now();
    const updates: Record<string, any> = { updatedAt: now };
    if (args.observation !== undefined) updates.observation = args.observation;
    if (args.invoiceNumber !== undefined) updates.invoiceNumber = args.invoiceNumber;
    if (args.invoiceDate !== undefined) updates.invoiceDate = args.invoiceDate;
    if (args.purchaseAuthorizationNumber !== undefined) updates.purchaseAuthorizationNumber = args.purchaseAuthorizationNumber;
    if (args.processNumber !== undefined) updates.processNumber = args.processNumber;
    if (args.contractNumber !== undefined) updates.contractNumber = args.contractNumber;
    if (args.documentStorageId !== undefined) updates.documentStorageId = args.documentStorageId;

    await ctx.db.patch(args.entryId, updates);

    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entries", entityId: args.entryId,
      details: `Entrada ${entry.entryNumber} editada`,
      timestamp: now,
    });

    return args.entryId;
  },
});

/** Reverse a confirmed entry. Cannot reverse if lots have been partially consumed. */
export const reverse = mutation({
  args: {
    entryId: v.id("entries"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (!args.reason.trim()) throw new Error("O motivo do estorno é obrigatório");

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "confirmed") throw new Error("Apenas entradas confirmadas podem ser estornadas");

    const items = await ctx.db.query("entryItems").withIndex("by_entry", (q: any) => q.eq("entryId", args.entryId)).collect();
    const now = Date.now();
    const reversalDetails: string[] = [];

    for (const item of items) {
      const product = await ctx.db.get(item.productId);

      // Check stock — cannot reverse if consumed
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).first();
      if (!stock) throw new Error(`Registro de estoque não encontrado para "${product?.name ?? "item"}"`);

      if (stock.physicalQuantity < item.quantity) {
        throw new Error(
          `Não é possível estornar "${product?.name ?? "item"}": parte do material já foi consumida. ` +
          `Saldo atual: ${stock.physicalQuantity}. Quantidade da entrada: ${item.quantity}. ` +
          `Diferença consumida: ${item.quantity - stock.physicalQuantity}.`
        );
      }

      // Check reservation integrity
      if (stock.reservedQuantity > 0 && stock.physicalQuantity - item.quantity < stock.reservedQuantity) {
        throw new Error(
          `Não é possível estornar "${product?.name ?? "item"}": a reserva atual (${stock.reservedQuantity}) consumiria mais que o saldo restante.`
        );
      }

      const newPhysical = stock.physicalQuantity - item.quantity;
      await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });

      // Reverse stock by location (same location used at confirmation)
      if (item.locationId) {
        const sblList = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect();
        const sbl = sblList.find((s: any) => s.locationId === item.locationId);
        if (sbl && sbl.quantity < item.quantity) {
          throw new Error(
            `Não é possível estornar "${product?.name ?? "item"}" no local: saldo do local (${sbl.quantity}) é menor que a quantidade da entrada (${item.quantity}). ` +
            `Faça um inventário/transferência para regularizar a localização antes de estornar.`
          );
        }
        if (sbl) {
          await ctx.db.patch(sbl._id, { quantity: sbl.quantity - item.quantity });
        }
      }

      // Mark related lots as inactive
      const lots = await ctx.db.query("lots").withIndex("by_entry", (q: any) => q.eq("entryId", args.entryId)).collect();
      for (const lot of lots) {
        if (lot.productId === item.productId) {
          await ctx.db.patch(lot._id, { active: false, quantityAvailable: 0 });
        }
      }

      // Create reversal movement
      await ctx.db.insert("stockMovements", {
        productId: item.productId,
        type: "adjustment",
        quantity: item.quantity,
        previousPhysical: stock.physicalQuantity,
        newPhysical,
        previousReserved: stock.reservedQuantity,
        newReserved: stock.reservedQuantity,
        userId,
        entryId: args.entryId,
        observation: `Estorno da entrada ${entry.entryNumber}. Motivo: ${args.reason.trim()}`,
        timestamp: now,
      });

      reversalDetails.push(`${product?.name ?? "item"}: -${item.quantity}`);
    }

    await ctx.db.patch(args.entryId, { status: "reversed", updatedAt: now });

    await ctx.db.insert("auditLogs", {
      userId,      action: "reverse_entry", entity: "entries", entityId: args.entryId,
      details: `Entrada ${entry.entryNumber} estornada. Itens: ${reversalDetails.join("; ")}. Motivo: ${args.reason.trim()}`,
      timestamp: now,
    });

    return args.entryId;
  },
});
