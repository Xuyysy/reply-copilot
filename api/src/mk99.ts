import {md5Hex,moneyToFen,parseEpayParameters} from './epay.js';
import type {Env} from './types';

export type Mk99SignType='MD5'|'RSA';
export type Mk99Config={baseUrl:string;pid:string;key?:string;privateKey?:string;platformPublicKey?:string;signType:Mk99SignType;notifySignType:Mk99SignType;currency:'CNY';cashierOrigins:string[]};
type Params=Record<string,string|number|null|undefined>;
export class Mk99Error extends Error{constructor(public code:string,public status:number|null=null){super('Payment provider could not confirm this request.');}}
const bytes=(s:string)=>new TextEncoder().encode(s);
const signTypes=['MD5','RSA'];
function pem(pem:string|undefined,label:string){if(!pem?.includes(`-----BEGIN ${label}-----`))throw new Mk99Error('MK99_CONFIG_ERROR');return Uint8Array.from(atob(pem.replace(`-----BEGIN ${label}-----`,'').replace(`-----END ${label}-----`,'').replace(/\s/g,'')),x=>x.charCodeAt(0));}
export function canonicalMk99(params:Params):string{
 const entries=Object.entries(params).filter(([k,v])=>k!=='sign'&&k!=='sign_type'&&v!==''&&v!==null&&v!==undefined);
 if(entries.some(([k,v])=>!/^[A-Za-z0-9_]{1,64}$/.test(k)||!['string','number'].includes(typeof v)||(typeof v==='number'&&!Number.isSafeInteger(v))))throw new Mk99Error('MK99_INVALID_PARAMETERS');
 // PHP urldecode(http_build_query(...)): canonical values are decoded, not JSON or percent-encoded.
 return entries.sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('&');
}
export async function signMk99(params:Params,config:Mk99Config):Promise<string>{
 const text=canonicalMk99(params);
 if(config.signType==='MD5'){if(!config.key)throw new Mk99Error('MK99_CONFIG_ERROR');return md5Hex(text+'&key='+config.key).toUpperCase();}
 const key=await crypto.subtle.importKey('pkcs8',pem(config.privateKey,'PRIVATE KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const result=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,bytes(text)));return btoa(String.fromCharCode(...result));
}
export async function verifyMk99(params:Record<string,string>,config:Mk99Config):Promise<boolean>{
 try{
  if(params.sign_type!==config.notifySignType||!params.sign||params.sign.length>2048)return false;
  if(config.notifySignType==='MD5'){
   if(!/^[A-Fa-f0-9]{32}$/.test(params.sign))return false;
   const expected=await signMk99(params,{...config,signType:'MD5'}),actual=params.sign.toUpperCase();let d=0;for(let i=0;i<32;i++)d|=expected.charCodeAt(i)^actual.charCodeAt(i);return d===0;
  }
  const key=await crypto.subtle.importKey('spki',pem(config.platformPublicKey,'PUBLIC KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const sig=Uint8Array.from(atob(params.sign),c=>c.charCodeAt(0));return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,sig,bytes(canonicalMk99(params)));
 }catch{return false;}
}
export function mk99Config(env:Env,requireConfirmed=true):Mk99Config{
 if(requireConfirmed&&(env.MK99_PROTOCOL_CONFIRMED!=='1'||env.MK99_AMOUNT_CONTRACT!=='CNY_EXACT_BUYER_TOTAL'))throw new Mk99Error('MK99_CONTRACT_UNCONFIRMED');
 const signType=env.MK99_REQUEST_SIGN_TYPE??'RSA',notifySignType=env.MK99_NOTIFY_SIGN_TYPE??'RSA';
 if(!signTypes.includes(signType)||!signTypes.includes(notifySignType)||!/^2088\d{1,28}$/.test(env.MK99_PID??''))throw new Mk99Error('MK99_CONFIG_ERROR');
 if(([signType,notifySignType].includes('MD5')&&!env.MK99_KEY)|| (signType==='RSA'&&!env.MK99_PRIVATE_KEY)||(notifySignType==='RSA'&&!env.MK99_PLATFORM_PUBLIC_KEY))throw new Mk99Error('MK99_CONFIG_ERROR');
 const cashierOrigins=(env.MK99_CASHIER_ORIGINS??'https://mk99.cn').split(',').map(x=>x.trim());
 for(const origin of cashierOrigins){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password||u.port)throw new Mk99Error('MK99_CONFIG_ERROR');}
 const config:Mk99Config={baseUrl:env.MK99_BASE_URL??'https://mk99.cn',pid:env.MK99_PID!,key:env.MK99_KEY,privateKey:env.MK99_PRIVATE_KEY,platformPublicKey:env.MK99_PLATFORM_PUBLIC_KEY,signType:signType as Mk99SignType,notifySignType:notifySignType as Mk99SignType,currency:'CNY',cashierOrigins};
 new Mk99Client(config);return config;
}
export async function mk99Readiness(env:Env){
 let credentialsConfigured=false;
 try{const config=mk99Config(env,false);if(config.signType==='RSA')await crypto.subtle.importKey('pkcs8',pem(config.privateKey,'PRIVATE KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);if(config.notifySignType==='RSA')await crypto.subtle.importKey('spki',pem(config.platformPublicKey,'PUBLIC KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);credentialsConfigured=true;}catch{}
 return {credentialsConfigured,protocolConfirmed:env.MK99_PROTOCOL_CONFIRMED==='1',amountContractConfirmed:env.MK99_AMOUNT_CONTRACT==='CNY_EXACT_BUYER_TOTAL'};
}
export function mk99Amount(value:unknown){try{return moneyToFen(value);}catch{throw new Mk99Error('MK99_AMOUNT_INVALID');}}
export function parseMk99Form(body:string){return parseEpayParameters(body) as Record<string,string>;}
export const mk99States=['WAIT_BUYER_PAY','TRADE_SUCCESS','TRADE_CLOSED','TRADE_REFUND','TRADE_FREEZE','TRADE_UNFREEZE'] as const;
export class Mk99Client{
 constructor(public config:Mk99Config,private fetcher:typeof fetch=globalThis.fetch){
  const u=new URL(config.baseUrl);if(u.origin!=='https://mk99.cn'||!['','/'].includes(u.pathname)||u.search||u.hash||u.username||u.password)throw new Mk99Error('MK99_CONFIG_ERROR');
 }
 private async request(path:'/openapi/pay/create'|'/openapi/pay/query'|'/openapi/merchant/balance_query',parameters:Record<string,string>):Promise<Record<string,any>>{
  const params={...parameters,pid:this.config.pid,timestamp:String(Math.floor(Date.now()/1000)),sign_type:this.config.signType};
  const signed={...params,sign:await signMk99(params,this.config)},controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
   let res:Response;try{const fetcher=this.fetcher;res=await fetcher('https://mk99.cn'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams(signed).toString(),redirect:'manual',signal:controller.signal});}catch{throw new Mk99Error(controller.signal.aborted?'MK99_TIMEOUT':'MK99_NETWORK_UNCERTAIN');}
   if(!res.ok)throw new Mk99Error('MK99_HTTP_ERROR',res.status);
   if(!res.headers.get('content-type')?.toLowerCase().includes('application/json'))throw new Mk99Error('MK99_RESPONSE_INVALID',res.status);
   const reader=res.body?.getReader();if(!reader)throw new Mk99Error('MK99_RESPONSE_INVALID');const chunks:Uint8Array[]=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new Mk99Error('MK99_RESPONSE_INVALID');}chunks.push(value);}
   const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
   let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new Mk99Error('MK99_RESPONSE_INVALID');}
   if(result?.code!==1)throw new Mk99Error('MK99_REQUEST_REJECTED',res.status);
   if(!result.data||typeof result.data!=='object'||Array.isArray(result.data))throw new Mk99Error('MK99_RESPONSE_INVALID');
   return result.data;
  }finally{clearTimeout(timer);}
 }
 async create(order:{outTradeNo:string;amountFen:number;subject:string;paytype:'wxpay'|'alipay';clientIp:string;notifyUrl:string;returnUrl:string}){
  if(!Number.isSafeInteger(order.amountFen)||order.amountFen<1||!/^[A-Za-z0-9_-]{6,64}$/.test(order.outTradeNo)||!order.subject||!['wxpay','alipay'].includes(order.paytype)||!/^([0-9a-fA-F:.]+)$/.test(order.clientIp))throw new Mk99Error('MK99_INVALID_PARAMETERS');
  const data=await this.request('/openapi/pay/create',{out_trade_no:order.outTradeNo,total_amount:`${Math.floor(order.amountFen/100)}.${String(order.amountFen%100).padStart(2,'0')}`,subject:order.subject,paytype_code:order.paytype,notify_url:order.notifyUrl,return_url:order.returnUrl,client_ip:order.clientIp});
  this.validateIdentity(data,order.outTradeNo);
  const url=new URL(data.pay_url);if(url.protocol!=='https:'||url.username||url.password||!this.config.cashierOrigins.includes(url.origin))throw new Mk99Error('MK99_CASHIER_INVALID');
  return data;
 }
 async query(outTradeNo:string){const data=await this.request('/openapi/pay/query',{out_trade_no:outTradeNo});this.validateIdentity(data,outTradeNo);if(!mk99States.includes(data.trade_status))throw new Mk99Error('MK99_STATUS_INVALID');mk99Amount(data.total_amount);return data;}
 async balance(){await this.request('/openapi/merchant/balance_query',{});return {ok:true};}
 private validateIdentity(data:Record<string,any>,outTradeNo:string){if(data.out_trade_no!==outTradeNo||typeof data.trade_no!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.trade_no))throw new Mk99Error('MK99_ORDER_MISMATCH');}
}
