import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** List all requests with requester info. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_created")
      .order("desc")
      .collect();

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
      .collect();

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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (args.items.length === 0) throw new Error("Request must have at least one item");

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
      details: `Solicitação criada com ${args.items.length} item(ns)`,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
      details: `Solicitação aprovada`,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
      details: `Solicitação rejeitada`,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
          // Reduce physical and reserved
          const newReserved = Math.max(0, stock.reservedQuantity - item.quantityApproved);
          const newPhysical = Math.max(0, stock.physicalQuantity - item.quantityApproved);

          await ctx.db.patch(stock._id, {
            physicalQuantity: newPhysical,
            reservedQuantity: newReserved,
          });

          // Create exit movement
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
            observation: `Entrega da solicitação`,
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
      details: `Solicitação entregue`,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
      details: `Solicitação cancelada pelo solicitante`,
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
