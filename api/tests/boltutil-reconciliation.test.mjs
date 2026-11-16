import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {fixture} from "./helpers/payment-v2.mjs";

const sql=readFileSync(new URL("../sql-proposals/0031_boltutil_five_networks_production_initial.sql",import.meta.url),"utf8");
function setup({schema=true,admin=true}={}){
 const f=fixture();
 if(schema)f.sql.exec(sql);
 f.env.ADMIN_PORTAL_ENABLED="1";
 f.env.BOLTUTIL_SCHEMA_READY=schema?"1":"0";
 if(admin){
  f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'");
  f.sql.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
 }
 return f;
}
function seed(f,i,{status="pending",network="TRC20",applied=false,receipt=false,ledger=false,expired=false}={}){
 const id=randomUUID(),external="local_admin_bolt_"+i;
 const fiat="local_fiat_"+i;
 f.sql.prepare(
  "INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,created_at) "+
  "VALUES(?,'test-user','starter','USDT test',400,199,'USD','awaiting_payment','boltutil',?)"
 ).run(fiat,i*1000);
 const hash=i.toString(16).repeat(64);
 f.sql.prepare(
  "INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,credit_order_id,"+
  "network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,"+
  "quoted_usdt_micros,payable_usdt_micros,paid_usdt_micros,tx_hash,status,paid_at,applied_at,"+
  "created_at,updated_at,expires_at) "+
  "VALUES(?,?,'test-user',?,'credits',?,?,'fixture-token',6,1990,7000000,2842858,2842858,"+
  "?,?,?, ?,?,?,?,?)"
 ).run(id,external,"local_op_"+i,fiat,network,
   status==="paid"?2842858:null,status==="paid"?hash:null,status,
   status==="paid"?i*1000:null,applied?i*1000:null,i*1000,i*1000,
   expired?1:Date.now()+86400000);
 if(status==="paid"&&applied)f.sql.prepare(
  "UPDATE recharge_orders SET status='paid',paid_at=?,credited_at=? WHERE id=?"
 ).run(i*1000,i*1000,fiat);
 if(receipt)f.sql.prepare(
  "INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) "+
  "VALUES(?,?,'CONFIRMED',?,?,?,?)"
 ).run("fixture_event_"+i,external,network,hash,"a".repeat(64),i*1000);
 if(ledger)f.sql.prepare(
  "INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) "+
  "VALUES(?,'test-user','purchase_grant',0,400,?,'fixture',?)"
 ).run(randomUUID(),fiat,i*1000);
 return {id,external,fiat};
}
function seeded(){
 const f=setup();
 const orders=[
  seed(f,1,{status:"manual_review"}),
  seed(f,2,{status:"paid"}),
  seed(f,3,{status:"paid",applied:true}),
  seed(f,4,{status:"paid",applied:true,receipt:true}),
  seed(f,5,{status:"pending",network:"POLYGON",expired:true}),
  seed(f,6,{status:"unknown",network:"BEP20"}),
  seed(f,7,{status:"pending",network:"ERC20"}),
  seed(f,8,{status:"paid",network:"SOLANA",applied:true,receipt:true,ledger:true})
 ];
 return {f,orders};
}
const report=(f,query="")=>f.call("/v1/admin/boltutil/reconciliation"+query,{method:"GET"});
const detail=(f,id)=>f.call("/v1/admin/boltutil/orders/"+id+"/evidence",{method:"GET"});
test("USDT recorded-evidence summary identifies all six anomaly classes without mixing CNY",async()=>{
 const {f}=seeded();try{
  const r=await report(f);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.schemaReady,true);
  assert.equal(r.body.reportCurrency,"USDT");
  assert.deepEqual(r.body.summary,{total:8,attention:6,manual_review:1,paid_unapplied:1,paid:4,pending:3});
  assert.equal(r.body.orders.length,6);
  assert.deepEqual(new Set(r.body.orders.map(x=>x.review_reason)),new Set([
   "manual_review","paid_unapplied","missing_recorded_receipt",
   "missing_credit_ledger","expired_unresolved","unknown_status"
  ]));
  assert.equal(r.body.nextCursor,null);
 }finally{f.sql.close();}
});
test("status, network and stable created-time plus UUID pagination reject bad user filters",async()=>{
 const {f,orders}=seeded();try{
  const first=await report(f,"?scope=all&limit=2");
  assert.equal(first.status,200);
  assert.deepEqual(first.body.orders.map(x=>x.id),[orders[7].id,orders[6].id]);
  const second=await report(f,"?scope=all&limit=2&cursor="+encodeURIComponent(first.body.nextCursor));
  assert.equal(second.status,200,JSON.stringify(second.body));
  assert.deepEqual(second.body.orders.map(x=>x.id),[orders[5].id,orders[4].id]);
  const paid=await report(f,"?scope=paid&network=SOLANA");
  assert.deepEqual(paid.body.orders.map(x=>x.id),[orders[7].id]);
  const polygon=await report(f,"?scope=attention&network=POLYGON");
  assert.deepEqual(polygon.body.orders.map(x=>x.id),[orders[4].id]);
  for(const query of ["?scope=not-a-filter","?network=ETH","?limit=100","?cursor=bad","?limit=0"]){
   assert.equal((await report(f,query)).status,400,query);
  }
 }finally{f.sql.close();}
});
test("detail shows only persisted linked event and entitlement evidence, never provider secrets or grants",async()=>{
 const {f,orders}=seeded();try{
  const before={
   ledger:f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger").get().n,
   events:f.sql.prepare("SELECT COUNT(*) n FROM boltutil_payment_events").get().n,
   money:f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance
  };
  const good=await detail(f,orders[7].id);
  assert.equal(good.status,200,JSON.stringify(good.body));
  assert.equal(good.body.readOnly,true);
  assert.equal(good.body.matchedRecordedReceipts,1);
  assert.equal(good.body.providerEvents.length,1);
  assert.equal(good.body.entitlement.credit.ledger_grants,1);
  assert.equal(good.body.entitlement.kind,"credits");
  assert.ok(!JSON.stringify(good.body).includes("body_sha256"));
  assert.ok(!JSON.stringify(good.body).includes("BOLTUTIL_WEBHOOK_SECRET"));
  const missing=await detail(f,orders[2].id);
  assert.equal(missing.body.matchedRecordedReceipts,0);
  assert.equal((await detail(f,randomUUID())).status,404);
  assert.equal((await detail(f,"z".repeat(36))).status,404);
  const after={
   ledger:f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger").get().n,
   events:f.sql.prepare("SELECT COUNT(*) n FROM boltutil_payment_events").get().n,
   money:f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance
  };
  assert.deepEqual(after,before,"evidence reads must not mutate finance or entitlements");
 }finally{f.sql.close();}
});
test("applied paid USDT with inconsistent linked credit order flags stays in the exception queue",async()=>{
 const f=setup();try{
  const order=seed(f,19,{status:"paid",applied:true,receipt:true,ledger:true});
  f.sql.prepare("UPDATE recharge_orders SET status='awaiting_payment',credited_at=NULL WHERE id=?").run(order.fiat);
  const r=await report(f);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.summary.attention,1);
  assert.equal(r.body.orders[0].review_reason,"missing_credit_order_state");
  assert.equal((await detail(f,order.id)).body.entitlement.credit.status,"awaiting_payment");
 }finally{f.sql.close();}
});
test("schema-unready report safely returns empty without BoltUtil table access; details are 404",async()=>{
 const f=setup({schema:false});try{
  const result=await report(f);
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.schemaReady,false);
  assert.deepEqual(result.body.orders,[]);
  assert.deepEqual(result.body.summary,{total:0,attention:0,manual_review:0,paid_unapplied:0,paid:0,pending:0});
  assert.equal((await detail(f,randomUUID())).status,404);
 }finally{f.sql.close();}
});
test("non-admin cannot access any reconciliation or evidence, including filters",async()=>{
 const f=setup({admin:false});try{
  assert.equal((await report(f)).status,403);
  assert.equal((await report(f,"?network=ETH")).status,403);
  assert.equal((await detail(f,randomUUID())).status,403);
 }finally{f.sql.close();}
});
