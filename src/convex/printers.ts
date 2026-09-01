import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado");
  return { userId, user };
}

async function requireManagerOrAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin" && role !== "stock_manager") {
    throw new Error("Apenas administradores e responsáveis pelo estoque podem gerenciar impressoras");
  }
  return { userId, user };
}

// ─── Printers ────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const printers = await ctx.db.query("printers").collect();
    return Promise.all(
      printers.map(async (p) => {
        const org = p.organizationId ? await ctx.db.get(p.organizationId) : null;
        return { ...p, organization: org };
      })
    );
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const printers = await ctx.db
      .query("printers")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return Promise.all(
      printers.map(async (p) => {
        const org = p.organizationId ? await ctx.db.get(p.organizationId) : null;
        return { ...p, organization: org };
      })
    );
  },
});

export const listByOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const printers = await ctx.db
      .query("printers")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .filter((q) => q.eq(q.field("active"), true))
      .collect();
    return printers;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    brand: v.string(),
    model: v.string(),
    organizationId: v.optional(v.id("organizations")),
    patrimony: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    if (!args.name.trim()) throw new Error("Nome da impressora é obrigatório");
    if (!args.brand.trim()) throw new Error("Marca é obrigatória");
    if (!args.model.trim()) throw new Error("Modelo é obrigatório");

    const id = await ctx.db.insert("printers", {
      ...args,
      name: args.name.trim(),
      brand: args.brand.trim(),
      model: args.model.trim(),
      patrimony: args.patrimony?.trim() || undefined,
      active: true,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "printers", entityId: id,
      details: `Impressora "${args.name}" (${args.brand} ${args.model}) cadastrada`,
      timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("printers"),
    name: v.optional(v.string()),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
    patrimony: v.optional(v.string()),
    observation: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const { id, ...updates } = args;
    const printer = await ctx.db.get(id);
    if (!printer) throw new Error("Impressora não encontrada");
    if (updates.name) updates.name = updates.name.trim();
    if (updates.brand) updates.brand = updates.brand.trim();
    if (updates.model) updates.model = updates.model.trim();
    await ctx.db.patch(id, updates);
    const action = updates.active === false ? "deactivate" : updates.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId, action, entity: "printers", entityId: id,
      details: `Impressora "${printer.name}" — alterada`,
      timestamp: Date.now(),
    });
    return id;
  },
});

// ─── Compatibility Matrix ────────────────────────────────────────────────────

export const listCompatibility = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("printerCompatibility")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
  },
});

/** Returns all compatibility records grouped by productId — used by Requests to validate toner→printer compatibility. */
export const listAllCompatibility = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("printerCompatibility").collect();
    const grouped: Record<string, string[]> = {};
    for (const c of all) {
      const pid = c.productId as string;
      if (!grouped[pid]) grouped[pid] = [];
      grouped[pid].push(c.printerModel);
    }
    return grouped;
  },
});

export const upsertCompatibility = mutation({
  args: {
    productId: v.id("products"),
    printerModel: v.string(),
    estimatedYield: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    if (!args.printerModel.trim()) throw new Error("Modelo da impressora é obrigatório");
    if (args.estimatedYield <= 0) throw new Error("Rendimento estimado deve ser maior que zero");

    // Check if already exists
    const existing = await ctx.db
      .query("printerCompatibility")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    const found = existing.find((c) => c.printerModel === args.printerModel.trim());
    if (found) {
      await ctx.db.patch(found._id, { estimatedYield: args.estimatedYield });
      await ctx.db.insert("auditLogs", {
        userId, action: "toner_update", entity: "printerCompatibility", entityId: found._id,
        details: `Compatibilidade atualizada: modelo "${args.printerModel.trim()}" rendimento ${args.estimatedYield} pág.`,
        timestamp: Date.now(),
      });
      return found._id;
    }

    const id = await ctx.db.insert("printerCompatibility", {
      productId: args.productId,
      printerModel: args.printerModel.trim(),
      estimatedYield: args.estimatedYield,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "toner_update", entity: "printerCompatibility", entityId: id,
      details: `Compatibilidade adicionada: modelo "${args.printerModel.trim()}" rendimento ${args.estimatedYield} pág.`,
      timestamp: Date.now(),
    });
    return id;
  },
});

export const removeCompatibility = mutation({
  args: { id: v.id("printerCompatibility") },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Registro de compatibilidade não encontrado");
    await ctx.db.delete(args.id);
    await ctx.db.insert("auditLogs", {
      userId, action: "toner_update", entity: "printerCompatibility", entityId: args.id,
      details: `Compatibilidade removida: modelo "${record.printerModel}"`,
      timestamp: Date.now(),
    });
    return args.id;
  },
});

// ─── Toner Metrics ───────────────────────────────────────────────────────────

export const tonerMetrics = query({
  args: {},
  handler: async (ctx) => {
    // Find all toner products (products that have compatibility entries)
    const allCompat = await ctx.db.query("printerCompatibility").collect();
    const tonerProductIds = [...new Set(allCompat.map((c) => c.productId))];

    // Find all printers
    const printers = await ctx.db.query("printers").withIndex("by_active", (q) => q.eq("active", true)).collect();

    // For each printer, find all delivered toner requests
    const metrics = [];
    for (const printer of printers) {
      // Find all requestItems where targetPrinterId = this printer
      const allRequestItems = await ctx.db.query("requestItems").collect();
      const printerItems = allRequestItems.filter((ri) => ri.targetPrinterId === printer._id && ri.quantityDelivered > 0);

      if (printerItems.length === 0) {
        metrics.push({
          printer,
          totalTonerChanges: 0,
          avgDaysBetweenChanges: 0,
          lastChangeDate: null,
          excessive: false,
          items: [],
        });
        continue;
      }

      // Get the delivery dates from parent requests
      const itemsWithDates = [];
      for (const item of printerItems) {
        const request = await ctx.db.get(item.requestId);
        if (request?.deliveredAt) {
          const product = await ctx.db.get(item.productId);
          itemsWithDates.push({
            productName: product?.name ?? "Item",
            quantity: item.quantityDelivered,
            deliveredAt: request.deliveredAt,
          });
        }
      }

      itemsWithDates.sort((a, b) => a.deliveredAt - b.deliveredAt);

      // Calculate average interval between changes
      let avgDays = 0;
      if (itemsWithDates.length >= 2) {
        let totalDays = 0;
        for (let i = 1; i < itemsWithDates.length; i++) {
          totalDays += (itemsWithDates[i].deliveredAt - itemsWithDates[i - 1].deliveredAt) / (1000 * 60 * 60 * 24);
        }
        avgDays = totalDays / (itemsWithDates.length - 1);
      }

      // Excessive = more than 3 changes in 30 days, or avg < 7 days
      const last30Days = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentCount = itemsWithDates.filter((i) => i.deliveredAt >= last30Days).length;
      const excessive = recentCount > 3 || (avgDays > 0 && avgDays < 7);

      metrics.push({
        printer,
        totalTonerChanges: itemsWithDates.length,
        avgDaysBetweenChanges: Math.round(avgDays * 10) / 10,
        lastChangeDate: itemsWithDates.length > 0 ? itemsWithDates[itemsWithDates.length - 1].deliveredAt : null,
        excessive,
        items: itemsWithDates.slice(0, 10),
      });
    }

    // Also include toners without assigned printers
    const unassignedItems = await ctx.db.query("requestItems").collect();
    const unassignedToner = unassignedItems.filter(
      (ri) => !ri.targetPrinterId && ri.quantityDelivered > 0 && tonerProductIds.includes(ri.productId)
    );

    return {
      printerMetrics: metrics,
      unassignedCount: unassignedToner.reduce((sum, i) => sum + i.quantityDelivered, 0),
    };
  },
});
