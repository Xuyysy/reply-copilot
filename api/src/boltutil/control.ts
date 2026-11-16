import type {Env} from "../types";
import {ApiFailure} from "../types";
import {boltCreateAuthorized,boltReadSchemaReady} from "./environment";
import {SUPPORTED_BOLT_NETWORKS,type BoltNetwork} from "./contract";

/**
 * Persistent operator switches are independent of the MK99/Xiaodou fiat rail.
 * The Cloudflare bindings remain non-overridable hard ceilings. Existing
 * Staging deployments default to their current environment-only behavior;
 * Production defaults CLOSED until an administrator explicitly opts in.
 * No new D1 tables, migration or financial rows are required.
 */
export type BoltOperatorControl={enabled:boolean;networks:Record<BoltNetwork,boolean>};
const MASTER_KEY="boltutil_operator_enabled";
const NETWORK_KEYS:Record<BoltNetwork,string>={
  TRC20:"boltutil_operator_trc20",POLYGON:"boltutil_operator_polygon",
  BEP20:"boltutil_operator_bep20",ERC20:"boltutil_operator_erc20",
  SOLANA:"boltutil_operator_solana"
};
export const BOLT_CONTROL_KEYS={master:MASTER_KEY,networks:NETWORK_KEYS} as const;
const KEYS=[MASTER_KEY,...SUPPORTED_BOLT_NETWORKS.map(n=>NETWORK_KEYS[n])];

export async function readBoltOperatorControl(env:Env):Promise<BoltOperatorControl>{
  if(env.ENVIRONMENT!=="staging"&&env.ENVIRONMENT!=="production")
    return {enabled:false,networks:{TRC20:false,POLYGON:false,BEP20:false,ERC20:false,SOLANA:false}};
  // A storage error must fail the request, never bypass a previously saved OFF.
  let rows:{key:string;value:string}[];
  try{
    const result=await env.DB.prepare(
      "SELECT key,value FROM system_settings WHERE key IN (?,?,?,?,?,?)"
    ).bind(...KEYS).all<{key:string;value:string}>();
    rows=result.results??[];
  }catch{throw new ApiFailure(503,"BOLTUTIL_CONTROL_UNAVAILABLE","USDT 收款控制状态暂不可读取。");}
  const saved=new Map(rows.map(row=>[row.key,row.value]));
  const fallback=env.ENVIRONMENT==="staging";
  const flag=(key:string)=>saved.has(key)?saved.get(key)==="1":fallback;
  return {enabled:flag(MASTER_KEY),networks:{
    TRC20:flag(NETWORK_KEYS.TRC20),POLYGON:flag(NETWORK_KEYS.POLYGON),
    BEP20:flag(NETWORK_KEYS.BEP20),ERC20:flag(NETWORK_KEYS.ERC20),
    SOLANA:flag(NETWORK_KEYS.SOLANA)
  }};
}
export function boltControlRevision(control:BoltOperatorControl):string{
  return [control.enabled,...SUPPORTED_BOLT_NETWORKS.map(n=>control.networks[n])]
    .map(v=>v?"1":"0").join("");
}
export type BoltReadinessCheck={
  id:"schemaDeclared"|"schemaVerified"|"globalEnabled"|"productionCreateApproved"|
    "apiKeyPresent"|"webhookSecretPresent"|"providerVerificationAcknowledged"|
    "quoteConfigured"|"approvedQuoteMatches"|"operatorMasterEnabled";
  satisfied:boolean;
};
export type BoltNetworkReadiness={
  network:BoltNetwork;environmentEnabled:boolean;operatorEnabled:boolean;
  acceptingNewOrders:boolean;blockedBy:string[];
};
export type BoltReadiness={
  environment:string;checks:BoltReadinessCheck[];networks:BoltNetworkReadiness[];
  acceptingNewOrders:boolean;environmentReady:boolean;missing:string[];
};
/** A statement of runtime flags, not an independent query of live D1/provider.
 * Never leak merchant keys, rate values, tokens or buyer data in diagnostics.
 */
export function boltReadiness(env:Env,control:BoltOperatorControl):BoltReadiness{
  const production=env.ENVIRONMENT==="production";
  const rateValid=/^[1-9][0-9]{5,8}$/.test(env.BOLTUTIL_CNY_PER_USDT_MICROS??"");
  const checks:BoltReadinessCheck[]=[
    {id:"schemaDeclared",satisfied:boltReadSchemaReady(env)},
    ...(production?[{id:"schemaVerified" as const,satisfied:env.BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED==="1"}]:[]),
    {id:"globalEnabled",satisfied:env.BOLTUTIL_ENABLED==="1"},
    {id:"productionCreateApproved",satisfied:boltCreateAuthorized(env)},
    {id:"apiKeyPresent",satisfied:Boolean(env.BOLTUTIL_API_KEY)},
    {id:"webhookSecretPresent",satisfied:Boolean(env.BOLTUTIL_WEBHOOK_SECRET)},
    ...(production?[{id:"providerVerificationAcknowledged" as const,satisfied:env.BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED==="1"}]:[]),
    {id:"quoteConfigured",satisfied:rateValid},
    ...(production?[{id:"approvedQuoteMatches" as const,satisfied:rateValid&&
      env.BOLTUTIL_PRODUCTION_APPROVED_CNY_PER_USDT_MICROS===env.BOLTUTIL_CNY_PER_USDT_MICROS}]:[]),
    {id:"operatorMasterEnabled",satisfied:control.enabled}
  ];
  const globalBlocked=checks.filter(c=>!c.satisfied).map(c=>c.id);
  const networks=SUPPORTED_BOLT_NETWORKS.map(network=>{
    const environmentEnabled=boltEnvironmentNetworkEnabled(env,network);
    const operatorEnabled=control.networks[network];
    const blockedBy=[...globalBlocked,
      ...(!environmentEnabled?["networkEnvironmentDisabled"]:[]),
      ...(!operatorEnabled?["networkOperatorDisabled"]:[])];
    return {network,environmentEnabled,operatorEnabled,
      acceptingNewOrders:blockedBy.length===0,blockedBy};
  });
  return {environment:env.ENVIRONMENT,checks,networks,
    acceptingNewOrders:networks.some(network=>network.acceptingNewOrders),
    environmentReady:boltEnvironmentReady(env),
    missing:globalBlocked};
}
export function boltEnvironmentReady(env:Env):boolean{
  return boltReadSchemaReady(env)&&env.BOLTUTIL_ENABLED==="1"&&
    boltCreateAuthorized(env)&&Boolean(env.BOLTUTIL_API_KEY)&&
    Boolean(env.BOLTUTIL_WEBHOOK_SECRET)&&
    /^[1-9][0-9]{5,8}$/.test(env.BOLTUTIL_CNY_PER_USDT_MICROS??"")&&
    (env.ENVIRONMENT!=="production"||
      (env.BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED==="1"&&
       env.BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED==="1"&&
       env.BOLTUTIL_PRODUCTION_APPROVED_CNY_PER_USDT_MICROS===env.BOLTUTIL_CNY_PER_USDT_MICROS));
}
export function boltEnvironmentNetworkEnabled(env:Env,n:BoltNetwork):boolean{
  const flag=n==="TRC20"?env.BOLTUTIL_TRC20_ENABLED:
    n==="POLYGON"?env.BOLTUTIL_POLYGON_ENABLED:
    n==="BEP20"?env.BOLTUTIL_BEP20_ENABLED:
    n==="ERC20"?env.BOLTUTIL_ERC20_ENABLED:env.BOLTUTIL_SOLANA_ENABLED;
  return flag==="1";
}
export function effectiveBoltNetworks(env:Env,control:BoltOperatorControl):BoltNetwork[]{
  if(!control.enabled||!boltEnvironmentReady(env))return [];
  return SUPPORTED_BOLT_NETWORKS.filter(n=>control.networks[n]&&boltEnvironmentNetworkEnabled(env,n));
}
