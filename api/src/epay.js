// Legacy Epay requires MD5, which is not available through Workers WebCrypto.
// This small RFC 1321 implementation is used only for that protocol signature.
const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
const constants = Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296)|0);
export function md5Hex(text) {
  const input=new TextEncoder().encode(text),size=Math.ceil((input.length+9)/64)*64;
  const bytes=new Uint8Array(size);bytes.set(input);bytes[input.length]=128;
  const view=new DataView(bytes.buffer),bits=BigInt(input.length)*8n;
  view.setUint32(size-8,Number(bits&0xffffffffn),true);view.setUint32(size-4,Number(bits>>32n),true);
  let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476;
  for(let offset=0;offset<size;offset+=64){
    let a=h0,b=h1,c=h2,d=h3;
    for(let i=0;i<64;i++){
      const round=i>>4,g=round===0?i:round===1?(5*i+1)%16:round===2?(3*i+5)%16:(7*i)%16;
      const f=round===0?(b&c)|(~b&d):round===1?(d&b)|(~d&c):round===2?b^c^d:c^(b|~d);
      const n=(a+f+constants[i]+view.getInt32(offset+g*4,true))|0,s=shifts[round*4+i%4];
      a=d;d=c;c=b;b=(b+((n<<s)|(n>>>(32-s))))|0;
    }
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;
  }
  return [h0,h1,h2,h3].map(n=>[0,8,16,24].map(s=>((n>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');
}
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
