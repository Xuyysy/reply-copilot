import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {fixture,withProvider} from "./helpers/payment-v2.mjs";

const chains=["TRC20","POLYGON","BEP20","ERC20","SOLANA"];
const all=Object.fromEntries(chains.map(chain=>[chain,true]));
const op=(extra={})=>({operationId:randomUUID(),reason:"USDT 本地管理员安全控制测试",confirm:true,...extra});
const address="T"+"1".repeat(33);
function setup(){
  const f=fixture();
  f.sql.exec(readFileSync(new URL("../sql-proposals/0028_boltutil_usdt.sql",import.meta.url),"utf8"));
  f.sql.exec(readFileSync(new URL("../sql-proposals/0030_boltutil_five_networks_staging.sql",import.meta.url),"utf8"));
  Object.assign(f.env,{
    ADMIN_PORTAL_ENABLED:"1",BOLTUTIL_ENABLED:"1",BOLTUTIL_SCHEMA_READY:"1",
    BOLTUTIL_STAGING_CREATE_ENABLED:"1",BOLTUTIL_PRODUCTION_CREATE_ENABLED:"0",
    BOLTUTIL_API_KEY:"local-test-key",BOLTUTIL_WEBHOOK_SECRET:"local-test-webhook-secret",
    BOLTUTIL_CNY_PER_USDT_MICROS:"7000000",
    BOLTUTIL_TRC20_ENABLED:"1",BOLTUTIL_POLYGON_ENABLED:"1",
    BOLTUTIL_BEP20_ENABLED:"1",BOLTUTIL_ERC20_ENABLED:"1",BOLTUTIL_SOLANA_ENABLED:"1"
  });
  f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'");
  f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
  f.sql.prepare("INSERT INTO admin_reauth_sessions VALUES('test-session',?)").run(Date.now()+900000);
  return f;
}
async function status(f){return f.call("/v1/admin/boltutil/control",{method:"GET"});}
async function save(f,body){return f.call("/v1/admin/boltutil/control",{body});}
async function create(f,chain="TRC20"){
  return withProvider(req=>{
    const body=JSON.parse(req.body);
    const amount=body.amount;
    const [whole,frac=""]=amount.split(".");
    const micro=BigInt(whole)*1000000n+BigInt((frac+"000000").slice(0,6));
    return Response.json({code:200,data:{
      merchantExternalId:body.externalOrderId,status:"PENDING",
      payment:{currency:"USDT",network:chain,decimal:6,address:chain==="TRC20"?address:"0x"+"a".repeat(40),
        amount,rawAmount:micro.toString()},
      checkoutUrl:"https://boltutil.com/pay/"+body.externalOrderId,
      time:{expireTimestamp:Date.now()+1800000,serverTimestamp:Date.now()}
    }});
  },()=>f.call("/v1/boltutil/orders",{body:{
    productType:"credits",sku:"starter",network:chain,idempotencyKey:randomUUID()
  }}));
}
test("Staging existing five-chain config remains live by default; new switch keys do not rewrite fiat",async()=>{
  const f=setup();
  try{
    const s=await status(f),p=await f.call("/v1/boltutil/availability",{method:"GET"});
    assert.equal(s.status,200);
    assert.equal(s.body.operatorEnabled,true);
    assert.equal(s.body.revision,"111111");
    assert.deepEqual([...p.body.networks].sort(),[...chains].sort());
    assert.equal(f.sql.prepare("SELECT count(*) n FROM system_settings WHERE key LIKE 'boltutil_operator_%'").get().n,0);
    assert.ok(!JSON.stringify(s.body).includes("local-test-webhook-secret"));
  }finally{f.sql.close();}
});
test("audited per-network pause blocks API creation while other networks and fiat stay unchanged",async()=>{
  const f=setup();
  try{
    const prev=await status(f);
    const next={...all,POLYGON:false};
    const change=op({enabled:true,networks:next,expectedRevision:prev.body.revision});
    assert.equal((await save(f,change)).status,200);
    assert.equal((await save(f,change)).status,200,"retry must not duplicate audit");
    assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='boltutil_operator_control'").get().n,1);
    const publicResult=await f.call("/v1/boltutil/availability",{method:"GET"});
    assert.ok(!publicResult.body.networks.includes("POLYGON"));
    const blocked=await f.call("/v1/boltutil/orders",{body:{productType:"credits",sku:"starter",network:"POLYGON",idempotencyKey:randomUUID()}});
    assert.equal(blocked.status,503);
    assert.equal(blocked.body.code,"BOLTUTIL_NETWORK_UNAVAILABLE");
    assert.equal((await create(f)).status,201);
    assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get().value,"1");
    assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs").get().n,1);
  }finally{f.sql.close();}
});
test("master pause stops all new USDT orders but preserves existing signed settlement",async()=>{
  const f=setup();
  try{
    const created=await create(f);
    assert.equal(created.status,201,JSON.stringify(created.body));
    const s=await status(f);
    assert.equal((await save(f,op({enabled:false,networks:all,expectedRevision:s.body.revision}))).status,200);
    assert.deepEqual((await f.call("/v1/boltutil/availability",{method:"GET"})).body.networks,[]);
    assert.equal((await create(f)).status,503);
    const external=f.sql.prepare("SELECT external_order_id FROM boltutil_orders WHERE id=?").get(created.body.order.id).external_order_id;
    const verified=await withProvider(req=>{
      assert.equal(new URL(req.url).pathname,"/api/v1/order/status");
      return Response.json({code:200,data:{
        status:"CONFIRMED",amount:created.body.order.amount,paidAmount:created.body.order.amount,
        shortfallAmount:"0",settlementType:"EXACT",manuallyAccepted:false,currency:"USDT",
        network:"TRC20",externalOrderId:external,destinationAddress:address,txHash:"f".repeat(64)
      }});
    },()=>f.call("/v1/boltutil/orders/"+created.body.order.id+"/refresh",{body:{}}));
    assert.equal(verified.status,200,JSON.stringify(verified.body));
    assert.equal(verified.body.order.entitlementApplied,true);
  }finally{f.sql.close();}
});
test("Production defaults CLOSED; Staging approval cannot enable Production",async()=>{
  const f=setup();
  try{
    f.env.ENVIRONMENT="production";
    const s=await status(f);
    assert.equal(s.body.operatorEnabled,false);
    assert.equal(s.body.revision,"000000");
    assert.deepEqual((await f.call("/v1/boltutil/availability",{method:"GET"})).body.networks,[]);
    const notReady=await save(f,op({enabled:true,networks:all,expectedRevision:s.body.revision}));
    assert.equal(notReady.status,409);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs").get().n,0);
    f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED="1";
    // Worker-level evidence must be explicitly acknowledged before operator activation.
    f.env.BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED="1";
    f.env.BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED="1";
    f.env.BOLTUTIL_PRODUCTION_APPROVED_CNY_PER_USDT_MICROS=f.env.BOLTUTIL_CNY_PER_USDT_MICROS;
    const activated=await save(f,op({enabled:true,networks:all,expectedRevision:s.body.revision}));
    assert.equal(activated.status,200,JSON.stringify(activated.body));
    assert.deepEqual((await f.call("/v1/boltutil/availability",{method:"GET"})).body.networks,chains);
    f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED="0";
    assert.deepEqual((await f.call("/v1/boltutil/availability",{method:"GET"})).body.networks,[]);
  }finally{f.sql.close();}
});
test("role/CSRF/password proof, request validation and stale writes all fail closed",async()=>{
  const f=setup();
  try{
    const s=await status(f),body=op({enabled:false,networks:all,expectedRevision:s.body.revision});
    assert.equal((await f.call("/v1/admin/boltutil/control",{body,headers:{"X-CSRF-Token":""}})).status,403);
    assert.equal((await save(f,{...body,networks:{TRC20:true}})).status,400);
    assert.equal((await save(f,{...body,confirm:false})).status,400);
    assert.equal((await save(f,body)).status,200);
    assert.equal((await save(f,op({enabled:true,networks:all,expectedRevision:s.body.revision}))).status,409);
    assert.equal((await save(f,{...body,enabled:true})).status,409);
    f.sql.exec("DELETE FROM admin_reauth_sessions");
    assert.equal((await save(f,op({enabled:true,networks:all,expectedRevision:"011111"}))).status,403);
    f.sql.exec("UPDATE users SET role='user' WHERE id='test-user'");
    assert.equal((await status(f)).status,403);
    assert.equal((await save(f,op({enabled:true,networks:all,expectedRevision:"011111"}))).status,403);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='boltutil_operator_control'").get().n,1);
  }finally{f.sql.close();}
});
