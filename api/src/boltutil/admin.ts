import type {Env} from "../types";
import {requireAdminSession} from "../admin-auth";
import {response} from "../http";
import {SUPPORTED_BOLT_NETWORKS} from "./contract";
import {boltAvailable} from "./routes";

/** Read-only Staging financial evidence. It never aggregates USDT into CNY revenue. */
export async function adminBoltOrders(request:Request,env:Env):Promise<Response>{
  await requireAdminSession(request,env);
  if(env.ENVIRONMENT!=="staging"||env.BOLTUTIL_SCHEMA_READY!=="1")
    return response({orders:[],available:false,networks:SUPPORTED_BOLT_NETWORKS},200,env,request);
  const results=await env.DB.prepare(
    "SELECT b.id,b.external_order_id,b.network,b.token_contract,b.token_decimals,b.user_id,u.email,"+
    "b.product_type,b.credit_order_id,b.subscription_order_id,b.base_amount_fen,b.cny_per_usdt_micros,"+
    "b.quoted_usdt_micros,b.payable_usdt_micros,b.paid_usdt_micros,b.tx_hash,b.status,b.paid_at,"+
    "b.applied_at,b.created_at,b.expires_at FROM boltutil_orders b "+
    "JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC,b.id DESC LIMIT 100"
  ).all();
  return response({orders:results.results??[],available:boltAvailable(env),networks:SUPPORTED_BOLT_NETWORKS,
    currency:"USDT",note:"Amounts are USDT micros; do not sum with CNY amounts."},200,env,request);
}
