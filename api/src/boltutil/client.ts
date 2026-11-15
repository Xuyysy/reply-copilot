import type {Env} from "../types";
import {ApiFailure} from "../types";

const HOST="https://api.boltutil.com";
const encoder = new TextEncoder();
async function hmac(secret:string,ts:string,raw:string):Promise<string>{
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(ts+"."+raw)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
export async function verifyBoltWebhook(request:Request,secret:string):Promise<unknown>{
  const ts=request.headers.get("X-Bolt-Webhook-Timestamp")??"";
  const sig=request.headers.get("X-Bolt-Webhook-Signature")??"";
  if (!/^\d{13}$/.test(ts)||Math.abs(Date.now()-Number(ts))>300000 || !/^[0-9a-fA-F]{64}$/.test(sig))
    throw new ApiFailure(401,"BOLTUTIL_SIGNATURE_INVALID","支付签名无效。");
  const raw=await request.text();
  if (encoder.encode(raw).length > 8192) throw new ApiFailure(413,"BOLTUTIL_PAYLOAD_TOO_LARGE","通知内容过大。");
  const expected=await hmac(secret,ts,raw);
  const a=encoder.encode(expected),b=encoder.encode(sig.toLowerCase());
  let mismatch=0;
  for(let i=0;i<a.length;i++) mismatch |= a[i]^b[i];
  if(mismatch!==0)throw new ApiFailure(401,"BOLTUTIL_SIGNATURE_INVALID","支付签名无效。");
  try{return JSON.parse(raw);}catch{throw new ApiFailure(400,"BOLTUTIL_BODY_INVALID","通知格式无效。");}
}
export async function boltRequest(env:Env,endpoint:"/api/v1/order/create"|"/api/v1/order/status",body:Record<string,unknown>,options:{adminProbe?:boolean}={}):Promise<Record<string,unknown>>{
  if(env.ENVIRONMENT!=="staging"|| (endpoint==="/api/v1/order/create"&&env.BOLTUTIL_STAGING_CREATE_ENABLED!=="1"&&
     !(options.adminProbe===true&&env.BOLTUTIL_ADMIN_TEST_ENABLED==="1"&&env.BOLTUTIL_ADMIN_TEST_SCHEMA_READY==="1"))||
     !env.BOLTUTIL_API_KEY||!env.BOLTUTIL_WEBHOOK_SECRET)
     throw new ApiFailure(503,"BOLTUTIL_NOT_CONFIGURED","USDT 收款通道尚未完成配置。");
  const raw=JSON.stringify(body),ts=String(Date.now()),sig=await hmac(env.BOLTUTIL_WEBHOOK_SECRET,ts,raw);
  let upstream:Response;
  try{
    upstream=await fetch(HOST+endpoint,{method:"POST",redirect:"manual",
      headers:{"Content-Type":"application/json","X-Bolt-Key":env.BOLTUTIL_API_KEY,
        "X-Bolt-Timestamp":ts,"X-Bolt-Signature":sig},body:raw,signal:AbortSignal.timeout(8000)});
  }catch{throw new ApiFailure(503,"BOLTUTIL_NETWORK_UNCERTAIN","USDT 平台请求状态不明，请查询原订单。");}
  if(!upstream.ok||upstream.status>=300)
    throw new ApiFailure(502,"BOLTUTIL_UPSTREAM_UNCONFIRMED","USDT 平台请求未确认，请保留原单核对。");
  if(Number(upstream.headers.get("content-length")??0)>16384)throw new ApiFailure(502,"BOLTUTIL_BAD_RESPONSE","收款平台响应异常。");
  let data:unknown;
  try{data=await upstream.json();}catch{throw new ApiFailure(502,"BOLTUTIL_BAD_RESPONSE","收款平台响应格式异常。");}
  if(!data||typeof data!=="object"||Array.isArray(data))throw new ApiFailure(502,"BOLTUTIL_BAD_RESPONSE","收款平台响应格式异常。");
  const payload=data as Record<string,unknown>;
  if(payload.code!==200||!payload.data||typeof payload.data!=="object"||Array.isArray(payload.data))
    throw new ApiFailure(502,"BOLTUTIL_UPSTREAM_UNCONFIRMED","收款平台未确认此操作，请核对原单。");
  return payload.data as Record<string,unknown>;
}

// Read-only BoltUtil diagnostics for authenticated Staging administrators.
// Never log or return API keys, secrets, raw provider bodies or payment addresses.
// This only calls /ping and /order/status; it cannot create an invoice or transfer money.
export type BoltReadOnlyProbe={
 kind:"ok"|"unauthorized"|"bad_request"|"rate_limited"|"not_found"|"upstream_http"|"business_rejected"|"malformed"|"network_error";
 httpStatus:number|null;providerCode:string|null;orderStatus:string|null;checkoutAvailable:boolean;
};
export async function boltReadOnlyProbe(env:Env,operation:"ping"|"status",externalOrderId?:string):Promise<BoltReadOnlyProbe>{
 if(env.ENVIRONMENT!=="staging"||!env.BOLTUTIL_API_KEY||!env.BOLTUTIL_WEBHOOK_SECRET)
   throw new ApiFailure(503,"BOLTUTIL_PROBE_NOT_CONFIGURED","Staging 商户密钥未配置。");
 if(operation==="status"&&(typeof externalOrderId!=="string"||!/^[A-Za-z0-9_-]{6,64}$/.test(externalOrderId)))
   throw new ApiFailure(400,"BOLTUTIL_INVALID_ORDER_ID","测试订单编号不合法。");
 const isStatus=operation==="status";
 const raw=isStatus?JSON.stringify({externalOrderId}):"";
 const ts=String(Date.now());
 const headers:Record<string,string>={"X-Bolt-Key":env.BOLTUTIL_API_KEY};
 if(isStatus){
   headers["Content-Type"]="application/json";
   headers["X-Bolt-Timestamp"]=ts;
   headers["X-Bolt-Signature"]=await hmac(env.BOLTUTIL_WEBHOOK_SECRET,ts,raw);
 }
 const blank=(kind:BoltReadOnlyProbe["kind"],httpStatus:number|null,providerCode:string|null=null):BoltReadOnlyProbe=>(
   {kind,httpStatus,providerCode,orderStatus:null,checkoutAvailable:false}
 );
 let res:Response;
 try{
   res=await fetch(HOST+(isStatus?"/api/v1/order/status":"/api/v1/ping"),{
     method:isStatus?"POST":"GET",headers,redirect:"manual",
     ...(isStatus?{body:raw}:{}),signal:AbortSignal.timeout(8000)
   });
 }catch{return blank("network_error",null);}
 const kind=res.status===401||res.status===403?"unauthorized":res.status===400?"bad_request":
   res.status===429?"rate_limited":res.status===404?"not_found":"upstream_http";
 const head=Number(res.headers.get("content-length")??0);
 if(head>8192)return blank("malformed",res.status);
 let payload:Record<string,unknown>|null=null;
 try{
   const str=await res.text();
   if(str.length>8192)return blank("malformed",res.status);
   const obj=JSON.parse(str);
   if(obj&&typeof obj==="object"&&!Array.isArray(obj))payload=obj as Record<string,unknown>;
 }catch{/* Ping may respond empty; HTTP status alone is enough. */}
 const code=payload?.code;
 const providerCode=(typeof code==="number"&&Number.isSafeInteger(code))?String(code):
   (typeof code==="string"&&/^[a-zA-Z0-9_-]{1,32}$/.test(code))?code:null;
 if(!res.ok||res.status>=300)return blank(kind,res.status,providerCode);
 if(!isStatus)return blank("ok",res.status,providerCode);
 if(!payload||payload.code!==200||!payload.data||typeof payload.data!=="object"||Array.isArray(payload.data))
   return blank(payload?"business_rejected":"malformed",res.status,providerCode);
 const p=payload.data as Record<string,unknown>;
 if(p.externalOrderId!==externalOrderId)return blank("malformed",res.status,providerCode);
 const providerStatus=typeof p.status==="string"&&
   ["PENDING","PAID","CONFIRMED","COMPLETED","EXPIRED","FAILED","CANCELLED"].includes(p.status)?p.status:null;
 return {kind:"ok",httpStatus:res.status,providerCode,orderStatus:providerStatus,
   checkoutAvailable:typeof p.checkoutUrl==="string"&&p.checkoutUrl.startsWith("https://")};
}
