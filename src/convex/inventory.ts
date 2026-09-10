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
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar inventários");
  }
  return { userId, user };
}

/** Generate sequential inventory number: INV-ANO-SEQUENCIAL */
async function generateInventoryNumber(ctx: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const existing = await ctx.db.query("inventories").collect();
  const maxNum = existing.reduce((max: number, inv: any) => {
    const match = inv.inventoryNumber.match(/^INV-\d{4}-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `INV-${year}-${String(maxNum + 1).padStart(4, "0")}`;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

async function decorateInventory(ctx: any, inv: any) {
  const responsible = await ctx.db.get(inv.responsibleUserId);
  const closedBy = inv.closedByUserId ? await ctx.db.get(inv.closedByUserId) : null;
  const location = inv.locationId ? await ctx.db.get(inv.locationId) : null;
  const category = inv.categoryId ? await ctx.db.get(inv.categoryId) : null;
  const counts = await ctx.db.query("inventoryCounts").withIndex("by_inventory", (q: any) => q.eq("inventoryId", inv._id)).collect();
  const countsWithProduct = await Promise.all(counts.map(async (c: any) => {
    const product = await ctx.db.get(c.productId);
    return { ...c, product };
  }));
  return { ...inv, responsible, closedBy, location, category, counts: countsWithProduct };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const inventories = await ctx.db.query("inventories").withIndex("by_date").order("desc").collect();
    return Promise.all(inventories.map((inv) => decorateInventory(ctx, inv)));
  },
});

export const get = query({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) return null;
    return decorateInventory(ctx, inv);
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Create a new inventory in DRAFT status. Populates counts with all active products. */
export const create = mutation({
  args: {
    observation: v.optional(v.string()),
    locationId: v.optional(v.id("storageLocations")),
    categoryId: v.optional(v.id("categories")),
    productIds: v.optional(v.array(v.id("products"))),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);

    // Check no active inventory exists
    const allInventories = await ctx.db.query("inventories").collect();
    const nonClosed = allInventories.filter((i) => i.status !== "cancelled" && i.status !== "closed");
    if (nonClosed.length > 0) {
      throw new Error("Já existe um inventário ativo. Finalize ou cancele o inventário anterior antes de criar um novo.");
    }

    // ── Validar escopo ──
    if (args.locationId) {
      const location = await ctx.db.get(args.locationId);
      if (!location) throw new Error("Local de armazenamento não encontrado");
      if (!location.active) throw new Error("O local de armazenamento selecionado está inativo");
    }
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category) throw new Error("Categoria não encontrada");
      if (!category.active) throw new Error("A categoria selecionada está inativa");
    }

    const now = Date.now();
    const inventoryNumber = await generateInventoryNumber(ctx);

    const inventoryId = await ctx.db.insert("inventories", {
      inventoryNumber,
      date: now,
      responsibleUserId: userId,
      status: "draft",
      observation: args.observation || undefined,
      locationId: args.locationId,
      categoryId: args.categoryId,
      productIds: args.productIds && args.productIds.length > 0 ? args.productIds : undefined,
      createdAt: now,
      updatedAt: now,
    });

    // ── Populate counts conforme o escopo ──
    let products = await ctx.db.query("products").withIndex("by_active", (q) => q.eq("active", true)).collect();
    if (args.categoryId) products = products.filter((p) => p.categoryId === args.categoryId);
    if (args.productIds && args.productIds.length > 0) {
      const selected = new Set(args.productIds);
      products = products.filter((p) => selected.has(p._id));
    }

    const scopeLabel = [
      args.locationId ? `local ${args.locationId}` : "todos os locais",
      args.categoryId ? `categoria ${args.categoryId}` : "",
      args.productIds && args.productIds.length > 0 ? `${args.productIds.length} produto(s) selecionado(s)` : "",
    ].filter(Boolean).join(", ");

    for (const product of products) {
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", product._id)).first();
      let systemQuantity = stock?.physicalQuantity ?? 0;
      if (args.locationId) {
        const sbls = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", product._id)).collect();
        systemQuantity = sbls.find((s) => s.locationId === args.locationId)?.quantity ?? 0;
      }
      await ctx.db.insert("inventoryCounts", {
        inventoryId,
        productId: product._id,
        systemQuantity,
      });
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "open_inventory", entity: "inventories", entityId: inventoryId,
      details: `Inventário ${inventoryNumber} aberto com ${products.length} itens para contagem (${scopeLabel})`,
      timestamp: now,
    });

    return inventoryId;
  },
});

/** Update inventory status to COUNTING. */
export const startCounting = mutation({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "draft") throw new Error("Inventário deve estar em rascunho para iniciar contagem");

    await ctx.db.patch(args.inventoryId, { status: "counting", updatedAt: Date.now() });

    await ctx.db.insert("auditLogs", {
      userId, action: "count_inventory", entity: "inventories", entityId: args.inventoryId,
      details: `Inventário ${inv.inventoryNumber} — contagem iniciada`, timestamp: Date.now(),
    });
  },
});

/** Save a count for a specific product in the inventory. */
export const saveCount = mutation({
  args: {
    countId: v.id("inventoryCounts"),
    countedQuantity: v.number(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const count = await ctx.db.get(args.countId);
    if (!count) throw new Error("Registro de contagem não encontrado");

    const inv = await ctx.db.get(count.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "counting" && inv.status !== "review") {
      throw new Error("Inventário deve estar em contagem ou revisão para registrar contagem");
    }

    if (args.countedQuantity < 0) throw new Error("A quantidade contada não pode ser negativa");

    const difference = args.countedQuantity - count.systemQuantity;

    await ctx.db.patch(args.countId, {
      countedQuantity: args.countedQuantity,
      difference,
      observation: args.observation || undefined,
    });

    await ctx.db.insert("auditLogs", {
      userId, action: "count_inventory", entity: "inventoryCounts", entityId: args.countId,
      details: `Contagem: produto ${count.productId}, sistema ${count.systemQuantity}, contado ${args.countedQuantity}, diferença ${difference >= 0 ? "+" : ""}${difference}`,
      timestamp: Date.now(),
    });
  },
});

/** Move inventory to REVIEW status. */
export const startReview = mutation({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "counting") throw new Error("Inventário deve estar em contagem para iniciar revisão");

    // Validate all counts have been filled
    const counts = await ctx.db.query("inventoryCounts").withIndex("by_inventory", (q: any) => q.eq("inventoryId", args.inventoryId)).collect();
    const uncounted = counts.filter((c) => c.countedQuantity === null || c.countedQuantity === undefined);
    if (uncounted.length > 0) {
      throw new Error(`${uncounted.length} item(ns) ainda não foram contados. Registre a contagem de todos os itens antes de revisar.`);
    }

    await ctx.db.patch(args.inventoryId, { status: "review", updatedAt: Date.now() });
  },
});

/**
 * Close inventory: generate adjustment movements for all differences.
 * This is an atomic operation.
 */
export const close = mutation({
  args: {
    inventoryId: v.id("inventories"),
    // Justificativa obrigatória: qualquer ajuste de saldo precisa de motivo
    // auditável — nunca alterar saldo silenciosamente.
    justification: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireStockManagerOrAdmin(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (role !== "admin" && role !== "stock_manager") {
      throw new Error("Apenas administradores e responsáveis pelo estoque podem fechar inventário");
    }

    const justification = (args.justification ?? "").trim();
    if (!justification) {
      throw new Error("A justificativa do fechamento é obrigatória (ajuste de saldo auditável)");
    }

    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "review") throw new Error("Inventário deve estar em revisão para ser fechado");

    const counts = await ctx.db.query("inventoryCounts").withIndex("by_inventory", (q: any) => q.eq("inventoryId", args.inventoryId)).collect();
    const countsWithDiff = counts.filter((c) => c.difference !== null && c.difference !== undefined && c.difference !== 0);
    const now = Date.now();
    const locationScope = inv.locationId ? await ctx.db.get(inv.locationId) : null;
    const scopeSuffix = locationScope ? ` no local "${locationScope.name}"` : "";

    const adjustmentDetails: string[] = [];

    for (const count of countsWithDiff) {
      const countProduct = await ctx.db.get(count.productId);
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", count.productId)).first();
      const counted = count.countedQuantity ?? 0;
      const prevPhysical = stock?.physicalQuantity ?? 0;
      const reserved = stock?.reservedQuantity ?? 0;

      let newPhysical: number;

      if (inv.locationId) {
        // ── Inventário por local: ajusta o saldo do local e recalcula o global ──
        const sbls = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", count.productId)).collect();
        const sbl = sbls.find((s) => s.locationId === inv.locationId);
        if (sbl) {
          await ctx.db.patch(sbl._id, { quantity: counted });
        } else if (counted > 0) {
          await ctx.db.insert("stockByLocation", {
            productId: count.productId,
            locationId: inv.locationId,
            quantity: counted,
          });
        }
        const allSbl = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", count.productId)).collect();
        newPhysical = allSbl.reduce((sum, s) => sum + s.quantity, 0);
      } else {
        // ── Inventário geral: saldo global é a contagem ──
        newPhysical = counted;
      }

      // Nunca deixar o estoque abaixo das reservas
      if (newPhysical < reserved) {
        throw new Error(
          `Ajuste de "${countProduct?.name ?? "item"}" deixaria o estoque (${newPhysical}) abaixo das unidades reservadas (${reserved}).`
        );
      }

      if (!stock) {
        // Create stock entry with counted quantity
        await ctx.db.insert("stock", {
          productId: count.productId,
          physicalQuantity: newPhysical,
          reservedQuantity: 0,
        });
      } else {
        await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
      }

      // Create adjustment movement (com a justificativa obrigatória)
      await ctx.db.insert("stockMovements", {
        productId: count.productId,
        type: "adjustment",
        quantity: Math.abs(count.difference!),
        previousPhysical: prevPhysical,
        newPhysical,
        previousReserved: reserved,
        newReserved: reserved,
        userId,
        observation: `Ajuste via inventário ${inv.inventoryNumber}${scopeSuffix}. Diferença: ${count.difference! >= 0 ? "+" : ""}${count.difference}. Justificativa: ${justification}`,
        timestamp: now,
      });

      adjustmentDetails.push(`${countProduct?.name ?? "item"}: ${count.systemQuantity} → ${count.countedQuantity} (${count.difference! >= 0 ? "+" : ""}${count.difference})${scopeSuffix}`);
    }

    // Close inventory
    await ctx.db.patch(args.inventoryId, {
      status: "closed",
      closedAt: now,
      closedByUserId: userId,
      updatedAt: now,
    });

    // Audit (com a justificativa obrigatória)
    await ctx.db.insert("auditLogs", {
      userId, action: "close_inventory", entity: "inventories", entityId: args.inventoryId,
      details: `Inventário ${inv.inventoryNumber} fechado${scopeSuffix}. ${countsWithDiff.length} ajuste(s): ${adjustmentDetails.join("; ") || "nenhum"}. Justificativa: ${justification}`,
      timestamp: now,
    });

    return { adjustments: countsWithDiff.length, details: adjustmentDetails };
  },
});

/** Cancel an inventory (only draft or counting). */
export const cancel = mutation({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status === "closed") throw new Error("Inventário já fechado não pode ser cancelado");
    if (inv.status === "cancelled") throw new Error("Inventário já está cancelado");

    await ctx.db.patch(args.inventoryId, { status: "cancelled", updatedAt: Date.now() });

    await ctx.db.insert("auditLogs", {
      userId, action: "cancel", entity: "inventories", entityId: args.inventoryId,
      details: `Inventário ${inv.inventoryNumber} cancelado`, timestamp: Date.now(),
    });
  },
});
