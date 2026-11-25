import {spawnSync} from "node:child_process";
const DEPLOYMENT="first-herring-264", HOST="first-herring-264.convex.cloud";
const key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${DEPLOYMENT}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino DEV não validado.");
const runId=`gha-${process.env.GITHUB_RUN_ID??"local"}-${process.env.GITHUB_RUN_ATTEMPT??"1"}`;
function run(args,label){const r=spawnSync("bunx",["convex","run",...args],{encoding:"utf8",env:process.env,maxBuffer:5e6});if(r.status!==0)throw Error(label+": "+(r.stderr||r.stdout).slice(-1500));const out=r.stdout.trim();try{return JSON.parse(out)}catch{for(const l of out.split("\n").reverse()){try{return JSON.parse(l)}catch{}}throw Error("JSON inválido "+label)}}
const internal=(name,args={})=>run([name,JSON.stringify(args)],name);
const pub=(identity,name,args)=>run(["--identity",JSON.stringify(identity),name,JSON.stringify(args)],name);
const assert=(x,m)=>{if(!x)throw Error(m)};
let failure,fixture;
try{
 fixture=internal("entryExitDevTests:seed",{runId});
 const identity={subject:fixture.operatorId,issuer:"https://sigesgd-capivari.dev"};
 const entry=pub(identity,"entries:create",{receivedAt:Date.now(),originType:"other",materialType:"consumption",areaId:fixture.areaId,observation:"__SIGESGD_ENTRY_EXIT_DEV__"+runId+"__ENTRY",items:[{productId:fixture.productId,quantity:10,unitOfMeasure:"un",areaId:fixture.areaId,locationId:fixture.locationId,observation:"Fixture entrada"}]});
 pub(identity,"entries:confirm",{entryId:entry.entryId});
 let state=internal("entryExitDevTests:inspect",{runId});
 assert(state.exists&&state.global===10&&state.local===10&&state.lot===10&&state.lotLocal===10&&state.ledgerBalanced,"Entrada confirmada não conciliou global/armário/lote.");
 assert(state.entryMovementCount===1&&state.lots[0].areaId===fixture.areaId&&state.items[0].lotId,"Entrada sem rastreabilidade/área/item-lote.");
 pub(identity,"stockMovements:createExit",{productId:fixture.productId,quantity:3,locationId:fixture.locationId,areaId:fixture.areaId,observation:"Saída teste DEV"});
 state=internal("entryExitDevTests:inspect",{runId});
 assert(state.global===7&&state.local===7&&state.lot===7&&state.lotLocal===7&&state.ledgerBalanced,"Saída não conciliou saldos.");
 assert(state.exitMovementCount===1,"Movimento de saída ausente.");
 let blocked=false;try{pub(identity,"stockMovements:createExit",{productId:fixture.productId,quantity:99,locationId:fixture.locationId,areaId:fixture.areaId,observation:"Teste saldo insuficiente"})}catch(e){blocked=/insuficiente/i.test(String(e))}
 assert(blocked,"Saída acima do saldo não foi bloqueada.");
 const final=internal("entryExitDevTests:inspect",{runId});
 assert(final.global===7&&final.ledgerBalanced,"Tentativa inválida alterou saldos.");
 console.log(JSON.stringify({passed:true,deployment:DEPLOYMENT,runId,results:["entrada mutation real 10","lote/área/item rastreável","saída mutation real 3","saldo final 7 conciliado","saída excedente bloqueada sem efeito"],final:{global:final.global,local:final.local,lot:final.lot,lotLocal:final.lotLocal}},null,2));
}catch(e){failure=e}
finally{try{const c=internal("entryExitDevTests:cleanup",{runId});assert(c.fixtureRemaining===false,"Fixture não limpa.");console.log(JSON.stringify({cleanup:c},null,2))}catch(e){failure=Error((failure?String(failure)+" | ":"")+"limpeza falhou "+String(e))}}
if(failure)throw failure;
