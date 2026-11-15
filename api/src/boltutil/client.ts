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
export async function boltRequest(env:Env,endpoint:"/api/v1/order/create"|"/api/v1/order/status",body:Record<string,unknown>):Promise<Record<string,unknown>>{
  if(env.ENVIRONMENT!=="staging"|| (endpoint==="/api/v1/order/create"&&env.BOLTUTIL_STAGING_CREATE_ENABLED!=="1")||
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
