import {creatorFeature} from './creator-momentum';
import { checkoutFromAttempt } from "./payment-checkout";
import type { Env, Session } from "./types";
import { sessionFor } from "./auth";
import { balance } from "./quota";
import { subscriptionAccount, availableNow } from './subscription-account';
import { signupBenefit } from "./signup-benefits";
import { response } from "./http";

export async function accountState(env: Env, session: Session) {
  const [quota,subscription] = await Promise.all([balance(env,session.user_id),subscriptionAccount(env,session.user_id)]);
  const user = await env.DB.prepare("SELECT status FROM users WHERE id=?").bind(session.user_id).first<{status:string}>();
  const status = user?.status === "frozen" ? "frozen" : availableNow(quota,subscription)>0 ? "credits_available" : "credits_exhausted";
  return {status,quota,subscription,availableNow:availableNow(quota,subscription)};
}
export async function me(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  const user=await env.DB.prepare("SELECT username,email,role,status,email_verified_at FROM users WHERE id=?").bind(session.user_id).first<{username:string|null;email:string;role:string;status:string;email_verified_at:number}>();
  return response({user:{userId:session.user_id,username:user?.username,email:user?.email,role:user?.role,status:user?.status,emailVerified:Boolean(user?.email_verified_at)}},200,env,request);
}
export async function entitlements(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  if(new URL(request.url).searchParams.get('feature')==='interactionMomentum'){
    const feature=await creatorFeature(env,session.user_id).catch(()=>null);
    return response({features:{interactionMomentum:feature&&{...feature,ownerId:session.user_id}}},200,env,request);
  }
  const state=await accountState(env,session);
  return response({status:state.status,entitlement:{entitlementStatus:state.status==="credits_available"?"active":"inactive"},quota:state.quota,subscription:state.subscription,availableNow:state.availableNow},200,env,request);
}
export async function usage(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  const [quota,benefit,subscription]=await Promise.all([balance(env,session.user_id),signupBenefit(env,session.user_id),subscriptionAccount(env,session.user_id)]);
  return response({quota,signupBenefit:benefit,subscription,availableNow:availableNow(quota,subscription)},200,env,request);
}
export async function licenseDevices(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  const license=await env.DB.prepare("SELECT id,max_devices,status FROM licenses WHERE user_id=?").bind(session.user_id).first<{id:string;max_devices:number;status:string}>();
  const devices=license?(await env.DB.prepare("SELECT device_id,activated_at FROM license_devices WHERE license_id=? ORDER BY activated_at").bind(license.id).all<{device_id:string;activated_at:number}>()).results.map(row=>({deviceId:row.device_id,activatedAt:new Date(row.activated_at).toISOString()})):[];
  return response({licenseStatus:license?.status || "none",maxDevices:license?.max_devices || 0,devices},200,env,request);
}
export async function activity(request: Request,env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  const [ledger,orders]=await Promise.all([
    env.DB.prepare("SELECT kind,free_delta,paid_delta,reason,created_at FROM credit_ledger WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 20").bind(session.user_id).all(),
    env.DB.prepare(`SELECT o.id,o.package_id,o.package_name,o.credits,o.amount_cents,o.currency,o.status,o.created_at,
      CASE WHEN o.payment_method='boltutil' THEN 'boltutil' WHEN t.merchant_provider='mk99' THEN 'mk99' ELSE t.provider END provider,CASE WHEN t.merchant_provider='mk99' THEN 'mk99' ELSE t.payment_protocol END payment_protocol,t.payment_channel,t.status payment_status,t.risk_state,o.credited_at,o.paid_at,
      (SELECT a.provider_code FROM payment_attempts a WHERE a.transaction_id=t.id ORDER BY a.attempt_number DESC LIMIT 1) checkout_marker,
      t.base_amount_fen,t.service_fee_fen,t.amount_fen total_amount_fen,t.amount_contract,
      CASE WHEN t.status<>'paid' OR o.credited_at IS NULL THEN 'not_paid'
        WHEN t.payment_protocol='epay' OR t.merchant_provider='mk99' THEN 'manual_review'
        WHEN EXISTS(SELECT 1 FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status IN ('requested','pending','unknown')) THEN 'refund_pending'
        WHEN b.status='refunded' OR (b.remaining_credits=0 AND b.permanently_revoked_credits>0) THEN 'refunded'
        WHEN b.id IS NULL OR b.history_confidence<>'tracked' THEN 'manual_review'
        WHEN b.consumed_credits>0 OR b.remaining_credits<b.grant_credits THEN 'used_ineligible'
        WHEN b.status='active' AND b.generation_reserved_credits=0 AND b.refund_reserved_credits=0 THEN 'eligible'
        ELSE 'manual_review' END refund_eligibility
      FROM recharge_orders o LEFT JOIN payment_transactions t ON t.order_id=o.id
      LEFT JOIN credit_batches b ON b.source_order_id=o.id
      WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 50`).bind(session.user_id).all(),
  ]);
  return response({ledger:ledger.results,orders:orders.results.map((row:any)=>{const {checkout_marker,...order}=row;return {...order,checkout:checkoutFromAttempt(checkout_marker)};})},200,env,request);
}
