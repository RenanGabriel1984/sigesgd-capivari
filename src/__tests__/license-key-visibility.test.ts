import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { maskLicenseKey } from "@/lib/license-keys";

const ROOT = resolve(__dirname, "../..");
const assetsBackend = readFileSync(resolve(ROOT, "src/convex/assets.ts"), "utf-8");
const licensesBackend = readFileSync(resolve(ROOT, "src/convex/licenses.ts"), "utf-8");

describe("segurança das chaves de licença", () => {
  it("mascara a chave preservando somente os quatro últimos caracteres", () => {
    expect(maskLicenseKey("AAAA-BBBB-CCCC-DDDD")).toBe("***************DDDD");
    expect(maskLicenseKey("12345678")).toBe("****");
    expect(maskLicenseKey("")).toBe("****");
  });

  it("detalhes do equipamento nunca devolvem chave completa a não-admin", () => {
    const start = assetsBackend.indexOf("export const get = query");
    const end = assetsBackend.indexOf("// ═══", start + 1);
    const block = assetsBackend.slice(start, end < 0 ? undefined : end);

    expect(block).toContain('const { userId, role } = await requireUser(ctx)');
    expect(block).toContain('const isAdmin = role === "admin"');
    expect(block).toContain("key: license.key ? (isAdmin ? license.key : maskLicenseKey(license.key)) : undefined");
  });

  it("consultas de licenças e detalhes de ativos usam o mesmo mascaramento", () => {
    expect(licensesBackend).toContain('import { maskLicenseKey } from "../lib/license-keys"');
    expect(licensesBackend).toContain("maskLicenseKey(l.key)");
    expect(licensesBackend).toContain("maskLicenseKey(license.key)");
    expect(assetsBackend).toContain('import { maskLicenseKey } from "../lib/license-keys"');
  });
});
