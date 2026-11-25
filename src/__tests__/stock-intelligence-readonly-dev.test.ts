import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const source=(path:string)=>readFileSync(resolve(__dirname,"..",path),"utf8");
describe("stock intelligence read-only DEV runner",()=>{
 it("identity helper is DEV-only and read-only",()=>{const module=source("convex/stockIntelligenceDevTests.ts");expect(module).toContain("first-herring-264.convex.cloud");expect(module).toContain("internalQuery");expect(module).not.toContain("internalMutation");});
 it("executes replenishment, consumption and organization reports",()=>{const runner=source("../scripts/convex-dev-stock-intelligence-readonly.mjs");expect(runner).toContain("stockIntelligence:replenishment");expect(runner).toContain("stockIntelligence:consumption");expect(runner).toContain("stockIntelligence:consumptionByOrganization");expect(runner).toContain("readOnly:true");expect(runner).toContain("ledgerBefore");expect(runner).toContain("ledgerAfter");});
});
