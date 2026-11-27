import {internalMutation,internalQuery} from "./_generated/server";
import {v} from "convex/values";
import {hashPassword,verifyPassword} from "./auth/passwords";
const HOST="first-herring-264.convex.cloud",PREFIX="__SIGESGD_AUTH_DEV__";
const email=(run:string,suffix="user")=>`${PREFIX}${run}-${suffix}@fixture.invalid`;
export const seed=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente DEV first-herring-264.");
 if(!/^[a-zA-Z0-9-]{1,60}$/.test(runId))throw new Error("runId inválido.");
 const now=Date.now(),pass="Synthetic-Test-Password-938!",{hash,salt}=await hashPassword(pass);
 const userId=await ctx.db.insert("users",{name:PREFIX+runId,email:email(runId),role:"admin",active:true,createdAt:now,updatedAt:now});
 await ctx.db.insert("passwords",{userId,passwordHash:hash,salt,requiresReset:false});
 return {email:email(runId),password:pass,userId};
}});
export const cleanup=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente DEV first-herring-264.");
 const targets=await ctx.db.query("users").collect().then(rs=>rs.filter(u=>typeof u.email==="string"&&u.email.startsWith(PREFIX+runId+"-")));
 let deletedPasswords=0,deletedAttempts=0;
 for(const u of targets){const ps=await ctx.db.query("passwords").withIndex("by_user",q=>q.eq("userId",u._id)).collect();for(const p of ps){await ctx.db.delete(p._id);deletedPasswords++;}const fr=await ctx.db.query("failedLoginAttempts").withIndex("by_email",q=>q.eq("email",u.email!)).first();if(fr){await ctx.db.delete(fr._id);deletedAttempts++;}await ctx.db.delete(u._id);}
 return {users:targets.length,passwords:deletedPasswords,failedAttempts:deletedAttempts,remaining:await ctx.db.query("users").collect().then(rs=>rs.filter(u=>typeof u.email==="string"&&u.email.startsWith(PREFIX+runId+"-")).length)};
}});

export const inspect=internalQuery({args:{runId:v.string(),password:v.string()},handler:async(ctx,{runId,password})=>{
 if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente DEV.");
 const matches=await ctx.db.query("users").collect().then(rs=>rs.filter(u=>u.email===email(runId)));
 const pw=matches.length===1?await ctx.db.query("passwords").withIndex("by_user",q=>q.eq("userId",matches[0]._id)).collect():[];
 return {users:matches.length,active:matches[0]?.active,role:matches[0]?.role,passwordRecords:pw.length,hashMatches:pw.length===1?await verifyPassword(password,pw[0].passwordHash,pw[0].salt):false};
}});

export const addDuplicate=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente DEV first-herring-264.");
 const now=Date.now();
 return await ctx.db.insert("users",{name:PREFIX+runId+"-DUP",email:email(runId),role:"technician",active:true,createdAt:now,updatedAt:now});
}});
