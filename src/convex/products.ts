import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { tonerKitObservation } from "./stockHelpers";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado. Faça login novamente.");
  return { userId, user };
}

async function requireManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar itens do estoque");
  }
  return { userId, user };
}

/** Generate sequential internal code: ITEM-0001, ITEM-0002, etc. */
async function generateInternalCode(ctx: any): Promise<string> {
  const existing = await ctx.db.query("products").collect();
  const maxNum = existing.reduce((max: number, p: any) => {
    const match = p.internalCode?.match(/^ITEM-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  const next = maxNum + 1;
  return `ITEM-${String(next).padStart(4, "0")}`;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const products = await ctx.db.query("products").collect();
    // Pre-fetch all compatibility records to flag toner products
    const allCompat = await ctx.db.query("printerCompatibility").collect();
    const compatProductIds = new Set(allCompat.map((c: any) => c.productId));
    return Promise.all(products.map(async (p: any) => {
      const category = await ctx.db.get(p.categoryId);
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", p._id)).first();
      return { ...p, category, stock: stock ?? { physicalQuantity: 0, reservedQuantity: 0 }, hasCompat: compatProductIds.has(p._id) };
    }));
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const products = await ctx.db.query("products").withIndex("by_active", (q) => q.eq("active", true)).collect();
    // Pre-fetch all compatibility records to flag toner products
    const allCompat = await ctx.db.query("printerCompatibility").collect();
    const compatProductIds = new Set(allCompat.map((c: any) => c.productId));
    return Promise.all(products.map(async (p: any) => {
      const category = await ctx.db.get(p.categoryId);
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", p._id)).first();
      return { ...p, category, stock: stock ?? { physicalQuantity: 0, reservedQuantity: 0 }, hasCompat: compatProductIds.has(p._id) };
    }));
  },
});

export const getById = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const product = await ctx.db.get(args.id);
    if (!product) return null;
    const category = await ctx.db.get(product.categoryId);
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.id)).first();
    const movements = await ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", args.id)).order("desc").take(10);
    const movementsWithUser = await Promise.all(movements.map(async (m: any) => {
      const user = await ctx.db.get(m.userId);
      return { ...m, user };
    }));
    // ── Lotes do produto (rastreabilidade de origem) ──
    const lots = await ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", args.id)).order("desc").collect();
    const lotsWithInfo = await Promise.all(lots.map(async (l: any) => {
      const entry = await ctx.db.get(l.entryId);
      const supplier = l.supplierId ? await ctx.db.get(l.supplierId) : null;
      return { ...l, entry, supplier };
    }));
    // ── Localizações (estoque por local) ──
    const sbls = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", args.id)).collect();
    const locations = await Promise.all(sbls.map(async (s: any) => {
      const location = await ctx.db.get(s.locationId);
      return { location, quantity: s.quantity };
    }));
    return {
      ...product,
      category,
      stock: stock ?? { physicalQuantity: 0, reservedQuantity: 0 },
      recentMovements: movementsWithUser,
      lots: lotsWithInfo,
      locations,
    };
  },
});

export const getStock = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.productId)).first();
    return stock ?? { physicalQuantity: 0, reservedQuantity: 0 };
  },
});

export const belowMinimum = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const products = await ctx.db.query("products").withIndex("by_active", (q) => q.eq("active", true)).collect();
    const result = [];
    for (const p of products) {
      const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", p._id)).first();
      const qty = stock?.physicalQuantity ?? 0;
      if (qty < p.minimumStock) {
        const category = await ctx.db.get(p.categoryId);
        result.push({ ...p, category, currentStock: qty });
      }
    }
    return result;
  },
});

/** Generate lot number: LOT-YYYY-NNNNNN (same pattern as entries/initial load) */
async function generateLotNumber(ctx: any, productId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existingLots = await ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", productId)).collect();
  const seq = existingLots.length + 1;
  return `LOT-${year}-${String(seq).padStart(6, "0")}`;
}

export const create = mutation({
  args: {
    name: v.string(), description: v.optional(v.string()), categoryId: v.id("categories"),
    unitOfMeasure: v.string(), internalCode: v.optional(v.string()),
    manufacturer: v.optional(v.string()), model: v.optional(v.string()),
    brand: v.optional(v.string()), specification: v.optional(v.string()),
    minimumStock: v.number(), idealStock: v.number(), maximumStock: v.number(),
    observation: v.optional(v.string()), photo: v.optional(v.string()),
    hasSerial: v.optional(v.boolean()),
    // Estoque atual informado no cadastro (carga inicial com rastreabilidade por lote)
    initialStock: v.optional(v.number()),
    locationId: v.optional(v.id("storageLocations")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const { initialStock, locationId, ...productArgs } = args;
    if (!args.name.trim()) throw new Error("Nome do item é obrigatório");

    // Validate category exists
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Categoria não encontrada");
    if (!category.active) throw new Error("A categoria selecionada está inativa");

    // Validate stock values
    if (args.minimumStock < 0) throw new Error("Estoque mínimo não pode ser negativo");
    if (args.idealStock < 0) throw new Error("Estoque ideal não pode ser negativo");
    if (args.maximumStock < 0) throw new Error("Estoque máximo não pode ser negativo");
    if (args.idealStock > args.maximumStock && args.maximumStock > 0) {
      throw new Error("Estoque ideal não pode ser maior que o estoque máximo");
    }

    // Validate initial stock
    if (initialStock !== undefined && initialStock < 0) {
      throw new Error("Estoque atual não pode ser negativo");
    }
    if (initialStock !== undefined && initialStock > 0) {
      if (!locationId) {
        throw new Error("Informe o local de armazenamento para registrar o estoque atual");
      }
      const location = await ctx.db.get(locationId);
      if (!location) throw new Error("Local de armazenamento não encontrado");
      if (!location.active) throw new Error("O local de armazenamento selecionado está inativo");
    }

    // Toners de kit original de 4 cores (VersaLink, AltaLink, Lexmark CX735,
    // Lexmark XM5365) ganham a observação padrão quando nenhuma foi informada.
    // É apenas observacional — não altera estoque físico nem agrupa produtos.
    const kitObservation = tonerKitObservation({
      name: args.name,
      brand: args.brand,
      model: args.model,
      specification: args.specification,
    });

    const id = await ctx.db.insert("products", {
      ...productArgs,
      name: args.name.trim(),
      // Auto-generate sequential internal code if not provided
      internalCode: productArgs.internalCode?.trim() || await generateInternalCode(ctx),
      observation: kitObservation ?? productArgs.observation,
      active: true,
    });
    const stockId = await ctx.db.insert("stock", { productId: id, physicalQuantity: 0, reservedQuantity: 0 });

    // ── Carga inicial: cria entrada, lote, saldo por local, saldo global e movimentação ──
    let initialLotInfo = "";
    if (initialStock !== undefined && initialStock > 0 && locationId) {
      const now = Date.now();
      const year = new Date().getFullYear();

      const entrySeq = (await ctx.db.query("entries").collect()).length + 1;
      const entryNumber = `ENT-${year}-${String(entrySeq).padStart(6, "0")}`;
      const entryId = await ctx.db.insert("entries", {
        entryNumber,
        receivedAt: now,
        originType: "initial_inventory",
        responsibleUserId: userId,
        observation: `Estoque inicial cadastrado junto com o item "${args.name}"`,
        status: "confirmed",
        createdAt: now,
        updatedAt: now,
      });

      const lotNumber = await generateLotNumber(ctx, id);
      const lotId = await ctx.db.insert("lots", {
        lotNumber,
        productId: id,
        entryId,
        quantityReceived: initialStock,
        quantityAvailable: initialStock,
        receivedAt: now,
        active: true,
        observation: `Carga inicial cadastrada junto com o item — ${initialStock} unidades`,
      });

      await ctx.db.insert("entryItems", {
        entryId,
        productId: id,
        quantity: initialStock,
        unitOfMeasure: args.unitOfMeasure,
        lotId: lotId as string,
        locationId,
      });

      await ctx.db.insert("stockByLocation", {
        productId: id,
        locationId,
        quantity: initialStock,
      });

      await ctx.db.patch(stockId, { physicalQuantity: initialStock });

      await ctx.db.insert("stockMovements", {
        productId: id,
        type: "adjustment",
        quantity: initialStock,
        previousPhysical: 0,
        newPhysical: initialStock,
        previousReserved: 0,
        newReserved: 0,
        userId,
        entryId,
        lotId: lotId as string,
        observation: `Estoque inicial — lote ${lotNumber} — ${initialStock} unidades (cadastro do item)`,
        timestamp: now,
      });

      initialLotInfo = `; estoque inicial: ${initialStock} ${args.unitOfMeasure} no lote ${lotNumber}`;
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "products", entityId: id,
      details: `Item "${args.name}" criado na categoria "${category.name}"${initialLotInfo}`, timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("products"), name: v.optional(v.string()), description: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")), unitOfMeasure: v.optional(v.string()),
    internalCode: v.optional(v.string()), manufacturer: v.optional(v.string()),
    model: v.optional(v.string()), brand: v.optional(v.string()),
    specification: v.optional(v.string()),
    active: v.optional(v.boolean()),
    minimumStock: v.optional(v.number()), idealStock: v.optional(v.number()),
    maximumStock: v.optional(v.number()), observation: v.optional(v.string()),
    photo: v.optional(v.string()), hasSerial: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const { id, ...updates } = args;

    const product = await ctx.db.get(id);
    if (!product) throw new Error("Item não encontrado");

    // Validate category if changing
    if (updates.categoryId) {
      const category = await ctx.db.get(updates.categoryId);
      if (!category) throw new Error("Categoria não encontrada");
      if (!category.active) throw new Error("A categoria selecionada está inativa");
    }

    // Prevent deactivation if product has active reservations
    if (updates.active === false) {
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", id)).first();
      if (stock && stock.reservedQuantity > 0) {
        throw new Error("Não é possível desativar: existem unidades reservadas em solicitações pendentes");
      }
    }

    // Validate stock values
    if (updates.minimumStock !== undefined && updates.minimumStock < 0) throw new Error("Estoque mínimo não pode ser negativo");
    if (updates.idealStock !== undefined && updates.idealStock < 0) throw new Error("Estoque ideal não pode ser negativo");
    if (updates.maximumStock !== undefined && updates.maximumStock < 0) throw new Error("Estoque máximo não pode ser negativo");

    if (updates.name) updates.name = updates.name.trim();

    await ctx.db.patch(id, updates);
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId, action, entity: "products", entityId: id,
      details: `Item "${product.name}" — ${JSON.stringify(updates)}`, timestamp: Date.now(),
    });
    return id;
  },
});
