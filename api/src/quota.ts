import { creditInvariant } from "./credit-assertion.js";
import { releaseStaleProductionGenerations } from "./production-generation-timeout";
import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { nowMs, shanghaiDay, uuid } from "./security";
import { sessionFor, takeRate } from "./auth";
import { response } from "./http";
import {subscriptionAccount,subscriptionsEnabled} from "./subscription-account";
import {reserveSubscribedGeneration,confirmSubscribedDelivery,failSubscribedGeneration,cleanupSubscribedReservations,abandonStaleSubscribedGeneration} from "./subscription-generation";
import { bestEffortReferralAward } from "./referrals";

export type Balance = { freeRemaining: number; paidRemaining: number; totalRemaining: number };
export type Reservation = { kind: "new"; quota?: Balance; funding?: "subscription"|"free"|"paid" } | { kind: "replay"; quota?: Balance; raw: string };
type StoredRequest = { status: string; generation_phase?: string; request_hash: string; raw_response: string | null; response_expires_at: number | null };
type CreditBatch = { id: string; bucket: "free" | "paid"; source_kind: string };

/**
 * A response that was generated but never acknowledged is not a delivered
 * credit use. Once its replay window expires, release its reservation so a
 * later request can proceed. Requests still in `generating` remain untouched
 * because their provider outcome may be uncertain.
 */
export async function releaseExpiredDeliveryReservations(env: Env, now = nowMs(), userId?: string): Promise<void> {
  await releaseStaleProductionGenerations(env, now, userId);
  if (subscriptionsEnabled(env)) await cleanupSubscribedReservations(env,now,userId);
  const scope = userId ? " AND r.user_id=?" : "";
  const params = userId ? [now, userId] : [now];
  const candidate = await env.DB.prepare(`SELECT 1 AS pending FROM ai_requests r
    JOIN ai_credit_allocations x ON x.user_id=r.user_id AND x.request_id=r.request_id
    WHERE r.status='reserved' AND r.generation_phase='awaiting_delivery'
      AND r.response_expires_at IS NOT NULL AND r.response_expires_at<?
      AND x.state='reserved'${scope} LIMIT 1`).bind(...params).first<{pending:number}>();
  if (!candidate) return;

  const operationId = uuid();
  const statements = [
    env.DB.prepare(`UPDATE ai_requests SET status='upstream_failed',generation_phase='unknown',completed_at=?,refunded_at=?
      WHERE status='reserved' AND generation_phase='awaiting_delivery' AND response_expires_at IS NOT NULL AND response_expires_at<?
        ${userId ? "AND user_id=?" : ""}
        AND EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.user_id=ai_requests.user_id AND x.request_id=ai_requests.request_id AND x.state='reserved')`).bind(now,now,now,...(userId?[userId]:[])),
    env.DB.prepare(`UPDATE ai_credit_allocations SET state='released',released_at=?
      WHERE state='reserved' AND EXISTS(SELECT 1 FROM ai_requests r WHERE r.user_id=ai_credit_allocations.user_id AND r.request_id=ai_credit_allocations.request_id AND r.status='upstream_failed' AND r.generation_phase='unknown' AND r.completed_at=?)`).bind(now,now),
    env.DB.prepare(`UPDATE credit_batches SET generation_reserved_credits=generation_reserved_credits-(SELECT COUNT(*) FROM ai_credit_allocations x WHERE x.credit_batch_id=credit_batches.id AND x.state='released' AND x.released_at=?)
      WHERE generation_reserved_credits >= (SELECT COUNT(*) FROM ai_credit_allocations x WHERE x.credit_batch_id=credit_batches.id AND x.state='released' AND x.released_at=?)
        AND EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.credit_batch_id=credit_batches.id AND x.state='released' AND x.released_at=?)`).bind(now,now,now),
    env.DB.prepare(`UPDATE credit_accounts SET
      free_generation_reserved=free_generation_reserved-(SELECT COUNT(*) FROM ai_credit_allocations x JOIN credit_batches b ON b.id=x.credit_batch_id WHERE x.user_id=credit_accounts.user_id AND b.bucket='free' AND x.state='released' AND x.released_at=?),
      paid_generation_reserved=paid_generation_reserved-(SELECT COUNT(*) FROM ai_credit_allocations x JOIN credit_batches b ON b.id=x.credit_batch_id WHERE x.user_id=credit_accounts.user_id AND b.bucket='paid' AND x.state='released' AND x.released_at=?),
      version=version+1,updated_at=?
      WHERE free_generation_reserved >= (SELECT COUNT(*) FROM ai_credit_allocations x JOIN credit_batches b ON b.id=x.credit_batch_id WHERE x.user_id=credit_accounts.user_id AND b.bucket='free' AND x.state='released' AND x.released_at=?)
        AND paid_generation_reserved >= (SELECT COUNT(*) FROM ai_credit_allocations x JOIN credit_batches b ON b.id=x.credit_batch_id WHERE x.user_id=credit_accounts.user_id AND b.bucket='paid' AND x.state='released' AND x.released_at=?)
        AND EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.user_id=credit_accounts.user_id AND x.state='released' AND x.released_at=?)`).bind(now,now,now,now,now,now),
    env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at)
      SELECT lower(hex(randomblob(16))),x.user_id,'generation_release',0,0,x.user_id||':'||x.request_id,'交付确认过期，释放额度预占',?
      FROM ai_credit_allocations x JOIN ai_requests r ON r.user_id=x.user_id AND r.request_id=x.request_id
      WHERE x.state='released' AND x.released_at=? AND r.status='upstream_failed' AND r.completed_at=?
      ON CONFLICT(kind,reference_id) DO NOTHING`).bind(now,now,now),
    ...creditInvariant(env,operationId,`NOT EXISTS(SELECT 1 FROM credit_accounts a WHERE
        a.free_balance<>(SELECT COALESCE(SUM(b.remaining_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='free') OR
        a.paid_balance<>(SELECT COALESCE(SUM(b.remaining_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid') OR
        a.free_generation_reserved<>(SELECT COALESCE(SUM(b.generation_reserved_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='free') OR
        a.paid_generation_reserved<>(SELECT COALESCE(SUM(b.generation_reserved_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid') OR
        a.paid_reserved_for_refunds<>(SELECT COALESCE(SUM(b.refund_reserved_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid'))
        AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations x JOIN ai_requests r ON r.user_id=x.user_id AND r.request_id=x.request_id WHERE x.state='released' AND x.released_at=? AND r.status='upstream_failed' AND r.completed_at=? AND NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.user_id=x.user_id AND l.kind='generation_release' AND l.reference_id=x.user_id||':'||x.request_id))`,[now,now]),
  ];
  await env.DB.batch(statements);
}

export async function balance(env: Env, userId: string): Promise<Balance> {
  const row = await env.DB.prepare(`SELECT
    MAX(0,free_balance-free_generation_reserved) free_remaining,
    MAX(0,paid_balance-paid_generation_reserved-paid_reserved_for_refunds-(SELECT COALESCE(sum(remaining_credits-generation_reserved_credits-refund_reserved_credits),0) FROM credit_batches WHERE user_id=credit_accounts.user_id AND bucket='paid' AND status='manual_review' AND manual_review_reason LIKE 'mk99_risk:%')) paid_remaining
    FROM credit_accounts WHERE user_id=?`).bind(userId).first<{free_remaining:number;paid_remaining:number}>();
  const freeRemaining = row?.free_remaining ?? 0;
  const paidRemaining = row?.paid_remaining ?? 0;
  return { freeRemaining, paidRemaining, totalRemaining: freeRemaining + paidRemaining };
}
async function existing(env: Env, userId: string, requestId: string): Promise<StoredRequest | null> {
  return env.DB.prepare("SELECT status,generation_phase,request_hash,raw_response,response_expires_at FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId, requestId).first<StoredRequest>();
}
async function replay(env: Env, userId: string, requestId: string, hash: string, row: StoredRequest, now: number, omitSubscriptionQuota=false): Promise<Reservation> {
  if(row.status === "upstream_failed" && row.request_hash === "") throw new ApiFailure(409,"GENERATION_FAILED","原生成已结束，请重新生成。 ");
  if (row.request_hash !== hash) throw new ApiFailure(409, "IDEMPOTENCY_CONFLICT", "同一请求标识不能用于不同内容。");
  if ((row.status === "succeeded" || row.generation_phase === "awaiting_delivery") && row.raw_response && row.response_expires_at && row.response_expires_at > now) {
    // HTTP clients must not receive permanent-credit quota for a subscription
    // result. Read the immutable funding allocation first, exactly as the wire
    // path did before; avoid building a balance that would be discarded.
    if(omitSubscriptionQuota&&subscriptionsEnabled(env)&&await env.DB.prepare(
      "SELECT 1 FROM subscription_ai_allocations WHERE user_id=? AND request_id=?"
    ).bind(userId,requestId).first())return {kind:"replay",raw:row.raw_response};
    return {kind:"replay",raw:row.raw_response,quota:await balance(env,userId)};
  }
  if (row.status === "reserved") throw new ApiFailure(409, "GENERATION_IN_PROGRESS", "这条回复仍在生成或确认交付，请稍后再试。", 3);
  if (row.status === "succeeded") throw new ApiFailure(409, "IDEMPOTENCY_RESULT_EXPIRED", "原结果已过保留期，请重新生成。");
  if (row.status === "upstream_failed") throw new ApiFailure(409, "GENERATION_FAILED", "这次生成已失败且额度已释放，请重新生成。", 1);
  throw new ApiFailure(503, "GENERATION_STATUS_UNKNOWN", "这次生成的结果尚未确认，请稍后重试或联系支持。");
}

// Same request lookup plus one indexed, account-scoped eligibility probe. The
// expensive cleanup procedure runs only when a real expired candidate exists.
export const GENERATION_PREFLIGHT_SQL = `SELECT r.request_id,r.status,r.generation_phase,r.request_hash,r.raw_response,r.response_expires_at,
  EXISTS(SELECT 1 FROM ai_requests s WHERE s.user_id=? AND s.status IN ('reserved','uncertain') AND (
    (s.generation_phase='generating' AND s.raw_response IS NULL AND s.response_expires_at IS NULL AND s.created_at<?) OR
    (s.status='reserved' AND s.generation_phase='awaiting_delivery' AND s.response_expires_at IS NOT NULL AND s.response_expires_at<?)
  )) needs_cleanup
  FROM (SELECT 1) anchor LEFT JOIN ai_requests r ON r.user_id=? AND r.request_id=?`;

// An anchor row preserves error precedence even when the settings or account
// row is missing. The lot ordering is identical to the old standalone query.
export const PERMANENT_RESERVATION_PREFLIGHT_SQL=`SELECT
  (SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd') AS budget_value,
  a.user_id AS account_id,b.id,b.bucket,b.source_kind
  FROM (SELECT 1) AS anchor
  LEFT JOIN credit_accounts a ON a.user_id=?
  LEFT JOIN credit_batches b ON b.id=(SELECT id FROM credit_batches
    WHERE user_id=? AND status='active' AND remaining_credits-generation_reserved_credits-refund_reserved_credits>0
    ORDER BY CASE bucket WHEN 'free' THEN 0 ELSE 1 END,
      CASE source_kind WHEN 'legacy_paid' THEN 0 WHEN 'purchase' THEN 1 ELSE 2 END,
      COALESCE(paid_at,granted_at),granted_at,id LIMIT 1)`;
export async function reserveGeneration(env: Env, session: Session, requestId: string, requestHash: string, budgetReserve: number, providerSnapshot: {id:string;version:number}|null = null, options: {prechecked?:boolean;cleanupRetried?:boolean;creditLotRetried?:boolean;omitNewQuota?:boolean;omitSubscriptionReplayQuota?:boolean} = {}): Promise<Reservation> {
  const now = nowMs();
  if(!options.prechecked){
    await releaseExpiredDeliveryReservations(env, now, session.user_id);
    const prior = await existing(env, session.user_id, requestId);
    if (prior) return replay(env, session.user_id, requestId, requestHash, prior, now, options.omitSubscriptionReplayQuota);
  }
  // The subscription reservation owns the authoritative eligibility read.
  // Avoid reading the same paid proof and usage twice on a normal request.
  if(subscriptionsEnabled(env)&&Number.isSafeInteger(budgetReserve)&&budgetReserve>=0){
    try{
      if(await reserveSubscribedGeneration(env,session.user_id,requestId,requestHash,budgetReserve,providerSnapshot,now))
        return options.omitNewQuota ? {kind:'new',funding:'subscription'} : {kind:'new',quota:await balance(env,session.user_id)};
    }catch(error){
      const concurrent=await existing(env,session.user_id,requestId);
      if(concurrent)return replay(env,session.user_id,requestId,requestHash,concurrent,now,options.omitSubscriptionReplayQuota);
      throw error;
    }
  }
  const date = shanghaiDay(now);
  const budgetDay = new Date(now).toISOString().slice(0, 10);
  if (!Number.isSafeInteger(budgetReserve) || budgetReserve < 0) throw new ApiFailure(503, "BUDGET_NOT_CONFIGURED", "AI 成本预留无效。");
  // Read the budget setting, account existence and ordered eligible lot in a
  // single D1 snapshot. The following atomic batch remains authoritative;
  // this does not cache balances or skip reservation/nonce/provider guards.
  const preflight = await env.DB.prepare(PERMANENT_RESERVATION_PREFLIGHT_SQL)
    .bind(session.user_id,session.user_id).first<{budget_value:string|null;account_id:string|null;id:string|null;bucket:CreditBatch["bucket"]|null;source_kind:CreditBatch["source_kind"]|null}>();
  const budgetLimit = Number(preflight?.budget_value);
  if (!Number.isSafeInteger(budgetLimit) || budgetLimit < 1) throw new ApiFailure(503, "BUDGET_NOT_CONFIGURED", "AI 成本预算尚未配置。");
  if (preflight?.account_id == null) throw new ApiFailure(402, "INSUFFICIENT_CREDITS", "生成次数已用完，请购买永久额度包，或等待订阅每日额度重置。");
  const lot:CreditBatch|null=preflight.id!==null&&preflight.bucket!==null&&preflight.source_kind!==null?
    {id:preflight.id,bucket:preflight.bucket,source_kind:preflight.source_kind}:null;
  if (!lot) {
    // A replay window can expire between preflight and allocation. Retry only
    // the reservation after bounded cleanup, never repeat an upstream call.
    if(options.prechecked&&!options.cleanupRetried){
      await releaseExpiredDeliveryReservations(env,nowMs(),session.user_id);
      const concurrent=await existing(env,session.user_id,requestId);
      if(concurrent)return replay(env,session.user_id,requestId,requestHash,concurrent,nowMs(),options.omitSubscriptionReplayQuota);
      return reserveGeneration(env,session,requestId,requestHash,budgetReserve,providerSnapshot,{...options,prechecked:true,cleanupRetried:true});
    }
    throw new ApiFailure(402, "INSUFFICIENT_CREDITS", "生成次数已用完，请购买永久额度包，或等待订阅每日额度重置。");
  }
  // Independent request IDs can start without waiting for other provider or ACK
  // work. Atomic per-request credit allocation and AI budget remain authoritative.
  const nonce = uuid(), allocationId = uuid();
  const batch = [
    env.DB.prepare("INSERT INTO site_daily_usage(quota_date,used) VALUES(?,0) ON CONFLICT(quota_date) DO NOTHING").bind(date),
    env.DB.prepare("INSERT INTO ai_budget_days(budget_day) VALUES(?) ON CONFLICT(budget_day) DO NOTHING").bind(budgetDay),
    env.DB.prepare(`INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,credit_source,budget_day,budget_reserved_micro_usd,generation_phase,provider_config_id,provider_config_version)
      SELECT ?,?,?,?,'reserved',0,?,?,?,?,?,'generating',?,? FROM credit_accounts
      WHERE user_id=? AND free_balance+paid_balance-paid_reserved_for_refunds-free_generation_reserved-paid_generation_reserved>0
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')
      AND EXISTS(SELECT 1 FROM ai_budget_days WHERE budget_day=? AND reserved_micro_usd+settled_micro_usd+?<=?)
      AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM ai_provider_runtime WHERE id=1 AND active_config_id IS NOT NULL)) OR EXISTS(SELECT 1 FROM ai_provider_runtime WHERE id=1 AND active_config_id=? AND active_version=?))
      ON CONFLICT(user_id,request_id) DO NOTHING`).bind(requestId,session.user_id,date,nonce,requestHash,now,lot.bucket,budgetDay,budgetReserve,providerSnapshot?.id??null,providerSnapshot?.version??null,session.user_id,session.user_id,budgetDay,budgetReserve,budgetLimit,providerSnapshot?.id??null,providerSnapshot?.id??null,providerSnapshot?.version??null),
    env.DB.prepare(`INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at)
      SELECT ?,?,?,?,1,'reserved',? WHERE EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)
      ON CONFLICT(user_id,request_id) DO NOTHING`).bind(allocationId,session.user_id,requestId,lot.id,now,session.user_id,requestId,nonce),
    env.DB.prepare(`UPDATE credit_batches SET generation_reserved_credits=generation_reserved_credits+1
      WHERE id=? AND user_id=? AND status='active' AND remaining_credits-generation_reserved_credits-refund_reserved_credits>0
      AND EXISTS(SELECT 1 FROM ai_credit_allocations WHERE id=? AND state='reserved')`).bind(lot.id,session.user_id,allocationId),
    env.DB.prepare(`UPDATE credit_accounts SET ${lot.bucket === "free" ? "free_generation_reserved" : "paid_generation_reserved"}=${lot.bucket === "free" ? "free_generation_reserved" : "paid_generation_reserved"}+1,version=version+1,updated_at=?
      WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_credit_allocations WHERE id=? AND state='reserved')`).bind(now,session.user_id,allocationId),
    env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd+? WHERE budget_day=? AND reserved_micro_usd+settled_micro_usd+?<=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)").bind(budgetReserve,budgetDay,budgetReserve,budgetLimit,session.user_id,requestId,nonce),
    env.DB.prepare("UPDATE site_daily_usage SET used=used+1 WHERE quota_date=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)").bind(date,session.user_id,requestId,nonce),
    ...creditInvariant(env,nonce,`EXISTS(SELECT 1 FROM ai_requests r JOIN ai_credit_allocations x ON x.user_id=r.user_id AND x.request_id=r.request_id JOIN credit_batches b ON b.id=x.credit_batch_id JOIN credit_accounts a ON a.user_id=r.user_id
        WHERE r.user_id=? AND r.request_id=? AND r.reservation_nonce=? AND r.status='reserved' AND x.state='reserved' AND b.generation_reserved_credits>0
        AND a.${lot.bucket === "free" ? "free_generation_reserved" : "paid_generation_reserved"}>0
        AND EXISTS(SELECT 1 FROM ai_budget_days d WHERE d.budget_day=? AND d.reserved_micro_usd>=?)
        AND EXISTS(SELECT 1 FROM site_daily_usage s WHERE s.quota_date=? AND s.used>0))`,[session.user_id,requestId,nonce,budgetDay,budgetReserve,date]),
  ];
  try { await env.DB.batch(batch); } catch {
    const concurrent = await existing(env, session.user_id, requestId);
    if (concurrent) return replay(env, session.user_id, requestId, requestHash, concurrent, now, options.omitSubscriptionReplayQuota);
    const user = await env.DB.prepare("SELECT status FROM users WHERE id=?").bind(session.user_id).first<{status:string}>();
    if (user?.status === "frozen") throw new ApiFailure(403,"ACCOUNT_FROZEN","账户已暂停，请联系支持。");
    const budget = await env.DB.prepare("SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days WHERE budget_day=?").bind(budgetDay).first<{reserved_micro_usd:number;settled_micro_usd:number}>();
    if ((budget?.reserved_micro_usd||0)+(budget?.settled_micro_usd||0)+budgetReserve>budgetLimit) throw new ApiFailure(503,"AI_BUDGET_EXHAUSTED","AI 成本安全预算已用完，请稍后再试。");
    // A competing request may reserve the last free lot after preselection.
    // Re-evaluate funding at most once, before any upstream AI invocation.
    if(!options.creditLotRetried)
      return reserveGeneration(env,session,requestId,requestHash,budgetReserve,providerSnapshot,
        {...options,prechecked:true,creditLotRetried:true});
    throw new ApiFailure(409,"GENERATION_RESERVATION_CONFLICT","额度状态刚刚变化，请重新生成。");
  }
  // The HTTP generation path reads the balance only after provider settlement.
  // Preserve the original return contract for other callers by default.
  return options.omitNewQuota ? {kind:"new",funding:lot.bucket} : {kind:"new", quota:await balance(env,session.user_id)};
}

export async function checkGenerationReplay(env: Env, session: Session, requestId: string, requestHash: string, options:{omitSubscriptionReplayQuota?:boolean}={}): Promise<Reservation | null> {
  const now = nowMs();
  const inspection=await env.DB.prepare(GENERATION_PREFLIGHT_SQL).bind(session.user_id,now-600000,now,session.user_id,requestId).first<StoredRequest & {request_id:string|null;needs_cleanup:number}>();
  if(inspection?.needs_cleanup){
    await releaseExpiredDeliveryReservations(env,now,session.user_id);
    const prior=await existing(env,session.user_id,requestId);
    return prior?replay(env,session.user_id,requestId,requestHash,prior,now,options.omitSubscriptionReplayQuota):null;
  }
  return inspection?.request_id?replay(env,session.user_id,requestId,requestHash,inspection,now,options.omitSubscriptionReplayQuota):null;
}


export async function finishGeneration(env: Env, userId: string, requestId: string, raw: string | null, usage?: {model:string;inputTokens:number;outputTokens:number;costMicroUsd:number;usageQuality?:"verified"|"estimated"}): Promise<boolean | void> {
  const now=nowMs(), ref=uuid();
  const verifiedCost=usage&&Number.isSafeInteger(usage.costMicroUsd)&&usage.costMicroUsd>=0?usage.costMicroUsd:null;
  // For a successful result with an explicit cost, the existing guarded
  // batch itself establishes ownership of the generating row. No pre-read
  // is needed; a stale/abandoned result changes zero rows and returns false.
  // Unknown-cost and failure paths retain the authoritative reservation read.
  let actual:number;
  if(raw&&verifiedCost!==null)actual=verifiedCost;
  else{
    const row=await env.DB.prepare("SELECT budget_reserved_micro_usd,provider_config_id,provider_config_version FROM ai_requests WHERE user_id=? AND request_id=? AND status='reserved' AND generation_phase='generating'").bind(userId,requestId).first<{budget_reserved_micro_usd:number;provider_config_id:string|null;provider_config_version:number|null}>();
    if(!row)return false;
    actual=verifiedCost??row.budget_reserved_micro_usd;
  }
  if(raw){
    const settled=await env.DB.batch([
      env.DB.prepare("UPDATE ai_requests SET raw_response=?,generation_phase='awaiting_delivery',response_expires_at=?,budget_finalization_ref=? WHERE user_id=? AND request_id=? AND status='reserved' AND generation_phase='generating'").bind(raw,now+10*60_000,ref,userId,requestId),
      env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=MAX(0,reserved_micro_usd-(SELECT budget_reserved_micro_usd FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)),settled_micro_usd=settled_micro_usd+? WHERE budget_day=(SELECT budget_day FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)").bind(userId,requestId,ref,actual,userId,requestId,ref),
      env.DB.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at,provider_config_id,provider_config_version,usage_quality) SELECT ?,?,?,?,?,?,?,provider_config_id,provider_config_version,? FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=? ON CONFLICT(user_id,request_id) DO NOTHING").bind(userId,requestId,usage?.model||"unknown",usage?.inputTokens||0,usage?.outputTokens||0,actual,now,usage?.usageQuality||"verified",userId,requestId,ref),
    ]);return settled[0].meta.changes===1;
  }
  if(subscriptionsEnabled(env) && await failSubscribedGeneration(env,userId,requestId,now,{model:usage?.model||'unknown-estimated',inputTokens:usage?.inputTokens||0,outputTokens:usage?.outputTokens||0,costMicroUsd:actual,usageQuality:usage?.usageQuality||'estimated'})) return;
  const allocation=await env.DB.prepare("SELECT credit_batch_id FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='reserved'").bind(userId,requestId).first<{credit_batch_id:string}>();
  if(!allocation)return;
  await env.DB.batch([
    env.DB.prepare("UPDATE ai_requests SET status='upstream_failed',generation_phase='unknown',completed_at=?,refunded_at=?,budget_finalization_ref=? WHERE user_id=? AND request_id=? AND status='reserved' AND generation_phase='generating'").bind(now,now,ref,userId,requestId),
    env.DB.prepare("UPDATE ai_credit_allocations SET state='released',released_at=? WHERE user_id=? AND request_id=? AND state='reserved' AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND status='upstream_failed' AND budget_finalization_ref=?)").bind(now,userId,requestId,userId,requestId,ref),
    env.DB.prepare("UPDATE credit_batches SET generation_reserved_credits=generation_reserved_credits-1 WHERE id=? AND generation_reserved_credits>0 AND EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='released' AND released_at=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)").bind(allocation.credit_batch_id,userId,requestId,now,userId,requestId,ref),
    env.DB.prepare("UPDATE credit_accounts SET free_generation_reserved=MAX(0,free_generation_reserved-CASE WHEN (SELECT bucket FROM credit_batches WHERE id=?)='free' THEN 1 ELSE 0 END),paid_generation_reserved=MAX(0,paid_generation_reserved-CASE WHEN (SELECT bucket FROM credit_batches WHERE id=?)='paid' THEN 1 ELSE 0 END),version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='released' AND released_at=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)").bind(allocation.credit_batch_id,allocation.credit_batch_id,now,userId,userId,requestId,now,userId,requestId,ref),
    env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=MAX(0,reserved_micro_usd-(SELECT budget_reserved_micro_usd FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)),settled_micro_usd=settled_micro_usd+? WHERE budget_day=(SELECT budget_day FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)").bind(userId,requestId,ref,actual,userId,requestId,ref),
    env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) SELECT ?,?,'generation_release',0,0,?,?,? WHERE EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='released' AND released_at=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?) ON CONFLICT(kind,reference_id) DO NOTHING").bind(uuid(),userId,`${userId}:${requestId}`,"确认生成失败，释放额度预占",now,userId,requestId,now,userId,requestId,ref),
    env.DB.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at,provider_config_id,provider_config_version,usage_quality) SELECT ?,?,?,?,?,?,?,provider_config_id,provider_config_version,? FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=? AND ?>0 ON CONFLICT(user_id,request_id) DO NOTHING").bind(userId,requestId,usage?.model||"unknown-estimated",usage?.inputTokens||0,usage?.outputTokens||0,actual,now,usage?.usageQuality||"estimated",userId,requestId,ref,actual),
  ]);
}

export async function acknowledgeDelivery(request:Request,env:Env,requestId:string):Promise<Response>{
  const {session}=await sessionFor(request,env);
  if(session.kind!=="extension")throw new ApiFailure(403,"FORBIDDEN","仅绑定的插件可以确认回复已接收。");
  const userId=session.user_id,now=nowMs(),operationId=uuid();
  const state=await env.DB.prepare("SELECT status,delivery_confirmation_id FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId,requestId).first<{status:string;delivery_confirmation_id:string|null}>();
  if(state?.status==="succeeded"&&state.delivery_confirmation_id){await bestEffortReferralAward(env,userId);return response({ok:true,alreadyConfirmed:true,requestId},200,env,request);}
  if(subscriptionsEnabled(env)){
    if(await confirmSubscribedDelivery(env,userId,requestId,now)){
      await bestEffortReferralAward(env,userId);
      return response({ok:true,alreadyConfirmed:false,requestId,subscription:await subscriptionAccount(env,userId)},200,env,request);
    }
    const after=await env.DB.prepare("SELECT status,delivery_confirmation_id FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId,requestId).first<{status:string;delivery_confirmation_id:string|null}>();
    if(after?.status==='succeeded'&&after.delivery_confirmation_id){await bestEffortReferralAward(env,userId);return response({ok:true,alreadyConfirmed:true,requestId},200,env,request);}
  }
  const allocation=await env.DB.prepare("SELECT credit_batch_id FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='reserved'").bind(userId,requestId).first<{credit_batch_id:string}>();
  if(!allocation)throw new ApiFailure(409,"DELIVERY_NOT_AVAILABLE","这条回复无法确认或已过期，请重新生成。");
  let batch;
  try {
    batch=await env.DB.batch([
      // Claim this confirmation with a unique per-attempt token before changing
      // any balances. A concurrent ACK cannot reuse another attempt's claim.
      env.DB.prepare("UPDATE ai_requests SET status='succeeded',consumed=1,delivery_confirmed_at=?,delivery_confirmation_id=? WHERE user_id=? AND request_id=? AND status='reserved' AND generation_phase='awaiting_delivery' AND raw_response IS NOT NULL AND EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='reserved')").bind(now,operationId,userId,requestId,userId,requestId),
      env.DB.prepare("UPDATE ai_credit_allocations SET state='consumed',consumed_at=? WHERE user_id=? AND request_id=? AND state='reserved' AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND status='succeeded' AND delivery_confirmation_id=?)").bind(now,userId,requestId,userId,requestId,operationId),
      env.DB.prepare("UPDATE credit_batches SET remaining_credits=remaining_credits-1,consumed_credits=consumed_credits+1,generation_reserved_credits=generation_reserved_credits-1 WHERE id=? AND remaining_credits>0 AND generation_reserved_credits>0 AND refund_reserved_credits=0 AND status='active' AND EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='consumed' AND consumed_at=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND delivery_confirmation_id=?)").bind(allocation.credit_batch_id,userId,requestId,now,userId,requestId,operationId),
      env.DB.prepare("UPDATE credit_accounts SET free_balance=free_balance-CASE WHEN (SELECT bucket FROM credit_batches WHERE id=?)='free' THEN 1 ELSE 0 END,paid_balance=paid_balance-CASE WHEN (SELECT bucket FROM credit_batches WHERE id=?)='paid' THEN 1 ELSE 0 END,free_generation_reserved=MAX(0,free_generation_reserved-CASE WHEN (SELECT bucket FROM credit_batches WHERE id=?)='free' THEN 1 ELSE 0 END),paid_generation_reserved=MAX(0,paid_generation_reserved-CASE WHEN (SELECT bucket FROM credit_batches WHERE id=?)='paid' THEN 1 ELSE 0 END),version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=? AND state='consumed' AND consumed_at=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND delivery_confirmation_id=?) AND free_balance+paid_balance>0").bind(allocation.credit_batch_id,allocation.credit_batch_id,allocation.credit_batch_id,allocation.credit_batch_id,now,userId,userId,requestId,now,userId,requestId,operationId),
      env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) SELECT ?,?,'generation_debit',CASE WHEN b.bucket='free' THEN -1 ELSE 0 END,CASE WHEN b.bucket='paid' THEN -1 ELSE 0 END,?,?,? FROM credit_batches b JOIN ai_credit_allocations x ON x.credit_batch_id=b.id WHERE b.id=? AND x.user_id=? AND x.request_id=? AND x.state='consumed' AND x.consumed_at=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND delivery_confirmation_id=?) ON CONFLICT(kind,reference_id) DO NOTHING").bind(uuid(),userId,`${userId}:${requestId}`,"回复已送达插件，扣除一次额度",now,allocation.credit_batch_id,userId,requestId,now,userId,requestId,operationId),
      ...creditInvariant(env,operationId,`EXISTS(
        SELECT 1 FROM ai_requests r JOIN ai_credit_allocations x ON x.user_id=r.user_id AND x.request_id=r.request_id
        JOIN credit_batches b ON b.id=x.credit_batch_id JOIN credit_accounts a ON a.user_id=r.user_id
        JOIN credit_ledger l ON l.user_id=r.user_id AND l.kind='generation_debit' AND l.reference_id=?
        WHERE r.user_id=? AND r.request_id=? AND r.status='succeeded' AND r.delivery_confirmation_id=?
          AND x.state='consumed' AND x.consumed_at=? AND b.id=?
          AND b.remaining_credits=b.grant_credits-b.consumed_credits-b.permanently_revoked_credits
          AND a.free_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='free')
          AND a.paid_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid')
          AND a.free_generation_reserved=(SELECT COALESCE(sum(generation_reserved_credits),0) FROM credit_batches WHERE user_id=? AND bucket='free')
          AND a.paid_generation_reserved=(SELECT COALESCE(sum(generation_reserved_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid')
          AND a.paid_reserved_for_refunds=(SELECT COALESCE(sum(refund_reserved_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid')
      )`,[`${userId}:${requestId}`,userId,requestId,operationId,now,allocation.credit_batch_id,userId,userId,userId,userId,userId]),
    ]);
  } catch {
    const current=await env.DB.prepare("SELECT status,delivery_confirmation_id FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId,requestId).first<{status:string;delivery_confirmation_id:string|null}>();
    if(current?.status==="succeeded"&&current.delivery_confirmation_id){await bestEffortReferralAward(env,userId);return response({ok:true,alreadyConfirmed:true,requestId},200,env,request);}
    throw new ApiFailure(409,"DELIVERY_CONFIRMATION_CONFLICT","额度状态已变化，请检查回复状态后再试。");
  }
  // The read-only assertion has no write count. Its success is enforced by
  // the batch itself; confirm the unique request claim instead.
  const confirmedChanges=env.CF_FREE_ZERO_WRITE_ASSERTIONS==="1"?batch[0].meta.changes:batch[5].meta.changes;
  if(confirmedChanges!==1)throw new ApiFailure(409,"DELIVERY_CONFIRMATION_CONFLICT","额度状态已变化，请检查回复状态后再试。");
  await bestEffortReferralAward(env,userId);
  return response({ok:true,alreadyConfirmed:false,requestId,quota:await balance(env,userId)},200,env,request);
}


/** Read-only recovery: ownership comes only from the authenticated extension session. */
async function recoveryState(env:Env,userId:string,requestId?:string):Promise<any>{
  const row= requestId
    ? await env.DB.prepare("SELECT request_id,status,generation_phase,raw_response,response_expires_at FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId,requestId).first<any>()
    : await env.DB.prepare("SELECT request_id,status,generation_phase,raw_response,response_expires_at FROM ai_requests WHERE user_id=? AND status IN ('reserved','uncertain') ORDER BY CASE generation_phase WHEN 'generating' THEN 0 ELSE 1 END,created_at LIMIT 1").bind(userId).first<any>();
  if(!row)return {state:'missing',requestId:requestId||null};
  if(row.status==='upstream_failed')return {state:'released',requestId:row.request_id};
  if(row.status==='succeeded')return {state:'delivered',requestId:row.request_id,...(row.raw_response&&row.response_expires_at>nowMs()?{raw:row.raw_response}:{})};
  if(row.raw_response && row.response_expires_at>nowMs() && (row.status==='succeeded'||(row.status==='reserved'&&row.generation_phase==='awaiting_delivery')))return {state:'ready',requestId:row.request_id,raw:row.raw_response};
  if(row.status==='succeeded')return {state:'delivered',requestId:row.request_id};
  return {state:row.raw_response?'expired':'running',requestId:row.request_id};
}
export async function recoverGeneration(request:Request,env:Env,requestId?:string,abandon=false):Promise<Response>{
  const {session}=await sessionFor(request,env);
  if(session.kind!=='extension')throw new ApiFailure(403,'FORBIDDEN','仅绑定插件可恢复生成。');
  if(!await takeRate(env,`ai-recovery:${session.user_id}`,60,60_000,nowMs()))throw new ApiFailure(429,'RATE_LIMITED','恢复操作过于频繁，请稍后再试。');
  let state=await recoveryState(env,session.user_id,requestId);
  if(!abandon||['released','ready','delivered'].includes(state.state))return response(state,200,env,request);
  if(!requestId)throw new ApiFailure(400,'INVALID_REQUEST','请指定旧生成请求。');
  if(!await takeRate(env,`ai-abandon-minute:${session.user_id}`,2,60_000,nowMs())||!await takeRate(env,`ai-abandon-hour:${session.user_id}`,6,3600_000,nowMs()))throw new ApiFailure(429,'RECOVERY_RATE_LIMIT','放弃操作过于频繁，请稍后恢复上一条。');
  // A delayed HTTP request might not have reserved yet: keep a terminal tombstone,
  // never merely clear client storage and permit that envelope to execute later.
  await env.DB.prepare(`INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,completed_at,generation_phase)
    VALUES(?,?,?,?,'upstream_failed',0,'',?,?,'unknown') ON CONFLICT(user_id,request_id) DO NOTHING`).bind(requestId,session.user_id,shanghaiDay(nowMs()),uuid(),nowMs(),nowMs()).run();
  if(state.state==='expired')await releaseExpiredDeliveryReservations(env,nowMs(),session.user_id);
  else { await releaseStaleProductionGenerations(env,nowMs(),session.user_id,requestId); if(subscriptionsEnabled(env))await abandonStaleSubscribedGeneration(env,nowMs(),session.user_id,requestId); }
  state=await recoveryState(env,session.user_id,requestId);
  if(state.state==='running')throw new ApiFailure(409,'RECOVERY_NOT_SAFE','暂时无法安全结束此任务，请恢复上一条或稍后再试。');
  return response(state,200,env,request);
}
