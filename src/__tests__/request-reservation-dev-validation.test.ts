import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const source=(path:string)=>readFileSync(resolve(__dirname,"..",path),"utf8");
describe("requests reservation DEV fixture",()=>{
 it("uses isolated DEV guard and fixture identifiers",()=>{const module=source("convex/requestDevTests.ts");expect(module).toContain("first-herring-264.convex.cloud");expect(module).toContain("__SIGESGD_REQUEST_DEV__");});
 it("tests excess approval, approved reservation and cancellation",()=>{const runner=source("../scripts/convex-dev-request-reservation-validation.mjs");expect(runner).toContain("requests:create");expect(runner).toContain("requests:approve");expect(runner).toContain("requests:cancel");expect(runner).toContain("finally");expect(runner).toContain("reserved===4");});
 it("cleanup removes fixture requests, items, stock, lots and audit",()=>{const module=source("convex/requestDevTests.ts");const cleanup=module.slice(module.indexOf("export const cleanup"));for(const table of ["requests","requestItems","auditLogs","lotLocationBalances","lots","stockByLocation","stock","products","entries","stockAreas","storageLocations","organizations"])expect(cleanup).toContain(table);});
});
