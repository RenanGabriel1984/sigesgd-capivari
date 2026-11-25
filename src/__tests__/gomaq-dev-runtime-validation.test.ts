import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const source=(path:string)=>readFileSync(resolve(__dirname,"..",path),"utf8");
describe("GomaQ transaction fixture DEV",()=>{
 it("only permits the isolated first-herring deployment and names fixture records",()=>{
  const module=source("convex/gomaQDevTests.ts");
  expect(module).toContain("first-herring-264.convex.cloud");
  expect(module).toContain("__SIGESGD_GOMAQ_DEV__");
  expect(module).toContain("Fixture GomaQ DEV");
 });
 it("runner requires a dev key, checks actual ledger, and cleans up in finally",()=>{
  const runner=source("../scripts/convex-dev-gomaq-validation.mjs");
  expect(runner).toContain("dev:first-herring-264");
  expect(runner).toContain("CONVEX_DEPLOYMENT");
  expect(runner).toContain("finally");
  expect(runner).toContain("gomaQDevTests:cleanup");
  expect(runner).toContain("gomaQ:createExchange");
  expect(runner).toContain("gomaQ:createCollection");
 });
 it("cleanup removes exchange, cartridge, collection, stock, lot and fixture links",()=>{
  const module=source("convex/gomaQDevTests.ts");
  const cleanup=module.slice(module.indexOf("export const cleanup"));
  for(const table of ["gomaQExchanges","gomaQEmptyCartridges","gomaQCollections","stockMovementLotAllocations","stockMovements","lotLocationBalances","lots","stockByLocation","stock","printerCompatibility","products","printers","storageLocations","stockAreas","entries","auditLogs"])expect(cleanup).toContain(table);
 });
});
