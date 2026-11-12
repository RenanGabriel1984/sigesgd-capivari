import { describe, expect, it } from "vitest";
import {
  canReadStorageFile,
  getStorageOwnerPermission,
} from "@/lib/storage-access";

describe("autorização contextual de arquivos", () => {
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
