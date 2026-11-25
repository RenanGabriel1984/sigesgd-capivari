import {spawnSync} from "node:child_process";
const deployment="first-herring-264",key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${deployment}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino não é o DEV autorizado.");
const runId=`gha-${process.env.GITHUB_RUN_ID??Date.now()}-${process.env.GITHUB_RUN_ATTEMPT??1}`;
const r=spawnSync("bunx",["convex","run","authDevTests:validate",JSON.stringify({runId})],{encoding:"utf8",env:process.env,maxBuffer:2e6});
if(r.status!==0)throw new Error((r.stderr||r.stdout).slice(-2500));
const output=r.stdout.trim();let result;try{result=JSON.parse(output)}catch{const lines=output.split("\n");for(const line of lines.reverse()){try{result=JSON.parse(line);break}catch{}}}
if(!result?.passed)throw new Error("Validação de autenticação falhou: "+JSON.stringify(result));
console.log(JSON.stringify({deployment,runId,...result},null,2));
