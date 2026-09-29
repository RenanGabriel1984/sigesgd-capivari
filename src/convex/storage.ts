import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // RBAC central: upload exige sessão com visão de estoque (XML, DANFE, fotos).
    await requirePermission(ctx, "stock.view");
    return await ctx.storage.generateUploadUrl();
  },
});

export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    // RBAC central: documentos/fotos são internos — exige visão de estoque.
    await requirePermission(ctx, "stock.view");
    const url = await ctx.storage.getUrl(args.storageId as any);
    return url;
  },
});

export const getUrls = query({
  args: { storageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    // RBAC central: documentos/fotos são internos — exige visão de estoque.
    await requirePermission(ctx, "stock.view");
    const urls: Record<string, string | null> = {};
    for (const id of args.storageIds) {
      urls[id] = await ctx.storage.getUrl(id as any);
    }
    return urls;
  },
});
