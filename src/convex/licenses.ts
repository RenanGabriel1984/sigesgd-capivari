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

async function requireAdmin(ctx: any) {
  const { userId, user } = await requireUser(ctx);
  const role = (user.role ?? "technician") as UserRole;
  if (role !== "admin") {
    throw new Error("Apenas administradores podem gerenciar licenças");
  }
  return { userId, user };
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) return "****";
  return "*".repeat(key.length - 4) + key.slice(-4);
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const list = query({
  args: {
    productName: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    const isAdmin = role === "admin";

    let licenses = await ctx.db.query("licenses").order("desc").take(500);

    if (args.productName) licenses = licenses.filter((l: any) => l.productName === args.productName);
    if (args.active !== undefined) licenses = licenses.filter((l: any) => l.active === args.active);

    // Mask keys for non-admins
    return licenses.map((l: any) => ({
      ...l,
      key: l.key ? (isAdmin ? l.key : maskKey(l.key)) : undefined,
    }));
  },
});

export const get = query({
  args: { licenseId: v.id("licenses") },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;
    const isAdmin = role === "admin";

    const license = await ctx.db.get(args.licenseId);
    if (!license) throw new Error("Licença não encontrada");

    // Get assignments
    const assignments = await ctx.db
      .query("licenseAssignments")
      .withIndex("by_license", (q) => q.eq("licenseId", args.licenseId))
      .collect();

    const activeAssignments = assignments.filter((a: any) => !a.removedAt);

    const assignmentsWithDetails = await Promise.all(activeAssignments.map(async (a: any) => {
      const asset = await ctx.db.get(a.assetId);
      const assignedBy = await ctx.db.get(a.assignedByUserId);
      return { ...a, asset, assignedBy };
    }));

    return {
      ...license,
      key: license.key ? (isAdmin ? license.key : maskKey(license.key)) : undefined,
      assignedCount: activeAssignments.length,
      assignments: assignmentsWithDetails,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const create = mutation({
  args: {
    productName: v.string(),
    edition: v.optional(v.string()),
    licenseType: v.string(),
    key: v.optional(v.string()),
    quantity: v.number(),
    expirationDate: v.optional(v.string()),
    supplier: v.optional(v.string()),
    invoiceNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    if (args.quantity <= 0) throw new Error("Quantidade deve ser maior que zero");

    const now = Date.now();

    const licenseId = await ctx.db.insert("licenses", {
      productName: args.productName,
      edition: args.edition || undefined,
      licenseType: args.licenseType as any,
      key: args.key || undefined,
      quantity: args.quantity,
      expirationDate: args.expirationDate || undefined,
      supplier: args.supplier || undefined,
      invoiceNumber: args.invoiceNumber || undefined,
      observation: args.observation || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "license_create",
      entity: "licenses",
      entityId: licenseId,
      details: `Licença criada: ${args.productName} (${args.quantity}x)`,
      timestamp: now,
    });

    return licenseId;
  },
});

export const update = mutation({
  args: {
    licenseId: v.id("licenses"),
    productName: v.optional(v.string()),
    edition: v.optional(v.string()),
    licenseType: v.optional(v.string()),
    key: v.optional(v.string()),
    quantity: v.optional(v.number()),
    expirationDate: v.optional(v.string()),
    supplier: v.optional(v.string()),
    invoiceNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const license = await ctx.db.get(args.licenseId);
    if (!license) throw new Error("Licença não encontrada");

    const now = Date.now();
    const updates: Record<string, any> = { updatedAt: now };

    if (args.productName !== undefined) updates.productName = args.productName;
    if (args.edition !== undefined) updates.edition = args.edition || undefined;
    if (args.licenseType !== undefined) updates.licenseType = args.licenseType;
    if (args.key !== undefined) updates.key = args.key || undefined;
    if (args.quantity !== undefined) {
      if (args.quantity <= 0) throw new Error("Quantidade deve ser maior que zero");
      // Check that we don't reduce below active assignments
      const activeCount = await ctx.db
        .query("licenseAssignments")
        .withIndex("by_license", (q) => q.eq("licenseId", args.licenseId!))
        .collect();
      const activeAssigned = activeCount.filter((a: any) => !a.removedAt).length;
      if (args.quantity < activeAssigned) {
        throw new Error(`Quantidade não pode ser menor que as atribuições ativas (${activeAssigned})`);
      }
      updates.quantity = args.quantity;
    }
    if (args.expirationDate !== undefined) updates.expirationDate = args.expirationDate || undefined;
    if (args.supplier !== undefined) updates.supplier = args.supplier || undefined;
    if (args.invoiceNumber !== undefined) updates.invoiceNumber = args.invoiceNumber || undefined;
    if (args.observation !== undefined) updates.observation = args.observation || undefined;
    if (args.active !== undefined) updates.active = args.active;

    await ctx.db.patch(args.licenseId, updates);

    return args.licenseId;
  },
});

export const assignToAsset = mutation({
  args: {
    licenseId: v.id("licenses"),
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);

    const license = await ctx.db.get(args.licenseId);
    if (!license) throw new Error("Licença não encontrada");
    if (!license.active) throw new Error("Licença inativa");

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    // Check quantity limit
    const existingAssignments = await ctx.db
      .query("licenseAssignments")
      .withIndex("by_license", (q) => q.eq("licenseId", args.licenseId))
      .collect();
    const activeCount = existingAssignments.filter((a: any) => !a.removedAt).length;

    if (activeCount >= license.quantity) {
      throw new Error(`Limite de licenças atingido. Disponível: 0 de ${license.quantity}`);
    }

    // Check if already assigned to this asset
    const alreadyAssigned = existingAssignments.find(
      (a: any) => a.assetId === args.assetId && !a.removedAt
    );
    if (alreadyAssigned) {
      throw new Error("Esta licença já está vinculada a este equipamento");
    }

    const now = Date.now();

    const assignmentId = await ctx.db.insert("licenseAssignments", {
      licenseId: args.licenseId,
      assetId: args.assetId,
      assignedAt: now,
      assignedByUserId: userId,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "license_assign",
      entity: "licenseAssignments",
      entityId: assignmentId,
      details: `Licença ${license.productName} vinculada a ${asset.patrimonyNumber ?? "equipamento"}`,
      timestamp: now,
    });

    return assignmentId;
  },
});

export const removeFromAsset = mutation({
  args: {
    assignmentId: v.id("licenseAssignments"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) throw new Error("Vinculação não encontrada");
    if (assignment.removedAt) throw new Error("Esta vinculação já foi removida");

    const now = Date.now();
    await ctx.db.patch(args.assignmentId, { removedAt: now });

    return args.assignmentId;
  },
});
