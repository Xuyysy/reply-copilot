import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,worker,enableEpaySales} from './helpers/payment-v2.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const op=extra=>({operationId:randomUUID(),reason:'管理员本地运营功能测试',...extra});
function setup(){const f=enableEpaySales(fixture());f.sql.exec('PRAGMA foreign_keys=OFF');for(const table of ['users','sessions','credit_accounts','credit_batches'])f.sql.prepare(`UPDATE ${table} SET ${table==='users'?'id':'user_id'}=? WHERE ${table==='users'?'id':'user_id'}='test-user'`).run(owner);f.sql.prepare("UPDATE users SET role='admin' WHERE id=?").run(owner);f.sql.prepare('INSERT INTO site_administrator VALUES(1,?,1)').run(owner);f.sql.prepare("INSERT INTO admin_reauth_sessions VALUES('test-session',?)").run(Date.now()+900000);f.env.ADMIN_PORTAL_ENABLED='1';Object.assign(f.env,{PAYMENT_PROVIDER:'xiaodou_epay',XIAODOU_EPAY_GATEWAY:'https://epay.example.test/submit.php',XIAODOU_EPAY_PID:'12345',XIAODOU_EPAY_KEY:'test-key'});return f;}
test('user filters use database evidence and notes remain admin-only/audited',async()=>{const f=setup();let r=await f.call('/v1/admin/users?q='+owner,{method:'GET'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.users.length,1);assert.equal((await f.call('/v1/admin/users?paid=paid',{method:'GET'})).body.users.length,0);assert.equal((await f.call('/v1/admin/users?registeredFrom=2',{method:'GET'})).body.users.length,0);const body=op({note:'内部备注，不应出现在公开页面'});assert.equal((await f.call(`/v1/admin/users/${owner}/note`,{body})).status,200);assert.equal((await f.call(`/v1/admin/users/${owner}/note`,{body})).status,200);assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_audit_logs').get().n,1);r=await f.call(`/v1/admin/users/${owner}`,{method:'GET'});assert.equal(r.body.user.admin_note,body.note);assert.ok(!JSON.stringify((await f.call('/v1/site',{method:'GET'})).body).includes(body.note));});
test('CSV exports only selected records, escapes formula content, and rejects ordinary users',async()=>{const f=setup();f.sql.prepare('UPDATE users SET username=? WHERE id=?').run('=HYPERLINK("bad")',owner);const req=()=>new Request(`${f.env.API_ORIGIN}/v1/admin/export?type=users&ids=${owner}`,{headers:{Cookie:'rc_session='+'b'.repeat(64)}});let r=await worker.fetch(req(),f.env);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/csv/);const body=await r.text();assert.ok(body.includes("'=HYPERLINK"));assert.ok(!body.includes('password_hash'));assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='csv_export'").get().n,1);f.sql.exec("UPDATE users SET role='user'");r=await worker.fetch(req(),f.env);assert.equal(r.status,403);});
test('order reporting exposes safe state and errors without cashier/signature materials',async()=>{const f=setup();const created=await f.call('/v1/orders');assert.equal(created.status,201,JSON.stringify(created));const id=created.body.order.id;f.sql.prepare("UPDATE payment_attempts SET provider_code='checkout-v2:unknown:NETWORK_UNCERTAIN' WHERE transaction_id IN (SELECT id FROM payment_transactions WHERE order_id=?)").run(id);const detail=await f.call(`/v1/admin/orders/${id}`,{method:'GET'});assert.equal(detail.status,200,JSON.stringify(detail));assert.equal(detail.body.order.credited_at,null);assert.match(detail.body.attempts[0].error_code,/NETWORK_UNCERTAIN/);assert.ok(!JSON.stringify(detail.body).includes('cashier_url'));assert.ok(!JSON.stringify(detail.body).includes('test-key'));assert.equal((await f.call('/v1/admin/orders?status=unknown',{method:'GET'})).body.orders.length,0);assert.equal((await f.call('/v1/admin/orders?q='+id,{method:'GET'})).body.orders.length,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM credit_ledger').get().n,0);});
test('long UTF-8 search and 200-record CSV selection avoid D1 LIKE/binding limits',async()=>{const f=setup(),q='测试'.repeat(30);assert.equal((await f.call('/v1/admin/users?q='+encodeURIComponent(q),{method:'GET'})).status,200);const ids=[owner,...Array.from({length:199},()=>randomUUID())],prepare=f.DB.prepare;f.DB.prepare=q=>{const s=prepare(q),bind=s.bind;s.bind=function(...args){assert.ok(args.length<=100);return bind.apply(s,args)};return s;};const r=await worker.fetch(new Request(`${f.env.API_ORIGIN}/v1/admin/export?type=users&ids=${ids.join(',')}`,{headers:{Cookie:'rc_session='+'b'.repeat(64)}}),f.env);assert.equal(r.status,200);assert.ok((await r.text()).includes(owner));});

test('admin directory avoids history scans by default while user detail retains exact ACK-backed counts',async()=>{
 const f=setup();
 try {
   const now=Date.UTC(2026,10,17,5);
   const insert=f.sql.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,delivery_confirmed_at,delivery_confirmation_id) VALUES(?,?,'2026-11-17',?,?,?,?,?,?,?)");
   insert.run('acknowledged',owner,'n-ack','succeeded',1,'hash',now,now,'ack-one');
   insert.run('unconfirmed',owner,'n-no-ack','succeeded',1,'hash',now+1,null,null);
   insert.run('unconsumed',owner,'n-reserved','reserved',0,'hash',now+2,null,null);
   const seen=[],prepare=f.DB.prepare.bind(f.DB);
   f.DB.prepare=sql=>{seen.push(sql);return prepare(sql);};
   const list=await f.call('/v1/admin/users',{method:'GET'});
   assert.equal(list.status,200,JSON.stringify(list));
   assert.equal(list.body.perUserStats,'detail_only');
   assert.equal(list.body.users.length,1);
   assert.equal(list.body.users[0].id,owner);
   assert.equal(list.body.users[0].generations,null,'directory must not fake exact lifetime stats');
   assert.equal(list.body.users[0].last_active_at,null,'directory must not run cross-table activity scans');
   const directorySql=seen.find(sql=>sql.includes('CAST(NULL AS INTEGER) generations'));
   assert.ok(directorySql,'lightweight directory projection is used');
   assert.doesNotMatch(directorySql,/FROM ai_requests|FROM sessions|FROM subscription_orders|FROM recharge_orders/i);
   const detail=await f.call('/v1/admin/users/'+owner,{method:'GET'});
   assert.equal(detail.status,200,JSON.stringify(detail));
   assert.equal(detail.body.user.generations,1,'only ACK-confirmed consumption counts');
   assert.equal(detail.body.user.last_active_at,now+2,'detailed activity retains actual latest request');
 }finally{f.sql.close();}
});
