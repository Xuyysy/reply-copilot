import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fixture, temp, providerResponse } from './helpers/payment-v2.mjs';
import { checkoutOrderFromError, checkoutOrderMessage } from '../../web/src/lib/checkout-status.mjs';
const out=path.join(temp,'web-api.cjs');
buildSync({entryPoints:[fileURLToPath(new URL('../../web/src/lib/api.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',outfile:out,define:{'import.meta.env':JSON.stringify({PUBLIC_API_BASE_URL:'https://api-staging.example.test',DEV:false})}});
const {api,ApiError}=createRequire(import.meta.url)(out);
test.after(()=>rmSync(temp,{recursive:true,force:true}));

test('browser API safely releases linkless rejection and permits another buyer-initiated checkout',async()=>{
 const f=fixture(),original=globalThis.fetch;let creates=0,csrfCalls=0;
 globalThis.fetch=async(url,init)=>{
  if(new URL(url).origin==='https://provider.example.test'){
    creates++;
    return providerResponse({headers:new Headers(init.headers),body:init.body},{code:'OPEN_API_SOURCE_IP_REJECTED',message:'private-provider-text'},{status:403,signed:false});
  }
  const route=new URL(url).pathname;
  if(route==='/v1/auth/csrf')csrfCalls++;
  const result=await f.call(route,{method:init.method||'GET',...(init.body?{body:JSON.parse(init.body)}:{}),headers:init.headers||{}});
  return Response.json(result.body,{status:result.status});
 };
 try{
   let caught;
   try{await api('/v1/orders',{method:'POST',body:JSON.stringify({packageId:'starter'})});}catch(error){caught=error;}
   assert.ok(caught instanceof ApiError);assert.equal(caught.status,502);
   assert.equal(caught.order.checkout.outcome,'rejected');
   assert.equal(caught.order.retryAvailable,true);
   assert.equal(checkoutOrderFromError(caught),null,'checkout must not latch a released order');
   assert.match(checkoutOrderMessage(caught.order,'zh'),/重新购买/);
   let again;try{await api('/v1/orders',{method:'POST',body:JSON.stringify({packageId:'starter'})});}catch(e){again=e;}
   assert.ok(again instanceof ApiError);assert.equal(again.status,502);
   assert.equal(again.order.retryAvailable,true);
   assert.notEqual(again.order.id,caught.order.id);
   assert.equal(creates,2);assert.equal(csrfCalls,1);
   assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,2);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM recharge_orders WHERE status='expired'").get().n,2);
   assert.equal(f.sql.prepare('SELECT paid_balance n FROM credit_accounts').get().n,0);
 }finally{globalThis.fetch=original;f.sql.close();}
});
