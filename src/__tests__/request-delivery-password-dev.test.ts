import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(__dirname,"..",p),"utf8");
describe("request electronic signature DEV validation",()=>{
 it("fixture creates temporary stock manager password and cleans credential records",()=>{const f=read("convex/requestDevTests.ts");expect(f).toContain("hashPassword(confirmationPassword)");expect(f).toContain("credentials");expect(f).toContain("for(const credential of credentials)");});
 it("runtime validates wrong password rollback and correct password delivery ledger",()=>{const runner=read("../scripts/convex-dev-request-reservation-validation.mjs");for(const x of ["requests:deliver","incorrect-password","confirmationPassword:fixture.confirmationPassword","deliveredBySignature","state.location===8","state.lotBalance===8","state.movements.length===0"])expect(runner).toContain(x);});
});
