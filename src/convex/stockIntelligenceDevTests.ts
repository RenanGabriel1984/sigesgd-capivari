import {internalQuery} from "./_generated/server";
import {v} from "convex/values";
const HOST="first-herring-264.convex.cloud";
export const identity=internalQuery({args:{},handler:async(ctx)=>{
 if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente DEV autorizado.");
 const users=await ctx.db.query("users").collect();
 const admin=users.find(u=>u.role==="admin"&&u.active!==false&&u.isAnonymous!==true);
 if(!admin)throw new Error("Administrador ativo DEV não encontrado.");
 return {userId:admin._id};
}});
