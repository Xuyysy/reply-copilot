import {md5Hex} from './md5.js';
import type {Env} from './types';

export type Mk99SignType='MD5'|'RSA';
export type Mk99Config={baseUrl:string;pid:string;key?:string;privateKey?:string;platformPublicKey?:string;signType:Mk99SignType;notifySignType:Mk99SignType;currency:'CNY';cashierOrigins:string[]};
export type Mk99TradeStatus='WAIT_BUYER_PAY'|'TRADE_SUCCESS'|'TRADE_CLOSED'|'TRADE_REFUND'|'TRADE_FREEZE'|'TRADE_UNFREEZE';
export type Mk99PaymentEvent={provider:'mk99';verification:'authenticated_query'|'verified_notification';outTradeNo:string;tradeNo:string;amountFen:number;tradeStatus:Mk99TradeStatus;merchantId?:string;paytypeCode?:string;currency?:string;refundAmountFen?:number;timestamp?:number};
export type Mk99CreateResult={provider:'mk99';outTradeNo:string;tradeNo:string;payUrl:string};
export type Mk99NotifyField='pid'|'trade_no'|'out_trade_no'|'subject'|'paytype_code'|'channel_id'|'trade_status'|'timestamp'|'currency'|'total_amount'|'refund_amount';
export type Mk99NotifyFieldCheck='required_missing'|'required_type_invalid'|'required_empty'|'value_mismatch'|'format_invalid'|'value_not_allowed'|'type_invalid';
type Params=Record<string,string|number|null|undefined>;
export class Mk99Error extends Error{constructor(public code:string,public status:number|null=null,public notifyFieldCheck?:Mk99NotifyFieldCheck,public notifyField?:Mk99NotifyField){super('Payment provider could not confirm this request.');}}
const bytes=(s:string)=>new TextEncoder().encode(s);
const signTypes=['MD5','RSA'];
function pem(pem:string|undefined,label:string){if(!pem?.includes(`-----BEGIN ${label}-----`))throw new Mk99Error('MK99_CONFIG_ERROR');return Uint8Array.from(atob(pem.replace(`-----BEGIN ${label}-----`,'').replace(`-----END ${label}-----`,'').replace(/\s/g,'')),x=>x.charCodeAt(0));}
// Cache only one resolved, non-extractable public verification key per isolate.
 // Exact configured PEM is the cache identity; a changed or invalid key is
 // always imported/validated and never falls back to the previous key.
 // Do not cache private signing keys or request-bound promises.
let platformVerifyKey: {pem:string;key:CryptoKey}|undefined;
async function importPlatformVerifyKey(value:string|undefined):Promise<CryptoKey>{
 if(value!==undefined&&platformVerifyKey?.pem===value)return platformVerifyKey.key;
 const key=await crypto.subtle.importKey('spki',pem(value,'PUBLIC KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(value!==undefined)platformVerifyKey={pem:value,key};
 return key;
}
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
  const key=await importPlatformVerifyKey(config.platformPublicKey);
  const sig=Uint8Array.from(atob(params.sign),c=>c.charCodeAt(0));return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,sig,bytes(canonicalMk99(params)));
 }catch{return false;}
}
export function mk99Config(env:Env,requireConfirmed=true):Mk99Config{
 if(requireConfirmed&&(env.MK99_PROTOCOL_CONFIRMED!=='1'||env.MK99_AMOUNT_CONTRACT!=='CNY_EXACT_BUYER_TOTAL'))throw new Mk99Error('MK99_CONTRACT_UNCONFIRMED');
 const signType=env.MK99_REQUEST_SIGN_TYPE??'RSA',notifySignType=env.MK99_NOTIFY_SIGN_TYPE??'RSA';
 if(!signTypes.includes(signType)||!signTypes.includes(notifySignType)||!/^2088[0-9]+$/.test(env.MK99_PID??''))throw new Mk99Error('MK99_CONFIG_ERROR');
 if(([signType,notifySignType].includes('MD5')&&!env.MK99_KEY)|| (signType==='RSA'&&!env.MK99_PRIVATE_KEY)||(notifySignType==='RSA'&&!env.MK99_PLATFORM_PUBLIC_KEY))throw new Mk99Error('MK99_CONFIG_ERROR');
 const cashierOrigins=(env.MK99_CASHIER_ORIGINS??'https://mk99.cn').split(',').map(x=>x.trim());
 for(const origin of cashierOrigins){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password||u.port)throw new Mk99Error('MK99_CONFIG_ERROR');}
 const config:Mk99Config={baseUrl:env.MK99_BASE_URL??'https://mk99.cn',pid:env.MK99_PID!,key:env.MK99_KEY,privateKey:env.MK99_PRIVATE_KEY,platformPublicKey:env.MK99_PLATFORM_PUBLIC_KEY,signType:signType as Mk99SignType,notifySignType:notifySignType as Mk99SignType,currency:'CNY',cashierOrigins};
 new Mk99Client(config);return config;
}
export async function mk99Readiness(env:Env){
 let credentialsConfigured=false;
 try{const config=mk99Config(env,false);if(config.signType==='RSA')await crypto.subtle.importKey('pkcs8',pem(config.privateKey,'PRIVATE KEY'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);if(config.notifySignType==='RSA')await importPlatformVerifyKey(config.platformPublicKey);credentialsConfigured=true;}catch{}
 return {credentialsConfigured,protocolConfirmed:env.MK99_PROTOCOL_CONFIRMED==='1',amountContractConfirmed:env.MK99_AMOUNT_CONTRACT==='CNY_EXACT_BUYER_TOTAL'};
}
/** MK99 documents total_amount as a decimal yuan string. Keep this parser local
 * to the provider adapter; never infer units or coerce JSON numbers. */
function amountFenFromDecimal(value:string):number{
 if(!/^[0-9]{1,14}(?:\.[0-9]{1,2})?$/.test(value))throw new Mk99Error('MK99_AMOUNT_INVALID');
 const [whole,fraction='']=value.split('.'),fen=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(fen<1n||fen>BigInt(Number.MAX_SAFE_INTEGER))throw new Mk99Error('MK99_AMOUNT_INVALID');
 return Number(fen);
}
/**
 * The published schema says yuan strings, while the Staging query diagnostic
 * observed a JSON number. Numbers are accepted only with their original JSON
 * token so exponent notation and rounded JS conversions cannot be mistaken
 * for exact cents.
 */
export function parseMk99AmountFen(value:unknown,rawNumberToken?:string):number{
 if(typeof value==='string')return amountFenFromDecimal(value);
 if(typeof value!=='number'||!Number.isFinite(value)||!rawNumberToken||!/^[0-9]{1,14}(?:\.[0-9]{1,2})?$/.test(rawNumberToken)||Number(rawNumberToken)!==value)throw new Mk99Error('MK99_AMOUNT_INVALID');
 return amountFenFromDecimal(rawNumberToken);
}
function skipJsonSpace(source:string,index:number){while(index<source.length&&/\s/.test(source[index]))index++;return index;}
function jsonStringEnd(source:string,index:number){
 if(source[index]!=='"')throw new Mk99Error('MK99_RESPONSE_INVALID');
 for(let i=index+1;i<source.length;i++){
  if(source[i]==='\\'){i++;continue;}
  if(source[i]==='"')return i+1;
 }
 throw new Mk99Error('MK99_RESPONSE_INVALID');
}
function jsonValueEnd(source:string,index:number){
 const start=skipJsonSpace(source,index),first=source[start];
 if(first==='"')return jsonStringEnd(source,start);
 if(first==='{'||first==='['){
  const stack=[first==='{'?'}':']'];let inString=false;
  for(let i=start+1;i<source.length;i++){
   const c=source[i];if(inString){if(c==='\\')i++;else if(c==='"')inString=false;continue;}
   if(c==='"')inString=true;else if(c==='{')stack.push('}');else if(c==='[')stack.push(']');else if(c==='}'||c===']'){if(stack.pop()!==c)throw new Mk99Error('MK99_RESPONSE_INVALID');if(!stack.length)return i+1;}
  }
  throw new Mk99Error('MK99_RESPONSE_INVALID');
 }
 let end=start;while(end<source.length&&!/[\s,}\]]/.test(source[end]))end++;
 if(end===start)throw new Mk99Error('MK99_RESPONSE_INVALID');return end;
}
function objectMemberSpan(source:string,objectStart:number,key:string):{start:number;end:number;raw:string}|undefined{
 let index=skipJsonSpace(source,objectStart);if(source[index++]!=='{')return undefined;let found:{start:number;end:number;raw:string}|undefined;
 while(index<source.length){
  index=skipJsonSpace(source,index);if(source[index]==='}')return undefined;
  const keyEnd=jsonStringEnd(source,index),member=JSON.parse(source.slice(index,keyEnd));index=skipJsonSpace(source,keyEnd);
  if(source[index++]!==':')throw new Mk99Error('MK99_RESPONSE_INVALID');const valueStart=skipJsonSpace(source,index),valueEnd=jsonValueEnd(source,valueStart);
  if(member===key){if(found)throw new Mk99Error('MK99_RESPONSE_INVALID');found={start:valueStart,end:valueEnd,raw:source.slice(valueStart,valueEnd)};}
  index=skipJsonSpace(source,valueEnd);if(source[index]===','){index++;continue;}if(source[index]==='}')return found;
  throw new Mk99Error('MK99_RESPONSE_INVALID');
 }
 throw new Mk99Error('MK99_RESPONSE_INVALID');
}
function queryAmountNumberToken(source:string):string|undefined{
 const dataSpan=objectMemberSpan(source,0,'data');if(!dataSpan||dataSpan.raw[0]!=='{')return undefined;
 const amount=objectMemberSpan(source,dataSpan.start,'total_amount'),token=amount?.raw;
 return token&&token[0]!=='"'&&token!=='null'&&token[0]!=='{'&&token[0]!=='['?token:undefined;
}
export function parseMk99Form(body:string):Record<string,string>{
 if(typeof body!=='string'||body.length>8192||/%(?![a-f0-9]{2})/i.test(body))throw new Mk99Error('MK99_INVALID_PARAMETERS');
 const result=Object.create(null) as Record<string,string>;
 new URLSearchParams(body).forEach((value,key)=>{
  if(!/^[A-Za-z0-9_]{1,64}$/.test(key)||Object.hasOwn(result,key)||value.includes('\uFFFD')||/[\u0000-\u001f\u007f]/.test(value))throw new Mk99Error('MK99_INVALID_PARAMETERS');
  result[key]=value;
 });
 return result;
}
export const mk99States=['WAIT_BUYER_PAY','TRADE_SUCCESS','TRADE_CLOSED','TRADE_REFUND','TRADE_FREEZE','TRADE_UNFREEZE'] as const satisfies readonly Mk99TradeStatus[];
function normalizePaymentEvent(data:Record<string,unknown>,outTradeNo:string,notification:boolean,rawAmountToken?:string):Mk99PaymentEvent{
 const required=notification?['pid','trade_no','out_trade_no','subject','paytype_code','channel_id','trade_status','timestamp']:['trade_no','out_trade_no','trade_status'];
 for(const key of required){const field=key as Mk99NotifyField;if(!(key in data))throw new Mk99Error('MK99_RESPONSE_INVALID',null,'required_missing',field);if(typeof data[key]!=='string')throw new Mk99Error('MK99_RESPONSE_INVALID',null,'required_type_invalid',field);if(data[key]===''&&key!=='subject')throw new Mk99Error('MK99_RESPONSE_INVALID',null,'required_empty',field);}
 if(data.out_trade_no!==outTradeNo)throw new Mk99Error('MK99_ORDER_MISMATCH',null,'value_mismatch','out_trade_no');
 if(typeof data.trade_no!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.trade_no))throw new Mk99Error('MK99_ORDER_MISMATCH',null,'format_invalid','trade_no');
 if(typeof data.trade_status!=='string'||!mk99States.includes(data.trade_status as Mk99TradeStatus))throw new Mk99Error('MK99_STATUS_INVALID',null,'value_not_allowed','trade_status');
 if(notification){
  if(typeof data.pid!=='string'||!/^2088[0-9]+$/.test(data.pid))throw new Mk99Error('MK99_RESPONSE_INVALID',null,'format_invalid','pid');
  if(typeof data.channel_id!=='string'||!/^[0-9]{1,20}$/.test(data.channel_id))throw new Mk99Error('MK99_RESPONSE_INVALID',null,'format_invalid','channel_id');
  if(typeof data.timestamp!=='string'||!/^[0-9]{1,12}$/.test(data.timestamp))throw new Mk99Error('MK99_RESPONSE_INVALID',null,'format_invalid','timestamp');
 }
 if(data.currency!==undefined&&typeof data.currency!=='string')throw new Mk99Error('MK99_AMOUNT_INVALID',null,'type_invalid','currency');
 if(data.currency!==undefined&&data.currency!=='CNY')throw new Mk99Error('MK99_AMOUNT_INVALID',null,'value_not_allowed','currency');
 let amountFen:number;try{amountFen=parseMk99AmountFen(data.total_amount,rawAmountToken);}catch(error){if(error instanceof Mk99Error)throw new Mk99Error(error.code,error.status,'format_invalid','total_amount');throw error;}
 const event:Mk99PaymentEvent={provider:'mk99',verification:notification?'verified_notification':'authenticated_query',outTradeNo,tradeNo:data.trade_no,amountFen,tradeStatus:data.trade_status as Mk99TradeStatus};
 if(data.pid!==undefined){if(typeof data.pid!=='string')throw new Mk99Error('MK99_RESPONSE_INVALID',null,'type_invalid','pid');event.merchantId=data.pid;}
 if(data.paytype_code!==undefined){if(typeof data.paytype_code!=='string')throw new Mk99Error('MK99_RESPONSE_INVALID',null,'type_invalid','paytype_code');event.paytypeCode=data.paytype_code;}
 if(typeof data.currency==='string')event.currency=data.currency;
 if(data.refund_amount!==undefined){try{event.refundAmountFen=parseMk99AmountFen(data.refund_amount);}catch(error){if(error instanceof Mk99Error)throw new Mk99Error(error.code,error.status,'format_invalid','refund_amount');throw error;}}
 if(data.timestamp!==undefined){const timestamp=Number(data.timestamp);if(!Number.isSafeInteger(timestamp)||timestamp<1)throw new Mk99Error('MK99_RESPONSE_INVALID',null,'format_invalid','timestamp');event.timestamp=timestamp;}
 return event;
}
export function parseMk99QueryEvent(data:Record<string,unknown>,outTradeNo:string,rawAmountToken?:string):Mk99PaymentEvent{return normalizePaymentEvent(data,outTradeNo,false,rawAmountToken);}
/** A notification event is only emitted after its configured signature verifies. */
export async function verifyAndParseMk99Notification(data:Record<string,string>,outTradeNo:string,config:Mk99Config):Promise<Mk99PaymentEvent|null>{
 if(!await verifyMk99(data,config))return null;
 return normalizePaymentEvent(data,outTradeNo,true);
}
export class Mk99Client{
 constructor(public config:Mk99Config,private fetcher:typeof fetch=globalThis.fetch){
  const u=new URL(config.baseUrl);if(u.origin!=='https://mk99.cn'||!['','/'].includes(u.pathname)||u.search||u.hash||u.username||u.password)throw new Mk99Error('MK99_CONFIG_ERROR');
 }
 private async request(path:'/openapi/pay/create'|'/openapi/pay/query'|'/openapi/merchant/balance_query',parameters:Record<string,string>):Promise<{data:Record<string,unknown>;rawText:string}>{
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
   let rawText:string,result;try{rawText=new TextDecoder('utf-8',{fatal:true}).decode(body);result=JSON.parse(rawText);}catch{throw new Mk99Error('MK99_RESPONSE_INVALID');}
   if(result?.code!==1)throw new Mk99Error('MK99_REQUEST_REJECTED',res.status);
   if(!result.data||typeof result.data!=='object'||Array.isArray(result.data))throw new Mk99Error('MK99_RESPONSE_INVALID');
   return {data:result.data,rawText};
  }finally{clearTimeout(timer);}
 }
 async create(order:{outTradeNo:string;amountFen:number;subject:string;paytype:'wxpay'|'alipay';clientIp:string;notifyUrl:string;returnUrl:string}):Promise<Mk99CreateResult>{
  if(!Number.isSafeInteger(order.amountFen)||order.amountFen<1||!/^[A-Za-z0-9_-]{6,64}$/.test(order.outTradeNo)||!order.subject||!['wxpay','alipay'].includes(order.paytype)||!/^([0-9a-fA-F:.]+)$/.test(order.clientIp))throw new Mk99Error('MK99_INVALID_PARAMETERS');
  const {data}=await this.request('/openapi/pay/create',{out_trade_no:order.outTradeNo,total_amount:`${Math.floor(order.amountFen/100)}.${String(order.amountFen%100).padStart(2,'0')}`,subject:order.subject,paytype_code:order.paytype,notify_url:order.notifyUrl,return_url:order.returnUrl,client_ip:order.clientIp});
  this.validateIdentity(data,order.outTradeNo);
  if(typeof data.pay_url!=='string')throw new Mk99Error('MK99_RESPONSE_INVALID');
  const url=new URL(data.pay_url);if(url.protocol!=='https:'||url.username||url.password||!this.config.cashierOrigins.includes(url.origin))throw new Mk99Error('MK99_CASHIER_INVALID');
  return {provider:'mk99',tradeNo:String(data.trade_no),outTradeNo:order.outTradeNo,payUrl:data.pay_url};
 }
 async query(outTradeNo:string){const {data,rawText}=await this.request('/openapi/pay/query',{out_trade_no:outTradeNo});return parseMk99QueryEvent(data,outTradeNo,queryAmountNumberToken(rawText));}
 async balance(){await this.request('/openapi/merchant/balance_query',{});return {ok:true};}
 private validateIdentity(data:Record<string,unknown>,outTradeNo:string){if(data.out_trade_no!==outTradeNo||typeof data.trade_no!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.trade_no))throw new Mk99Error('MK99_ORDER_MISMATCH');}
}
