import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';

const folder=mkdtempSync(join(tmpdir(),'xrh-cleanup-fk-'));
const bundle=join(folder,'cleanup.cjs');
buildSync({entryPoints:[new URL('../src/cleanup.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:bundle});
const {cleanup}=createRequire(import.meta.url)(bundle);
test.after(()=>rmSync(folder,{recursive:true,force:true}));
const now=Date.UTC(2026,10,27,3),day=86400000,old=now-31*day;
function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 assert.equal(sql.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 const DB={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async first(){return sql.prepare(query).get(...this.args)??null},async all(){return {results:sql.prepare(query).all(...this.args)}},async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}}}}},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>({meta:{changes:Number(sql.prepare(s.query).run(...s.args).changes)}}));sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 for(const u of ['owner','other'])sql.prepare('INSERT INTO users(id,email,email_verified_at,created_at) VALUES(?,?,1,1)').run(u,u+'@example.test');
 sql.exec("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('owner',8,9,1,1); INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,granted_at,history_confidence,status) VALUES('free-lot','owner','free','signup',10,8,2,1,'tracked','active'),('paid-lot','owner','paid','legacy_paid',10,9,1,1,'tracked','active');");
 sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at) VALUES('sub-order','owner','basic-v1','purchase',6990,'paid',1,2,1,1)").run();
 sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('sub-period','owner','sub-order','basic-v1',500,'active',?,?,1,1)").run(now-10*day,now+20*day);
 sql.exec("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('sub-period',0,1,0,1)");
 const seed=(u,id,status='succeeded',at=old,expires=now-1)=>sql.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,completed_at,raw_response,response_expires_at,generation_phase) VALUES(?,?,'2026-10-27',?,?,?,'synthetic-hash',?,?, 'synthetic-response',?,'unknown')").run(id,u,u+':'+id,status,status==='succeeded'?1:0,at,at+100,expires);
 for(const [id,b,state,status] of [['free-ok','free-lot','consumed','succeeded'],['paid-ok','paid-lot','consumed','succeeded'],['free-failed','free-lot','released','upstream_failed']]){
  seed('owner',id,status);sql.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,state,created_at) VALUES(?,'owner',?,?,?,?)").run('alloc:'+id,id,b,state,old);
 }
 for(const [id,state,status] of [['sub-ok','consumed','succeeded'],['sub-failed','released','upstream_failed']]){
  seed('owner',id,status);sql.prepare("INSERT INTO subscription_ai_allocations(id,user_id,request_id,period_id,day_index,state,created_at) VALUES(?,'owner',?,'sub-period',0,?,?)").run('alloc:'+id,id,state,old);
 }
 seed('other','free-ok');seed('other','sub-ok');seed('owner','old-orphan-ok');seed('owner','old-orphan-failed','upstream_failed');seed('owner','recent','succeeded',now-29*day,now+day);seed('owner','boundary','succeeded',now-30*day);seed('owner','old-uncertain','uncertain');
 sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('expired-session','synthetic-token','owner','web',1,?)").run(now-2*day);
 const snapshot=()=>Object.fromEntries(['credit_accounts','credit_batches','ai_credit_allocations','subscription_ai_allocations','subscription_daily_usage','subscription_orders','subscription_periods','credit_ledger','subscription_usage_events'].map(t=>[t,sql.prepare('SELECT * FROM '+t+' ORDER BY 1,2').all()]));
 return {sql,env:{DB,ENVIRONMENT:'production',SUBSCRIPTIONS_ENABLED:'1',AUTH_HASH_SECRET:'synthetic-auth-secret-not-real'},snapshot};
}
test('legacy 30-day delete reproduces restrictive FK failure in real migration schema',()=>{
 const f=setup();try{
  const before=f.snapshot();
  assert.throws(()=>f.sql.prepare("DELETE FROM ai_requests WHERE created_at<? AND status IN ('succeeded','upstream_failed')").run(now-30*day),/FOREIGN KEY constraint failed/);
  assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.sql.close()}
});
test('cleanup preserves permanent/subscription allocation parents and deletes only unreferenced expired terminal rows',async()=>{
 const f=setup();try{
  const before=f.snapshot();
  await cleanup(f.env,now);
  const rows=f.sql.prepare('SELECT user_id,request_id,raw_response,response_expires_at FROM ai_requests ORDER BY user_id,request_id').all();
  assert.deepEqual(rows.map(x=>x.user_id+':'+x.request_id),['owner:boundary','owner:free-failed','owner:free-ok','owner:old-uncertain','owner:paid-ok','owner:recent','owner:sub-failed','owner:sub-ok']);
  for(const r of rows){assert.equal(r.raw_response,r.request_id==='recent'?'synthetic-response':null);assert.equal(r.response_expires_at,r.request_id==='recent'?now+day:null)}
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sessions WHERE id='expired-session'").get().n,0);
  assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  await cleanup(f.env,now);
  assert.deepEqual(f.sql.prepare('SELECT user_id,request_id,raw_response,response_expires_at FROM ai_requests ORDER BY user_id,request_id').all(),rows);assert.deepEqual(f.snapshot(),before);
  console.log('XRH_CLEANUP_FK_REGRESSION '+JSON.stringify({scope:'LOCAL_SQLITE_ALL_MIGRATIONS',referencedRetained:5,unreferencedOldDeleted:4,expiredPayloadsCleared:7,financialRowsUnchanged:true,foreignKeyViolations:0,idempotent:true}));
 }finally{f.sql.close()}
});
