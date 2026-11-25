import {spawnSync} from "node:child_process";
const deployment="first-herring-264",key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${deployment}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino não é o DEV autorizado.");
const runId=`gha-${process.env.GITHUB_RUN_ID??Date.now()}-${process.env.GITHUB_RUN_ATTEMPT??1}`;
function call(name,args){const r=spawnSync("bunx",["convex","run",name,JSON.stringify(args)],{encoding:"utf8",env:process.env,maxBuffer:2e6});if(r.status!==0)throw new Error(name+": "+(r.stderr||r.stdout).slice(-1500));const s=r.stdout.trim();if(!s||s==="undefined"||s==="null")return null;try{return JSON.parse(s)}catch{for(const line of s.split("\n").reverse()){try{return JSON.parse(line)}catch{}}throw new Error("Resposta inválida: "+name)}}
const internal=(name,args={})=>call(name,args);
let fixture;
try{
 fixture=internal("authDevTests:seed",{runId});
 const inspect=internal("authDevTests:inspect",{runId,password:fixture.password});
 const goodLower=internal("passwords:verifyCredentials",{email:fixture.email,password:fixture.password});
 const goodUpper=internal("passwords:verifyCredentials",{email:fixture.email.toUpperCase(),password:fixture.password});
 const bad=internal("passwords:verifyCredentials",{email:fixture.email,password:"wrong-password"});
 for(let i=0;i<5;i++)internal("passwords:recordFailedLogin",{email:fixture.email});
 const locked=internal("passwords:isLockedOut",{email:fixture.email});
 const success=internal("passwords:recordSuccessfulLogin",{email:fixture.email});
 const after=internal("passwords:isLockedOut",{email:fixture.email});
 internal("authDevTests:addDuplicate",{runId});
 const duplicate=internal("passwords:verifyCredentials",{email:fixture.email,password:fixture.password});
 const checks={credentialHashMatches:inspect.hashMatches===true,normalizedEmailAccepted:goodLower.success===true,caseNormalizationAccepted:goodUpper.success===true,wrongPasswordGeneric:bad.success===false&&bad.error===goodLower.error,lockAfterFive:locked.locked===true,successfulLoginClearsLock:success.cleared===true&&after.locked===false,duplicateIdentityFailsClosed:duplicate.success===false};
 if(Object.values(checks).some(x=>!x))throw new Error("Cenários falharam: "+JSON.stringify({checks,inspect,goodLower,goodUpper,bad}));
 console.log(JSON.stringify({passed:true,deployment,runId,checks},null,2));
}finally{
 const cleanup=internal("authDevTests:cleanup",{runId});
 if(cleanup.remaining!==0)throw new Error("Fixture não limpa: "+JSON.stringify(cleanup));
 console.log(JSON.stringify({cleanupVerified:cleanup},null,2));
}
