import {spawnSync} from "node:child_process";
const DEPLOYMENT="first-herring-264",key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${DEPLOYMENT}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino DEV não validado.");
function run(args,label){const r=spawnSync("bunx",["convex","run",...args],{encoding:"utf8",env:process.env,maxBuffer:8e6});if(r.status!==0)throw Error(label+": "+(r.stderr||r.stdout).slice(-1800));const out=r.stdout.trim();if(!out)return null;try{return JSON.parse(out)}catch{for(const l of out.split("\n").reverse()){try{return JSON.parse(l)}catch{}}throw Error("JSON inválido "+label)}}
const internal=(name,args={})=>run([name,JSON.stringify(args)],name),pub=(identity,name,args={})=>run(["--identity",JSON.stringify(identity),name,JSON.stringify(args)],name);
const assert=(x,m)=>{if(!x)throw Error(m)};
function totals(readiness){const ps=readiness.report.products??[];return ps.reduce((a,p)=>({global:a.global+(p.globalPhysical??0),local:a.local+(p.localPhysicalTotal??0),lots:a.lots+(p.lotsAvailableTotal??0)}),{global:0,local:0,lots:0})}
const before=internal("stockSetup:lotLocationMigrationReadinessInternal");
assert(before.readOnly===true&&before.migrationApplied===false,"Baseline diagnostic não read-only.");
const identity={subject:internal("stockIntelligenceDevTests:identity").userId,issuer:"https://sigesgd-capivari.dev"};
const replenishment=pub(identity,"stockIntelligence:replenishment");
const consumption=pub(identity,"stockIntelligence:consumption",{period:"30d"});
const organization=pub(identity,"stockIntelligence:consumptionByOrganization",{period:"12m"});
assert(Array.isArray(replenishment.rows)&&replenishment.counters&&typeof replenishment.counters==="object","Relatório de reposição inválido.");
assert(consumption.period==="30d"&&Array.isArray(consumption.summaries)&&Array.isArray(consumption.series)&&Number.isFinite(consumption.totalQuantity)&&Number.isFinite(consumption.totalExits),"Relatório de consumo inválido.");
assert(Array.isArray(organization.bySecretaria)&&Array.isArray(organization.byDepartment)&&Array.isArray(organization.byUnit)&&Array.isArray(organization.byProduct)&&Array.isArray(organization.byCategory),"Relatório por organização incompleto.");
const after=internal("stockSetup:lotLocationMigrationReadinessInternal");
const b=totals(before),a=totals(after);
assert(JSON.stringify(b)===JSON.stringify(a),"Consultas de inteligência alteraram saldos.");
assert(b.global===b.local&&b.local===b.lots,"Ledger estava divergente antes das consultas.");
console.log(JSON.stringify({passed:true,deployment:DEPLOYMENT,readOnly:true,products:before.report.products.length,replenishmentRows:replenishment.rows.length,counters:replenishment.counters,consumption:{period:consumption.period,quantity:consumption.totalQuantity,exits:consumption.totalExits,withoutHistory:consumption.withoutHistory,seriesPoints:consumption.series.length},organizationReport:{secretarias:organization.bySecretaria.length,departments:organization.byDepartment.length,units:organization.byUnit.length,products:organization.byProduct.length,categories:organization.byCategory.length,withoutHistory:organization.withoutHistory},ledgerBefore:b,ledgerAfter:a},null,2));
