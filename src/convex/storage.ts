import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Não autenticado");
    return await ctx.storage.generateUploadUrl();
  },
});

export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    // Proteção: exige sessão autenticada (documentos/fotos são internos)
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Não autenticado");
    const url = await ctx.storage.getUrl(args.storageId as any);
    return url;
  },
});

export const getUrls = query({
  args: { storageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    // Proteção: exige sessão autenticada
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Não autenticado");
    const urls: Record<string, string | null> = {};
    for (const id of args.storageIds) {
      urls[id] = await ctx.storage.getUrl(id as any);
    }
    return urls;
  },
});
