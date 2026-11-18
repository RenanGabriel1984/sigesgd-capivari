import { describe, expect, it } from "vitest";
import {
  canAttachPendingStorageFile,
  canReadStorageFile,
  getStorageOwnerPermission,
  isStorageUploadSizeAllowed,
  MAX_STORAGE_UPLOAD_BYTES,
} from "@/lib/storage-access";

describe("limite de upload aplicado também no backend", () => {
  it("aceita somente arquivos maiores que zero e de até 10 MB", () => {
    expect(isStorageUploadSizeAllowed(1)).toBe(true);
    expect(isStorageUploadSizeAllowed(MAX_STORAGE_UPLOAD_BYTES)).toBe(true);
    expect(isStorageUploadSizeAllowed(MAX_STORAGE_UPLOAD_BYTES + 1)).toBe(false);
    expect(isStorageUploadSizeAllowed(0)).toBe(false);
    expect(isStorageUploadSizeAllowed(-1)).toBe(false);
    expect(isStorageUploadSizeAllowed(Number.NaN)).toBe(false);
    expect(isStorageUploadSizeAllowed(1.5)).toBe(false);
  });

  it("usa um limite único compartilhado entre interface e backend", () => {
    expect(MAX_STORAGE_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("autorização contextual de arquivos", () => {
  it("permite vincular somente arquivo pendente enviado pelo próprio usuário", () => {
    expect(canAttachPendingStorageFile({
      userId: "user-a",
      existingOwners: [{ ownerType: "pending", uploaderUserId: "user-a" }],
    })).toBe(true);
    expect(canAttachPendingStorageFile({
      userId: "user-b",
      existingOwners: [{ ownerType: "pending", uploaderUserId: "user-a" }],
    })).toBe(false);
  });

  it("impede reutilizar ou compartilhar implicitamente arquivo já vinculado, inclusive pelo próprio remetente", () => {
    expect(canAttachPendingStorageFile({
      userId: "user-a",
      existingOwners: [{ ownerType: "entry", uploaderUserId: "user-a" }],
    })).toBe(false);
    expect(canAttachPendingStorageFile({
      userId: "user-a",
      existingOwners: [
        { ownerType: "pending", uploaderUserId: "user-a" },
        { ownerType: "product", uploaderUserId: "user-a" },
      ],
    })).toBe(false);
    expect(canAttachPendingStorageFile({
      userId: "user-a",
      existingOwners: [],
    })).toBe(false);
  });

  it("mapeia cada tipo de documento para a permissão da entidade proprietária", () => {
    expect(getStorageOwnerPermission("entry")).toBe("entries.view");
    expect(getStorageOwnerPermission("entryItem")).toBe("entries.view");
    expect(getStorageOwnerPermission("product")).toBe("products.view");
    expect(getStorageOwnerPermission("lot")).toBe("lots.view");
    expect(getStorageOwnerPermission("gomaqCollection")).toBe("gomaq.view");
  });

  it("permite visualizar arquivo pendente somente ao usuário que o enviou", () => {
    expect(canReadStorageFile({
      role: "technician",
      userId: "user-a",
      ownerType: "pending",
      uploaderUserId: "user-a",
    })).toBe(true);
    expect(canReadStorageFile({
      role: "technician",
      userId: "user-b",
      ownerType: "pending",
      uploaderUserId: "user-a",
    })).toBe(false);
  });

  it("nega acesso quando o perfil não possui a permissão do proprietário", () => {
    expect(canReadStorageFile({
      role: "patrimony_manager",
      userId: "patrimony-user",
      ownerType: "product",
    })).toBe(false);
    expect(canReadStorageFile({
      role: null,
      userId: "anonymous",
      ownerType: "entry",
    })).toBe(false);
  });

  it("permite consultar os arquivos da entidade para um perfil autorizado", () => {
    expect(canReadStorageFile({
      role: "admin",
      userId: "admin",
      ownerType: "entry",
    })).toBe(true);
    expect(canReadStorageFile({
      role: "admin",
      userId: "admin",
      ownerType: "gomaqCollection",
    })).toBe(true);
  });
});

describe("vínculo direto de arquivos no backend", () => {
  it("revalida metadados e tamanho mesmo quando registerUpload é ignorado", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("../convex/storage.ts", import.meta.url), "utf-8")
    );
    const start = source.indexOf("export async function attachStorageFile(");
    const end = source.indexOf("\nexport const generateUploadUrl", start);
    const attach = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(attach).toContain('ctx.db.system.get("_storage"');
    expect(attach).toContain("isStorageUploadSizeAllowed(metadata.size)");
  });
});
