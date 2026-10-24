import {md5Hex} from './md5.js';
export {md5Hex} from './md5.js';

export function signEpay(parameters,key){
  if(typeof key!=='string'||!key.trim())throw new TypeError('Epay is not configured');
  const entries=Object.entries(parameters).filter(([k,v])=>k!=='sign'&&k!=='sign_type'&&v!=='');
  if(entries.some(([k,v])=>!/^[A-Za-z0-9_]+$/.test(k)||typeof v!=='string'))throw new TypeError('Invalid Epay parameters');
  return md5Hex(entries.sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('&')+key);
}
export function verifyEpay(parameters,key){
  if(parameters.sign_type!==undefined&&parameters.sign_type!=='MD5')return false;
  if(typeof parameters.sign!=='string'||! /^[a-f0-9]{32}$/i.test(parameters.sign))return false;
  const expected=signEpay(parameters,key),actual=parameters.sign.toLowerCase();let difference=0;
  for(let i=0;i<32;i++)difference|=expected.charCodeAt(i)^actual.charCodeAt(i);
  return difference===0;
}
export function parseEpayParameters(query){
  if(typeof query!=='string'||query.length>8192||/%(?![a-f0-9]{2})/i.test(query))throw new TypeError('Invalid Epay query');
  const result=Object.create(null);
  for(const [key,value] of new URLSearchParams(query)){
    if(!/^[A-Za-z0-9_]{1,64}$/.test(key)||Object.hasOwn(result,key)||value.includes('\uFFFD')||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError('Invalid Epay parameter');
    result[key]=value;
  }
  return result;
}
export function moneyToFen(value){
  if(typeof value!=='string'||!/^\d{1,14}(?:\.\d{1,2})?$/.test(value))throw new TypeError('Invalid Epay amount');
  const [whole,fraction='']=value.split('.'),fen=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(fen<1n||fen>BigInt(Number.MAX_SAFE_INTEGER))throw new TypeError('Invalid Epay amount');
  return Number(fen);
}
export function epayCheckout(config,order){
  const gateway=new URL(config.gateway);
  if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.search||gateway.hash||gateway.port||!['/','/submit.php'].includes(gateway.pathname))throw new TypeError('Invalid Epay gateway');
  if(typeof config.pid!=='string'||!/^\d{1,32}$/.test(config.pid))throw new TypeError('Invalid Epay merchant');
  if(!/^[A-Za-z0-9_-]{6,64}$/.test(order.outTradeNo)||!Number.isSafeInteger(order.amountFen)||order.amountFen<1||typeof order.name!=='string'||!order.name||order.name.length>128)throw new TypeError('Invalid Epay order');
  for(const origin of [config.apiOrigin,config.webOrigin]){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin)throw new TypeError('Invalid Epay callback origin');}
  const returnUrl=new URL('/account/',config.webOrigin);
  if(order.orderId!==undefined){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.orderId))throw new TypeError('Invalid local order');returnUrl.searchParams.set('payment_order',order.orderId);}
  const fields={pid:config.pid,type:'alipay',out_trade_no:order.outTradeNo,notify_url:config.apiOrigin+'/v1/payments/xiaodou/epay/notify',return_url:returnUrl.href,name:order.name,money:`${Math.floor(order.amountFen/100)}.${String(order.amountFen%100).padStart(2,'0')}`};
  return {action:gateway.origin+'/submit.php',method:'POST',fields:{...fields,sign:signEpay(fields,config.key),sign_type:'MD5'}};
}
