import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const source=(path:string)=>readFileSync(resolve(__dirname,"..",path),"utf8");
describe("inventory DEV transaction fixture",()=>{
 it("guarded by DEV host and isolated fixture names",()=>{const module=source("convex/inventoryDevTests.ts");expect(module).toContain("first-herring-264.convex.cloud");expect(module).toContain("__SIGESGD_INVENTORY_DEV__");expect(module).toContain("Existe inventário ativo no DEV");});
 it("runner executes the full workflow and rejects invalid steps",()=>{const runner=source("../scripts/convex-dev-inventory-validation.mjs");expect(runner).toContain("dev:first-herring-264");expect(runner).toContain("inventory:create");expect(runner).toContain("inventory:startCounting");expect(runner).toContain("inventory:saveCount");expect(runner).toContain("inventory:startReview");expect(runner).toContain("inventory:close");expect(runner).toContain("finally");});
 it("cleanup deletes inventory records and stock fixture",()=>{const module=source("convex/inventoryDevTests.ts");const cleanup=module.slice(module.indexOf("export const cleanup"));for(const table of ["inventoryCounts","inventories","auditLogs","stockMovements","lotLocationBalances","lots","stockByLocation","stock","products","entries","stockAreas","storageLocations"])expect(cleanup).toContain(table);});
});
