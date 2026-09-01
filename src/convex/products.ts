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
    const product = await ctx.db.get(args.id);
    if (!product) return null;
    const category = await ctx.db.get(product.categoryId);
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.id)).first();
    const movements = await ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", args.id)).order("desc").take(10);
    const movementsWithUser = await Promise.all(movements.map(async (m: any) => {
      const user = await ctx.db.get(m.userId);
      return { ...m, user };
    }));
    return { ...product, category, stock: stock ?? { physicalQuantity: 0, reservedQuantity: 0 }, recentMovements: movementsWithUser };
  },
});

export const getStock = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const stock = await ctx.db.query("stock").withIndex("by_product", (q) => q.eq("productId", args.productId)).first();
    return stock ?? { physicalQuantity: 0, reservedQuantity: 0 };
  },
});

export const belowMinimum = query({
  args: {},
  handler: async (ctx) => {
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

export const create = mutation({
  args: {
    name: v.string(), description: v.optional(v.string()), categoryId: v.id("categories"),
    unitOfMeasure: v.string(), internalCode: v.optional(v.string()),
    manufacturer: v.optional(v.string()), model: v.optional(v.string()),
    brand: v.optional(v.string()), specification: v.optional(v.string()),
    minimumStock: v.number(), idealStock: v.number(), maximumStock: v.number(),
    observation: v.optional(v.string()), photo: v.optional(v.string()),
    hasSerial: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
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

    const id = await ctx.db.insert("products", {
      ...args,
      name: args.name.trim(),
      // Auto-generate sequential internal code if not provided
      internalCode: args.internalCode?.trim() || await generateInternalCode(ctx),
      active: true,
    });
    await ctx.db.insert("stock", { productId: id, physicalQuantity: 0, reservedQuantity: 0 });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "products", entityId: id,
      details: `Item "${args.name}" criado na categoria "${category.name}"`, timestamp: Date.now(),
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
