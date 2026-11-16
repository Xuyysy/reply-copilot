import test from "node:test";
import assert from "node:assert/strict";
import {fixture,withProvider} from "./helpers/payment-v2.mjs";

const path="/v1/admin/boltutil/provider-ping";
const key="fictional-test-only-api-key";
function setup(){
  const f=fixture();
  Object.assign(f.env,{
    ENVIRONMENT:"production",ADMIN_PORTAL_ENABLED:"1",BOLTUTIL_API_KEY:key
  });
  f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'");
  f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
  return f;
}

test("Production admin can verify existing merchant API Key without order or configuration writes",async()=>{
  const f=setup();
  try{
    const [result,calls]=await withProvider(req=>{
      assert.equal(new URL(req.url).origin,"https://api.boltutil.com");
      assert.equal(new URL(req.url).pathname,"/api/v1/ping");
      assert.equal(req.method,"GET");
      assert.equal(req.headers.get("X-Bolt-Key"),key);
      assert.equal(req.headers.get("X-Bolt-Signature"),null);
      assert.equal(req.body,undefined);
      return Response.json({code:200,account:"private-merchant-name"},{status:200});
    },async calls=>[await f.call(path,{method:"GET"}),calls]);
    assert.equal(result.status,200);
    assert.deepEqual(result.body,{kind:"ok",httpStatus:200});
    assert.equal(calls.length,1);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM admin_audit_logs").get().n,0);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM payment_transactions").get().n,0);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM recharge_orders").get().n,0);
    assert.equal(f.env.BOLTUTIL_ENABLED,undefined);
    assert.equal(f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED,undefined);
    assert.ok(!JSON.stringify(result).includes(key));
    assert.ok(!JSON.stringify(result).includes("private-merchant-name"));
  }finally{f.sql.close();}
});

test("Production probe is fail-closed for nonadmin and never contacts provider",async()=>{
  const f=setup();
  try{
    f.sql.exec("UPDATE users SET role='user' WHERE id='test-user'");
    const [result,calls]=await withProvider(()=>{throw Error("unauthorized network request");},
      async calls=>[await f.call(path,{method:"GET"}),calls]);
    assert.equal(result.status,403);
    assert.equal(calls.length,0);
  }finally{f.sql.close();}
});

test("Production merchant key is required; Staging cannot call Production probe",async()=>{
  const f=setup();
  try{
    delete f.env.BOLTUTIL_API_KEY;
    assert.equal((await f.call(path,{method:"GET"})).status,503);
    f.env.BOLTUTIL_API_KEY=key;
    f.env.ENVIRONMENT="staging";
    const [result,calls]=await withProvider(()=>{throw Error("staging network request");},
      async calls=>[await f.call(path,{method:"GET"}),calls]);
    assert.equal(result.status,404);
    assert.equal(calls.length,0);
  }finally{f.sql.close();}
});

test("Production probe reduces provider responses to bounded status only",async()=>{
  const f=setup();
  try{
    for(const [httpStatus,kind] of [[401,"unauthorized"],[403,"unauthorized"],[429,"rate_limited"],[502,"upstream_http"]]){
      const result=await withProvider(()=>Response.json({
        code:"INTERNAL_SECRET",message:"private merchant response",wallet:"do-not-leak"
      },{status:httpStatus}),()=>f.call(path,{method:"GET"}));
      assert.equal(result.status,200);
      assert.deepEqual(result.body,{kind,httpStatus});
      assert.ok(!JSON.stringify(result).includes("private"));
    }
    const network=await withProvider(()=>{throw Error("local simulated network timeout");},
      ()=>f.call(path,{method:"GET"}));
    assert.equal(network.status,200);
    assert.deepEqual(network.body,{kind:"network_error",httpStatus:null});
  }finally{f.sql.close();}
});
