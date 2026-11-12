import { roleHasPermission, type AppPermission, type AppRole } from "./rbac";

export type StorageOwnerType =
  | "pending"
  | "entry"
  | "entryItem"
  | "product"
  | "lot"
  | "gomaqCollection";

const OWNER_PERMISSION: Record<Exclude<StorageOwnerType, "pending">, AppPermission> = {
  entry: "entries.view",
  entryItem: "entries.view",
  product: "products.view",
  lot: "lots.view",
  gomaqCollection: "gomaq.view",
};

export function getStorageOwnerPermission(
  ownerType: Exclude<StorageOwnerType, "pending">,
): AppPermission {
  return OWNER_PERMISSION[ownerType];
}

/**
 * A file in a draft may be previewed only by the active SIGESGD user who
 * uploaded it. Once linked, access follows the permission for its owning entity.
 */
export function canReadStorageFile(input: {
  role: AppRole | null;
  userId: string;
  ownerType: StorageOwnerType;
  uploaderUserId?: string;
}): boolean {
  if (!input.role) return false;

  if (input.ownerType === "pending") {
    return (
      input.uploaderUserId === input.userId &&
      roleHasPermission(input.role, "stock.view")
    );
  }

  return roleHasPermission(input.role, OWNER_PERMISSION[input.ownerType]);
}
