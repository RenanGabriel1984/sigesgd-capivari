import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
const HOST="first-herring-264.convex.cloud", PREFIX="__SIGESGD_GOMAQ_DEV__";
function guard(){if(!(process.env.CONVEX_CLOUD_URL??"").includes(HOST))throw new Error("Somente Convex DEV autorizado.");}
function valid(id:string){if(!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw new Error("Fixture inválida.");}
function name(id:string,s:string){return PREFIX+id+"__"+s;}
export const seed=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const users=await ctx.db.query("users").collect();
 const operator=["admin","stock_manager","secretary"].map(role=>users.find(u=>u.role===role&&u.active!==false&&u.isAnonymous!==true)).find(Boolean);
 if(!operator)throw new Error("Operador DEV autorizado não encontrado.");
 const category=await ctx.db.query("categories").withIndex("by_active",q=>q.eq("active",true)).first();
 if(!category)throw new Error("Categoria ativa ausente.");
 const candidateAreas=await ctx.db.query("stockAreas").collect();
 const canonical=candidateAreas.filter(a=>a.active!==false&&(a.name==="Impressoras"||a.name==="Impressoras/Gomaq"));
 if(canonical.length>1)throw new Error("Ambiguidade: mais de uma área ativa Impressoras/Gomaq.");
 const areaCreated=canonical.length===0;
 const areaId=areaCreated?await ctx.db.insert("stockAreas",{name:"Impressoras/Gomaq",description:"Fixture DEV GomaQ",active:true}):canonical[0]._id;
 const locationId=await ctx.db.insert("storageLocations",{name:name(runId,"LOCATION"),description:"Fixture descartável GomaQ",active:true});
 const productId=await ctx.db.insert("products",{name:name(runId,"PRODUCT"),description:"Fixture DEV GomaQ",categoryId:category._id,unitOfMeasure:"un",active:true,maximumStock:100,brand:"Fixture",model:"TEST"});
 const printerId=await ctx.db.insert("printers",{name:name(runId,"PRINTER"),brand:"Fixture",model:"TEST-PRINTER",active:true,observation:"Fixture DEV descartável"});
 const compatibilityId=await ctx.db.insert("printerCompatibility",{productId,printerModel:"TEST-PRINTER",estimatedYield:1000});
 const lotId=await ctx.db.insert("lots",{lotNumber:name(runId,"LOT"),productId,entryId:undefined as any,quantityReceived:10,quantityAvailable:10,receivedAt:Date.now(),active:true,materialType:"consumption",areaId});
 await ctx.db.insert("stock",{productId,physicalQuantity:10,reservedQuantity:0});
 await ctx.db.insert("stockByLocation",{productId,locationId,quantity:10});
 await ctx.db.insert("lotLocationBalances",{lotId,productId,locationId,quantityAvailable:10,updatedAt:Date.now()});
 return {runId,operatorId:operator._id,role:operator.role,productId,printerId,compatibilityId,areaId,areaCreated,locationId,lotId,baseline:10};
}});
export const inspect=internalQuery({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 if(!product)return {exists:false};
 const [stock,locations,lots,movements,exchanges,cartridges,collections,compatibility]=await Promise.all([
 ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockByLocation").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("lots").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockMovements").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("gomaQExchanges").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("gomaQEmptyCartridges").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("gomaQCollections").collect().then(rs=>rs.filter(c=>c.observation?.includes(name(runId,"COLLECTION")))),
 ctx.db.query("printerCompatibility").withIndex("by_product",q=>q.eq("productId",product._id)).collect()]);
 const balances:any[]=(await Promise.all(lots.map(l=>ctx.db.query("lotLocationBalances").withIndex("by_lot",q=>q.eq("lotId",l._id)).collect()))).flat();
 const global=stock.reduce((s,x)=>s+x.physicalQuantity,0),local=locations.reduce((s,x)=>s+x.quantity,0),lot=lots.reduce((s,x)=>s+x.quantityAvailable,0),lotLocal=balances.reduce((s,x)=>s+x.quantityAvailable,0);
 return {exists:true,global,local,lot,lotLocal,ledgerBalanced:stock.length===1&&locations.length===1&&lots.length===1&&global===local&&local===lot&&lot===lotLocal,
 movements,exchanges,cartridges,collections,compatibility,awaiting:cartridges.filter(c=>c.status==="awaiting_collection").reduce((s,c)=>s+c.quantity,0),collected:cartridges.filter(c=>c.status==="collected").reduce((s,c)=>s+c.quantity,0)};
}});
export const cleanup=internalMutation({args:{runId:v.string()},handler:async(ctx,{runId})=>{
 guard();valid(runId);
 const product=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 const printer=await ctx.db.query("printers").collect().then(rs=>rs.find(p=>p.name===name(runId,"PRINTER"))??null);
 const location=await ctx.db.query("storageLocations").collect().then(rs=>rs.find(l=>l.name===name(runId,"LOCATION"))??null);
 const fixtureArea=await ctx.db.query("stockAreas").collect().then(rs=>rs.find(a=>a.name==="Impressoras/Gomaq"&&a.description==="Fixture DEV GomaQ")??null);
 if(!product){if(printer)await ctx.db.delete(printer._id);if(location)await ctx.db.delete(location._id);if(fixtureArea)await ctx.db.delete(fixtureArea._id);return {fixtureRemaining:false};}
 const [stocks,locations,lots,movements,exchanges,cartridges,compatibilities]=await Promise.all([
 ctx.db.query("stock").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockByLocation").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("lots").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("stockMovements").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("gomaQExchanges").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("gomaQEmptyCartridges").withIndex("by_product",q=>q.eq("productId",product._id)).collect(),
 ctx.db.query("printerCompatibility").withIndex("by_product",q=>q.eq("productId",product._id)).collect()]);
 const collections=await ctx.db.query("gomaQCollections").collect().then(rs=>rs.filter(c=>c.observation?.includes(name(runId,"COLLECTION"))));
 const balances:any[]=(await Promise.all(lots.map(l=>ctx.db.query("lotLocationBalances").withIndex("by_lot",q=>q.eq("lotId",l._id)).collect()))).flat();
 const allocations:any[]=(await Promise.all(movements.map(m=>ctx.db.query("stockMovementLotAllocations").withIndex("by_movement",q=>q.eq("movementId",m._id)).collect()))).flat();
 const entityIds=new Set([...exchanges.map(x=>String(x._id)),...collections.map(x=>String(x._id)),...movements.map(x=>String(x._id)),...cartridges.map(x=>String(x._id))]);
 const audit:any[]=(await ctx.db.query("auditLogs").collect()).filter(a=>a.entityId&&entityIds.has(a.entityId));
 for(const a of audit)await ctx.db.delete(a._id);
 for(const a of allocations)await ctx.db.delete(a._id);
 for(const c of collections)await ctx.db.delete(c._id);
 for(const c of cartridges)await ctx.db.delete(c._id);
 for(const e of exchanges)await ctx.db.delete(e._id);
 for(const m of movements)await ctx.db.delete(m._id);
 for(const b of balances)await ctx.db.delete(b._id);
 for(const l of lots)await ctx.db.delete(l._id);
 for(const s of locations)await ctx.db.delete(s._id);
 for(const s of stocks)await ctx.db.delete(s._id);
 for(const c of compatibilities)await ctx.db.delete(c._id);
 await ctx.db.delete(product._id);
 if(printer)await ctx.db.delete(printer._id);
 if(location)await ctx.db.delete(location._id);
 if(fixtureArea)await ctx.db.delete(fixtureArea._id);
 const remaining=await ctx.db.query("products").withIndex("by_name",q=>q.eq("name",name(runId,"PRODUCT"))).first();
 if(remaining)throw new Error("Fixture GomaQ ainda existe.");
 return {fixtureRemaining:false,deleted:{audit:audit.length,exchange:exchanges.length,cartridges:cartridges.length,collections:collections.length,movements:movements.length,compatibilities:compatibilities.length}};
}});
