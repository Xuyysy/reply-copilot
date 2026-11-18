import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

// A completely isolated SQLite test fixture: no external Cloudflare/D1 calls.
function admin(){
 const f=fixture();f.env.ADMIN_PORTAL_ENABLED='1';f.env.AI_MODE='production';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator VALUES(1,'test-user',1)");
 return f;
}
const get=(f,view)=>f.call('/v1/admin/dashboard'+(view?'?view='+view:''),{method:'GET'});
const spy=f=>{const queries=[];const prepare=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{queries.push(String(sql));return prepare(sql);};return queries;};
const historicalSql=q=>/FROM credit_ledger|FROM credit_grants|FROM recharge_orders o LEFT JOIN payment_transactions/i.test(q);

test('CF Free: default admin overview skips all three lifetime history scans and monthly model attribution',async()=>{
 const f=admin();try{
  const seen=spy(f);
  const r=await get(f,'overview');
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.body.detailScope,'overview');
  assert.equal(r.body.newUsers7d,0);
  assert.ok(!('totalUsed' in r.body),'unknown legacy metric must not be silently reported as 0');
  assert.ok(!('users' in r.body),'total historical users deferred');
  assert.ok(!seen.some(historicalSql),JSON.stringify(seen.filter(historicalSql)));
  assert.ok(seen.some(q=>q.includes('COUNT(*) newUsers7d')&&q.includes('FROM users')),'retain index-covered 7-day KPI');
  assert.ok(!seen.some(q=>q.includes('FROM ai_usage_costs u')),'monthly cost is still deferred');
  assert.ok('dailyCostMicroUsd' in r.body,'current budget remains available');
  const unauth=fixture();try{assert.equal((await get(unauth,'history')).status,404);}finally{unauth.sql.close();}
 }finally{f.sql.close();}
});

test('CF Free: history view runs original exact aggregates only on demand, with authorization',async()=>{
 const f=admin();try{
  const seen=spy(f);
  let r=await get(f,'overview');
  assert.equal(seen.some(historicalSql),false);
  r=await get(f,'history');
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.body.users,1);
  for(const field of ['totalUsed','paidCreditsSpent','totalIssued','successfulOrders','revenue7dFen','totalFreeGranted','newUsers7d'])
   assert.equal(typeof r.body[field],'number',field);
  assert.ok(seen.some(q=>q.includes('FROM credit_ledger')),'explicit history view retains exact ledger semantics');
  assert.ok(seen.some(q=>q.includes('FROM credit_grants')),'explicit history keeps lifetime free grants');
  assert.ok(!seen.some(q=>q.includes('FROM ai_usage_costs u')),'historical bookkeeping does not trigger monthly AI models');
  f.sql.exec("UPDATE users SET role='user' WHERE id='test-user'");
  assert.equal((await get(f,'history')).status,403,'cache can never bypass admin authorization');
 }finally{f.sql.close();}
});

test('CF Free: AI cost view is exact but does not rerun lifetime history scans; full legacy endpoint is unchanged',async()=>{
 const f=admin();try{
  const seen=spy(f);
  let r=await get(f,'cost');
  assert.equal(r.status,200,JSON.stringify(r));
  assert.ok('todayCost' in r.body);
  assert.ok('costByModel' in r.body);
  assert.ok(!('totalUsed' in r.body));
  assert.ok(!seen.some(historicalSql),'opening AI model costs must not scan lifetime ledger');
  seen.length=0;
  r=await get(f);
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.body.users,1);
  assert.ok('totalUsed' in r.body);
  assert.ok('costByModel' in r.body);
  assert.ok(seen.some(q=>q.includes('FROM credit_ledger')),'legacy full endpoint remains compatible');
 }finally{f.sql.close();}
});
