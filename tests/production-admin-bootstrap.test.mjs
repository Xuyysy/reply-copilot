import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {bootstrapAdmin,inspectBootstrapTarget,PRODUCTION_DATABASE_ID} from '../tools/production-admin-bootstrap/bootstrap.mjs';
import {handleBootstrapRequest} from '../tools/production-admin-bootstrap/worker.mjs';
import {assertExecutionAuthorization,buildWranglerConfig,parseCliArgs} from '../tools/production-admin-bootstrap/run.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const userId='11111111-1111-4111-8111-111111111111';
const otherUserId='22222222-2222-4222-8222-222222222222';
const email='owner@example.com';
const guard={environment:'production',configuredDatabaseId:PRODUCTION_DATABASE_ID,requestedDatabaseId:PRODUCTION_DATABASE_ID,confirmedDatabaseId:PRODUCTION_DATABASE_ID,explicitAuthorization:true,typedConfirmationUserId:userId};

function localD1({verifiedAt=1,status='active',role='user',emailValue=email,secondUser=false}={}){
 const sqlite=new DatabaseSync(':memory:');
 const migrations=readdirSync(path.join(root,'api/migrations')).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort();
 for(const name of migrations)sqlite.exec(readFileSync(path.join(root,'api/migrations',name),'utf8'));
 sqlite.prepare('INSERT INTO users(id,email,email_verified_at,created_at,status,role) VALUES(?,?,?,?,?,?)').run(userId,emailValue,verifiedAt,1,status,role);
 if(secondUser)sqlite.prepare("INSERT INTO users(id,email,email_verified_at,created_at,status,role) VALUES(?,?,1,1,'active','user')").run(otherUserId,'other@example.com');
 const db={
  prepare(sql){return {sql,values:[],bind(...values){return {...this,values};},first(){return sqlite.prepare(sql).get(...this.values)??null;},run(){const result=sqlite.prepare(sql).run(...this.values);return {meta:{changes:Number(result.changes)}};}};},
  async batch(statements){
   sqlite.exec('BEGIN IMMEDIATE');
   try{const results=statements.map(statement=>{const result=sqlite.prepare(statement.sql).run(...statement.values);return {success:true,meta:{changes:Number(result.changes)}};});sqlite.exec('COMMIT');return results;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
 };
 return {db,sqlite};
}

const input={userId,email,reason:'Owner authorized initial Production administrator bootstrap'};

test('first bootstrap binds an existing active verified user and writes one audit record atomically',async()=>{
 const {db,sqlite}=localD1({});
 const result=await bootstrapAdmin(db,input,guard);
 assert.equal(result.ok,true);
 assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get(userId).role,'admin');
 assert.deepEqual(sqlite.prepare('SELECT id,user_id FROM site_administrator').all().map(row=>({id:row.id,user_id:row.user_id})),[{id:1,user_id:userId}]);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='initial_admin_bootstrap' AND actor_user_id=? AND target_id=?").get(userId,userId).n,1);
 sqlite.close();
});

test('preflight never returns the target email',async()=>{
 const {db,sqlite}=localD1({});
 const result=await inspectBootstrapTarget(db,input);
 assert.equal(result.eligible,true);
 assert.equal(JSON.stringify(result).includes(email),false);
 sqlite.close();
});

test('missing user is rejected without writes',async()=>{
 const {db,sqlite}=localD1({});
 const result=await inspectBootstrapTarget(db,{...input,userId:otherUserId});
 assert.equal(result.reason,'USER_NOT_FOUND');
 await assert.rejects(bootstrapAdmin(db,{...input,userId:otherUserId},{...guard,typedConfirmationUserId:otherUserId}),/USER_NOT_FOUND/);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get().n,0);
 sqlite.close();
});

test('unverified user is rejected',async()=>{
 const {db,sqlite}=localD1({verifiedAt:0});
 await assert.rejects(bootstrapAdmin(db,input,guard),/USER_NOT_VERIFIED/);
 assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get(userId).role,'user');
 sqlite.close();
});

test('disabled user is rejected',async()=>{
 const {db,sqlite}=localD1({status:'frozen'});
 await assert.rejects(bootstrapAdmin(db,input,guard),/USER_DISABLED/);
 sqlite.close();
});

test('email mismatch is rejected without revealing either address',async()=>{
 const {db,sqlite}=localD1({emailValue:'different@example.com'});
 const result=await inspectBootstrapTarget(db,input);
 assert.equal(result.reason,'EMAIL_MISMATCH');
 assert.equal(JSON.stringify(result).includes('different@example.com'),false);
 await assert.rejects(bootstrapAdmin(db,input,guard),/EMAIL_MISMATCH/);
 sqlite.close();
});

test('existing admin role blocks promotion',async()=>{
 const {db,sqlite}=localD1({secondUser:true});
 sqlite.prepare("UPDATE users SET role='admin' WHERE id=?").run(otherUserId);
 await assert.rejects(bootstrapAdmin(db,input,guard),/EXISTING_ADMIN/);
 assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get(userId).role,'user');
 sqlite.close();
});

test('existing singleton binding blocks promotion',async()=>{
 const {db,sqlite}=localD1({secondUser:true});
 sqlite.prepare('INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,?,1)').run(otherUserId);
 await assert.rejects(bootstrapAdmin(db,input,guard),/ADMIN_ALREADY_BOUND/);
 assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get(userId).role,'user');
 sqlite.close();
});

test('repeat bootstrap is rejected and leaves the original audit unchanged',async()=>{
 const {db,sqlite}=localD1({});
 await bootstrapAdmin(db,input,guard);
 await assert.rejects(bootstrapAdmin(db,input,guard),/USER_NOT_ORDINARY|EXISTING_ADMIN|ADMIN_ALREADY_BOUND/);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='initial_admin_bootstrap'").get().n,1);
 sqlite.close();
});

test('concurrent bootstrap attempts produce exactly one success',async()=>{
 const {db,sqlite}=localD1({});
 const outcomes=await Promise.allSettled([bootstrapAdmin(db,input,guard),bootstrapAdmin(db,input,guard)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get().n,1);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM site_administrator').get().n,1);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='initial_admin_bootstrap'").get().n,1);
 sqlite.close();
});

test('audit failure rolls back role and singleton binding',async()=>{
 const {db,sqlite}=localD1({});
 sqlite.exec("CREATE TRIGGER fail_bootstrap_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='initial_admin_bootstrap' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END;");
 await assert.rejects(bootstrapAdmin(db,input,guard),/simulated audit failure/);
 assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get(userId).role,'user');
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM site_administrator').get().n,0);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='initial_admin_bootstrap'").get().n,0);
 sqlite.close();
});

test('wrong environment or database is rejected before any database call',async()=>{
 let calls=0;const db={prepare(){calls++;throw new Error('database must not be touched');},batch(){calls++;throw new Error('database must not be touched');}};
 await assert.rejects(bootstrapAdmin(db,input,{...guard,environment:'staging'}),/WRONG_ENVIRONMENT/);
 await assert.rejects(bootstrapAdmin(db,input,{...guard,configuredDatabaseId:'00000000-0000-0000-0000-000000000001'}),/WRONG_DATABASE/);
 await assert.rejects(bootstrapAdmin(db,input,{...guard,requestedDatabaseId:'00000000-0000-0000-0000-000000000001'}),/WRONG_DATABASE/);
 assert.equal(calls,0);
});

test('missing explicit authorization is rejected before any database call',async()=>{
 let calls=0;const db={prepare(){calls++;},batch(){calls++;}};
 await assert.rejects(bootstrapAdmin(db,input,{...guard,explicitAuthorization:false}),/OWNER_AUTHORIZATION_REQUIRED/);
 assert.equal(calls,0);
});

test('unauthorized local HTTP request never touches D1',async()=>{
 let calls=0;const db={prepare(){calls++;throw new Error('unexpected database call');},batch(){calls++;throw new Error('unexpected database call');}};
 const response=await handleBootstrapRequest(new Request('http://127.0.0.1/inspect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),{ENVIRONMENT:'production',BOOTSTRAP_TARGET_DATABASE_ID:PRODUCTION_DATABASE_ID,BOOTSTRAP_SESSION_TOKEN:'a'.repeat(43),DB:db});
 assert.equal(response.status,404);assert.equal(calls,0);
});

test('wrong Worker environment or configured database is rejected before D1 access',async()=>{
 let calls=0;const db={prepare(){calls++;throw new Error('unexpected database call');},batch(){calls++;throw new Error('unexpected database call');}};
 for(const env of [
  {ENVIRONMENT:'staging',BOOTSTRAP_TARGET_DATABASE_ID:PRODUCTION_DATABASE_ID,BOOTSTRAP_SESSION_TOKEN:'a'.repeat(43),DB:db},
  {ENVIRONMENT:'production',BOOTSTRAP_TARGET_DATABASE_ID:'00000000-0000-0000-0000-000000000001',BOOTSTRAP_SESSION_TOKEN:'a'.repeat(43),DB:db}
 ]){
  const response=await handleBootstrapRequest(new Request('http://127.0.0.1/inspect',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(43)},body:JSON.stringify(input)}),env);
  assert.equal(response.status,404);
 }
 assert.equal(calls,0);
});

test('only authenticated POST inspect and execute routes are accepted',async()=>{
 const {db,sqlite}=localD1({});const token='z'.repeat(43);const env={ENVIRONMENT:'production',BOOTSTRAP_TARGET_DATABASE_ID:PRODUCTION_DATABASE_ID,BOOTSTRAP_SESSION_TOKEN:token,DB:db};
 const get=await handleBootstrapRequest(new Request('http://127.0.0.1/inspect'),env);assert.equal(get.status,404);
 const wrongPath=await handleBootstrapRequest(new Request('http://127.0.0.1/anything',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(input)}),env);assert.equal(wrongPath.status,404);
 const badJson=await handleBootstrapRequest(new Request('http://127.0.0.1/inspect',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{' }),env);assert.equal(badJson.status,400);
 const inspect=await handleBootstrapRequest(new Request('http://127.0.0.1/inspect',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)}),env);
 assert.equal(inspect.status,200);assert.equal((await inspect.json()).result.eligible,true);
 sqlite.close();
});

test('execute route needs explicit owner authorization and typed target confirmation',async()=>{
 let calls=0;const db={prepare(){calls++;throw new Error('unexpected database call');},batch(){calls++;throw new Error('unexpected database call');}};const token='q'.repeat(43);const env={ENVIRONMENT:'production',BOOTSTRAP_TARGET_DATABASE_ID:PRODUCTION_DATABASE_ID,BOOTSTRAP_SESSION_TOKEN:token,DB:db};
 const body={...input,requestedDatabaseId:PRODUCTION_DATABASE_ID,confirmedDatabaseId:PRODUCTION_DATABASE_ID,explicitAuthorization:false,typedConfirmationUserId:userId};
 const response=await handleBootstrapRequest(new Request('http://127.0.0.1/execute',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),env);
 assert.equal(response.status,403);assert.equal((await response.json()).code,'OWNER_AUTHORIZATION_REQUIRED');assert.equal(calls,0);
});

test('CLI defaults to offline dry-run and refuses execute without every authorization gate',()=>{
 const args=parseCliArgs(['--user-id='+userId,'--expected-email='+email,'--target-database-id='+PRODUCTION_DATABASE_ID]);
 assert.equal(args.execute,false);assert.throws(()=>assertExecutionAuthorization({...args,execute:true}),/OWNER_AUTHORIZATION_REQUIRED/);
 assert.throws(()=>assertExecutionAuthorization({...args,execute:true,authorizeProductionBootstrap:true,confirmProductionDatabaseId:PRODUCTION_DATABASE_ID}),/INTERACTIVE_CONFIRMATION_REQUIRED/);
 assert.throws(()=>assertExecutionAuthorization({...args,execute:true,authorizeProductionBootstrap:true,confirmProductionDatabaseId:'00000000-0000-0000-0000-000000000001',interactiveConfirmation:true}),/WRONG_DATABASE/);
 assert.doesNotThrow(()=>assertExecutionAuthorization({...args,execute:true,authorizeProductionBootstrap:true,confirmProductionDatabaseId:PRODUCTION_DATABASE_ID,interactiveConfirmation:true}));
});

test('temporary Wrangler config binds only the fixed Production D1 remotely and has no routes',()=>{
 const config=buildWranglerConfig({name:'reply-copilot-api-production',compatibility_date:'2026-10-14',vars:{ENVIRONMENT:'production'},routes:[{pattern:'api.x-reply-helper.top',custom_domain:true}],d1_databases:[{binding:'DB',database_name:'reply-copilot-production',database_id:PRODUCTION_DATABASE_ID}]},'../../tools/production-admin-bootstrap/worker.mjs');
 assert.equal(config.workers_dev,false);assert.deepEqual(config.routes,[]);assert.deepEqual(config.d1_databases,[{binding:'DB',database_name:'reply-copilot-production',database_id:PRODUCTION_DATABASE_ID,remote:true}]);
 assert.equal(config.vars.ENVIRONMENT,'production');assert.equal(config.vars.BOOTSTRAP_TARGET_DATABASE_ID,PRODUCTION_DATABASE_ID);assert.equal(config.main.startsWith('/'),false);
 assert.throws(()=>buildWranglerConfig({name:'reply-copilot-api-staging',vars:{ENVIRONMENT:'staging'},d1_databases:[{binding:'DB',database_name:'staging',database_id:'00000000-0000-0000-0000-000000000001'}]},'/tmp/worker.mjs'),/WRONG_PRODUCTION_CONFIG/);
});
