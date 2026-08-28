import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Types ───────────────────────────────────────────────────────────────────
type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

// Roles that can view ALL requests (not just their own)
const ROLES_WITH_FULL_VISIBILITY: UserRole[] = [
  "admin",
  "stock_manager",
  "director",
  "secretary",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get authenticated user with profile, or throw. */
async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User profile not found. Please sign in again.");
  return { userId, user };
}

/** Check if role has full visibility over all requests. */
function hasFullVisibility(role: UserRole | undefined): boolean {
  if (!role) return false;
  return ROLES_WITH_FULL_VISIBILITY.includes(role);
}

/** Enrich a request document with requester, approver, and items. */
async function enrichRequest(ctx: any, r: any) {
  const requester = await ctx.db.get(r.requesterId);
  const approver = r.approverId ? await ctx.db.get(r.approverId) : null;
  const items = await ctx.db
    .query("requestItems")
    .withIndex("by_request", (q: any) => q.eq("requestId", r._id))
    .collect();

  const itemsWithProduct = await Promise.all(
    items.map(async (item: any) => {
      const product = await ctx.db.get(item.productId);
      return { ...item, product };
    })
  );

  return { ...r, requester, approver, items: itemsWithProduct };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List requests with role-based visibility (REQUIREMENT 1).
 *
 * - Technician: only their own requests
 * - Stock Manager / Director / Secretary / Admin: all requests
 *
 * This is enforced on the backend — the frontend cannot bypass it.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;

    let requests;
    if (hasFullVisibility(role)) {
      // Full visibility: all requests
      requests = await ctx.db
        .query("requests")
        .withIndex("by_created")
        .order("desc")
        .take(200);
    } else {
      // Technician: only own requests
      requests = await ctx.db
        .query("requests")
        .withIndex("by_requester", (q) => q.eq("requesterId", user._id))
        .order("desc")
        .take(200);
    }

    return Promise.all(
      requests.map(async (r) => enrichRequest(ctx, r))
    );
  },
});

/**
 * List requests by a specific user.
 * Used internally; also respects visibility rules.
 */
export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;

    // Technicians can only query their own
    if (!hasFullVisibility(role) && args.userId !== user._id) {
      throw new Error("Access denied");
    }

    const requests = await ctx.db
      .query("requests")
      .withIndex("by_requester", (q) => q.eq("requesterId", args.userId))
      .order("desc")
      .take(100);

    return Promise.all(
      requests.map(async (r) => enrichRequest(ctx, r))
    );
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Create a new request.
 *
 * REQUIRES (REQUIREMENT 2):
 * - Product exists
 * - Product is active
 * - Quantity > 0
 * - Quantity is a valid number
 */
export const create = mutation({
  args: {
    observation: v.optional(v.string()),
    items: v.array(
      v.object({
        productId: v.id("products"),
        quantityRequested: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    if (args.items.length === 0) throw new Error("Request must have at least one item");

    // Validate each item on the backend (REQUIREMENT 2)
    for (const item of args.items) {
      // Product exists?
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error("Product not found");

      // Product is active?
      if (!product.active) throw new Error(`Product "${product.name}" is inactive`);

      // Quantity > 0?
      if (typeof item.quantityRequested !== "number" || !isFinite(item.quantityRequested)) {
        throw new Error("Invalid quantity");
      }
      if (item.quantityRequested <= 0) {
        throw new Error("Quantity must be greater than zero");
      }

      // Quantity is integer for "un" unit?
      if (product.unitOfMeasure === "un" && !Number.isInteger(item.quantityRequested)) {
        throw new Error("Quantity must be a whole number for this unit");
      }
    }

    const now = Date.now();
    const requestId = await ctx.db.insert("requests", {
      requesterId: userId,
      status: "pending",
      observation: args.observation,
      createdAt: now,
      updatedAt: now,
    });

    for (const item of args.items) {
      await ctx.db.insert("requestItems", {
        requestId,
        productId: item.productId,
        quantityRequested: item.quantityRequested,
        quantityApproved: 0,
        quantityDelivered: 0,
      });
    }

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "requests",
      entityId: requestId,
      details: `Request created with ${args.items.length} item(s)`,
      timestamp: now,
    });

    return requestId;
  },
});

/**
 * Approve a request (reserve stock).
 *
 * Validates:
 * - Request exists and is pending
 * - Approver is not the requester
 * - Stock availability for each item before reserving
 */
export const approve = mutation({
  args: {
    requestId: v.id("requests"),
    items: v.array(
      v.object({
        itemId: v.id("requestItems"),
        quantityApproved: v.number(),
      })
    ),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;

    // Only roles with approval权限 can approve
    if (role === "technician") {
      throw new Error("Technicians cannot approve requests");
    }

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    if (request.requesterId === userId) throw new Error("Cannot approve your own request");
    if (request.status !== "pending") throw new Error("Request is not pending");

    // Pre-validate stock availability for ALL items before making any changes
    for (const item of args.items) {
      if (item.quantityApproved <= 0) continue;

      const requestItem = await ctx.db.get(item.itemId);
      if (!requestItem) throw new Error(`Request item not found: ${item.itemId}`);
      if (requestItem.requestId !== args.requestId) throw new Error("Item does not belong to this request");

      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", requestItem.productId))
        .first();

      if (stock) {
        const available = stock.physicalQuantity - stock.reservedQuantity;
        if (available < item.quantityApproved) {
          throw new Error(`Insufficient stock for approval. Available: ${available}, approved: ${item.quantityApproved}`);
        }
      } else {
        throw new Error("No stock record for this product");
      }
    }

    // All validations passed — now apply changes
    const now = Date.now();

    for (const item of args.items) {
      if (item.quantityApproved <= 0) {
        await ctx.db.patch(item.itemId, { quantityApproved: 0 });
        continue;
      }

      const requestItem = await ctx.db.get(item.itemId);
      if (!requestItem) continue;

      await ctx.db.patch(item.itemId, {
        quantityApproved: item.quantityApproved,
      });

      // Reserve stock
      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", requestItem.productId))
        .first();

      if (stock) {
        await ctx.db.patch(stock._id, {
          reservedQuantity: stock.reservedQuantity + item.quantityApproved,
        });
      }
    }

    await ctx.db.patch(args.requestId, {
      status: "approved",
      approverId: userId,
      updatedAt: now,
      observation: args.observation ?? request.observation,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "approve",
      entity: "requests",
      entityId: args.requestId,
      details: `Request approved`,
      timestamp: now,
    });

    return args.requestId;
  },
});

/**
 * Reject a request.
 */
export const reject = mutation({
  args: {
    requestId: v.id("requests"),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;

    if (role === "technician") {
      throw new Error("Technicians cannot reject requests");
    }

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    if (request.requesterId === userId) throw new Error("Cannot reject your own request");
    if (request.status !== "pending") throw new Error("Request is not pending");

    const now = Date.now();

    await ctx.db.patch(args.requestId, {
      status: "rejected",
      approverId: userId,
      updatedAt: now,
      observation: args.observation,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "reject",
      entity: "requests",
      entityId: args.requestId,
      details: `Request rejected`,
      timestamp: now,
    });

    return args.requestId;
  },
});

/**
 * Deliver a request (consume reserved stock).
 *
 * REQUIRES (REQUIREMENTS 3, 4, 5):
 * - ALL stock must be sufficient — no Math.max(0, ...) masking
 * - ALL validations happen BEFORE any writes (atomic)
 * - Stock is re-read at write time for concurrency safety
 *
 * If ANY item fails validation, the entire operation is rejected.
 */
export const deliver = mutation({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    if (request.status !== "approved") throw new Error("Request must be approved first");

    const items = await ctx.db
      .query("requestItems")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();

    if (items.length === 0) throw new Error("Request has no items");

    // ─── Phase 1: Validate ALL items before any writes (ATOMIC — REQUIREMENT 4) ───
    const stockUpdates: Array<{
      stockId: string;
      productId: string;
      quantity: number;
      prevPhysical: number;
      prevReserved: number;
    }> = [];

    for (const item of items) {
      if (item.quantityApproved <= 0) continue;

      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
        .first();

      if (!stock) {
        throw new Error(`No stock record for product ${item.productId}`);
      }

      // REQUIREMENT 3: Strict stock check — NO Math.max(0, ...) masking
      const physicalAvailable = stock.physicalQuantity;
      if (physicalAvailable < item.quantityApproved) {
        throw new Error(
          `Estoque insuficiente. Disponível: ${physicalAvailable}. Solicitado: ${item.quantityApproved}.`
        );
      }

      // REQUIREMENT 5: Re-validate reserved stock at this moment
      const reservedAvailable = stock.reservedQuantity;
      if (reservedAvailable < item.quantityApproved) {
        throw new Error(
          `Estoque reservado insuficiente. Reservado: ${reservedAvailable}. Solicitado: ${item.quantityApproved}.`
        );
      }

      stockUpdates.push({
        stockId: stock._id,
        productId: item.productId,
        quantity: item.quantityApproved,
        prevPhysical: stock.physicalQuantity,
        prevReserved: stock.reservedQuantity,
      });
    }

    // ─── Phase 2: Apply ALL changes (ATOMIC) ───
    const now = Date.now();

    for (const update of stockUpdates) {
      // RE-READ stock for concurrency safety (REQUIREMENT 5)
      const freshStock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q) => q.eq("productId", update.productId as any))
        .first();
      if (!freshStock) throw new Error("Stock record disappeared during delivery");

      // Re-validate with fresh data
      if (freshStock.physicalQuantity < update.quantity) {
        throw new Error(
          `Estoque insuficiente (concorrência). Disponível: ${freshStock.physicalQuantity}. Solicitado: ${update.quantity}.`
        );
      }
      if (freshStock.reservedQuantity < update.quantity) {
        throw new Error(
          `Estoque reservado insuficiente (concorrência). Reservado: ${freshStock.reservedQuantity}. Solicitado: ${update.quantity}.`
        );
      }

      const newPhysical = freshStock.physicalQuantity - update.quantity;
      const newReserved = freshStock.reservedQuantity - update.quantity;

      await ctx.db.patch(freshStock._id, {
        physicalQuantity: newPhysical,
        reservedQuantity: newReserved,
      });

      // Create stock movement
      await ctx.db.insert("stockMovements", {
        productId: update.productId as any,
        type: "exit",
        quantity: update.quantity,
        previousPhysical: freshStock.physicalQuantity,
        newPhysical,
        previousReserved: freshStock.reservedQuantity,
        newReserved,
        userId,
        requestId: args.requestId,
        observation: "Delivery from request",
        timestamp: now,
      });
    }

    // Update delivered quantities on request items
    for (const item of items) {
      if (item.quantityApproved > 0) {
        await ctx.db.patch(item._id, {
          quantityDelivered: item.quantityApproved,
        });
      }
    }

    // Update request status
    await ctx.db.patch(args.requestId, {
      status: "delivered",
      updatedAt: now,
    });

    // Audit log
    await ctx.db.insert("auditLogs", {
      userId,
      action: "deliver",
      entity: "requests",
      entityId: args.requestId,
      details: `Request delivered (${stockUpdates.length} item(s))`,
      timestamp: now,
    });

    return args.requestId;
  },
});

/**
 * Cancel a request (technician can cancel their own pending).
 */
export const cancel = mutation({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    if (request.requesterId !== userId) throw new Error("Can only cancel your own requests");
    if (request.status !== "pending") throw new Error("Can only cancel pending requests");

    const now = Date.now();

    await ctx.db.patch(args.requestId, {
      status: "cancelled",
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "reject",
      entity: "requests",
      entityId: args.requestId,
      details: "Request cancelled by requester",
      timestamp: now,
    });

    return args.requestId;
  },
});

/**
 * Count pending requests (visible to all authenticated users).
 */
export const pendingCount = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    const role = (user.role ?? "technician") as UserRole;

    if (hasFullVisibility(role)) {
      const pending = await ctx.db
        .query("requests")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .collect();
      return pending.length;
    }

    // Technicians: count only their own pending requests
    const pending = await ctx.db
      .query("requests")
      .withIndex("by_requester", (q) => q.eq("requesterId", user._id))
      .collect();
    return pending.filter((r) => r.status === "pending").length;
  },
});
