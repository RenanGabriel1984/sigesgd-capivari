import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(__dirname,"..",p),"utf8");
describe("replenishment parameter read-only DEV audit",()=>{
 it("calls stock parameter listing and snapshots ledger without writes",()=>{const runner=read("../scripts/convex-dev-replenishment-parameter-audit.mjs");for(const x of ["stockParameters:list","stockSetup:lotLocationMigrationReadinessInternal","readOnly:true","ledgerBefore","ledgerAfter","minimumMissing","idealMissing"])expect(runner).toContain(x);expect(runner).not.toContain("stockParameters:updateMany");});
});
