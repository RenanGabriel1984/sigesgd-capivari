import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission, effectiveRole } from "./rbac";
import {
  canReadStorageFile,
  type StorageOwnerType,
} from "../lib/storage-access";

const MAX_URLS_PER_CALL = 50;
const STORAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

type StorageOwnerRecord = {
  ownerType: StorageOwnerType;
  ownerId?: string;
  uploaderUserId?: string;
};

function assertValidStorageId(storageId: unknown): string {
  if (typeof storageId !== "string" || !STORAGE_ID_PATTERN.test(storageId)) {
    throw new Error("Identificador de arquivo inválido.");
  }
  return storageId;
}

function isStorageId(value: unknown): value is string {
  return typeof value === "string" && STORAGE_ID_PATTERN.test(value);
}

async function getStorageViewer(ctx: any): Promise<{ userId: string; role: NonNullable<ReturnType<typeof effectiveRole>> }> {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) throw new Error("Não autenticado.");

  const user = await ctx.db.get(authUserId);
  if (!user || user.active === false || (user as { isAnonymous?: boolean }).isAnonymous === true) {
    throw new Error("Acesso negado ao arquivo.");
  }

  const role = effectiveRole(user);
  if (!role) throw new Error("Acesso negado ao arquivo.");

  return { userId: String(authUserId), role };
}

/**
 * Resolves ownership from the registry first. If a file predates the registry,
 * discover its persisted owner from existing domain records without changing them.
 */
async function resolveStorageOwners(
  ctx: any,
  storageIds: string[],
): Promise<Map<string, StorageOwnerRecord[]>> {
  const ownersById = new Map<string, StorageOwnerRecord[]>();
  for (const id of storageIds) ownersById.set(id, []);

  const registered = await Promise.all(
    storageIds.map((storageId) =>
      ctx.db
        .query("storageFiles")
        .withIndex("by_storageId", (q: any) => q.eq("storageId", storageId))
        .collect(),
    ),
  );

  const idsNeedingLegacyLookup: string[] = [];
  for (let index = 0; index < storageIds.length; index++) {
    const storageId = storageIds[index];
    const rows = registered[index] as Array<{
      ownerType: StorageOwnerType;
      ownerId?: string;
      uploaderUserId?: string;
    }>;
    if (rows.length === 0) {
      idsNeedingLegacyLookup.push(storageId);
      continue;
    }
    ownersById.set(
      storageId,
      rows.map((row) => ({
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        uploaderUserId: row.uploaderUserId ? String(row.uploaderUserId) : undefined,
      })),
    );
  }

  if (idsNeedingLegacyLookup.length === 0) return ownersById;

  const wanted = new Set(idsNeedingLegacyLookup);
  const [entries, entryItems, products, lots, collections] = await Promise.all([
    ctx.db.query("entries").collect(),
    ctx.db.query("entryItems").collect(),
    ctx.db.query("products").collect(),
    ctx.db.query("lots").collect(),
    ctx.db.query("gomaQCollections").collect(),
  ]);

  const addLegacy = (storageId: unknown, ownerType: StorageOwnerType, ownerId: string) => {
    if (typeof storageId !== "string" || !wanted.has(storageId)) return;
    const rows = ownersById.get(storageId) ?? [];
    if (!rows.some((row) => row.ownerType === ownerType && row.ownerId === ownerId)) {
      rows.push({ ownerType, ownerId });
      ownersById.set(storageId, rows);
    }
  };

  for (const entry of entries as any[]) {
    addLegacy(entry.documentStorageId, "entry", String(entry._id));
    addLegacy(entry.xmlStorageId, "entry", String(entry._id));
  }
  for (const item of entryItems as any[]) {
    addLegacy(item.photoStorageId, "entryItem", String(item._id));
  }
  for (const product of products as any[]) {
    addLegacy(product.photo, "product", String(product._id));
  }
  for (const lot of lots as any[]) {
    addLegacy(lot.photoStorageId, "lot", String(lot._id));
  }
  for (const collection of collections as any[]) {
    addLegacy(collection.documentStorageId, "gomaqCollection", String(collection._id));
  }

  return ownersById;
}

async function resolveAuthorizedUrls(ctx: any, rawIds: string[]): Promise<Record<string, string | null>> {
  const ids = rawIds.map(assertValidStorageId);
  const viewer = await getStorageViewer(ctx);
  const ownersById = await resolveStorageOwners(ctx, ids);
  const urls: Record<string, string | null> = {};

  for (const storageId of ids) {
    const owners = ownersById.get(storageId) ?? [];
    const allowed = owners.some((owner) =>
      canReadStorageFile({
        role: viewer.role,
        userId: viewer.userId,
        ownerType: owner.ownerType,
        uploaderUserId: owner.uploaderUserId,
      }),
    );
    if (!allowed) {
      throw new Error("Arquivo não encontrado ou sem permissão para visualização.");
    }

    urls[storageId] = await ctx.storage.getUrl(storageId as any);
  }

  return urls;
}

/**
 * Register the storage ID immediately after upload. Until the business mutation
 * links it to an entity, only the uploader can preview their own pending file.
 */
export const registerUpload = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "stock.view");
    const storageId = assertValidStorageId(args.storageId);
    const url = await ctx.storage.getUrl(storageId as any);
    if (!url) throw new Error("O arquivo enviado não foi encontrado no armazenamento.");

    const existing = await ctx.db
      .query("storageFiles")
      .withIndex("by_storageId", (q: any) => q.eq("storageId", storageId))
      .collect();

    if (existing.some((row: any) =>
      row.ownerType === "pending" && String(row.uploaderUserId) === String(userId)
    )) {
      return storageId;
    }
    if (existing.length > 0) {
      throw new Error("Este arquivo já está vinculado a outro registro.");
    }

    // Do not let a caller re-register a legacy file ID as their own pending upload.
    const legacyOwners = await resolveStorageOwners(ctx, [storageId]);
    if ((legacyOwners.get(storageId) ?? []).length > 0) {
      throw new Error("Este arquivo já pertence a outro registro.");
    }

    const now = Date.now();
    await ctx.db.insert("storageFiles", {
      storageId,
      ownerType: "pending",
      uploaderUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    return storageId;
  },
});

/**
 * Attach an uploaded file to its business record. Legacy files (without registry
 * rows) can be linked when an already-authorized mutation edits their owner.
 */
export async function attachStorageFile(
  ctx: any,
  rawStorageId: string | null | undefined,
  ownerType: Exclude<StorageOwnerType, "pending">,
  ownerId: string,
  userId: string,
): Promise<void> {
  if (!isStorageId(rawStorageId)) return;
  const storageId = rawStorageId;
  const existing = await ctx.db
    .query("storageFiles")
    .withIndex("by_storageId", (q: any) => q.eq("storageId", storageId))
    .collect();

  if (existing.some((row: any) =>
    row.ownerType === ownerType && row.ownerId === ownerId
  )) {
    return;
  }

  // A legacy ID with a different persisted owner cannot be reassigned to a new
  // entity. A matching old reference is already authorized and needs no rewrite.
  if (existing.length === 0) {
    const legacyOwners = await resolveStorageOwners(ctx, [storageId]);
    const owners = legacyOwners.get(storageId) ?? [];
    if (owners.length > 0) {
      const alreadyBelongsToTarget = owners.some((owner) =>
        owner.ownerType === ownerType && owner.ownerId === ownerId
      );
      if (alreadyBelongsToTarget) return;
      throw new Error("Este arquivo legado já pertence a outro registro.");
    }
  }

  const sameUploaderPending = existing.some((row: any) =>
    row.ownerType === "pending" && String(row.uploaderUserId) === userId
  );
  const sameUploaderLinked = existing.some((row: any) =>
    row.ownerType !== "pending" && String(row.uploaderUserId) === userId
  );

  if (existing.length > 0 && !sameUploaderPending && !sameUploaderLinked) {
    throw new Error("O arquivo não pertence ao usuário que está vinculando o documento.");
  }

  const url = await ctx.storage.getUrl(storageId as any);
  if (!url) throw new Error("O arquivo a ser vinculado não existe no armazenamento.");

  const now = Date.now();
  for (const row of existing as any[]) {
    if (row.ownerType === "pending" && String(row.uploaderUserId) === userId) {
      await ctx.db.delete(row._id);
    }
  }

  await ctx.db.insert("storageFiles", {
    storageId,
    ownerType,
    ownerId,
    uploaderUserId: userId as any,
    createdAt: now,
    updatedAt: now,
  });
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "stock.view");
    return await ctx.storage.generateUploadUrl();
  },
});

export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    const urls = await resolveAuthorizedUrls(ctx, [args.storageId]);
    return urls[args.storageId] ?? null;
  },
});

export const getUrls = query({
  args: { storageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.storageIds.length > MAX_URLS_PER_CALL) {
      throw new Error(
        `Máximo de ${MAX_URLS_PER_CALL} arquivos por chamada. Solicite em lotes.`,
      );
    }
    return resolveAuthorizedUrls(ctx, args.storageIds);
  },
});

/** Used by the upload UI to avoid offering upload to invalid sessions. */
export const canUpload = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { allowed: false, reason: "unauthenticated" };
    const user = await ctx.db.get(userId);
    if (!user || user.active === false) {
      return { allowed: false, reason: "inactive" };
    }
    if ((user as { isAnonymous?: boolean }).isAnonymous === true) {
      return { allowed: false, reason: "anonymous" };
    }
    if (!effectiveRole(user)) return { allowed: false, reason: "no-role" };
    return { allowed: true };
  },
});
