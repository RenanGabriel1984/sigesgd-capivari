import { spawnSync } from "node:child_process";
const DEPLOYMENT = "first-herring-264";
const HOST = "first-herring-264.convex.cloud";
const key = process.env.CONVEX_DEPLOY_KEY ?? "";
if (key.split("|", 1)[0] !== `dev:${DEPLOYMENT}`) throw new Error("Somente dev:first-herring-264 é permitido.");
if (process.env.CONVEX_DEPLOYMENT) throw new Error("CONVEX_DEPLOYMENT definida; destino implícito bloqueado.");
const runId = `gha-${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
function run(args, label) {
  const r = spawnSync("bunx", ["convex", "run", ...args], { encoding:"utf8", env:process.env, maxBuffer:5*1024*1024 });
  if (r.status !== 0) throw new Error(`${label}: ${(r.stderr || r.stdout).slice(-2000)}`);
  const out=r.stdout.trim(); try{return JSON.parse(out);}catch{for(const line of out.split("\n").reverse()){try{return JSON.parse(line);}catch{}} throw new Error(`${label}: saída JSON inválida`);}
}
const internal=(name,args={})=>run([name,JSON.stringify(args)],name);
const asOperator=(identity,name,args)=>run(["--identity",JSON.stringify(identity),name,JSON.stringify(args)],name);
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
let seeded=false, failure, fixture;
try {
  fixture=internal("waterDevTransactionTests:seed",{runId}); seeded=true;
  const identity={subject:fixture.operatorId,issuer:"https://sigesgd-capivari.dev"};
  const suffix="__SIGESGD_WATER_DEV__"+runId+"__";
  const p1=asOperator(identity,"water:createParticipant",{name:suffix+"A"});
  const p2=asOperator(identity,"water:createParticipant",{name:suffix+"B"});
  asOperator(identity,"water:recordMovement",{movementType:"supplier_delivery",fullDelta:8,emptyDelta:0,supplierName:"Fornecedor de teste",costAmount:16,observation:suffix+"delivery"});
  asOperator(identity,"water:recordMovement",{movementType:"consumption",fullDelta:-3,emptyDelta:3,observation:suffix+"consumption"});
  asOperator(identity,"water:recordMovement",{movementType:"supplier_exchange",fullDelta:2,emptyDelta:-2,supplierName:"Fornecedor de teste",costAmount:2,observation:suffix+"exchange"});
  let state=internal("waterDevTransactionTests:inspect",{runId});
  check(state.balances.full===fixture.baseline.full+7 && state.balances.empty===fixture.baseline.empty+1,"Saldos de garrafões não conciliam após recebimento, consumo e troca.");
  check(state.audit.movements===3,"Quantidade de movimentos de fixture incorreta.");
  asOperator(identity,"water:createPeriod",{label:suffix+"PERIOD",startDate:fixture.periodDate,endDate:fixture.periodDate,gallonsConsumed:5,totalCost:10,participantIds:[p1,p2],observation:suffix+"period"});
  state=internal("waterDevTransactionTests:inspect",{runId});
  check(state.charges.length===2 && state.charges.reduce((s,x)=>s+x.shareAmount,0)===10,"Rateio não fechou exatamente R$ 10,00.");
  check(state.charges.every(x=>x.shareAmount===5),"Rateio igualitário de R$ 5,00 por participante falhou.");
  const payment=asOperator(identity,"water:recordPayment",{periodId:state.period._id,participantId:p1,amount:2,paidAt:Date.now(),method:"teste",observation:suffix+"partial"});
  asOperator(identity,"water:recordPayment",{periodId:state.period._id,participantId:p1,amount:3,paidAt:Date.now(),method:"teste",observation:suffix+"second"});
  let rejected=false; try{asOperator(identity,"water:recordPayment",{periodId:state.period._id,participantId:p1,amount:0.01,paidAt:Date.now()});}catch(e){rejected=/excede|saldo/i.test(String(e));}
  check(rejected,"Pagamento acima da cota foi aceito.");
  asOperator(identity,"water:reversePayment",{paymentId:payment,reason:"Estorno controlado de teste DEV"});
  state=internal("waterDevTransactionTests:inspect",{runId});
  const p1charge=state.charges.find(x=>x.participantId===p1);
  const p1payments=state.payments.filter(x=>x.participantId===p1&&!x.reversedAt).reduce((s,x)=>s+x.amount,0);
  check(p1charge.shareAmount-p1payments===2,"Estorno não recompôs o saldo devedor esperado.");
  console.log(JSON.stringify({deployment:DEPLOYMENT,host:HOST,runId,passed:true,results:["recebimento","consumo","troca com fornecedor","rateio em centavos","pagamentos parciais","bloqueio de sobrepagamento","estorno auditável"],baseline:fixture.baseline,finalBalances:state.balances,fixture:state.audit},null,2));
} catch(e) { failure=e; }
finally {
  try { const cleanup=internal("waterDevTransactionTests:cleanup",{runId}); check(cleanup.fixtureRemaining===false,"Fixture não foi removida."); console.log(JSON.stringify({cleanup},null,2)); }
  catch(e) { failure=new Error(`${failure?String(failure)+" | ":""}Falha de limpeza: ${String(e)}`); }
}
if(failure) throw failure;
