import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const source=new URL('../../web/src/pages/checkout.astro',import.meta.url);
const script=readFileSync(source,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const compiled=buildSync({stdin:{contents:script,loader:'ts',resolveDir:fileURLToPath(new URL('../../web/src/pages/',import.meta.url))},bundle:true,platform:'browser',format:'iife',write:false,define:{'import.meta.env':JSON.stringify({PUBLIC_API_BASE_URL:'https://api.example.test',DEV:false})}}).outputFiles[0].text;
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};

test('RSA2 WeChat checkout renders a local QR from the unchanged payUrl and keeps the cashier link fallback',async()=>{
 const nodes=new Map(),calls=[];
 class Element extends EventTarget{children=[];disabled=false;hidden=false;textContent='';href='';src='';alt='';appendChild(child){this.children.push(child);}append(child){this.children.push(child);}replaceChildren(...children){this.children=children;}remove(){}}
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'zh'},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},body:new Element()});
 const window=new EventTarget(),order={id:'qr-order',packageId:'starter',packageName:'400次',credits:400,displayPriceCents:149,displayCurrency:'USD',baseAmountFen:990,serviceFeeFen:16,feeRateBps:150,amountFen:1006,currency:'CNY',status:'pending',paymentProtocol:'rsa2',paymentProvider:'xiaodou',paymentChannel:'WECHAT_H5',paymentUrl:'https://cashier.example.test/session?token=opaque'};
 const fetch=async(url,init={})=>{const path=new URL(url).pathname;calls.push(path);if(path==='/v1/packages')return Response.json({paymentAvailable:true,paymentProvider:'xiaodou',paymentMethods:[{provider:'xiaodou',channel:'WECHAT_H5'}],packages:[{id:'starter',name_zh:'400次',name_en:'400 credits',credits:400,price_cents:149,promo_price_cents:null,price_cny_fen:990,service_fee_fen:16,total_payment_fen:1006,fee_rate_bps:150}]});if(path==='/v1/auth/csrf')return Response.json({csrfToken:'test-only'});if(path==='/v1/orders')return Response.json({order});throw Error('Unexpected request: '+path);};
 runInNewContext(compiled,{document,window,location:{href:'https://web.example.test/checkout/?package=starter'},URL,fetch,console,setTimeout,clearTimeout,AbortController,TextEncoder});await flush();nodes.get('create-order').dispatchEvent(new Event('click'));await flush();
 assert.equal(nodes.get('cashier-link').href,order.paymentUrl,'fallback link must preserve provider payUrl verbatim');
 assert.match(nodes.get('wechat-qr-image').src,/^data:image\/svg\+xml/);
 assert.match(nodes.get('wechat-qr-image').alt,/WeChat|微信/);
 assert.ok(calls.every(path=>path.startsWith('/v1/')),'QR rendering must not send payUrl to a third-party QR service');
});

test('when fiat is closed, checkout shows only a disabled USDT preview and does not imply Alipay',async()=>{
 const nodes=new Map();
 class Element extends EventTarget{children=[];disabled=false;hidden=false;textContent='';replaceChildren(...children){this.children=children;}append(...children){this.children.push(...children);}}
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{lang:'zh'},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();}});
 const fetch=async url=>{if(new URL(url).pathname==='/v1/packages')return Response.json({paymentAvailable:false,paymentProvider:null,paymentMethods:[],packages:[{id:'starter',name_zh:'400次',name_en:'400 credits',credits:400,price_cents:149,promo_price_cents:null,price_cny_fen:990,service_fee_fen:16,total_payment_fen:1006,fee_rate_bps:150}]});throw Error('Unexpected request');};
 runInNewContext(compiled,{document,window:new EventTarget(),location:{href:'https://web.example.test/checkout/?package=starter'},URL,fetch,console,setTimeout,clearTimeout,AbortController,TextEncoder});await flush();
 assert.equal(nodes.get('checkout-payment-method').hidden,false);
 assert.equal(nodes.get('payment-method-options').children.length,1,'Only independent USDT is visible when fiat methods are closed');
 assert.match(nodes.get('payment-method-options').children[0].children[1].textContent,/USDT/);
 assert.equal(nodes.get('create-order').disabled,true);
 assert.match(nodes.get('create-order-label').textContent,/暂不可付款|暂无可用支付方式/);
 assert.doesNotMatch(nodes.get('create-order-label').textContent,/支付宝|Alipay/);
});
