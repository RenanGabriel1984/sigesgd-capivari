import { describe, expect, it } from "vitest";
import { canAssignLicenseToAsset, licenseQuantityError } from "@/lib/license-quantity";

describe("regras de quantidade e atribuição de licenças", () => {
  it("aceita somente quantidades positivas, inteiras e seguras", () => {
    for (const quantity of [1, 2, 100, Number.MAX_SAFE_INTEGER]) {
      expect(licenseQuantityError(quantity)).toBeNull();
    }
  });

  it("rejeita zero, negativos, frações, infinito, NaN e estouro de precisão", () => {
    for (const quantity of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(licenseQuantityError(quantity)).toMatch(/inteiro maior que zero/i);
    }
  });

  it("bloqueia vínculo novo a equipamento baixado ou extraviado", () => {
    expect(canAssignLicenseToAsset("active")).toBe(true);
    expect(canAssignLicenseToAsset("maintenance")).toBe(true);
    expect(canAssignLicenseToAsset("inactive")).toBe(true);
    expect(canAssignLicenseToAsset("disposed")).toBe(false);
    expect(canAssignLicenseToAsset("lost")).toBe(false);
  });
});
