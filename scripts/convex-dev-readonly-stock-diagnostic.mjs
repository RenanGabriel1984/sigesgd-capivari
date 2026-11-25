import {spawnSync} from "node:child_process";
const deployment="first-herring-264",host="first-herring-264.convex.cloud",key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${deployment}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino DEV inválido.");
function run(args){const r=spawnSync("bunx",["convex","run",...args],{encoding:"utf8",env:process.env,maxBuffer:10e6});if(r.status!==0)throw Error(r.stderr||r.stdout);const out=r.stdout.trim();try{return JSON.parse(out)}catch{for(const line of out.split("\n").reverse()){try{return JSON.parse(line)}catch{}}throw Error("JSON inválido da consulta read-only")}}
const result=run(["stockSetup:lotLocationMigrationReadinessInternal"]);
const report=result.report??{};
const products=report.products??[];
if(result.readOnly!==true||result.migrationApplied!==false||report.readOnly!==true||report.migrationApplied!==false||result.plan?.safeToApply!==false)throw Error("Marcadores read-only não confirmados.");
if(!products.length)throw Error("Consulta retornou zero produtos: diagnóstico inválido.");
const totals=products.reduce((a,p)=>({global:a.global+(p.globalPhysical??0),local:a.local+(p.localPhysicalTotal??0),lot:a.lot+(p.lotsAvailableTotal??0),reserved:a.reserved+(p.globalReserved??0)}),{global:0,local:0,lot:0,reserved:0});
const statuses={mapped:0,candidate:0,divergent:0,ambiguous:0,unmapped:0};let positiveLots=0;
for(const p of products)for(const lot of p.lots??[]){if(lot.quantityAvailable>0)positiveLots++;if(Object.hasOwn(statuses,lot.status))statuses[lot.status]++;}
const locations=report.locations??[];
const summary={deployment,host,readOnly:true,migrationApplied:false,safeToApply:false,products:products.length,positiveLots,statuses,totals,locations:locations.map(l=>({name:l.name,active:l.active})),proposedLots:result.plan?.insertions?.length??0,proposedQuantity:result.plan?.totalQuantityToTrace??0,blockedProducts:(result.plan?.blockedProducts??[]).length};
const close=(a,b)=>Math.abs(a-b)<1e-8;
if(!close(totals.global,totals.local)||!close(totals.global,totals.lot))throw Error("Reconciliação agregada divergiu: "+JSON.stringify(totals));
console.log(JSON.stringify({passed:true,summary},null,2));
