import type {Env} from "../types";
import {ApiFailure} from "../types";
import {boltProductionKeyProbe} from "./client";
import {requireAdminSession} from "../admin-auth";
import {operation,commitOperation} from "../admin-operations";
import {jsonBody,nowMs,requireWebOrigin} from "../security";
import {response} from "../http";
import {SUPPORTED_BOLT_NETWORKS,type BoltNetwork} from "./contract";
import {boltReadSchemaReady,boltCreateAuthorized} from "./environment";
import {
  BOLT_CONTROL_KEYS,readBoltOperatorControl,boltControlRevision,
  boltEnvironmentReady,boltEnvironmentNetworkEnabled,effectiveBoltNetworks,boltReadiness,
  type BoltOperatorControl
} from "./control";

/** Admin-only, read-only production merchant key verification. No orders or D1 mutations. */
export async function adminBoltProviderPing(request:Request,env:Env):Promise<Response>{
  await requireAdminSession(request,env);
  if(env.ENVIRONMENT!=="production")throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  const result=await boltProductionKeyProbe(env);
  return response(result,200,env,request);
}

export async function adminBoltControl(request:Request,env:Env):Promise<Response>{
  await requireAdminSession(request,env);
  const control=await readBoltOperatorControl(env);
  const networks=effectiveBoltNetworks(env,control);
  const readiness=boltReadiness(env,control);
  return response({
    readiness,
    environment:env.ENVIRONMENT,
    operatorEnabled:control.enabled,operatorNetworks:control.networks,
    revision:boltControlRevision(control),
    environmentReady:boltEnvironmentReady(env),
    schemaReady:boltReadSchemaReady(env),
    creationApproved:boltCreateAuthorized(env),
    credentialsConfigured:Boolean(env.BOLTUTIL_API_KEY)&&Boolean(env.BOLTUTIL_WEBHOOK_SECRET),
    rateConfigured:/^[1-9][0-9]{5,8}$/.test(env.BOLTUTIL_CNY_PER_USDT_MICROS??""),
    environmentNetworks:Object.fromEntries(SUPPORTED_BOLT_NETWORKS.map(n=>[n,boltEnvironmentNetworkEnabled(env,n)])),
    effectiveNetworks:networks,available:networks.length>0
  },200,env,request);
}
function isNetworks(v:unknown):v is Record<BoltNetwork,boolean>{
  return Boolean(v)&&typeof v==="object"&&!Array.isArray(v)&&
    Object.keys(v as object).length===SUPPORTED_BOLT_NETWORKS.length&&
    SUPPORTED_BOLT_NETWORKS.every(n=>typeof (v as Record<string,unknown>)[n]==="boolean");
}
/** Audited, idempotent operator switches. They never write Workers bindings or grant credits. */
export async function updateAdminBoltControl(request:Request,env:Env):Promise<Response>{
  const actor=await requireAdminSession(request,env,true);
  requireWebOrigin(request,env);
  const body=await jsonBody(request,4096);
  if(Object.keys(body).some(k=>!["enabled","networks","expectedRevision","operationId","reason","confirm"].includes(k))||
     typeof body.enabled!=="boolean"||!isNetworks(body.networks)||
     typeof body.expectedRevision!=="string"||!/^[01]{6}$/.test(body.expectedRevision)||
     body.confirm!==true)
    throw new ApiFailure(400,"BOLTUTIL_CONTROL_INVALID","USDT 收款控制参数无效。");
  const before=await readBoltOperatorControl(env);
  const op=await operation(env,actor,body,"boltutil_operator_control","boltutil");
  if(op.replayed)return adminBoltControl(request,env);
  if(body.expectedRevision!==boltControlRevision(before))
    throw new ApiFailure(409,"BOLTUTIL_CONTROL_STALE","USDT 开关已被其他操作修改，请刷新并重新确认。");
  const desired:BoltOperatorControl={enabled:body.enabled,networks:body.networks};
  // In Production, an operator cannot arm an enabled master before the
  // independently approved Cloudflare ceilings, quote and schema are ready.
  if(desired.enabled&&!boltEnvironmentReady(env))
    throw new ApiFailure(409,"BOLTUTIL_ENVIRONMENT_NOT_READY","云端 USDT 安全门禁、表结构或正式汇率尚未就绪，无法开启总收款。");
  const changes:[string,boolean][]=[[BOLT_CONTROL_KEYS.master,desired.enabled],
    ...SUPPORTED_BOLT_NETWORKS.map(n=>[BOLT_CONTROL_KEYS.networks[n],desired.networks[n]] as [string,boolean])];
  const now=nowMs();
  const statements=changes.map(([key,value])=>env.DB.prepare(
    "INSERT INTO system_settings(key,value,updated_at,updated_by) VALUES(?,?,?,?) "+
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by"
  ).bind(key,value?"1":"0",now,actor.user_id));
  await commitOperation(env,op,statements,before,desired);
  return adminBoltControl(request,env);
}

/** Historical payment evidence: no mutation and never mixed into CNY revenue. */
export async function adminBoltOrders(request:Request,env:Env):Promise<Response>{
  await requireAdminSession(request,env);
  if(!boltReadSchemaReady(env))
    return response({orders:[],available:false,networks:SUPPORTED_BOLT_NETWORKS},200,env,request);
  const control=await readBoltOperatorControl(env);
  const results=await env.DB.prepare(
    "SELECT b.id,b.external_order_id,b.network,b.token_contract,b.token_decimals,b.user_id,u.email,"+
    "b.product_type,b.credit_order_id,b.subscription_order_id,b.base_amount_fen,b.cny_per_usdt_micros,"+
    "b.quoted_usdt_micros,b.payable_usdt_micros,b.paid_usdt_micros,b.tx_hash,b.status,b.paid_at,"+
    "b.applied_at,b.created_at,b.expires_at FROM boltutil_orders b "+
    "JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC,b.id DESC LIMIT 100"
  ).all();
  const live=effectiveBoltNetworks(env,control);
  return response({orders:results.results??[],available:live.length>0,networks:live,
    currency:"USDT",note:"Amounts are USDT micros; do not sum with CNY amounts."},200,env,request);
}
