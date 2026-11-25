import {internalMutation,internalQuery} from "./_generated/server";
import {v} from "convex/values";
const HOST="first-herring-264.convex.cloud",PREFIX="__SIGESGD_REQUEST_DEV__";
function guard(){if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente Convex DEV autorizado.");}
function valid(id:string){if(!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw new Error("Fixture inválida.");}
function name(id:string,s:string){return PREFIX+id+"__"+s;}
export const seed=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const now=Date.now();
 const requesterId=await ctx.db.insert("users",{name:name(runId,"REQUESTER"),email:name(runId,"requester")+"@fixture.invalid",role:"technician",active:true,createdAt:now,updatedAt:now});
 const approverId=await ctx.db.insert("users",{name:name(runId,"APPROVER"),email:name(runId,"approver")+"@fixture.invalid",role:"stock_manager",active:true,createdAt:now,updatedAt:now});
 const category=await ctx.db.query("categories").withIndex("by_active",q=>q.eq("active",true)).first();
 if(!category)throw new Error("Categoria ativa ausente.");
 const areaId=await ctx.db.insert("stockAreas",{name:name(runId,"AREA"),description:"Fixture request DEV",active:true});
 const locationId=await ctx.db.insert("storageLocations",{name:name(runId,"LOCATION"),description:"Fixture request DEV",active:true});
 const secretariaId=await ctx.db.insert("organizations",{name:name(runId,"SECRETARIA"),type:"secretaria",active:true});
 const productId=await ctx.db.insert("products",{name:name(runId,"PRODUCT"),description:"Fixture request DEV",categoryId:category._id,unitOfMeasure:"un",active:true,maximumStock:100});
 const entryId=await ctx.db.insert("entries",{entryNumber:name(runId,"ENTRY"),receivedAt:now,originType:"other",responsibleUserId:approverId,observation:"Fixture request DEV",status:"confirmed",materialType:"consumption",areaId,createdAt:now,updatedAt:now});
 const lotId=await ctx.db.insert("lots",{lotNumber:name(runId,"LOT"),productId,entryId,quantityReceived:10,quantityAvailable:10,receivedAt:now,active:true,materialType:"consumption",areaId});
 await ctx.db.insert("stock",{productId,physicalQuantity:10,reservedQuantity:0});
 await ctx.db.insert("stockByLocation",{productId,locationId,quantity:10});
 await ctx.db.insert("lotLocationBalances",{lotId,productId,locationId,quantityAvailable:10,updatedAt:now});
 return {runId,requesterId,approverId,secretariaId,productId,areaId,locationId,entryId,lotId,baseline:10};
}});
export const inspect=internalQuery({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 if(!product)return {exists:false};
 const requests=await ctx.db.query("requests").collect().then(rs=>rs.filter(r=>r.reason?.includes(name(runId,"REASON"))));
 const items:any[]=(await Promise.all(requests.map(r=>ctx.db.query("requestItems").withIndex("by_request",q=>q.eq("requestId",r._id)).collect()))).flat();
 const stock=await ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect();
 return {exists:true,global:stock.reduce((s,x)=>s+x.physicalQuantity,0),reserved:stock.reduce((s,x)=>s+x.reservedQuantity,0),requests,items};
}});
export const cleanup=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 const requests=await ctx.db.query("requests").collect().then(rs=>rs.filter(r=>r.reason?.includes(name(runId,"REASON"))));
 const items:any[]=(await Promise.all(requests.map(r=>ctx.db.query("requestItems").withIndex("by_request",q=>q.eq("requestId",r._id)).collect()))).flat();
 const requester=await ctx.db.query("users").collect().then(rs=>rs.find(u=>u.email===name(runId,"requester")+"@fixture.invalid")??null);\n const approver=await ctx.db.query("users").collect().then(rs=>rs.find(u=>u.email===name(runId,"approver")+"@fixture.invalid")??null);\n const org=await ctx.db.query("organizations").collect().then(rs=>rs.find(o=>o.name===name(runId,"SECRETARIA"))??null);
 const entry=await ctx.db.query("entries").withIndex("by_number",q=>q.eq("entryNumber",name(runId,"ENTRY"))).first();
 const area=await ctx.db.query("stockAreas").withIndex("by_name",q=>q.eq("name",name(runId,"AREA"))).first();
 const location=await ctx.db.query("storageLocations").collect().then(rs=>rs.find(l=>l.name===name(runId,"LOCATION"))??null);
 if(!product){for(const i of items)await ctx.db.delete(i._id);for(const r of requests)await ctx.db.delete(r._id);if(requester)await ctx.db.delete(requester._id);if(approver)await ctx.db.delete(approver._id);if(org)await ctx.db.delete(org._id);if(entry)await ctx.db.delete(entry._id);if(area)await ctx.db.delete(area._id);if(location)await ctx.db.delete(location._id);return {fixtureRemaining:false};}
 const [stocks,locations,lots]=await Promise.all([
 ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockByLocation").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("lots").withIndex("by_product",q=>q.eq("productId",product._id)).collect()]);
 const balances:any[]=(await Promise.all(lots.map(l=>ctx.db.query("lotLocationBalances").withIndex("by_lot",q=>q.eq("lotId",l._id)).collect()))).flat();
 const ids=new Set([...requests.map(r=>String(r._id)),...items.map(i=>String(i._id))]);
 const audit:any[]=(await ctx.db.query("auditLogs").collect()).filter(a=>a.entityId&&ids.has(a.entityId));
 for(const a of audit)await ctx.db.delete(a._id);
 for(const i of items)await ctx.db.delete(i._id);
 for(const r of requests)await ctx.db.delete(r._id);
 for(const b of balances)await ctx.db.delete(b._id);
 for(const l of lots)await ctx.db.delete(l._id);
 for(const row of locations)await ctx.db.delete(row._id);
 for(const row of stocks)await ctx.db.delete(row._id);
 await ctx.db.delete(product._id);
 if(entry)await ctx.db.delete(entry._id);
 if(org)await ctx.db.delete(org._id);
 if(area)await ctx.db.delete(area._id);
 if(location)await ctx.db.delete(location._id);
 const remaining=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 if(remaining)throw new Error("Fixture request ainda existe.");
 return {fixtureRemaining:false,deleted:{audit:audit.length,requests:requests.length,items:items.length,users:2}};
}});
