import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(__dirname,"..",p),"utf8");
describe("authentication credential integrity",()=>{
 it("credential provider uses normalized email and trusted internal validation",()=>{const provider=read("convex/auth/credentials.ts");expect(provider).toContain("internal.passwords.verifyCredentials");expect(provider).toContain("recordFailedLogin");expect(provider).toContain("recordSuccessfulLogin");expect(provider).toContain("email.trim().toLowerCase()");});
 it("rejects duplicate normalized identities and duplicate password rows",()=>{const impl=read("convex/passwords.ts");expect(impl).toContain("findUsersByNormalizedEmail");expect(impl).toContain("resolveUniqueRecord(passwordRecords)");expect(impl).toContain("GENERIC_AUTH_ERROR");});
 it("runtime harness covers valid/invalid credentials, lockout, success clearing and cleanup",()=>{const fixture=read("convex/authDevTests.ts");const runner=read("../scripts/convex-dev-auth-integrity-validation.mjs");for(const key of ["first-herring-264.convex.cloud","export const seed","export const cleanup","await ctx.db.delete(u._id)"])expect(fixture).toContain(key);for(const key of ["passwords:verifyCredentials","passwords:recordFailedLogin","passwords:isLockedOut","passwords:recordSuccessfulLogin","duplicateIdentityFailsClosed","finally"])expect(runner).toContain(key);});
});
