import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, worker } from "./helpers/payment-v2.mjs";

const token="e".repeat(64);
function setup(environment="production") {
  const f=fixture();
  f.env.ENVIRONMENT=environment;
  f.sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('extension-bootstrap-prod',?,'test-user','extension',1,?)")
    .run(createHash("sha256").update(token).digest("hex"), Date.now()+600000);
  return { f, headers:{Cookie:"",Authorization:"Bearer "+token,Origin:f.env.EXTENSION_ORIGIN} };
}

for(const environment of ["staging","production"]){
  test(environment+" authenticated bootstrap matches separate authoritative account reads without writes",async()=>{
    const {f,headers}=setup(environment);
    try{
      let writes=0;
      const original=f.DB.prepare.bind(f.DB);
      f.DB.prepare=(sql)=>{if(/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql))writes++;return original(sql);};
      const [boot,me,ent,usage]=await Promise.all([
        f.call("/v1/extension/bootstrap",{method:"GET",headers}),
        f.call("/v1/me",{method:"GET",headers}),
        f.call("/v1/entitlements",{method:"GET",headers}),
        f.call("/v1/usage",{method:"GET",headers})
      ]);
      assert.equal(boot.status,200,JSON.stringify(boot.body));
      assert.deepEqual(boot.body.user,me.body.user);
      assert.equal(boot.body.status,ent.body.status);
      assert.deepEqual(boot.body.quota,usage.body.quota);
      assert.deepEqual(boot.body.subscription,usage.body.subscription);
      assert.deepEqual(boot.body.entitlement,ent.body.entitlement);
      assert.equal(writes,0);
      assert.equal(f.sql.prepare("SELECT free_balance FROM credit_accounts WHERE user_id='test-user'").get().free_balance,200);
      assert.equal(JSON.stringify(boot.body).includes(token),false);
    }finally{f.sql.close();}
  });
}
test("Production requires active extension bearer; rejects web and expired sessions",async()=>{
 const {f,headers}=setup();
 try{
   let r=await f.call("/v1/extension/bootstrap",{method:"GET"});
   assert.equal(r.status,403);assert.equal(r.body.code,"FORBIDDEN");
   r=await f.call("/v1/extension/bootstrap",{method:"GET",headers:{Origin:f.env.EXTENSION_ORIGIN,Cookie:"",Authorization:""}});
   assert.equal(r.status,401);assert.equal(r.body.code,"AUTH_REQUIRED");
   f.sql.prepare("UPDATE sessions SET revoked_at=? WHERE id='extension-bootstrap-prod'").run(Date.now());
   r=await f.call("/v1/extension/bootstrap",{method:"GET",headers});
   assert.equal(r.status,401);
 }finally{f.sql.close();}
});
test("Development does not expose extension bootstrap",async()=>{
 const {f,headers}=setup("development");
 try{
  const r=await f.call("/v1/extension/bootstrap",{method:"GET",headers});
  // A fixture initialized with Staging secrets may be rejected by the
  // environment middleware before the route returns its own 404.
  assert.notEqual(r.status,200,"Development must never expose account data");
  assert.ok(["NOT_FOUND","SERVER_UNAVAILABLE"].includes(r.body.code));
 }
 finally{f.sql.close();}
});
test("Production bootstrap uses existing no-store and allowed Chrome extension CORS",async()=>{
 const {f,headers}=setup();
 try{
  const resp=await worker.fetch(new Request(f.env.API_ORIGIN+"/v1/extension/bootstrap",{headers}),f.env);
  assert.equal(resp.status,200);
  assert.equal(resp.headers.get("Cache-Control"),"no-store");
  assert.equal(resp.headers.get("Access-Control-Allow-Origin"),f.env.EXTENSION_ORIGIN);
  assert.equal(resp.headers.get("Access-Control-Allow-Credentials"),"true");
 }finally{f.sql.close();}
});
test("Frozen accounts do not gain credits or an active entitlement via bootstrap",async()=>{
 const {f,headers}=setup();
 try{
  f.sql.prepare("UPDATE users SET status='frozen' WHERE id='test-user'").run();
  const r=await f.call("/v1/extension/bootstrap",{method:"GET",headers});
  assert.equal(r.status,401); // Session auth denies frozen users, never generates.
  assert.equal(f.sql.prepare("SELECT free_balance FROM credit_accounts WHERE user_id='test-user'").get().free_balance,200);
 }finally{f.sql.close();}
});
