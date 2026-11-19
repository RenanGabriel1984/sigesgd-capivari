import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("busca de equipamentos", () => {
  const page = readFileSync(resolve(__dirname, "../pages/Assets.tsx"), "utf8");
  const backend = readFileSync(resolve(__dirname, "../convex/assets.ts"), "utf8");

  it("preserva resultados encontrados pelo hostname no filtro da interface", () => {
    expect(backend).toContain("asset.hostname");
    expect(backend).toContain("asset.macAddress");
    expect(page).toContain("a.hostname?.toLowerCase().includes(filters.search.toLowerCase())");
    expect(page).toContain("a.macAddress?.toLowerCase().includes(filters.search.toLowerCase())");
    expect(page).toContain('placeholder="Buscar por patrimônio, série, hostname, MAC, marca..."');
  });
});
