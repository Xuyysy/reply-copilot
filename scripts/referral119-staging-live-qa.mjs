import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
const expectedAccount='cb5fc919a9f05dcf39b3ca29c9538a1f';
const dbid='cd44bb44-b525-42c4-b286-2cc84dae7fdb';
const worker='reply-copilot-api-staging';
const pages='x-reply-helper-staging';
const version='0b310725-0f1b-45e5-b18b-a5ef989ab76e';
const pagesSha='ae53b0a93e3846a69c9ece8c643bdb938c608c33';
const api='https://api-staging.x-reply-helper.top';
const website='https://staging.x-reply-helper.top';
const cloud='https://api.cloudflare.com/client/v4/accounts/'+account;
if(!token || account!==expectedAccount || process.env.GITHUB_REPOSITORY!=='Xuyysy/reply-copilot'){
 throw Error('Ref119 QA credentials or repo mismatch');
}
function sha(s){return createHash('sha256').update(s).digest('hex');}
async function cf(method,path,body){
 const r=await fetch(cloud+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const data=await r.json();
 if(!r.ok||data.success!==true)throw Error('Cloudflare request failed: '+path+' HTTP '+r.status+' code '+JSON.stringify(data.errors||[]).slice(0,240));
 return data.result;
}
const db='/d1/database/'+dbid;
async function sql(statement,params=[]){
 const result=await cf('POST',db+'/query',{sql:statement,params:params.map(x=>String(x))});
 return (result||[]).flatMap(x=>x.results||[]);
}
async function batch(statements){
 const result=await cf('POST',db+'/query',{batch:statements.map(([statement,params])=>({sql:statement,params:params.map(x=>String(x))}))});
 assert.equal(result.length,statements.length,'D1 batch returned incorrect statement count');
 assert.ok(result.every(r=>r.success!==false),'D1 batch failed');
 return result;
}
async function get(path,{cookie,method='GET',body,csrf}={}){
 const headers={Origin:website};
 if(cookie)headers.Cookie='rc_session='+cookie;
 if(body!==undefined){headers['Content-Type']='application/json';headers['X-Reply-Copilot-Action']='staging-referral119-qa';}
 if(csrf)headers['X-CSRF-Token']=csrf;
 const r=await fetch(api+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
 let data={};
 try{data=await r.json()}catch{}
 return {status:r.status,body:data};
}
const meta=await cf('GET',db);
assert.equal(meta.name,'reply-copilot-staging');
const deployed=await cf('GET','/workers/scripts/'+worker+'/deployments?page=1&per_page=1');
const active=(Array.isArray(deployed)?deployed:deployed.deployments)[0];
assert.equal(active.versions[0].version_id,version);
assert.equal(active.versions[0].percentage,100);
const site=await cf('GET','/pages/projects/'+pages+'/deployments?page=1&per_page=1&env=production');
assert.equal(site[0].deployment_trigger.metadata.commit_hash,pagesSha);
assert.equal(site[0].latest_stage.status,'success');
const flag=(await sql("SELECT value FROM system_settings WHERE key='referrals_enabled'"))[0]?.value;
assert.equal(flag,'1');
assert.equal((await sql("SELECT COUNT(*) n FROM d1_migrations WHERE name='0027_referral_rewards_v1.sql'"))[0].n,1);
console.log('PASS staging target, exact Pages/Worker versions, 0027 schema, referral flag ON');

const nonce=randomUUID().slice(0,12);
const inviter='qa-ref119-inviter-'+nonce;
const invitee='qa-ref119-invitee-'+nonce;
const email1='qa-ref119-inviter-'+nonce+'@example.invalid';
const email2='qa-ref119-invitee-'+nonce+'@example.invalid';
const codeRef='qa-ref119-'+nonce;
const token1=randomBytes(32).toString('hex');
const token2=randomBytes(32).toString('hex');
const sessionId1=randomUUID(),sessionId2=randomUUID();
const requestId=randomUUID(),requestNonce=randomUUID();
const signupBatch='qa-ref119-welcome-'+nonce;
const digest1='qa-ref119-device-a-'+nonce;
const digest2='qa-ref119-device-b-'+nonce;
const now=Date.now();
let seeded=false;
let passed=false;
try{
 const s=[
  ["INSERT INTO users(id,email,email_verified_at,created_at,username,status,role,is_test_account,admin_note) VALUES(?,?,?,?,?,'active','user',0,'PR119 short-lived Staging QA')",[inviter,email1,now,now,'qa-inviter-'+nonce]],
  ["INSERT INTO users(id,email,email_verified_at,created_at,username,status,role,is_test_account,admin_note) VALUES(?,?,?,?,?,'active','user',0,'PR119 short-lived Staging QA')",[invitee,email2,now,now,'qa-invitee-'+nonce]],
  ["INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,?,?)",[inviter,now,now]],
  ["INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,199,0,?,?)",[invitee,now,now]],
  ["INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,granted_at,history_confidence,status) VALUES(?,?,'free','signup',200,199,1,?,'tracked','active')",[signupBatch,invitee,now]],
  ["INSERT INTO signup_benefit_claims(user_id,grant_amount,status,device_digest,claim_nonce,created_at,granted_at) VALUES(?,200,'granted',?,?,?,?)",[invitee,digest2,'qa-claim-'+nonce,now,now]],
  ["INSERT INTO device_free_claims(device_digest,user_id,claimed_at) VALUES(?,?,?)",[digest1,inviter,now]],
  ["INSERT INTO device_free_claims(device_digest,user_id,claimed_at) VALUES(?,?,?)",[digest2,invitee,now]],
  ["INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,? ,?,'web',?,?)",[sessionId1,sha(token1),inviter,now,now+600000]],
  ["INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,? ,?,'web',?,?)",[sessionId2,sha(token2),invitee,now,now+600000]],
  ["INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,raw_response,created_at,completed_at,delivery_confirmed_at,delivery_confirmation_id,credit_source,generation_phase) VALUES(?,?,'2026-11-13',?,'succeeded',1,?,'{\"replies\":{\"natural\":\"qa\",\"light_humor\":\"qa\",\"thoughtful\":\"qa\"}}',?,?,?,?,'free','unknown')",[requestId,invitee,requestNonce,'qa-hash',now,now,now,'qa-confirmed-'+nonce]],
  ["INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at,consumed_at) VALUES(?,?,?,?,1,'consumed',?,?)",[randomUUID(),invitee,requestId,signupBatch,now,now]],
  ["INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES(?,?,'signup_grant',200,0,?,'PR119 synthetic QA signup',?)",[randomUUID(),invitee,'qa-signup-'+nonce,now]],
  ["INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES(?,?,'generation_debit',-1,0,?,'PR119 synthetic QA delivery ACK only',?)",[randomUUID(),invitee,invitee+':'+requestId,now]]
 ];
 await batch(s);
 seeded=true;
 console.log('PASS two synthetic Staging-only QA accounts seeded; no real email, AI or merchant call');
 const initial=await get('/v1/referrals/me',{cookie:token1});
 assert.equal(initial.status,200,'inviter account referral endpoint');
 assert.equal(initial.body.enabled,true);
 assert.equal(initial.body.canInvite,true);
 const csrf=await get('/v1/auth/csrf',{cookie:token1});
 assert.equal(csrf.status,200,'CSRF endpoint');
 assert.ok(typeof csrf.body.csrfToken==='string'&&csrf.body.csrfToken.length>10);
 const link=await get('/v1/referrals/link',{cookie:token1,method:'POST',body:{},csrf:csrf.body.csrfToken});
 assert.equal(link.status,200,'link creation');
 const url=new URL(link.body.link);
 assert.equal(url.origin,website);
 assert.equal(url.pathname,'/login/');
 const code=url.searchParams.get('ref');
 assert.match(code,/^[a-f0-9]{16}$/);
 const link2=await get('/v1/referrals/link',{cookie:token1,method:'POST',body:{},csrf:csrf.body.csrfToken});
 assert.equal(link2.status,200,'link repeat');
 assert.equal(link2.body.link,link.body.link,'invite link must be stable');
 console.log('PASS authenticated referral link generation, CSRF, stable code and Staging URL');
 await sql("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,status,registered_at) VALUES(?,?,?,'pending',?)",[invitee,inviter,code,now]);
 const reward=await get('/v1/referrals/me',{cookie:token2});
 assert.equal(reward.status,200,'invitee award-triggering endpoint');
 assert.equal(reward.body.invitedBy?.status,'rewarded');
 const a1=await sql("SELECT COUNT(*) n,COALESCE(SUM(amount),0) total FROM referral_awards WHERE invited_user_id=?",[invitee]);
 assert.equal(a1[0].n,2);
 assert.equal(a1[0].total,100);
 const credit=await sql("SELECT user_id,free_balance,paid_balance FROM credit_accounts WHERE user_id IN (?,?) ORDER BY user_id",[inviter,invitee]);
 assert.equal(credit.find(x=>x.user_id===inviter).free_balance,50);
 assert.equal(credit.find(x=>x.user_id===invitee).free_balance,249);
 assert.ok(credit.every(x=>x.paid_balance===0));
 const inv=await get('/v1/referrals/me',{cookie:token1});
 assert.equal(inv.status,200);
 assert.equal(inv.body.rewarded,1);
 assert.equal(inv.body.earnedCredits,50);
 await get('/v1/referrals/me',{cookie:token2});
 assert.equal((await sql("SELECT COUNT(*) n FROM referral_awards WHERE invited_user_id=?",[invitee]))[0].n,2,'no double awards on replay');
 assert.equal((await sql("SELECT COUNT(*) n FROM credit_ledger WHERE reason LIKE 'referral_reward:%' AND user_id IN (?,?)",[inviter,invitee]))[0].n,2);
 console.log('PASS first confirmed delivered reply awards +50/+50; 2 exact ledger entries, stable balances, replay idempotency');
 const noAdmin=await get('/v1/admin/referrals');
 assert.equal(noAdmin.status,401);
 assert.equal(noAdmin.body.code,'AUTH_REQUIRED');
 const fk=await sql('PRAGMA foreign_key_check');
 assert.equal(fk.length,0);
 passed=true;
}finally{
 if(seeded){
  const done=Date.now();
  await batch([
   ["UPDATE sessions SET revoked_at=? WHERE id IN (?,?) AND revoked_at IS NULL",[done,sessionId1,sessionId2]],
   ["UPDATE users SET is_test_account=1,status='frozen',archived_at=?,admin_note='PR119 STAGING SYNTHETIC QA - FROZEN' WHERE id IN (?,?) AND email LIKE 'qa-ref119-%@example.invalid'",[done,inviter,invitee]]
  ]);
  const frozen=await sql("SELECT COUNT(*) n FROM users WHERE id IN (?,?) AND is_test_account=1 AND status='frozen' AND archived_at IS NOT NULL",[inviter,invitee]);
  assert.equal(frozen[0].n,2);
  console.log('PASS temporary accounts frozen/marked TEST and web sessions revoked; no existing users modified');
 }
}
if(!passed)throw Error('Ref119 Staging live QA failed');
console.log('PASS STAGING PR119 LIVE CONTROLLED REFERRAL QA, no upstream AI calls, merchant charges or Production actions');
