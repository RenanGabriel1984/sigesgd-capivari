import {spawnSync} from "node:child_process";
const DEPLOYMENT="first-herring-264",key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${DEPLOYMENT}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino DEV não validado.");
const runId=`gha-${process.env.GITHUB_RUN_ID??"local"}-${process.env.GITHUB_RUN_ATTEMPT??"1"}`;
function run(args,label){const r=spawnSync("bunx",["convex","run",...args],{encoding:"utf8",env:process.env,maxBuffer:5e6});if(r.status!==0)throw Error(label+": "+(r.stderr||r.stdout).slice(-1800));const out=r.stdout.trim();if(!out)return null;try{return JSON.parse(out)}catch{for(const l of out.split("\n").reverse()){try{return JSON.parse(l)}catch{}}throw Error("JSON inválido "+label)}}
const internal=(name,args={})=>run([name,JSON.stringify(args)],name),pub=(identity,name,args)=>run(["--identity",JSON.stringify(identity),name,JSON.stringify(args)],name);
const assert=(x,m)=>{if(!x)throw Error(m)};
let failure;
try{
 const fixture=internal("requestDevTests:seed",{runId});
 const requester={subject:fixture.requesterId,issuer:"https://sigesgd-capivari.dev"};
 const approver={subject:fixture.approverId,issuer:"https://sigesgd-capivari.dev"};
 const marker="__SIGESGD_REQUEST_DEV__"+runId+"__";
 const requestExcess=pub(requester,"requests:create",{secretariaId:fixture.secretariaId,reason:marker+"REASON-EXCESS",items:[{productId:fixture.productId,quantityRequested:11}]});
 let state=internal("requestDevTests:inspect",{runId});
 const excessItem=state.items.find(i=>i.requestId===requestExcess);
 let approvalRejected=false;try{pub(approver,"requests:approve",{requestId:requestExcess,items:[{itemId:excessItem._id,quantityApproved:11}]})}catch(e){approvalRejected=/insuficiente|excede/i.test(String(e))}
 assert(approvalRejected,"Aprovação acima do estoque disponível foi aceita.");
 state=internal("requestDevTests:inspect",{runId});
 assert(state.global===10&&state.reserved===0&&state.requests.find(r=>r._id===requestExcess).status==="pending","A aprovação inválida alterou saldo ou status.");
 pub(requester,"requests:cancel",{requestId:requestExcess});
 state=internal("requestDevTests:inspect",{runId});
 assert(state.reserved===0&&state.requests.find(r=>r._id===requestExcess).status==="cancelled","Cancelamento da pendente não concluiu.");

 const requestApproved=pub(requester,"requests:create",{secretariaId:fixture.secretariaId,reason:marker+"REASON-APPROVED",items:[{productId:fixture.productId,quantityRequested:4}]});
 state=internal("requestDevTests:inspect",{runId});
 const item=state.items.find(i=>i.requestId===requestApproved);
 pub(approver,"requests:approve",{requestId:requestApproved,items:[{itemId:item._id,quantityApproved:4}]});
 state=internal("requestDevTests:inspect",{runId});
 assert(state.global===10&&state.reserved===4&&state.requests.find(r=>r._id===requestApproved).status==="approved","A aprovação não reservou saldo corretamente.");
 pub(requester,"requests:cancel",{requestId:requestApproved});
 state=internal("requestDevTests:inspect",{runId});
 assert(state.global===10&&state.reserved===0&&state.requests.every(r=>r.status==="cancelled"),"Cancelamento de aprovada não liberou reserva.");
 console.log(JSON.stringify({passed:true,deployment:DEPLOYMENT,runId,scenarios:["solicitação de 11 excede disponibilidade e aprovação rejeitada","solicitação pendente cancelada","solicitação de 4 aprovada/reservada","cancelamento da aprovada libera reserva","ledger físico permanece 10 e reserva volta a 0"],final:{global:state.global,reserved:state.reserved,requestStatuses:state.requests.map(r=>r.status)}},null,2));
}catch(e){failure=e}
finally{try{const cleanup=internal("requestDevTests:cleanup",{runId});assert(cleanup.fixtureRemaining===false,"Fixture request não removida.");console.log(JSON.stringify({cleanup},null,2))}catch(e){failure=Error((failure?String(failure)+" | ":"")+"Limpeza falhou: "+String(e))}}
if(failure)throw failure;
