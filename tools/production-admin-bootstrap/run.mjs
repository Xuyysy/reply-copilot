import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,chmod,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {PRODUCTION_DATABASE_ID} from './bootstrap.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const defaultReason='Owner-authorized initial Production administrator bootstrap';

function requiredString(value){return typeof value==='string'&&value.trim()?value.trim():null;}

function assertExplicitExecutionFlags(options){
 if(options?.execute!==true||options?.authorizeProductionBootstrap!==true)throw new Error('OWNER_AUTHORIZATION_REQUIRED');
 if(options?.targetDatabaseId!==PRODUCTION_DATABASE_ID||options?.confirmProductionDatabaseId!==PRODUCTION_DATABASE_ID)throw new Error('WRONG_DATABASE');
}

export function parseCliArgs(argv){
 const options={execute:false,authorizeProductionBootstrap:false,confirmProductionDatabaseId:null,userId:null,email:null,targetDatabaseId:null,reason:defaultReason};
 const values=new Map([['--user-id','userId'],['--expected-email','email'],['--target-database-id','targetDatabaseId'],['--confirm-production-database','confirmProductionDatabaseId'],['--reason','reason']]);
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--execute'){options.execute=true;continue;}
  if(arg==='--dry-run'){options.dryRun=true;continue;}
  if(arg==='--authorize-production-bootstrap'){options.authorizeProductionBootstrap=true;continue;}
  const equalAt=arg.indexOf('=');const key=equalAt===-1?arg:arg.slice(0,equalAt);const property=values.get(key);
  if(!property)throw new Error('UNKNOWN_ARGUMENT');
  const value=equalAt===-1?argv[++i]:arg.slice(equalAt+1);
  if(!requiredString(value))throw new Error('INVALID_ARGUMENT');
  options[property]=value.trim();
 }
 if(options.execute&&options.dryRun)throw new Error('CONFLICTING_MODE');
 if(!options.userId||!options.email||!options.targetDatabaseId)throw new Error('USER_ID_EMAIL_AND_TARGET_DATABASE_REQUIRED');
 if(options.targetDatabaseId!==PRODUCTION_DATABASE_ID)throw new Error('WRONG_DATABASE');
 if(options.execute)assertExplicitExecutionFlags(options);
 return options;
}

export function assertExecutionAuthorization(options){
 assertExplicitExecutionFlags(options);
 if(options?.interactiveConfirmation!==true)throw new Error('INTERACTIVE_CONFIRMATION_REQUIRED');
 return true;
}

export function buildWranglerConfig(productionConfig,mainPath){
 const db=productionConfig?.d1_databases?.length===1?productionConfig.d1_databases[0]:null;
 if(productionConfig?.name!=='reply-copilot-api-production'||productionConfig?.vars?.ENVIRONMENT!=='production'||db?.binding!=='DB'||db?.database_name!=='reply-copilot-production'||db?.database_id!==PRODUCTION_DATABASE_ID)throw new Error('WRONG_PRODUCTION_CONFIG');
 return {
  name:'reply-copilot-admin-bootstrap-local',
  main:mainPath,
  compatibility_date:productionConfig.compatibility_date??'2026-10-14',
  workers_dev:false,
  routes:[],
  vars:{ENVIRONMENT:'production',BOOTSTRAP_TARGET_DATABASE_ID:PRODUCTION_DATABASE_ID},
  d1_databases:[{binding:'DB',database_name:'reply-copilot-production',database_id:PRODUCTION_DATABASE_ID,remote:true}]
 };
}

async function availableLoopbackPort(){
 const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();const port=typeof address==='object'&&address?address.port:null;
 await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 if(!port)throw new Error('LOCAL_PORT_UNAVAILABLE');return port;
}

async function waitForLocalWorker(baseUrl,child){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  if(child.exitCode!==null||child.signalCode!==null||child.spawnError)throw new Error('WRANGLER_DEV_FAILED');
  try{const response=await fetch(baseUrl,{signal:AbortSignal.timeout(500)});if(response.status===404)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 throw new Error('WRANGLER_DEV_TIMEOUT');
}

async function postJson(baseUrl,pathName,token,body){
 return fetch(new URL(pathName,baseUrl),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
}

async function askExactConfirmation(userId){
 const rl=readline.createInterface({input:stdin,output:stdout});
 try{const answer=await rl.question(`Type BOOTSTRAP ${userId} ON PRODUCTION to continue: `);return answer.trim()===`BOOTSTRAP ${userId} ON PRODUCTION`;}
 finally{rl.close();}
}

async function executeOnce(options){
 if(!stdin.isTTY||!stdout.isTTY)throw new Error('INTERACTIVE_CONFIRMATION_REQUIRED');
 const sourceConfig=JSON.parse(await readFile(path.join(root,'api/deploy/production.wrangler.json'),'utf8'));
 const tempDir=await mkdtemp(path.join(os.tmpdir(),'reply-copilot-admin-bootstrap-'));await chmod(tempDir,0o700);
 let child=null;
 try{
  const token=randomBytes(32).toString('base64url');
  const workerPath=path.join(root,'tools/production-admin-bootstrap/worker.mjs');
  const generated=buildWranglerConfig(sourceConfig,path.relative(tempDir,workerPath));
  await writeFile(path.join(tempDir,'wrangler.json'),JSON.stringify(generated,null,2),{mode:0o600});
  await writeFile(path.join(tempDir,'.dev.vars'),`BOOTSTRAP_SESSION_TOKEN=${token}\n`,{mode:0o600});
  const port=await availableLoopbackPort(),baseUrl=`http://127.0.0.1:${port}/`;
  const wrangler=path.join(root,'api/node_modules/.bin/wrangler');
  child=spawn(wrangler,['dev','--config',path.join(tempDir,'wrangler.json'),'--ip','127.0.0.1','--port',String(port),'--log-level','error','--show-interactive-dev-session=false'],{cwd:tempDir,stdio:'ignore',env:{...process.env,NO_UPDATE_NOTIFIER:'1'}});
  child.once('error',error=>{child.spawnError=error;});
  await waitForLocalWorker(baseUrl,child);
  const input={userId:options.userId,email:options.email,reason:options.reason};
  const inspectResponse=await postJson(baseUrl,'/inspect',token,input);
  const inspect=await inspectResponse.json().catch(()=>null);
  if(!inspectResponse.ok||inspect?.ok!==true||!inspect?.result?.eligible){
   console.log(JSON.stringify({mode:'preflight',ok:false,code:inspect?.result?.reason??inspect?.code??'PREFLIGHT_FAILED',checks:inspect?.result?{userExists:inspect.result.userExists,emailMatches:inspect.result.emailMatches,active:inspect.result.active,emailVerified:inspect.result.emailVerified,ordinaryUser:inspect.result.ordinaryUser,noExistingAdmin:inspect.result.noExistingAdmin,noExistingBinding:inspect.result.noExistingBinding}:undefined}));
   return 2;
  }
  console.log(JSON.stringify({mode:'preflight',ok:true,userId:options.userId,checks:{userExists:true,emailMatches:true,active:true,emailVerified:true,ordinaryUser:true,noExistingAdmin:true,noExistingBinding:true}}));
  if(!await askExactConfirmation(options.userId))throw new Error('TYPED_CONFIRMATION_REQUIRED');
  const payload={...input,requestedDatabaseId:options.targetDatabaseId,confirmedDatabaseId:options.confirmProductionDatabaseId,explicitAuthorization:true,typedConfirmationUserId:options.userId};
  let response;
  try{response=await postJson(baseUrl,'/execute',token,payload);}catch{throw new Error('RESULT_UNKNOWN_NO_RETRY');}
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.ok!==true)throw new Error(result?.code??'BOOTSTRAP_FAILED');
  console.log(JSON.stringify({mode:'completed',ok:true,userId:options.userId,auditId:result.result.auditId,boundAt:result.result.boundAt}));
  return 0;
 }finally{
  if(child){
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
   await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  }
  await rm(tempDir,{recursive:true,force:true});
 }
}

export async function main(argv=process.argv.slice(2)){
 const options=parseCliArgs(argv);
 if(!options.execute){
  console.log(JSON.stringify({mode:'dry-run',environment:'production',databaseId:PRODUCTION_DATABASE_ID,userId:options.userId,remoteOperationsExecuted:false,writesPerformed:false,emailDisplayed:false}));
  return 0;
 }
 if(!process.env.CONFIRM_PRODUCTION_ADMIN_BOOTSTRAP||process.env.CONFIRM_PRODUCTION_ADMIN_BOOTSTRAP!==`reply-copilot-production:${PRODUCTION_DATABASE_ID}`)throw new Error('OWNER_AUTHORIZATION_REQUIRED');
 assertExecutionAuthorization({...options,interactiveConfirmation:stdin.isTTY&&stdout.isTTY});
 return executeOnce(options);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(code=>{process.exitCode=code;}).catch(error=>{const safe=/^[A-Z0-9_]+$/.test(error.message)?error.message:'BOOTSTRAP_TOOL_FAILED';console.error(safe);process.exitCode=1;});
}
