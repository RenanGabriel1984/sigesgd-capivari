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

  it("posição detalhada usa saldo por produto × área × local e exibe reservas separadamente", () => {
    const block = queryBlock("stockPositionByArea", "export const movementReport");
    const page = readFileSync(resolve(root, "src/pages/Reports.tsx"), "utf8");
    expect(block).toContain('requirePermission(ctx, "reports.view"');
    expect(block).toContain('ctx.db.query("stockByLocation").collect()');
    expect(block).toContain('ctx.db.query("requestItemReservations").collect()');
    expect(block).toContain("reservation.quantityRemaining");
    expect(block).toContain('"Sem área (legado)"');
    expect(block).toContain("duplicateRows");
    expect(block).toContain("inconsistent:");
    expect(page).toContain("api.dashboard.stockPositionByArea");
    expect(page).toContain("Posição por área e local físico");
    expect(page).toContain("CSV detalhado");
  });

  it("filtra as duas extremidades no índice antes do limite de registros", () => {
    const block = queryBlock("movementReport", "export const consumptionByOrg");
    expect(block).toContain('.gte("timestamp", startDate)');
    expect(block).toContain('.lte("timestamp", endDate)');
    expect(block).not.toContain("filtered = movements.filter");
    expect(block).toContain("startDate > endDate");
    expect(block).toContain(".take(501)");
  });

  it("inclui o último milissegundo do dia e avisa quando o relatório excede 500 linhas", () => {
    const page = readFileSync(resolve(root, "src/pages/Reports.tsx"), "utf8");
    expect(page).toContain('new Date(movEndDate + "T23:59:59.999").getTime()');
    expect(page).toContain("movements?.slice(0, 500)");
    expect(page).toContain("movementReportTruncated");
    expect(page).toContain("A tela e o CSV mostram somente as 500 mais recentes");
    expect(page).toContain('new Date(reqEndDate + "T23:59:59.999").getTime()');
    expect(page).toContain("usePaginatedQuery(api.requests.listPaginated, {}, { initialNumItems: 50 })");
    expect(page).toContain('const requestReportComplete = requestReportStatus === "Exhausted"');
    expect(page).toContain("disabled={!requestReportComplete || filteredRequests.length === 0}");
    expect(page).toContain("CSV integral");
    expect(page).toContain("Carregar mais 50");
    expect(page).not.toContain("requestReportMayBeTruncated");
    expect(page).not.toContain("somente as 200 solicitações mais recentes");
  });

  it("relatório de movimentações identifica a área e o local físico de cada movimento", () => {
    const block = queryBlock("movementReport", "export const consumptionByOrg");
    const page = readFileSync(resolve(root, "src/pages/Reports.tsx"), "utf8");
    expect(block).toContain("ctx.db.get(m.areaId)");
    expect(block).toContain("ctx.db.get(m.locationId)");
    expect(block).toContain("areaName: area?.name");
    expect(block).toContain("locationName: location?.name");
    expect(page).toContain('"Área", "Local físico"');
    expect(page).toContain("{m.areaName}");
    expect(page).toContain("{m.locationName}");
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
