import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** Helper: get authenticated user or throw. */
async function requireUser(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User profile not found. Please sign in again.");
  return { userId, user };
}

/** List all requests with requester info (limited for performance). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_created")
      .order("desc")
      .take(200);

    return Promise.all(
      requests.map(async (r) => {
        const requester = await ctx.db.get(r.requesterId);
        const approver = r.approverId ? await ctx.db.get(r.approverId) : null;
        const items = await ctx.db
          .query("requestItems")
          .withIndex("by_request", (q) => q.eq("requestId", r._id))
          .collect();

        const itemsWithProduct = await Promise.all(
          items.map(async (item) => {
            const product = await ctx.db.get(item.productId);
            return { ...item, product };
          })
        );

        return { ...r, requester, approver, items: itemsWithProduct };
      })
    );
  },
});

/** List requests by a specific user (technician's own requests). */
export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_requester", (q) => q.eq("requesterId", args.userId))
      .order("desc")
      .take(100);

    return Promise.all(
      requests.map(async (r) => {
        const approver = r.approverId ? await ctx.db.get(r.approverId) : null;
        const items = await ctx.db
          .query("requestItems")
          .withIndex("by_request", (q) => q.eq("requestId", r._id))
          .collect();

        const itemsWithProduct = await Promise.all(
          items.map(async (item) => {
            const product = await ctx.db.get(item.productId);
            return { ...item, product };
          })
        );

        return { ...r, approver, items: itemsWithProduct };
      })
    );
  },
});

/** Create a new request (solicitação). */
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

    // Validate that all products exist
    for (const item of args.items) {
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Product not found: ${item.productId}`);
      if (item.quantityRequested <= 0) throw new Error("Quantity must be greater than zero");
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

/** Approve a request (reserve stock). */
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
    const { userId } = await requireUser(ctx);

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    if (request.requesterId === userId) throw new Error("Cannot approve your own request");
    if (request.status !== "pending") throw new Error("Request is not pending");

    const now = Date.now();

    for (const item of args.items) {
      const requestItem = await ctx.db.get(item.itemId);
      if (!requestItem) continue;

      await ctx.db.patch(item.itemId, {
        quantityApproved: item.quantityApproved,
      });

      // Reserve stock
      if (item.quantityApproved > 0) {
        const stock = await ctx.db
          .query("stock")
          .withIndex("by_product", (q) => q.eq("productId", requestItem.productId))
          .first();

        if (stock) {
          const available = stock.physicalQuantity - stock.reservedQuantity;
          if (available >= item.quantityApproved) {
            await ctx.db.patch(stock._id, {
              reservedQuantity: stock.reservedQuantity + item.quantityApproved,
            });
          }
        }
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

/** Reject a request. */
export const reject = mutation({
  args: {
    requestId: v.id("requests"),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);

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

/** Mark request as delivered (consume reserved stock). */
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

    const now = Date.now();

    for (const item of items) {
      if (item.quantityApproved > 0) {
        const stock = await ctx.db
          .query("stock")
          .withIndex("by_product", (q) => q.eq("productId", item.productId))
          .first();

        if (stock) {
          const newReserved = Math.max(0, stock.reservedQuantity - item.quantityApproved);
          const newPhysical = Math.max(0, stock.physicalQuantity - item.quantityApproved);

          await ctx.db.patch(stock._id, {
            physicalQuantity: newPhysical,
            reservedQuantity: newReserved,
          });

          await ctx.db.insert("stockMovements", {
            productId: item.productId,
            type: "exit",
            quantity: item.quantityApproved,
            previousPhysical: stock.physicalQuantity,
            newPhysical,
            previousReserved: stock.reservedQuantity,
            newReserved,
            userId,
            requestId: args.requestId,
            observation: `Delivery from request`,
            timestamp: now,
          });
        }

        await ctx.db.patch(item._id, {
          quantityDelivered: item.quantityApproved,
        });
      }
    }

    await ctx.db.patch(args.requestId, {
      status: "delivered",
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "deliver",
      entity: "requests",
      entityId: args.requestId,
      details: `Request delivered`,
      timestamp: now,
    });

    return args.requestId;
  },
});

/** Cancel a request (technician can cancel their own pending). */
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
      details: `Request cancelled by requester`,
      timestamp: now,
    });

    return args.requestId;
  },
});

/** Count pending requests. */
export const pendingCount = query({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    return pending.length;
  },
});
