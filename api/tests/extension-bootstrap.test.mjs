import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fixture,worker} from "./helpers/payment-v2.mjs";

const token="e".repeat(64);
function setup(){
  const f=fixture();
  f.sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('extension-bootstrap-test',?,'test-user','extension',1,?)")
    .run(createHash("sha256").update(token).digest("hex"),Date.now()+600000);
  return {f,headers:{Cookie:"",Authorization:"Bearer "+token,Origin:f.env.EXTENSION_ORIGIN}};
}
test("Staging bootstrap matches legacy account/entitlement/usage and never writes",async()=>{
 const {f,headers}=setup();
 try{
   let writes=0;
   const original=f.DB.prepare.bind(f.DB);
   f.DB.prepare=(sql)=>{if(/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)/i.test(sql))writes++;return original(sql);};
   const [boot,me,ent,usage]=await Promise.all([
     f.call("/v1/extension/bootstrap",{method:"GET",headers}),
     f.call("/v1/me",{method:"GET",headers}),
     f.call("/v1/entitlements",{method:"GET",headers}),
     f.call("/v1/usage",{method:"GET",headers}),
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
test("bootstrap enforces real extension authentication and revoked sessions",async()=>{
 const {f,headers}=setup();
 try{
   const web=await f.call("/v1/extension/bootstrap",{method:"GET"});
   assert.equal(web.status,403);assert.equal(web.body.code,"FORBIDDEN");
   const anonymous=await f.call("/v1/extension/bootstrap",{method:"GET",headers:{Authorization:"",Cookie:"",Origin:f.env.EXTENSION_ORIGIN}});
   assert.equal(anonymous.status,401);assert.equal(anonymous.body.code,"AUTH_REQUIRED");
   f.sql.prepare("UPDATE sessions SET revoked_at=? WHERE id='extension-bootstrap-test'").run(Date.now());
   const revoked=await f.call("/v1/extension/bootstrap",{method:"GET",headers});
   assert.equal(revoked.status,401);
 }finally{f.sql.close();}
});
test("Production never exposes staging-only bootstrap",async()=>{
 const {f,headers}=setup();
 try{
   f.env.ENVIRONMENT="production";
   const r=await f.call("/v1/extension/bootstrap",{method:"GET",headers});
   assert.equal(r.status,404);assert.equal(r.body.code,"NOT_FOUND");
 }finally{f.sql.close();}
});
test("bootstrap response is private, no-store and uses existing extension origin policy",async()=>{
 const {f,headers}=setup();
 try{
   const response=await worker.fetch(new Request(f.env.API_ORIGIN+"/v1/extension/bootstrap",{headers}),f.env);
   assert.equal(response.status,200);
   assert.equal(response.headers.get("cache-control"),"no-store");
   assert.equal(response.headers.get("access-control-allow-origin"),f.env.EXTENSION_ORIGIN);
   assert.equal(response.headers.get("access-control-allow-credentials"),"true");
 }finally{f.sql.close();}
});
