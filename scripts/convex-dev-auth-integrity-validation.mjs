import {spawnSync} from "node:child_process";
import {ConvexHttpClient} from "convex/browser";
import {anyApi} from "convex/server";

const deployment="first-herring-264",key=process.env.CONVEX_DEPLOY_KEY??"";
if(key.split("|",1)[0]!==`dev:${deployment}`||process.env.CONVEX_DEPLOYMENT)throw new Error("Destino não é o DEV autorizado.");
const runId=`gha-${process.env.GITHUB_RUN_ID??Date.now()}-${process.env.GITHUB_RUN_ATTEMPT??1}`;
const client=new ConvexHttpClient(`https://${deployment}.convex.cloud`);
function call(name,args){const r=spawnSync("bunx",["convex","run",name,JSON.stringify(args)],{encoding:"utf8",env:process.env,maxBuffer:2e6});if(r.status!==0)throw new Error(name+": "+(r.stderr||r.stdout).slice(-1500));const s=r.stdout.trim();if(!s||s==="undefined"||s==="null")return null;try{return JSON.parse(s)}catch{for(const line of s.split("\n").reverse()){try{return JSON.parse(line)}catch{}}throw new Error("Resposta inválida: "+name)}}
const internal=(name,args={})=>call(name,args);
let fixture;
let tokens;
let accessToken;
let sessionNeedsRevocation=false;
try{
 fixture=internal("authDevTests:seed",{runId});
 const inspect=internal("authDevTests:inspect",{runId,password:fixture.password});
 const goodLower=internal("passwords:verifyCredentials",{email:fixture.email,password:fixture.password});
 const goodUpper=internal("passwords:verifyCredentials",{email:fixture.email.toUpperCase(),password:fixture.password});
 const bad=internal("passwords:verifyCredentials",{email:fixture.email,password:"wrong-password"});

 // Exercise the exact public action invoked by useAuthActions().signIn.
 let invalidSignInError;
 try{
  await client.action(anyApi.auth.signIn,{provider:"credentials",params:{email:fixture.email,password:"wrong-password"},calledBy:"dev-credential-integrity"});
 }catch(error){invalidSignInError=error;}
 const invalidSignInErrorData=invalidSignInError?.data;
 const invalidSignInGeneric=Boolean(invalidSignInError)&&(
  invalidSignInErrorData==="E-mail ou senha incorretos."||
  invalidSignInError?.message==="E-mail ou senha incorretos."
 );

 const signInResult=await client.action(anyApi.auth.signIn,{
  provider:"credentials",
  params:{email:fixture.email,password:fixture.password},
  calledBy:"dev-credential-integrity"
 });
 tokens=signInResult?.tokens;
 accessToken=tokens?.accessToken??tokens?.token??tokens?.jwt;
 sessionNeedsRevocation=typeof accessToken==="string";
 const tokenBundleValid=typeof accessToken==="string"&&accessToken.length>40&&
  typeof tokens?.refreshToken==="string"&&tokens.refreshToken.length>20;

 let authenticated=false,currentUserMatches=false,signedOut=false;
 if(tokenBundleValid){
  client.setAuth(accessToken);
  authenticated=await client.query(anyApi.auth.isAuthenticated,{})===true;
  const currentUser=await client.query(anyApi.users.currentUser,{});
  currentUserMatches=currentUser?._id===fixture.userId&&currentUser?.email===fixture.email;
  await client.action(anyApi.auth.signOut,{});
  sessionNeedsRevocation=false;
  signedOut=await client.query(anyApi.auth.isAuthenticated,{})===false;
  client.clearAuth();
 }

 // Exercise brute-force lockout and successful-login counter reset.
 for(let i=0;i<5;i++)internal("passwords:recordFailedLogin",{email:fixture.email});
 const locked=internal("passwords:isLockedOut",{email:fixture.email});
 const success=internal("passwords:recordSuccessfulLogin",{email:fixture.email});
 const after=internal("passwords:isLockedOut",{email:fixture.email});

 // Duplicate identity must fail closed, even when the password matches.
 internal("authDevTests:addDuplicate",{runId});
 const duplicate=internal("passwords:verifyCredentials",{email:fixture.email,password:fixture.password});
 const checks={
  credentialHashMatches:inspect.hashMatches===true,
  normalizedEmailAccepted:goodLower.success===true,
  caseNormalizationAccepted:goodUpper.success===true,
  wrongPasswordGeneric:bad.success===false&&bad.error==="E-mail ou senha incorretos.",
  actualSignInReturnsGenericConvexError:invalidSignInGeneric,
  actualSignInIssuesTokenBundle:tokenBundleValid,
  tokenAuthenticatesConvexSession:authenticated,
  authenticatedUserMatchesFixture:currentUserMatches,
  actualSignOutRevokesSession:signedOut,
  lockAfterFive:locked.locked===true,
  successfulLoginClearsLock:success.cleared===true&&after.locked===false,
  duplicateIdentityFailsClosed:duplicate.success===false
 };
 if(Object.values(checks).some(x=>!x)){const tokenShape=Object.fromEntries(Object.entries(tokens??{}).map(([k,v])=>[k,typeof v==="string"?`string(${v.length})`:v===null?"null":typeof v]));throw new Error("Cenários falharam: "+JSON.stringify({checks,signInResultKeys:Object.keys(signInResult??{}),tokenShape}));}
 console.log(JSON.stringify({passed:true,deployment,runId,checks},null,2));
}finally{
 if(sessionNeedsRevocation&&accessToken){
  client.setAuth(accessToken);
  await client.action(anyApi.auth.signOut,{});
  client.clearAuth();
 }
 if(fixture){
  const cleanup=internal("authDevTests:cleanup",{runId});
  if(cleanup.remaining!==0)throw new Error("Fixture não limpa: "+JSON.stringify(cleanup));
  console.log(JSON.stringify({cleanupVerified:cleanup},null,2));
 }
}
