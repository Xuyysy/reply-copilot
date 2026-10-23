import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const page=new URL('../../web/src/pages/checkout.astro',import.meta.url);
const script=readFileSync(page,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const compiled=buildSync({stdin:{contents:script,loader:'ts',resolveDir:fileURLToPath(new URL('../../web/src/pages/',import.meta.url))},bundle:true,platform:'browser',format:'iife',write:false,define:{'import.meta.env':JSON.stringify({PUBLIC_API_BASE_URL:'https://api.example.test',DEV:false})}}).outputFiles[0].text;
const form={action:'https://epay.example.test/submit.php',method:'POST',fields:{pid:'12345',type:'alipay',out_trade_no:'XRH_ui_123',money:'10.06',name:'400 次',notify_url:'https://api.example.test/v1/payments/xiaodou/epay/notify',sign:'a'.repeat(32),sign_type:'MD5'}};
const order={id:'11111111-1111-4111-8111-111111111111',packageId:'starter',packageName:'400 次',credits:400,displayPriceCents:149,displayCurrency:'USD',baseAmountFen:990,serviceFeeFen:16,feeRateBps:150,amountFen:1006,currency:'CNY',status:'pending',paymentProtocol:'epay',checkout:{outcome:'ready',issue:'EPAY_FORM_PREPARED'}};
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
test('Actual checkout script restores same-order form without auto-submission, survives browser Back, and keeps payment usable after local refresh',async()=>{
 let submissions=0,restores=0,reads=0;const nodes=new Map();
 class Element extends EventTarget{children=[];disabled=false;hidden=false;textContent='';appendChild(child){this.children.push(child);}append(child){this.children.push(child);}replaceChildren(...items){this.children=items;}submit(){submissions++;}remove(){}}
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'zh'},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},body:new Element()});
 const window=new EventTarget();
 const fetch=async(url,init={})=>{assert.equal(new URL(url).origin,'https://api.example.test');const p=new URL(url).pathname;
 if(p==='/v1/packages')return Response.json({packages:[],paymentAvailable:true,paymentProvider:'xiaodou_epay'});
 if(p==='/v1/auth/csrf')return Response.json({csrfToken:'mock-csrf'});
 if(p.endsWith('/attempts')){restores++;return Response.json({ok:true,paymentForm:form});}
 if(p==='/v1/orders/'+order.id){reads++;return Response.json({order,quota:{freeRemaining:200,paidRemaining:0,totalRemaining:200}});}
 throw Error('Unexpected network operation');};
 runInNewContext(compiled,{document,window,location:{href:'https://web.example.test/checkout/?order='+order.id},URL,fetch,console,setTimeout,clearTimeout,AbortController});await flush();
 const button=nodes.get('epay-submit');assert.equal(button.hidden,false);assert.equal(button.disabled,false);
 button.dispatchEvent(new Event('click'));await flush();assert.equal(restores,1);assert.equal(submissions,0);assert.equal(button.disabled,false);
 button.dispatchEvent(new Event('click'));await flush();assert.equal(submissions,1);assert.equal(button.disabled,true);
 window.dispatchEvent(new Event('pageshow'));assert.equal(button.disabled,false);
 nodes.get('refresh-order').dispatchEvent(new Event('click'));await flush();assert.ok(reads>=2);assert.equal(button.disabled,false,'Local refresh must not leave the payment button disabled');assert.equal(submissions,1);
});

test('Checkout offers an explicit fresh Epay order after unresolved-order rejection, blocks double click, and never auto-submits',async()=>{
 let submissions=0,creates=0,release;const nodes=new Map();
 class Element extends EventTarget{children=[];disabled=false;hidden=false;textContent='';appendChild(c){this.children.push(c);}append(c){this.children.push(c);}replaceChildren(...items){this.children=items;}submit(){submissions++;}remove(){}}
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'zh'},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},body:new Element()}),window=new EventTarget();
 const fetch=async(url,init={})=>{const p=new URL(url).pathname;if(p==='/v1/packages')return Response.json({paymentAvailable:true,paymentProvider:'xiaodou_epay',paymentMethods:[{provider:'xiaodou_epay',channel:'ALIPAY_H5'}],packages:[{id:'starter',name_zh:'400 次',name_en:'400 credits',credits:400,price_cents:149,promo_price_cents:null,price_cny_fen:990,service_fee_fen:16,total_payment_fen:1006,fee_rate_bps:150}]});if(p==='/v1/auth/csrf')return Response.json({csrfToken:'mock-csrf'});if(p==='/v1/orders'){creates++;const b=JSON.parse(init.body);if(!b.restartPayment)return Response.json({code:'UNRESOLVED_ORDER_EXISTS',message:'Existing order'},{status:409});assert.equal(b.restartPayment,true);await new Promise(r=>release=r);return Response.json({order:{...order,paymentForm:form}},{status:201});}throw Error('Unexpected operation');};
 runInNewContext(compiled,{document,window,location:{href:'https://web.example.test/checkout/?package=starter'},URL,fetch,console,setTimeout,clearTimeout,AbortController});await flush();nodes.get('create-order').dispatchEvent(new Event('click'));await flush();assert.equal(creates,1);const retry=nodes.get('restart-payment');assert.ok(retry);assert.equal(retry.hidden,false);retry.dispatchEvent(new Event('click'));retry.dispatchEvent(new Event('click'));await flush();assert.equal(creates,2);assert.equal(retry.disabled,true);release();await flush();assert.equal(submissions,0);assert.equal(nodes.get('epay-submit').hidden,false);assert.equal(nodes.get('epay-submit').disabled,false);
});
test('Actual checkout automatically reloads account/quota after a delayed local paid confirmation and then stops',async()=>{
 let now=1000,seq=0,paid=false,reads=0,accountReads=0,quotaReads=0,creates=0;const timers=new Map(),nodes=new Map();
 class Element extends EventTarget{children=[];disabled=false;hidden=false;textContent='';appendChild(c){this.children.push(c);}append(c){this.children.push(c);}replaceChildren(...items){this.children=items;}submit(){throw Error('Must not auto-submit');}remove(){}}
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'zh'},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},body:new Element()}),window=new EventTarget();
 const timer=(fn,ms)=>{const id=++seq;timers.set(id,{fn,at:now+ms});return id;};const advance=async ms=>{now+=ms;for(let n=0;n<8;n++){const due=[...timers].filter(([,t])=>t.at<=now);if(!due.length)break;for(const[k,t]of due){timers.delete(k);t.fn();}await flush();}};
 const fetch=async(url,init={})=>{const p=new URL(url).pathname;if(p==='/v1/packages')return Response.json({paymentAvailable:true,paymentProvider:'xiaodou_epay',packages:[{id:'starter',name_zh:'400次',credits:400,price_cents:149,promo_price_cents:null,price_cny_fen:990,service_fee_fen:16,total_payment_fen:1006,fee_rate_bps:150}]});if(p==='/v1/auth/csrf')return Response.json({csrfToken:'test-only'});if(p==='/v1/orders'){creates++;return Response.json({order:{...order,paymentForm:form}});}if(p==='/v1/orders/'+order.id){reads++;assert.equal(init.method,'GET');return Response.json({order:{...order,status:paid?'paid':'pending',creditedAt:paid?123:null}});}if(p==='/v1/me'){accountReads++;return Response.json({user:{}});}if(p==='/v1/usage'){quotaReads++;return Response.json({quota:{freeRemaining:200,paidRemaining:400,totalRemaining:600}});}throw Error('Unexpected operation');};
 class Clock extends Date{static now(){return now;}}
 runInNewContext(compiled,{document,window,location:{href:'https://web.example.test/checkout/?package=starter&trade_status=TRADE_SUCCESS'},URL,fetch,console,Date:Clock,setTimeout:timer,clearTimeout:id=>timers.delete(id),AbortController});await flush();nodes.get('create-order').dispatchEvent(new Event('click'));await flush();await advance(0);assert.equal(quotaReads,0);assert.notEqual(nodes.get('checkout-status').textContent,'支付成功，400 次额度已到账。');paid=true;await advance(2500);assert.match(nodes.get('checkout-status').textContent,/支付成功，400 次额度已到账/);assert.match(nodes.get('quota-result').textContent,/400/);assert.equal(accountReads,1);assert.equal(quotaReads,1);const count=reads;await advance(10000);assert.equal(reads,count);assert.equal(creates,1);
});

test('Focus and visibility debounce only local package availability reads, without creating orders',async()=>{
 let enabled=false,reads=0,seq=0;const timers=new Map(),nodes=new Map(),calls=[],delays=[];
 class Element extends EventTarget{disabled=false;hidden=false;textContent='';}
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'zh'},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}}),window=new EventTarget();
 const fetch=async(url,init={})=>{calls.push({path:new URL(url).pathname,method:init.method??'GET'});assert.equal(new URL(url).pathname,'/v1/packages');assert.equal(init.method??'GET','GET');reads++;return Response.json({paymentAvailable:enabled,paymentProvider:enabled?'xiaodou_epay':null,packages:[{id:'starter',name_zh:'400次',name_en:'400 credits',credits:400,price_cents:149,promo_price_cents:null,total_payment_fen:1006,fee_rate_bps:150}]});};
 runInNewContext(compiled,{document,window,location:{href:'https://web.example.test/checkout/?package=starter'},URL,fetch,console,setTimeout:(fn,ms)=>{delays.push(ms);const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),AbortController});await flush();assert.equal(reads,1);assert.equal(nodes.get('create-order').disabled,true);
 enabled=true;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));assert.equal(timers.size,1);assert.equal(delays.at(-1),250);for(const[id,fn]of timers){timers.delete(id);fn();}await flush();assert.equal(reads,2);assert.equal(nodes.get('create-order').disabled,false);
 enabled=false;document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));assert.equal(timers.size,0);document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));for(const[id,fn]of timers){timers.delete(id);fn();}await flush();assert.equal(reads,3);assert.equal(nodes.get('create-order').disabled,true);assert.ok(calls.every(c=>c.path==='/v1/packages'&&c.method==='GET'));
});
