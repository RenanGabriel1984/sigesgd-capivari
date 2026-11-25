import {internalMutation,internalQuery} from "./_generated/server";
import {v} from "convex/values";
const HOST="first-herring-264.convex.cloud",PREFIX="__SIGESGD_INVENTORY_DEV__";
function guard(){if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente Convex DEV autorizado.");}
function valid(id:string){if(!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw new Error("Fixture inválida.");}
function name(id:string,s:string){return PREFIX+id+"__"+s;}
export const seed=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const open=await ctx.db.query("inventories").collect().then(rs=>rs.filter(i=>i.status!=="closed"&&i.status!=="cancelled"));
 if(open.length)throw new Error("Existe inventário ativo no DEV; teste bloqueado para não interferir.");
 const users=await ctx.db.query("users").collect();
 const operator=["admin","stock_manager"].map(role=>users.find(u=>u.role===role&&u.active!==false&&u.isAnonymous!==true)).find(Boolean);
 if(!operator)throw new Error("Operador autorizado de estoque DEV ausente.");
 const category=await ctx.db.query("categories").withIndex("by_active",q=>q.eq("active",true)).first();
 if(!category)throw new Error("Categoria ativa ausente.");
 const areaId=await ctx.db.insert("stockAreas",{name:name(runId,"AREA"),description:"Fixture de inventário DEV",active:true});
 const locationId=await ctx.db.insert("storageLocations",{name:name(runId,"LOCATION"),description:"Fixture de inventário DEV",active:true});
 const productId=await ctx.db.insert("products",{name:name(runId,"PRODUCT"),description:"Produto fixture inventário DEV",categoryId:category._id,unitOfMeasure:"un",active:true,maximumStock:100});
 const now=Date.now();
 const entryId=await ctx.db.insert("entries",{entryNumber:name(runId,"ENTRY"),receivedAt:now,originType:"other",responsibleUserId:operator._id,observation:"Fixture inventory DEV",status:"confirmed",materialType:"consumption",areaId,createdAt:now,updatedAt:now});
 const lotId=await ctx.db.insert("lots",{lotNumber:name(runId,"LOT"),productId,entryId,quantityReceived:10,quantityAvailable:10,receivedAt:now,active:true,materialType:"consumption",areaId});
 await ctx.db.insert("stock",{productId,physicalQuantity:10,reservedQuantity:0});
 await ctx.db.insert("stockByLocation",{productId,locationId,quantity:10});
 await ctx.db.insert("lotLocationBalances",{lotId,productId,locationId,quantityAvailable:10,updatedAt:now});
 return {runId,operatorId:operator._id,productId,areaId,locationId,entryId,lotId,baseline:10};
}});
export const inspect=internalQuery({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 if(!product)return {exists:false};
 const inventories=await ctx.db.query("inventories").collect().then(rs=>rs.filter(i=>i.observation?.includes(name(runId,"INVENTORY"))));
 const counts:any[]=(await Promise.all(inventories.map(i=>ctx.db.query("inventoryCounts").withIndex("by_inventory",q=>q.eq("inventoryId",i._id)).collect()))).flat();
 const [stocks,locations,lots,movements]=await Promise.all([
 ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockByLocation").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("lots").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockMovements").withIndex("by_product",q=>q.eq("productId",product._id)).collect()]);
 const balances:any[]=(await Promise.all(lots.map(l=>ctx.db.query("lotLocationBalances").withIndex("by_lot",q=>q.eq("lotId",l._id)).collect()))).flat();
 const global=stocks.reduce((s,x)=>s+x.physicalQuantity,0),local=locations.reduce((s,x)=>s+x.quantity,0),lot=lots.reduce((s,x)=>s+x.quantityAvailable,0),lotLocal=balances.reduce((s,x)=>s+x.quantityAvailable,0);
 return {exists:true,global,local,lot,lotLocal,balanced:stocks.length===1&&locations.length===1&&lots.length===1&&global===local&&local===lot&&lot===lotLocal,
 inventories,counts,movements};
}});
export const cleanup=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 const inventory=await ctx.db.query("inventories").collect().then(rs=>rs.find(i=>i.observation?.includes(name(runId,"INVENTORY")))??null);
 const counts=inventory?await ctx.db.query("inventoryCounts").withIndex("by_inventory",q=>q.eq("inventoryId",inventory._id)).collect():[];
 const entry=await ctx.db.query("entries").withIndex("by_number",q=>q.eq("entryNumber",name(runId,"ENTRY"))).first();
 const area=await ctx.db.query("stockAreas").withIndex("by_name",q=>q.eq("name",name(runId,"AREA"))).first();
 const location=await ctx.db.query("storageLocations").collect().then(rs=>rs.find(l=>l.name===name(runId,"LOCATION"))??null);
 if(!product){for(const c of counts)await ctx.db.delete(c._id);if(inventory)await ctx.db.delete(inventory._id);if(entry)await ctx.db.delete(entry._id);if(area)await ctx.db.delete(area._id);if(location)await ctx.db.delete(location._id);return {fixtureRemaining:false};}
 const [stocks,locations,lots,movements]=await Promise.all([
 ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockByLocation").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("lots").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockMovements").withIndex("by_product",q=>q.eq("productId",product._id)).collect()]);
 const balances:any[]=(await Promise.all(lots.map(l=>ctx.db.query("lotLocationBalances").withIndex("by_lot",q=>q.eq("lotId",l._id)).collect()))).flat();
 const ids=new Set([...movements.map(m=>String(m._id)),...(inventory?[String(inventory._id)]:[]),...counts.map(c=>String(c._id))]);
 const audit:any[]=(await ctx.db.query("auditLogs").collect()).filter(a=>a.entityId&&ids.has(a.entityId));
 for(const a of audit)await ctx.db.delete(a._id);
 for(const c of counts)await ctx.db.delete(c._id);
 for(const m of movements)await ctx.db.delete(m._id);
 for(const b of balances)await ctx.db.delete(b._id);
 for(const l of lots)await ctx.db.delete(l._id);
 for(const row of locations)await ctx.db.delete(row._id);
 for(const row of stocks)await ctx.db.delete(row._id);
 await ctx.db.delete(product._id);
 if(inventory)await ctx.db.delete(inventory._id);
 if(entry)await ctx.db.delete(entry._id);
 if(area)await ctx.db.delete(area._id);
 if(location)await ctx.db.delete(location._id);
 const remaining=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 if(remaining)throw new Error("Fixture inventário ainda existe.");
 return {fixtureRemaining:false,deleted:{audit:audit.length,counts:counts.length,movements:movements.length,inventory:inventory?1:0}};
}});
