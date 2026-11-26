import test from 'node:test';
import assert from 'node:assert/strict';
import {qaGrant,temporaryQaAccess} from '../qa/partners-hosted-oidc.mjs';

const origin='https://reply-copilot-api-partners-qa.yyx0149.workers.dev';
// No deployed secrets or identity tokens: test rejection before any I/O.
test('unconfigured, malformed and expired draft identity trust fails closed',async t=>{
 let touches=0;const original=globalThis.fetch;
 globalThis.fetch=async()=>{touches++;throw Error('unexpected outbound network');};
 t.after(()=>{globalThis.fetch=original;});
 const DB={prepare(){touches++;throw Error('unexpected database access');}};
 const fake='Bearer e30.e30.invalid';
 for(const path of ['/internal-qa/exchange','/internal-qa/close']){
  for(const env of [{DB},{DB,QA_OIDC_TRUST:'invalid',QA_OIDC_GRANT_KEY:'local-fixture'},{DB,QA_OIDC_TRUST:JSON.stringify({until:1}),QA_OIDC_GRANT_KEY:'local-fixture'},{DB,QA_OIDC_TRUST:JSON.stringify({until:Math.floor(Date.now()/1000)+999999}),QA_OIDC_GRANT_KEY:'local-fixture'}]){
   const r=await qaGrant(new Request(origin+path,{method:'POST',headers:{Authorization:fake}}),env,path);
   assert.equal(r.status,403);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
   assert.deepEqual(await r.json(),{ok:false});
  }
 }
 for(const auth of ['',fake,'Basic invalid','Basic '+ 'x'.repeat(300)]){
  assert.equal(await temporaryQaAccess(new Request(origin,{headers:{Authorization:auth}}),{DB}),false);
 }
 assert.equal(touches,0);
});
