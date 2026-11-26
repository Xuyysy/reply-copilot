import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import {pbkdf2Sync,createHmac,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {migrationStatements,summarizeWallMs} from '../scripts/lib/workerd-cpu-evidence.mjs';

// Two real local workerd isolates, synthetic credentials, no network or cloud.
// This is compatibility and dispatch latency evidence, NOT cloud CPU proof.
const API='https://isolated-api.example.test',WEB='https://isolated-web.example.test';
const AUTH='offline-rpc-test-auth-key-never-production-123';
const PEPPER='offline-rpc-test-pepper-never-production-123';
const PASSWORD='synthetic-local-password-2026!';
const NEW_PASSWORD='synthetic-reset-password-2026!';
const FACTORS=[10000,60000,100000,210000];
const VERIFIER='cf-free-local-rpc-verifier';

function bundle(path,extra={}){
  return buildSync({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,write:false,
    platform:'browser',format:'esm',target:'es2022',...extra}).outputFiles[0].text;
}
function manifest(contents,legacyCompat=false){const modules={'index.js':{type:'esm',contents}};if(legacyCompat)modules['legacy-210k.wasm']={type:'wasm',contents:new Uint8Array(readFileSync(new URL('../prototypes/cf-free-private-verifier/src/legacy-210k.wasm',import.meta.url)))};return {mainModule:'index.js',modules};}
const hash=(n,password=PASSWORD)=>'pbkdf2-sha256:'+n+':'+('ab'.repeat(16))+':'+pbkdf2Sync(password+'\0'+PEPPER,Buffer.alloc(16,0xab),n,32,'sha256').toString('hex');

async function setup(offload,legacyCompat=false,rollbackMatrix=false,adminEnabled=false){
  let outbound=0;
  const deny=()=>{outbound++;throw Error('External network forbidden');};
  const vars={ENVIRONMENT:'staging',WEB_ORIGIN:WEB,API_ORIGIN:API,EXTENSION_ORIGIN:'chrome-extension://'+'a'.repeat(32),
    AUTH_HASH_SECRET:AUTH,PASSWORD_PEPPER:PEPPER,AI_MODE:'mock',SUBSCRIPTIONS_ENABLED:'0',PAYMENTS_ENABLED:'0',
    ADMIN_PORTAL_ENABLED:adminEnabled?'1':'0',PASSWORD_VERIFY_DO_ENABLED:offload?'1':'0'};
  const env=Object.fromEntries(Object.entries(vars).map(([key,value])=>[key,{type:'text',value}]));
  env.DB={type:'d1',id:'synthetic-password-rpc'};
  if(offload)env.PASSWORD_VERIFY_DO={type:'durable-object',worker:VERIFIER,exportName:'PasswordVerifierDO'};
  const workers=[{config:{name:'cf-free-local-rpc-api',compatibilityDate:'2026-10-14',env,
    manifest:manifest(bundle('../src/index.ts'))},dev:{outboundService:{type:'fetcher',handler:deny}}}];
  if(offload)workers.push({config:{name:VERIFIER,compatibilityDate:'2026-10-14',
    env:{PASSWORD_PEPPER:{type:'text',value:PEPPER}},
    manifest:manifest(bundle(legacyCompat?'../prototypes/cf-free-private-verifier/src/index.ts':'../prototypes/cf-free-password-do/src/index.ts',{external:['cloudflare:workers','./legacy-210k.wasm']}),legacyCompat),
    exports:{PasswordVerifierDO:{type:'durable-object',storage:'sqlite'}}},
    dev:{outboundService:{type:'fetcher',handler:deny}}});
  if(rollbackMatrix){
    // Same synthetic D1 and secrets, separate API isolates; never a cloud rollout.
    for(const [name,enabled] of [['cf-free-local-rollback',false],['cf-free-local-missing-verifier',true]]){
      const isolated={...env, PASSWORD_VERIFY_DO_ENABLED:{type:'text',value:enabled?'1':'0'},
        PASSWORD_FREE_CPU_ENABLED:{type:'text',value:'0'},PASSWORD_FREE_TINY_CPU_ENABLED:{type:'text',value:'0'},
        PASSWORD_LEGACY_MIGRATION_ENABLED:{type:'text',value:'0'}};
      delete isolated.PASSWORD_VERIFY_DO;
      workers.push({config:{name,compatibilityDate:'2026-10-14',env:isolated,
        manifest:manifest(bundle('../src/index.ts'))},dev:{outboundService:{type:'fetcher',handler:deny}}});
    }
  }
  if(rollbackMatrix){
    // Route through a local test-only service binding, not Miniflare's
    // getWorker().fetch proxy, which may reject the synthetic HTTPS Origin.
    workers.unshift({config:{name:'cf-free-local-test-router',compatibilityDate:'2026-10-14',env:{
      CANDIDATE:{type:'worker',worker:'cf-free-local-rpc-api'},ROLLBACK:{type:'worker',worker:'cf-free-local-rollback'},BROKEN:{type:'worker',worker:'cf-free-local-missing-verifier'}},
      manifest:manifest(`export default {fetch(request,env){const headers=new Headers(request.headers);const target=headers.get('x-local-test-target');headers.delete('x-local-test-target');const binding=target==='rollback'?env.ROLLBACK:target==='broken'?env.BROKEN:env.CANDIDATE;return binding.fetch(new Request(request,{headers}));}}`)} ,dev:{outboundService:{type:'fetcher',handler:deny}}});
  }
  const mf=new Miniflare({workers});
  try{
    const db=await mf.getD1Database('DB','cf-free-local-rpc-api');
    const root=new URL('../migrations/',import.meta.url);
    for(const name of readdirSync(root).filter(n=>/^\d{4}_[\w-]+\.sql$/.test(n)).sort())
      for(const sql of migrationStatements(readFileSync(new URL(name,root),'utf8')))await db.prepare(sql).run();
    for(const n of FACTORS)await db.prepare('INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,status) VALUES(?,?,?,?,?,?,?)')
      .bind('test-'+n,'test-'+n+'@example.test',1,1,'testuser'+n,hash(n),'active').run();
    return {mf,db,outbound:()=>outbound};
  }catch(e){await mf.dispose();throw e;}
}

async function call(mf,path,body,ip=10){
  const started=performance.now();
  const response=await mf.dispatchFetch(API+path,{method:'POST',headers:{Origin:WEB,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+ip},body:JSON.stringify(body)});
  const data=await response.json();
  return {status:response.status,code:data?.code??null,wallMs:performance.now()-started,cookie:response.headers.get('set-cookie')};
}

test('CF Free actual local workerd password RPC and legacy compatibility matrix',{timeout:120000},async()=>{
  const results=[];
  for(const offload of [false,true]){
    const {mf,db,outbound}=await setup(offload);
    try{
      const cases=[];
      let sessions=0;
      for(const [i,n] of FACTORS.entries()){
        const identity='test-'+n+'@example.test';
        const samples=[];
        const a=await call(mf,'/v1/auth/login',{identity,password:PASSWORD},10+i);
        samples.push(a.wallMs);
        // 210k native WebCrypto may be unsupported in this runtime. Record
        // the exact limitation rather than treating a failed login as success.
        if(n===210000&&a.status!==200){
          assert.ok([500,503].includes(a.status),'legacy runtime failure must fail closed');
          assert.equal(a.cookie,null);
          assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').bind('test-'+n).first()).n,0);
          cases.push({factor:n,status:'RUNTIME_BLOCKED',httpStatus:a.status,code:a.code});
          continue;
        }
        assert.equal(a.status,200,'factor '+n+' offload '+offload+' '+a.code);
        assert.ok(a.cookie?.startsWith('rc_session='));
        const b=await call(mf,'/v1/auth/login',{identity,password:PASSWORD},10+i);
        assert.equal(b.status,200);
        samples.push(b.wallMs);
        sessions+=2;
        const wrong=await call(mf,'/v1/auth/login',{identity,password:'wrong-synthetic-password'},10+i);
        assert.equal(wrong.status,401);
        assert.equal(wrong.code,'INVALID_CREDENTIALS');
        assert.equal(wrong.cookie,null);
        assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').bind('test-'+n).first()).password_hash,hash(n));
        cases.push({factor:n,status:'COMPATIBLE',wall:summarizeWallMs(samples),wrongPasswordDenied:true});
      }
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions').first()).n,sessions);
      const user='test-100000',code='123456',now=Date.now();
      const digest=createHmac('sha256',AUTH).update('reset:'+user+':'+code).digest('hex');
      await db.prepare('INSERT INTO password_resets(user_id,code_hash,expires_at,sent_at,attempts) VALUES(?,?,?,?,0)').bind(user,digest,now+600000,now).run();
      const reset=await call(mf,'/v1/auth/reset-password',{email:user+'@example.test',code,password:NEW_PASSWORD},30);
      assert.equal(reset.status,200,'reset '+reset.code);
      const stored=(await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(user).first()).password_hash;
      const parts=stored.split(':');
      assert.equal(parts[1],'100000');
      assert.equal(parts[3],pbkdf2Sync(NEW_PASSWORD+'\0'+PEPPER,Buffer.from(parts[2],'hex'),100000,32,'sha256').toString('hex'));
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND revoked_at IS NULL').bind(user).first()).n,0);
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM password_resets WHERE user_id=?').bind(user).first()).n,0);
      assert.equal(outbound(),0);
      results.push({mode:offload?'real_do_rpc':'http_local',cases,reset:{status:200,originalFactor:100000,sessionsRevoked:true,challengeConsumed:true,wallMs:Number(reset.wallMs.toFixed(3))},externalCalls:0});
    }finally{await mf.dispose();}
  }
  console.log('CF_FREE_REAL_PASSWORD_RPC '+JSON.stringify({scope:'LOCAL_WORKERD_ONLY',freeCertified:false,results}));
});

// Real production HTTP handler + private candidate verifier + real local D1.
// This is not an authorization to deploy or a cloud CPU measurement.
test('CF Free actual business login with isolated 210k compatibility candidate preserves sessions and legacy hashes',{timeout:120000},async()=>{
  const {mf,db,outbound}=await setup(true,true);
  try{
    const user='test-210000',identity=user+'@example.test',before=hash(210000);
    const denied=await call(mf,'/v1/auth/login',{identity,password:'wrong-synthetic-password'},40);
    assert.equal(denied.status,401);assert.equal(denied.cookie,null);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').bind(user).first()).n,0);
    const accepted=await call(mf,'/v1/auth/login',{identity,password:PASSWORD},40);
    assert.equal(accepted.status,200);assert.ok(accepted.cookie?.startsWith('rc_session='));
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND revoked_at IS NULL').bind(user).first()).n,1);
    assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(user).first()).password_hash,before);
    const now=Date.now(),code='123456',digest=createHmac('sha256',AUTH).update('reset:'+user+':'+code).digest('hex');
    await db.prepare('INSERT INTO password_resets(user_id,code_hash,expires_at,sent_at,attempts) VALUES(?,?,?,?,0)').bind(user,digest,now+600000,now).run();
    const reset=await call(mf,'/v1/auth/reset-password',{email:identity,code,password:NEW_PASSWORD},41);
    assert.equal(reset.status,200);
    const stored=(await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(user).first()).password_hash;
    const [,factor,salt,expected]=stored.split(':');
    assert.equal(factor,'100000');assert.equal(expected,pbkdf2Sync(NEW_PASSWORD+'\0'+PEPPER,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex'));
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND revoked_at IS NULL').bind(user).first()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM password_resets WHERE user_id=?').bind(user).first()).n,0);
    assert.equal(outbound(),0);
    console.log('CF_FREE_REAL_210K_COMPAT_AUTH '+JSON.stringify({scope:'LOCAL_WORKERD_ONLY',loginStatus:accepted.status,wrongStatus:denied.status,legacyHashPreservedBeforeReset:true,resetStatus:reset.status,sessionsRevoked:true,challengeConsumed:true,externalCalls:0,freeCertified:false}));
  }finally{await mf.dispose();}
});

test('private candidate rollback and missing binding fail closed against the same synthetic account state',{timeout:120000},async()=>{
  const {mf,db,outbound}=await setup(true,true,true);
  try{
    const rollback='rollback',broken='broken';
    const login=(target,identity,password,ip)=>call({dispatchFetch:(url,init)=>mf.dispatchFetch(url,{...init,headers:{...init.headers,'x-local-test-target':target}})},'/v1/auth/login',{identity,password},ip);
    const user='test-210000', identity=user+'@example.test', before=hash(210000);
    const first=await call(mf,'/v1/auth/login',{identity,password:PASSWORD},50);
    assert.equal(first.status,200);
    assert.ok(first.cookie?.startsWith('rc_session='));
    const unavailable=await login(broken,identity,PASSWORD,51);
    assert.equal(unavailable.status,503);
    assert.equal(unavailable.code,'PASSWORD_VERIFIER_UNAVAILABLE');
    assert.equal(unavailable.cookie,null);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').bind(user).first()).n,1);
    // Native fallback is tested only with the flag deliberately off on a
    // separate compatible API isolate. Local native success is NOT Free CPU.
    for(const [i,n] of FACTORS.entries()){
      const id='test-'+n, email=id+'@example.test';
      const denied=await login(rollback,email,'wrong-synthetic-password',60+i);
      assert.equal(denied.status,401,'rollback must reject invalid credentials '+n);
      assert.equal(denied.cookie,null);
      const accepted=await login(rollback,email,PASSWORD,70+i);
      assert.equal(accepted.status,200,'compatible rollback must accept '+n);
      assert.ok(accepted.cookie?.startsWith('rc_session='));
      assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(id).first()).password_hash,hash(n));
    }
    assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(user).first()).password_hash,before);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').bind(user).first()).n,2);
    assert.equal(outbound(),0);
    console.log('CF_FREE_PRIVATE_ROLLBACK '+JSON.stringify({scope:'LOCAL_WORKERD_ONLY',sameSyntheticD1:true,missingBindingFailClosed:true,rollbackFactors:FACTORS,legacyHashesUnchanged:true,externalCalls:0,paidRollbackRehearsed:false,freeCertified:false}));
  }finally{await mf.dispose();}
});

test('private verifier handles real administrator reauthentication and password change with unchanged audit and session safety',{timeout:120000},async()=>{
  const {mf,db,outbound}=await setup(true,true,true,true);
  try{
    const user='test-210000',identity=user+'@example.test';
    await db.prepare("UPDATE users SET role='admin' WHERE id=?").bind(user).run();
    await db.prepare("INSERT INTO site_administrator VALUES(1,?,1)").bind(user).run();
    const a=await call(mf,'/v1/auth/login',{identity,password:PASSWORD},80);
    const b=await call(mf,'/v1/auth/login',{identity,password:PASSWORD},81);
    assert.equal(a.status,200);assert.equal(b.status,200);
    const cookie=a.cookie.split(';')[0],token=decodeURIComponent(cookie.slice('rc_session='.length));
    const csrf=createHmac('sha256',AUTH).update('csrf:'+token).digest('hex');
    const request=async(path,body,target='candidate',csrfToken=csrf)=>{
      const response=await mf.dispatchFetch(API+path,{method:'POST',headers:{Origin:WEB,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.82',Cookie:cookie,'X-CSRF-Token':csrfToken,'x-local-test-target':target},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    const readHash=async()=> (await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(user).first()).password_hash;
    const count=async(sql)=> (await db.prepare(sql).first()).n;
    assert.equal((await request('/v1/admin/reauth',{password:PASSWORD},'candidate','')).status,403);
    assert.equal((await request('/v1/admin/reauth',{password:'wrong-synthetic-password'})).status,401);
    const denied=await request('/v1/admin/reauth',{password:PASSWORD},'broken');
    assert.equal(denied.status,503);assert.equal(denied.body.code,'PASSWORD_VERIFIER_UNAVAILABLE');
    assert.equal(await count('SELECT count(*) n FROM admin_reauth_sessions'),0);
    assert.equal((await request('/v1/admin/reauth',{password:PASSWORD})).status,200);
    const body={operationId:randomUUID(),reason:'Synthetic admin password migration test',oldPassword:PASSWORD,newPassword:NEW_PASSWORD,confirmPassword:NEW_PASSWORD};
    assert.equal((await request('/v1/admin/security/password',body,'broken')).status,503);
    assert.equal(await readHash(),hash(210000));
    assert.equal(await count('SELECT count(*) n FROM admin_operations'),0);
    assert.equal(await count('SELECT count(*) n FROM admin_audit_logs'),0);
    assert.equal((await request('/v1/admin/security/password',body)).status,200);
    const stored=await readHash(),[,factor,salt,digest]=stored.split(':');
    assert.equal(factor,'100000');assert.equal(digest,pbkdf2Sync(NEW_PASSWORD+'\0'+PEPPER,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex'));
    assert.equal(await count('SELECT count(*) n FROM admin_reauth_sessions'),0);
    assert.equal(await count('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL'),1);
    assert.equal(await count('SELECT count(*) n FROM admin_operations'),1);
    assert.equal(await count('SELECT count(*) n FROM admin_audit_logs'),1);
    assert.equal((await request('/v1/admin/security/password',body)).status,200);
    assert.equal(await count('SELECT count(*) n FROM admin_audit_logs'),1);
    assert.equal((await call(mf,'/v1/auth/login',{identity,password:PASSWORD},83)).status,401);
    assert.equal((await call(mf,'/v1/auth/login',{identity,password:NEW_PASSWORD},84)).status,200);
    assert.equal(outbound(),0);
    console.log('CF_FREE_PRIVATE_ADMIN_RPC '+JSON.stringify({scope:'LOCAL_WORKERD_ONLY',reauth:true,passwordChange:true,missingBindingFailClosed:true,legacy210k:true,creationFactor:100000,externalCalls:0,freeCertified:false}));
  }finally{await mf.dispose();}
});
