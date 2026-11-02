import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';
import {auditOptions,auditPage,runCreditAudit} from '../scripts/lib/credit-audit.mjs';
const now=Date.UTC(2026,10,2,12),DAY=86400000;
function request(f,user,id,{legacy=false,at=now-1000}={}){
 if(user!=='test-user')f.sql.prepare('INSERT INTO users(id,email,email_verified_at,created_at) VALUES(?,?,1,1)').run(user,user+'@example.test');
 f.sql.prepare(`INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,delivery_confirmed_at,delivery_confirmation_id)
  VALUES(?,?,'2026-11-02',?,'succeeded',1,'hash',?,?,?,?)`).run(user,id,user+':'+id,at,legacy?'unknown':'awaiting_delivery',legacy?null:at,legacy?null:'ack-'+user+id);
}
function cost(f,user,id){f.sql.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) VALUES(?,?,'mock',1,1,1,?)").run(user,id,now)}
function allocation(f,user,id){f.sql.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,state,created_at,consumed_at) VALUES(?,?,?,'free-batch','consumed',?,?)").run(user+id,user,id,now,now)}
function debit(f,user,id,reference=user+':'+id){f.sql.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES(?,?,'generation_debit',-1,0,?,?)").run(user+id,user,reference,now)}

test('audit bounds default to24h and reject full history, oversized pages, future windows and unconfirmed expanded ranges',()=>{
 assert.deepEqual(auditOptions({},now),{since:now-DAY,until:now,limit:200,pages:1,rowsReadBudget:5000,after:null});
 for(const options of [{since:0},{since:now-2*DAY},{limit:501},{pages:6},{until:now+1},{since:now},{rowsReadBudget:20001}])assert.throws(()=>auditOptions(options,now));
 assert.equal(auditOptions({since:now-2*DAY,confirmExpandedWindow:true},now).limit,200);
 assert.throws(()=>auditOptions({since:now-8*DAY,confirmExpandedWindow:true},now));
});
test('mixed legacy/current data uses full user/request keys and exact ledger reference without inventing missing legacy credits',async()=>{
 const f=fixture();try{
  request(f,'test-user','shared');cost(f,'test-user','shared');allocation(f,'test-user','shared');debit(f,'test-user','shared');
  request(f,'another','shared'); // Another account's records must not satisfy these joins.
  request(f,'test-user','legacy',{legacy:true});
  request(f,'test-user','prefix');cost(f,'test-user','prefix');allocation(f,'test-user','prefix');debit(f,'test-user','prefix','test-user:prefix-extra');
  request(f,'test-user','wrong-bucket');cost(f,'test-user','wrong-bucket');allocation(f,'test-user','wrong-bucket');debit(f,'test-user','wrong-bucket');f.sql.exec("UPDATE credit_ledger SET free_delta=0,paid_delta=-1 WHERE reference_id='test-user:wrong-bucket'");
  request(f,'test-user','old-missing',{at:now-3*DAY});
  const result=await runCreditAudit(f.DB,{},now);
  assert.deepEqual(result.counts,{checked:5,modern:4,legacyUnattributed:1,missingAllocations:1,missingCosts:1,missingDebits:2,invalidDebit:1});
  assert.equal(result.metrics.rowsRead,null,'node SQLite has no D1 rows_read: never manufacture a count');
  assert.ok(result.complete);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM ai_requests').get().n,6);
 }finally{f.sql.close()}
});
test('keyset pages with tied times visit each request once and read budget stops subsequent queries',async()=>{
 const f=fixture();try{
  for(const id of ['a','b','c'])request(f,'test-user',id,{legacy:true});
  const result=await runCreditAudit(f.DB,{limit:1,pages:3},now);assert.equal(result.counts.checked,3);assert.equal(result.metrics.queries,3);
  const original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{const s=original(sql),all=s.all;s.all=async()=>({...await all.call(s),meta:{rows_read:9000,rows_written:0,duration:1}});return s;};
  const stopped=await runCreditAudit(f.DB,{limit:1,pages:5},now);assert.equal(stopped.metrics.queries,1);assert.equal(stopped.stoppedBecause,'read_budget');
  const q=auditPage(auditOptions({},now));assert.match(q.sql,/MATERIALIZED/);assert.doesNotMatch(q.sql,/instr\(|\bLIKE\b/i);
 }finally{f.sql.close()}
});

test('read consumption warns even when a short final page exhausts the window',async()=>{
 const result=await runCreditAudit({prepare(){return{bind(){return this},async all(){return{success:true,results:[],meta:{rows_read:9000,rows_written:0,duration:2}}}}}}, {},now);
 assert.equal(result.complete,true);assert.equal(result.metrics.queries,1);assert.match(result.warnings.join(' '),/Read budget/);
});
