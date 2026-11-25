import {spawnSync} from "node:child_process";
const DEPLOYMENT="first-herring-264",HOST="first-herring-264.convex.cloud";
const key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${DEPLOYMENT}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino DEV não validado.");
const runId=`gha-${process.env.GITHUB_RUN_ID??"local"}-${process.env.GITHUB_RUN_ATTEMPT??"1"}`;
function run(args,label){const r=spawnSync("bunx",["convex","run",...args],{encoding:"utf8",env:process.env,maxBuffer:5e6});if(r.status!==0)throw Error(label+": "+(r.stderr||r.stdout).slice(-1800));const out=r.stdout.trim();try{return JSON.parse(out)}catch{for(const l of out.split("\n").reverse()){try{return JSON.parse(l)}catch{}}throw Error("JSON inválido "+label)}}
const internal=(name,args={})=>run([name,JSON.stringify(args)],name);
const pub=(identity,name,args)=>run(["--identity",JSON.stringify(identity),name,JSON.stringify(args)],name);
const assert=(x,m)=>{if(!x)throw Error(m)};
let failure,fixture;
try{
 fixture=internal("gomaQDevTests:seed",{runId});
 const identity={subject:fixture.operatorId,issuer:"https://sigesgd-capivari.dev"};
 const marker="__SIGESGD_GOMAQ_DEV__"+runId+"__";
 const exchangeId=pub(identity,"gomaQ:createExchange",{productId:fixture.productId,printerId:fixture.printerId,locationId:fixture.locationId,quantityDelivered:2,quantityEmptyReceived:2,receivedByName:"Teste DEV GomaQ",observation:marker+"EXCHANGE"});
 let state=internal("gomaQDevTests:inspect",{runId});
 assert(state.exists&&state.global===8&&state.local===8&&state.lot===8&&state.lotLocal===8&&state.ledgerBalanced,"Troca GomaQ não conciliou global/local/lote.");
 assert(state.exchanges.length===1&&state.exchanges[0]._id===exchangeId&&state.exchanges[0].quantityDelivered===2&&state.exchanges[0].quantityEmptyReceived===2,"Registro da troca inconsistente.");
 assert(state.movements.length===1&&state.movements[0].type==="exit"&&state.movements[0].areaId===fixture.areaId&&state.movements[0].locationId===fixture.locationId,"Movimento da troca não preservou área/local.");
 assert(state.awaiting===2&&state.cartridges.length===1&&state.cartridges[0].sourceExchangeId===exchangeId,"Carcaças vazias não foram geradas/vinculadas.");
 let rejected=false;try{pub(identity,"gomaQ:createExchange",{productId:fixture.productId,printerId:fixture.printerId,locationId:fixture.locationId,quantityDelivered:99,quantityEmptyReceived:0,receivedByName:"Teste DEV",observation:marker+"OVERDRAW"})}catch(e){rejected=/insuficiente/i.test(String(e))}
 assert(rejected,"Troca acima do saldo foi aceita.");
 state=internal("gomaQDevTests:inspect",{runId});assert(state.global===8&&state.exchanges.length===1&&state.awaiting===2&&state.ledgerBalanced,"Tentativa inválida alterou estoque/registro.");
 const cartridgeIds=state.cartridges.map(c=>c._id);
 const collectionId=pub(identity,"gomaQ:createCollection",{cartridgeIds,observation:marker+"COLLECTION"});
 state=internal("gomaQDevTests:inspect",{runId});
 assert(state.awaiting===0&&state.collected===2&&state.cartridges.every(c=>c.status==="collected"&&c.collectionId===collectionId),"Coleta não marcou carcaças como coletadas.");
 assert(state.collections.length===1&&state.collections[0]._id===collectionId&&state.collections[0].totalCartridges===2,"Registro da coleta/totais incorretos.");
 let duplicateRejected=false;try{pub(identity,"gomaQ:createCollection",{cartridgeIds,observation:marker+"DUPLICATE"})}catch(e){duplicateRejected=/coletada|já/i.test(String(e))}
 assert(duplicateRejected,"Carcaças já coletadas foram aceitas em nova coleta.");
 state=internal("gomaQDevTests:inspect",{runId});assert(state.collections.length===1&&state.collected===2&&state.global===8,"Tentativa de coleta duplicada alterou dados.");
 console.log(JSON.stringify({passed:true,deployment:DEPLOYMENT,runId,scenarios:["troca real de 2 suprimentos","baixa por lote/armário/área conciliada","2 carcaças vazias vinculadas","troca excedente bloqueada","coleta real de 2 carcaças","coleta duplicada bloqueada"],final:{global:state.global,local:state.local,lot:state.lot,lotLocal:state.lotLocal,awaiting:state.awaiting,collected:state.collected}},null,2));
}catch(e){failure=e}
finally{try{const cleanup=internal("gomaQDevTests:cleanup",{runId});assert(cleanup.fixtureRemaining===false,"Fixture não foi removida.");console.log(JSON.stringify({cleanup},null,2))}catch(e){failure=Error((failure?String(failure)+" | ":"")+"Limpeza falhou: "+String(e))}}
if(failure)throw failure;
