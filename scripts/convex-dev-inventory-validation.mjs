import {spawnSync} from "node:child_process";
const DEPLOYMENT="first-herring-264",key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${DEPLOYMENT}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino DEV não validado.");
const runId=`gha-${process.env.GITHUB_RUN_ID??"local"}-${process.env.GITHUB_RUN_ATTEMPT??"1"}`;
function run(args,label){const r=spawnSync("bunx",["convex","run",...args],{encoding:"utf8",env:process.env,maxBuffer:5e6});if(r.status!==0)throw Error(label+": "+(r.stderr||r.stdout).slice(-1800));const out=r.stdout.trim();try{return JSON.parse(out)}catch{for(const l of out.split("\n").reverse()){try{return JSON.parse(l)}catch{}}throw Error("JSON inválido "+label)}}
const internal=(name,args={})=>run([name,JSON.stringify(args)],name),pub=(identity,name,args)=>run(["--identity",JSON.stringify(identity),name,JSON.stringify(args)],name);
const assert=(x,m)=>{if(!x)throw Error(m)};
let failure,fixture;
try{
 fixture=internal("inventoryDevTests:seed",{runId});
 const identity={subject:fixture.operatorId,issuer:"https://sigesgd-capivari.dev"};
 const marker="__SIGESGD_INVENTORY_DEV__"+runId+"__";
 const inventoryId=pub(identity,"inventory:create",{locationId:fixture.locationId,productIds:[fixture.productId],observation:marker+"INVENTORY"});
 let state=internal("inventoryDevTests:inspect",{runId});
 assert(state.exists&&state.global===10&&state.balanced&&state.inventories.length===1&&state.counts.length===1&&state.counts[0].systemQuantity===10,"Inventário inicial não criou contagem por lote/local correta.");
 const countId=state.counts[0]._id;
 pub(identity,"inventory:startCounting",{inventoryId});
 let negativeRejected=false;try{pub(identity,"inventory:saveCount",{countId,countedQuantity:-1,observation:"Teste negativo"})}catch(e){negativeRejected=/não negativo|inválid/i.test(String(e))}
 assert(negativeRejected,"Contagem negativa foi aceita.");
 let reviewBlocked=false;try{pub(identity,"inventory:startReview",{inventoryId})}catch(e){reviewBlocked=/não foram contados|contagem/i.test(String(e))}
 assert(reviewBlocked,"Inventário iniciou revisão sem contagem completa.");
 pub(identity,"inventory:saveCount",{countId,countedQuantity:8,observation:"Contagem física de teste: 8"});
 pub(identity,"inventory:startReview",{inventoryId});
 let blankJustificationRejected=false;try{pub(identity,"inventory:close",{inventoryId,justification:" "})}catch(e){blankJustificationRejected=/justificativa/i.test(String(e))}
 assert(blankJustificationRejected,"Fechamento sem justificativa foi aceito.");
 state=internal("inventoryDevTests:inspect",{runId});
 assert(state.global===10&&state.counts[0].countedQuantity===8&&state.inventories[0].status==="review","Tentativa de fechamento inválida alterou estoque ou status.");
 const closed=pub(identity,"inventory:close",{inventoryId,justification:"Validação de inventário transacional em fixture descartável DEV"});
 state=internal("inventoryDevTests:inspect",{runId});
 assert(state.global===8&&state.local===8&&state.lot===8&&state.lotLocal===8&&state.balanced,"Fechamento não reconciliou global/local/lote.");
 assert(state.inventories[0].status==="closed"&&state.inventories[0].closedByUserId===fixture.operatorId,"Inventário não foi fechado/auditado pelo operador.");
 assert(state.counts[0].difference===-2&&state.counts[0].countedQuantity===8,"Diferença da contagem não foi persistida.");
 assert(state.movements.length===1&&state.movements[0].type==="adjustment"&&state.movements[0].quantity===2&&state.movements[0].areaId===fixture.areaId&&state.movements[0].locationId===fixture.locationId,"Movimento de ajuste não preservou quantidade/área/armário.");
 console.log(JSON.stringify({passed:true,deployment:DEPLOYMENT,runId,scenarios:["inventário criado com lote/local","contagem negativa bloqueada","revisão antes de contar bloqueada","contagem 8 contra sistema 10","fechamento sem justificativa bloqueado","fechamento auditável com ajuste -2"],final:{global:state.global,local:state.local,lot:state.lot,lotLocal:state.lotLocal,difference:state.counts[0].difference,movementCount:state.movements.length},closeResult:closed},null,2));
}catch(e){failure=e}
finally{try{const cleanup=internal("inventoryDevTests:cleanup",{runId});assert(cleanup.fixtureRemaining===false,"Fixture não removida.");console.log(JSON.stringify({cleanup},null,2))}catch(e){failure=Error((failure?String(failure)+" | ":"")+"Limpeza falhou: "+String(e))}}
if(failure)throw failure;
