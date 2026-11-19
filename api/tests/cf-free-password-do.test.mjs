import test from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fixture, temp } from "./helpers/payment-v2.mjs";

const pepper="synthetic-cf-do-local-pepper-12345678";
const password="offline-DO-password-2026!";
const salt="ab".repeat(16);
const legacy=iterations=>{
  const digest=pbkdf2Sync(password+"\\0"+pepper,Buffer.from(salt,"hex"),iterations,32,"sha256").toString("hex");
  return `pbkdf2-sha256:${iterations}:${salt}:${digest}`;
};
const dest=temp+"/cf-free-password-do-prototype.cjs";
// Replace only Cloudflare runtime class in an offline Node build. No remote
// namespace, D1, payments, credentials, provider or network is accessed.
buildSync({
  entryPoints:[new URL("../prototypes/cf-free-password-do/src/index.ts",import.meta.url).pathname],
  bundle:true, platform:"node", format:"cjs", target:"node22", outfile:dest,
  plugins:[{name:"cloudflare-do-offline-mock",setup(build){
    build.onResolve({filter:/^cloudflare:workers$/},()=>({path:"mock-do",namespace:"offline"}));
    build.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:
      "export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }",loader:"js"}));
  }}]
});
const { PasswordVerifierDO, default: publicEntry }=createRequire(import.meta.url)(dest);

function fixtureDO(env){
  return new PasswordVerifierDO(null,{PASSWORD_PEPPER:env.PASSWORD_PEPPER});
}
test("Durable Object accepts every legacy password hash at original work factors",async()=>{
  const doObj=fixtureDO({PASSWORD_PEPPER:pepper});
  for(const n of [10_000,60_000,100_000,210_000]){
    assert.equal(await doObj.verify(password,legacy(n)),true,String(n));
    assert.equal(await doObj.verify("wrong password",legacy(n)),false,String(n));
  }
  assert.equal(await doObj.verify(password,legacy(100_000).replace(":100000:",":5000:")),false);
  assert.equal(await doObj.verify(password,"malformed"),false);
  assert.equal(await doObj.verify(password,"x".repeat(181)),false);
  assert.equal((await publicEntry.fetch()).status,404);
});
test("OFF by default: original password login remains available with no DO binding",async()=>{
  const f=fixture();try{
    f.env.PASSWORD_PEPPER=pepper;
    f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(legacy(100_000));
    const ok=await f.call("/v1/auth/login",{body:{identity:"v2@example.test",password}});
    assert.equal(ok.status,200,JSON.stringify(ok.body));
    assert.equal((await f.call("/v1/auth/login",{body:{identity:"v2@example.test",password:"wrong password"}})).status,401);
  }finally{f.sql.close();}
});
test("enabled: route delegates to per-user DO and retains original web session semantics",async()=>{
  const f=fixture();try{
    f.env.PASSWORD_PEPPER=pepper;
    f.env.PASSWORD_VERIFY_DO_ENABLED="1";
    const names=[];
    const verifier=fixtureDO(f.env);
    f.env.PASSWORD_VERIFY_DO={getByName(name){
      names.push(name);
      return {verify:(pass,hash)=>verifier.verify(pass,hash)};
    }};
    f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(legacy(210_000));
    const before=f.sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='test-user'").get().n;
    const correct=await f.call("/v1/auth/login",{body:{identity:"v2@example.test",password}});
    assert.equal(correct.status,200,JSON.stringify(correct.body));
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='test-user'").get().n,before+1);
    const incorrect=await f.call("/v1/auth/login",{body:{identity:"v2@example.test",password:"incorrect"}});assert.equal(incorrect.status,401);
    assert.deepEqual(names,["test-user","test-user"]);
    f.sql.exec("UPDATE users SET status='frozen' WHERE id='test-user'");
    assert.equal((await f.call("/v1/auth/login",{body:{identity:"v2@example.test",password}})).status,403);
  }finally{f.sql.close();}
});
test("enabled: missing DO binding, throw, or non-boolean result all fail closed without session issuance",async()=>{
  for(const mode of ["missing","throw","nonboolean"]){
    const f=fixture();try{
      f.env.PASSWORD_PEPPER=pepper;
      f.env.PASSWORD_VERIFY_DO_ENABLED="1";
      const hash=legacy(100_000);
      f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(hash);
      if(mode==="throw")f.env.PASSWORD_VERIFY_DO={getByName:()=>({verify:async()=>{throw Error("secret "+password+" "+pepper)}})};
      if(mode==="nonboolean")f.env.PASSWORD_VERIFY_DO={getByName:()=>({verify:async()=>({admin:true})})};
      const before=f.sql.prepare("SELECT COUNT(*) n FROM sessions").get().n;
      const res=await f.call("/v1/auth/login",{body:{identity:"v2@example.test",password}});
      assert.equal(res.status,503);
      assert.equal(res.body.code,"PASSWORD_VERIFIER_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(res.body),new RegExp(pepper+"|"+password));
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sessions").get().n,before);
    }finally{f.sql.close();}
  }
});
test("enabled: verified legacy login never rehashes on 10ms entrypoint",async()=>{
  const f=fixture();try{
    f.env.PASSWORD_PEPPER=pepper;f.env.PASSWORD_VERIFY_DO_ENABLED="1";
    f.env.PASSWORD_FREE_CPU_ENABLED="1";f.env.PASSWORD_FREE_TINY_CPU_ENABLED="1";
    f.env.PASSWORD_LEGACY_MIGRATION_ENABLED="1";
    const hash=legacy(100_000);
    f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(hash);
    const verifier=fixtureDO(f.env);
    f.env.PASSWORD_VERIFY_DO={getByName:()=>({verify:(pass,stored)=>verifier.verify(pass,stored)})};
    assert.equal((await f.call("/v1/auth/login",{body:{identity:"v2@example.test",password}})).status,200);
    assert.equal(f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash,hash);
  }finally{f.sql.close();}
});
