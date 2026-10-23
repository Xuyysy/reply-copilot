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

test('browser API, CSRF, worker, signed provider rejection and checkout UI preserve one local order',async()=>{
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
   const order=checkoutOrderFromError(caught);assert.ok(order);assert.equal(order.checkout.outcome,'rejected');
   assert.match(checkoutOrderMessage(order,'zh'),/拒绝生成付款链接/);
   assert.equal(creates,1);assert.equal(csrfCalls,1);
   assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,1);
   assert.equal(f.sql.prepare('SELECT paid_balance n FROM credit_accounts').get().n,0);
 }finally{globalThis.fetch=original;f.sql.close();}
});
