import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
const stagingAccount='cb5fc919a9f05dcf39b3ca29c9538a1f';
const dbid='cd44bb44-b525-42c4-b286-2cc84dae7fdb';
const worker='19b19a8a-6de9-435d-a9b2-c02284ab459a';
const pageSource='de69edbc2517ac7f1ced830b8bbc8865f724311c';
const url='https://api-staging.x-reply-helper.top';
const site='https://staging.x-reply-helper.top';
assert.equal(account,stagingAccount);
assert.ok(token && token.length>10);
assert.equal(process.env.GITHUB_REPOSITORY,'Xuyysy/reply-copilot');
const base='https://api.cloudflare.com/client/v4/accounts/'+account;
async function cf(method,path,body){
 const res=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const data=await res.json();
 if(!res.ok||data.success!==true)throw Error('Cloudflare '+path+' HTTP '+res.status+' '+JSON.stringify(data.errors||[]).slice(0,260));
 return data.result;
}
const db='/d1/database/'+dbid;
const sql=async(statement,params=[])=>{
 const q=await cf('POST',db+'/query',{sql:statement,params:params.map(String)});
 return q.flatMap(x=>x.results||[]);
};
const batch=async(arr)=>cf('POST',db+'/query',{batch:arr.map(([sql,params])=>({sql,params:params.map(String)}))});
const auth=async(path,{cookie,method='GET',csrf,body}={})=>{
 const headers={Origin:site,...(cookie?{Cookie:'rc_session='+cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})};
 if(body!==undefined){headers['Content-Type']='application/json';headers['X-Reply-Copilot-Action']='staging-ref119-admin-qa';}
 const res=await fetch(url+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual'});
 let data={};try{data=await res.json()}catch{}
 return {status:res.status,json:data};
};
const m=await cf('GET',db);
assert.equal(m.name,'reply-copilot-staging');
const workers=await cf('GET','/workers/scripts/reply-copilot-api-staging/deployments?page=1&per_page=1');
const w=(Array.isArray(workers)?workers:workers.deployments)[0];
assert.equal(w.versions[0].version_id,worker);
assert.equal(w.versions[0].percentage,100);
const pages=await cf('GET','/pages/projects/x-reply-helper-staging/deployments?page=1&per_page=1&env=production');
assert.equal(pages[0].deployment_trigger.metadata.commit_hash,pageSource);
assert.equal(pages[0].latest_stage.status,'success');
assert.equal((await sql("SELECT value FROM system_settings WHERE key='referrals_enabled'"))[0].value,'1');
console.log('PASS: exact Staging Worker, Pages, D1 and referral gate');
const nonce=randomUUID().replace(/-/g,'').slice(0,12);
const id='qa-ref119-admin-'+nonce;
const email=id+'@example.invalid';
const secret=randomBytes(32).toString('hex');
const hash=createHash('sha256').update(secret).digest('hex');
const sid=randomUUID();
const now=Date.now();
let seed=false,passed=false;
try{
 await batch([
  ["INSERT INTO users(id,email,email_verified_at,created_at,username,role,status,is_test_account,admin_note) VALUES(?,?,?,?,?,'admin','active',0,'PR119 ephemeral admin inviter smoke')",[id,email,now,now,'qa-admin-'+nonce]],
  ["INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,?,?)",[id,now,now]],
  ["INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,? ,?,'web',?,?)",[sid,hash,id,now,now+180000]]
 ]);
 seed=true;
 const info=await auth('/v1/referrals/me',{cookie:secret});
 assert.equal(info.status,200,'admin referral status');
 assert.equal(info.json.enabled,true);
 assert.equal(info.json.canInvite,true,'admin must be allowed to invite');
 assert.equal(info.json.link,null,'no link yet');
 console.log('PASS: authenticated admin role sees canInvite=true; create-link button can render');
 const csrf=await auth('/v1/auth/csrf',{cookie:secret});
 assert.equal(csrf.status,200,'admin csrf');
 assert.ok(typeof csrf.json.csrfToken==='string'&&csrf.json.csrfToken.length>15);
 const a=await auth('/v1/referrals/link',{cookie:secret,method:'POST',csrf:csrf.json.csrfToken,body:{}});
 assert.equal(a.status,200,'admin create link');
 const invite=new URL(a.json.link);
 assert.equal(invite.origin,site);
 assert.equal(invite.pathname,'/login/');
 assert.equal(invite.searchParams.get('mode'),'register');
 assert.match(invite.searchParams.get('ref'),/^[a-f0-9]{16}$/);
 const b=await auth('/v1/referrals/link',{cookie:secret,method:'POST',csrf:csrf.json.csrfToken,body:{}});
 assert.equal(b.status,200,'admin repeat link');
 assert.equal(b.json.link,a.json.link,'generated link stable on repeat');
 const after=await auth('/v1/referrals/me',{cookie:secret});
 assert.equal(after.status,200);
 assert.equal(after.json.link,a.json.link);
 assert.equal(after.json.canInvite,true);
 passed=true;
 console.log('PASS: Staging admin can generate, repeat, read stable invite URL; no real users changed');
}finally{
 if(seed){
  try {
   await batch([
    ["DELETE FROM referral_codes WHERE user_id=?",[id]],
    ["DELETE FROM sessions WHERE id=?",[sid]],
    ["DELETE FROM credit_accounts WHERE user_id=?",[id]],
    ["DELETE FROM users WHERE id=? AND email=?",[id,email]]
   ]);
   const left=await sql("SELECT COUNT(*) n FROM users WHERE id=?",[id]);
   assert.equal(left[0].n,0);
   console.log('PASS: synthetic admin user, session, credits and invite link fully deleted');
  }catch(e){
   // Conservative fallback: no active session or rewards if FK constraints change.
   await batch([
    ["UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL",[Date.now(),sid]],
    ["UPDATE users SET is_test_account=1,status='frozen',archived_at=?,admin_note='PR119 admin smoke cleanup pending' WHERE id=?",[Date.now(),id]]
   ]).catch(()=>{});
   throw e;
  }
 }
}
assert.ok(passed);
console.log('PASS PR119 STAGING ADMIN INVITATION E2E API SMOKE, ZERO PERSISTENT TEST USERS');
