import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
const HOST="first-herring-264.convex.cloud", PREFIX="__SIGESGD_ENTRY_EXIT_DEV__";
function guard(){if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente Convex DEV autorizado.");}
function valid(id:string){if(!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw new Error("Fixture id inválido.");}
function nm(id:string,s:string){return PREFIX+id+"__"+s;}
export const seed=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const users=await ctx.db.query("users").collect();
 const operator=["admin","stock_manager","secretary"].map(role=>users.find(u=>u.role===role&&u.active!==false&&u.isAnonymous!==true)).find(Boolean);
 if(!operator)throw new Error("Operador autorizado DEV não encontrado.");
 const category=await ctx.db.query("categories").withIndex("by_active",q=>q.eq("active",true)).first();
 if(!category)throw new Error("Categoria ativa inexistente.");
 const areaId=await ctx.db.insert("stockAreas",{name:nm(runId,"AREA"),description:"Fixture entrada/saída",active:true});
 const locationId=await ctx.db.insert("storageLocations",{name:nm(runId,"LOCATION"),description:"Fixture descartável",active:true});
 const productId=await ctx.db.insert("products",{name:nm(runId,"PRODUCT"),description:"Fixture teste real mutations DEV",categoryId:category._id,unitOfMeasure:"un",active:true,maximumStock:100,observation:"Fixture temporária"});
 return {runId,operatorId:operator._id,role:operator.role,productId,areaId,locationId};
}});
export const inspect=internalQuery({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",nm(runId,"PRODUCT"))).first();
 if(!product)return {exists:false};
 const entries:any[]=await ctx.db.query("entries").collect().then(rs=>rs.filter(e=>e.observation?.includes(nm(runId,"ENTRY"))));
 const items:any[]=await ctx.db.query("entryItems").collect().then(rs=>rs.filter(i=>entries.some(e=>e._id===i.entryId)));
 const [stock,locations,lots,movements]=await Promise.all([
 ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockByLocation").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("lots").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockMovements").withIndex("by_product",q=>q.eq("productId",product._id)).collect()]);
 const lotBalances:any[]=(await Promise.all(lots.map(l=>ctx.db.query("lotLocationBalances").withIndex("by_lot",q=>q.eq("lotId",l._id)).collect()))).flat();
 const globalQty=stock.reduce((a,x)=>a+x.physicalQuantity,0),localQty=locations.reduce((a,x)=>a+x.quantity,0),lotQty=lots.reduce((a,x)=>a+x.quantityAvailable,0),lotLocalQty=lotBalances.reduce((a,x)=>a+x.quantityAvailable,0);
 return {exists:true,global:globalQty,reserved:stock.reduce((a,x)=>a+x.reservedQuantity,0),local:localQty,lot:lotQty,lotLocal:lotLocalQty,lots,entries,items,movements,
 entryMovementCount:movements.filter(m=>m.type==="entry").length,exitMovementCount:movements.filter(m=>m.type==="exit").length,
 locationId:locations[0]?.locationId,ledgerBalanced:stock.length===1&&locations.length===1&&lots.length===1&&globalQty===localQty&&globalQty===lotQty&&lotQty===lotLocalQty};
}});
export const cleanup=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",nm(runId,"PRODUCT"))).first();
 const area=await ctx.db.query("stockAreas").withIndex("by_name",q=>q.eq("name",nm(runId,"AREA"))).first();
 const location:any=await ctx.db.query("storageLocations").collect().then(rs=>rs.find(x=>x.name===nm(runId,"LOCATION"))??null);
 if(!product){if(location)await ctx.db.delete(location._id);if(area)await ctx.db.delete(area._id);return {fixtureRemaining:false};}
 const entries:any[]=await ctx.db.query("entries").collect().then(rs=>rs.filter(e=>e.observation?.includes(nm(runId,"ENTRY"))));
 const items:any[]=await ctx.db.query("entryItems").collect().then(rs=>rs.filter(i=>entries.some(e=>e._id===i.entryId)));
 const [stocks,locations,lots,movements]=await Promise.all([
 ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockByLocation").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("lots").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockMovements").withIndex("by_product",q=>q.eq("productId",product._id)).collect()]);
 const balances:any[]=(await Promise.all(lots.map(l=>ctx.db.query("lotLocationBalances").withIndex("by_lot",q=>q.eq("lotId",l._id)).collect()))).flat();
 const allocations:any[]=(await Promise.all(movements.map(m=>ctx.db.query("stockMovementLotAllocations").withIndex("by_movement",q=>q.eq("movementId",m._id)).collect()))).flat();
 const ids=new Set([...movements.map(x=>String(x._id)),...entries.map(x=>String(x._id)),...items.map(x=>String(x._id))]);
 const audit:any[]=(await ctx.db.query("auditLogs").collect()).filter(a=>a.entityId&&ids.has(a.entityId));
 for(const a of audit)await ctx.db.delete(a._id);
 for(const a of allocations)await ctx.db.delete(a._id);
 for(const a of balances)await ctx.db.delete(a._id);
 for(const a of movements)await ctx.db.delete(a._id);
 for(const a of items)await ctx.db.delete(a._id);
 for(const a of entries)await ctx.db.delete(a._id);
 for(const a of lots)await ctx.db.delete(a._id);
 for(const a of locations)await ctx.db.delete(a._id);
 for(const a of stocks)await ctx.db.delete(a._id);
 await ctx.db.delete(product._id);if(location)await ctx.db.delete(location._id);if(area)await ctx.db.delete(area._id);
 const remaining=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",nm(runId,"PRODUCT"))).first();
 if(remaining)throw new Error("Fixture ainda existe após limpeza.");
 return {fixtureRemaining:false,deleted:{audit:audit.length,movements:movements.length,lots:lots.length,entries:entries.length,items:items.length}};
}});
