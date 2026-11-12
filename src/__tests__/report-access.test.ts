import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { roleHasPermission } from "@/lib/rbac";

const root = resolve(__dirname, "../..");
const dashboard = readFileSync(resolve(root, "src/convex/dashboard.ts"), "utf8");

function queryBlock(name: string, nextMarker: string): string {
  const start = dashboard.indexOf(`export const ${name} = query({`);
  const end = nextMarker ? dashboard.indexOf(nextMarker, start + 1) : -1;
  return dashboard.slice(start, end < 0 ? undefined : end);
}

describe("segurança e precisão dos relatórios", () => {
  it("queries de relatório exigem reports.view no backend", () => {
    const blocks = [
      queryBlock("stockPosition", "export const movementReport"),
      queryBlock("movementReport", "export const consumptionByOrg"),
      queryBlock("consumptionByOrg", ""),
    ];
    for (const block of blocks) {
      expect(block).toContain('requirePermission(ctx, "reports.view"');
      expect(block).not.toContain("requireUser(ctx)");
    }
  });

  it("filtra as duas extremidades no índice antes do limite de registros", () => {
    const block = queryBlock("movementReport", "export const consumptionByOrg");
    expect(block).toContain('.gte("timestamp", startDate)');
    expect(block).toContain('.lte("timestamp", endDate)');
    expect(block).not.toContain("filtered = movements.filter");
    expect(block).toContain("startDate > endDate");
  });

  it("diretor tem leitura de relatórios, organização, impressoras e GomaQ, sem gerenciamento", () => {
    expect(roleHasPermission("director", "reports.view")).toBe(true);
    expect(roleHasPermission("director", "organizations.view")).toBe(true);
    expect(roleHasPermission("director", "printers.view")).toBe(true);
    expect(roleHasPermission("director", "gomaq.view")).toBe(true);
    expect(roleHasPermission("director", "organizations.manage")).toBe(false);
    expect(roleHasPermission("director", "printers.manage")).toBe(false);
    expect(roleHasPermission("director", "gomaq.manage")).toBe(false);
    expect(roleHasPermission("technician", "reports.view")).toBe(false);
  });
});
