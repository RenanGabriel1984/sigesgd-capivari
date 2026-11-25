import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

const gomaQ = read("convex/gomaQ.ts");
const printSupplies = read("convex/printSupplies.ts");
const inventory = read("convex/inventory.ts");
const stockSetup = read("convex/stockSetup.ts");
const requests = read("convex/requests.ts");
const reports = read("pages/Reports.tsx");
const stockPage = read("pages/Stock.tsx");
const inventoryPage = read("pages/Inventory.tsx");
const gomaQPage = read("pages/GomaQ.tsx");

function section(source: string, start: string, end: string) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  return source.slice(begin, finish < 0 ? undefined : finish);
}

describe("etapa 4 — Gomaq, suprimentos, inventário e relatórios", () => {
  it("troca Gomaq valida os quatro níveis, reserva e armário antes de gravar", () => {
    const create = section(gomaQ, "export const createExchange = mutation({", "export const createCollection = mutation({");
    expect(create).toContain("assertProductLedgerConsistent");
    expect(create).toContain("assertProductReservationConsistent");
    expect(create).toContain('area.name === "Impressoras" || area.name === "Impressoras/Gomaq"');
    expect(create).toContain("areaId: printerAreaId");
    expect(create).toContain("exatamente uma área ativa");
    expect(create).toContain("resolveWithdrawalLocation");
    expect(create).toContain("consumeLotLocationStock");
    expect(create).toContain("recordLotMovementAllocations");
    expect(create).toContain("locationId: sourceLocationId");
    expect(create).toContain("locationId: sourceLocationId");
    expect(create).toContain("gomaQExchanges");
  });

  it("coleta GomaQ rejeita IDs de carcaça duplicados antes de alterar registros", () => {
    const collection = section(gomaQ, "export const createCollection = mutation({", "export const exportMonthlyOrder = mutation({");
    expect(collection).toContain("new Set(args.cartridgeIds).size !== args.cartridgeIds.length");
    expect(collection).toContain("A mesma carcaça não pode ser incluída mais de uma vez");
    expect(collection.indexOf("new Set(args.cartridgeIds)")).toBeLessThan(collection.indexOf('ctx.db.patch(cartridgeId'));
  });

  it("retirada simples e por família de suprimentos registram lotes e armários", () => {
    const simple = section(printSupplies, "export const withdraw = mutation({", "export const configurePackaging = mutation({");
    const family = section(printSupplies, "export const withdrawFamily = mutation({", "export const previewFamilyWithdrawal = query({");
    expect(simple).toContain("assertProductLedgerConsistent");
    expect(simple).toContain("consumeLotLocationStock");
    expect(simple).toContain("recordLotMovementAllocations");
    expect(simple).toContain("PRINT_AREA_ID");
    expect(family).toContain("assertProductLedgerConsistent");
    expect(family).toContain("originLotId: sourceLot._id");
    expect(family).toContain('ctx.db.insert("lotLocationBalances"');
    expect(family).toContain('allocationType: "reclassification"');
    expect(family).toContain("recordLotMovementAllocations");
    expect(family).toContain("Equivalência preservada em unidade-base");
  });

  it("inventário abre contagem física por lote e armário, sem inventar lotes", () => {
    const create = section(inventory, "export const create = mutation({", "export const list = query({");
    expect(create).toContain("activeLocations");
    expect(create).toContain("lotLocationBalances");
    expect(create).toContain("lotId");
    expect(create).toContain("locationId");
    expect(create).toContain("inventoryCounts");
    expect(create).toContain("trackedLots");
  });

  it("fechamento de inventário protege linhas novas e reconcilia lotes e armários", () => {
    const close = inventory.slice(inventory.indexOf("export const close = mutation({"));
    expect(close).toContain("currentPositiveLotBalances");
    expect(close).toContain("não foi contado");
    expect(close).toContain("lotLocationBalances");
    expect(close).toContain("stockByLocation");
    expect(close).toContain("physicalQuantity");
    expect(close).toContain("Justificativa");
    expect(close).toContain("close_inventory");
    expect(close).toContain("areaId: change.areaId");
  });

  it("visão dimensional é somente leitura e não classifica saldos legados por suposição", () => {
    const overview = stockSetup.slice(stockSetup.indexOf("export const stockDimensionOverview = query({"));
    expect(overview).toContain("await requireUser(ctx)");
    expect(overview).toContain('ctx.db.query("lotLocationBalances")');
    expect(overview).toContain('ctx.db.query("stockByLocation")');
    expect(overview).toContain("globalVsLocationDifference");
    expect(overview).toContain("globalVsLotsDifference");
    expect(overview).toContain("untrackedLocations");
    expect(overview).toContain("readOnly: true");
    expect(overview).toContain("global.length > 1");
    expect(overview).toContain("row.reservedQuantity > row.physicalQuantity");
    expect(overview).toContain("!Number.isFinite(row.quantity) || row.quantity < 0");
    expect(overview).toContain("row.invalidBalanceCount > 0 || row.untrackedLocations.length > 0");
    expect(overview).toContain("Math.abs(lotQuantity - locatedQuantity)");
    expect(overview).toContain("!productLots.some((lot) => String(lot._id) === String(balance.lotId))");
    expect(overview).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
  });

  it("relatórios e telas usam a visão por área, armário e lote", () => {
    expect(reports).toContain("api.stockSetup.stockDimensionOverview");
    expect(reports).toContain("api.requests.listForReport");
    expect(reports).toContain("exportLotLocationCSV");
    expect(reports).toContain('lotNumber: "Inconsistência de saldo"');
    expect(reports).toContain("diagnosticCount: product.invalidBalanceCount");
    expect(reports).toContain("Alertas de integridade");
    expect(reports).toContain("dimensionAreaFilter");
    expect(reports).toContain("dimensionLocationFilter");
    expect(stockPage).toContain("api.stockSetup.stockDimensionOverview");
    expect(inventoryPage).toContain("countLocation");
    expect(inventoryPage).toContain("lot");
    expect(gomaQPage).toContain("locationId");
  });

  it("consulta de requisições para relatório mantém escopo conforme perfil autenticado", () => {
    const reportQuery = section(requests, "export const listForReport = query({", "export const listByUser = query({");
    expect(reportQuery).toContain("await requireUser(ctx)");
    expect(reportQuery).toContain("hasFullVisibility(role)");
    expect(reportQuery).toContain("requesterId");
    expect(reportQuery).toContain("enrichRequest(ctx, request)");
  });
});
