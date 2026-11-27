import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setupSyntheticWorkerd,InspectorClient} from '../scripts/cf-free-workerd-cpu.mjs';
import {migrationStatements,summarizeWallMs,summarizeV8Profile} from '../scripts/lib/workerd-cpu-evidence.mjs';

// Bounded local workerd CPU samples only; never call cloud resources.
test('CF Free partner payout: bounded actual Workerd route diagnostic',{timeout:120000},async()=>{
 const f=await setupSyntheticWorkerd({profile:true,partnerPayout:true});
 let inspector;
 try{
  const db=f.db,owner='benchmark-owner',user='benchmark-main-user',token='b'.repeat(64),webToken='a'.repeat(64),auth='isolated-benchmark-auth-key-not-a-secret-123',api='https://isolated-api.example.test',web='https://isolated-web.example.test';
  const run=(q,...args)=>db.prepare(q).bind(...args).run();
  for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_manual_record_proposal.sql','partners_payout_profile_proposal.sql']){
   for(const stmt of migrationStatements(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8')))await run(stmt);
  }
  await run("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture','admin')",owner,owner+'@example.test',owner);
  await run("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,?,1)",owner);
  await run("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('synthetic-admin',?,?,'web',1,?)",createHash('sha256').update(token).digest('hex'),owner,Date.now()+600000);
  await run("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('synthetic-admin',?)",Date.now()+600000);
  await run("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled','partner_payout_profile_enabled')");
  await run("INSERT INTO partner_policy_versions(user_id,version,status,level,rate_bps,term_months,effective_at,authorized_by,reason) VALUES(?,1,'active','standard',1500,NULL,1,?,'local test')",user,owner);
  const call=async(path,who=webToken,body)=>{
   const headers={Origin:web,Cookie:'rc_session='+who,'Content-Type':'application/json','X-Reply-Copilot-Action':'1','X-CSRF-Token':createHmac('sha256',auth).update('csrf:'+who).digest('hex')};
   const response=await f.mf.dispatchFetch(api+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();assert.equal(response.status,200,data.code||'unexpected status');return data;
  };
  const payout='/v1/partners/payout',report='/v1/partners/manual-report',admin='/v1/admin/partners/payout',directory='/v1/admin/partners/list';
  let version=0;
  const save=async()=>{const r=await call(payout,webToken,{name:'Synthetic Recipient',account:'synthetic@example.test',expectedVersion:version});version=r.version;assert.ok(r.profile);};
  await save();
  await call(report);await call(directory,token);
  inspector=await InspectorClient.connect(f.mf);
  const cases=[];
  for(const [category,invoke] of [
   ['report_read',async()=>{assert.equal((await call(report)).recipientReady,true);}],
   ['directory_read',async()=>{assert.equal((await call(directory,token)).items.length,1);}],
   ['profile_read',async()=>{assert.ok((await call(payout)).profile);}],
   ['profile_save',save],
   ['admin_reveal',async()=>{const r=await call(admin,token,{userId:user,reason:'synthetic recipient check',operationId:randomUUID()});assert.equal(r.profile.name,'Synthetic Recipient');}]
  ]){
   await inspector.call('Profiler.start');const elapsed=[];let profile;
   try{for(let i=0;i<3;i++){const start=performance.now();await invoke();elapsed.push(performance.now()-start);}}
   finally{profile=(await inspector.call('Profiler.stop')).profile;}
   cases.push({category,wall:summarizeWallMs(elapsed),cpuProfile:summarizeV8Profile(profile)});
  }
  assert.equal(f.getExternalCalls(),0);
  console.log('XRH_PARTNER_CPU_LOCAL '+JSON.stringify({scope:'SYNTHETIC_LOCAL_WORKERD',samplesPerRoute:3,cases,externalCalls:0,caveat:'Wall includes scheduling and I/O; V8 samples are not Cloudflare billed CPU or proof of the 10ms limit.'}));
 }finally{if(inspector)inspector.close();await f.mf.dispose();}
});
