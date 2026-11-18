import type { Env } from './types';
import { ApiFailure } from './types';
import { nowMs, shanghaiDay, uuid } from './security';
import { subscriptionAccount, subscriptionsEnabled } from './subscription-account';
import { subscriptionDayWindow } from '../../domain/subscription-policy.js';

type Allocation = { id: string; period_id: string; day_index: number };
type RequestCost = { model: string; inputTokens: number; outputTokens: number; costMicroUsd: number; usageQuality?: 'verified' | 'estimated' };
const MAX_CLEANUP_PER_CALL=20;
const FIAT_PROOF_SQL = "EXISTS (SELECT 1 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=p.source_order_id AND o.user_id=p.user_id AND o.status='paid' AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL AND t.status='paid' AND t.paid_at IS NOT NULL AND t.risk_state='clear' AND t.amount_fen=o.amount_fen AND t.currency='CNY' AND (?<>'production' OR t.merchant_provider IN ('mk99','xiaodou')) AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen AND (t.merchant_provider='local_mock' OR e.body_sha256 IS NOT NULL)))";
// Align the atomic spend predicate with subscriptionAccount's BoltUtil proof.
// This is a separate money domain; never query these tables without the
// environment-specific schema-ready flag. Paid alone is NOT a payment proof.
const CRYPTO_PROOF_SQL = "EXISTS (SELECT 1 FROM subscription_orders o JOIN boltutil_orders b ON b.subscription_order_id=o.id AND b.user_id=p.user_id WHERE o.id=p.source_order_id AND o.user_id=p.user_id AND o.status='paid' AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL AND b.status='paid' AND b.paid_at IS NOT NULL AND b.applied_at IS NOT NULL AND b.product_type='subscription' AND b.tx_hash IS NOT NULL AND b.receiving_address IS NOT NULL AND b.payable_usdt_micros>=1000000 AND b.paid_usdt_micros>=b.payable_usdt_micros AND EXISTS (SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=b.external_order_id AND e.network=b.network AND e.tx_hash=b.tx_hash AND e.body_sha256 IS NOT NULL))";

async function pendingSubscriptionAllocation(env:Env,userId:string,requestId:string):Promise<Allocation|null> {
  return await env.DB.prepare("SELECT id,period_id,day_index FROM subscription_ai_allocations WHERE user_id=? AND request_id=? AND state='reserved'")
    .bind(userId,requestId).first<Allocation>();
}

function invariant(env:Env,operationId:string,assertionSql:string,values:unknown[]) {
  return [
    env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN "+assertionSql+" THEN 1 ELSE 0 END").bind(operationId,...values),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(operationId)
  ];
}

/**
 * An atomic, separate daily-bucket reservation. Returns false if no currently
 * verified subscription slot is left, so the caller can use free credits
 * before separately purchased permanent credits.
 */
export async function reserveSubscribedGeneration(
  env:Env,userId:string,requestId:string,requestHash:string,
  budgetReserve:number,providerSnapshot:{id:string;version:number}|null,now=nowMs()
):Promise<boolean> {
  if(!subscriptionsEnabled(env))return false;
  if(!Number.isSafeInteger(budgetReserve)||budgetReserve<0)throw new ApiFailure(503,'BUDGET_NOT_CONFIGURED','AI 成本预算配置无效。');
  const subscription=await subscriptionAccount(env,userId,now);
  if(subscription.status!=='active'||subscription.remainingToday<=0)return false;
  const period=await env.DB.prepare("SELECT id,start_at,end_at FROM subscription_periods WHERE user_id=? AND status='active' AND start_at<=? AND end_at>? LIMIT 1")
    .bind(userId,now,now).first<{id:string;start_at:number;end_at:number}>();
  if(!period)return false;
  const day=subscriptionDayWindow(period.start_at,now);
  if(day.status!=='active'||day.dayIndex===null||day.expiresAt!==period.end_at)
    throw new ApiFailure(503,'SUBSCRIPTION_PERIOD_INVALID','订阅周期状态异常。');

  const date=shanghaiDay(now),budgetDay=new Date(now).toISOString().slice(0,10);
  const setting=await env.DB.prepare("SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'").first<{value:string}>();
  const budgetLimit=Number(setting?.value);
  if(!Number.isSafeInteger(budgetLimit)||budgetLimit<1)throw new ApiFailure(503,'BUDGET_NOT_CONFIGURED','AI 成本预算尚未配置。');
  // The fiat proof stays available everywhere. BoltUtil proof is allowed only
  // where its independent D1 schema has been approved and installed.
  const cryptoReady=['staging','production'].includes(env.ENVIRONMENT)&&env.BOLTUTIL_SCHEMA_READY==='1';
  const proofSql=cryptoReady?'('+FIAT_PROOF_SQL+' OR '+CRYPTO_PROOF_SQL+')':FIAT_PROOF_SQL;
  const nonce=uuid(),allocationId=uuid(),eventId=uuid();
  const requestInsert="INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,credit_source,budget_day,budget_reserved_micro_usd,generation_phase,provider_config_id,provider_config_version) "+
    "SELECT ?,?,?,?,'reserved',0,?,?,NULL,?,?,'generating',?,? FROM subscription_periods p WHERE p.id=? AND p.user_id=? AND p.status='active' AND p.start_at<=? AND p.end_at>? "+
    "AND "+proofSql+" AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.status='active' AND u.archived_at IS NULL) "+
    "AND EXISTS(SELECT 1 FROM ai_budget_days d WHERE d.budget_day=? AND d.reserved_micro_usd+d.settled_micro_usd+?<=?) "+
    "AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM ai_provider_runtime WHERE id=1 AND active_config_id IS NOT NULL)) OR EXISTS(SELECT 1 FROM ai_provider_runtime WHERE id=1 AND active_config_id=? AND active_version=?)) "+
    "AND NOT EXISTS(SELECT 1 FROM ai_requests r WHERE r.user_id=? AND r.status='reserved' AND (COALESCE(r.generation_phase,'unknown')<>'awaiting_delivery' OR r.raw_response IS NULL OR r.response_expires_at IS NULL)) "+
    "ON CONFLICT(user_id,request_id) DO NOTHING";
  const statements=[
    env.DB.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,updated_at) VALUES(?,?,?) ON CONFLICT(period_id,day_index) DO NOTHING").bind(period.id,day.dayIndex,now),
    env.DB.prepare("INSERT INTO site_daily_usage(quota_date,used) VALUES(?,0) ON CONFLICT(quota_date) DO NOTHING").bind(date),
    env.DB.prepare("INSERT INTO ai_budget_days(budget_day) VALUES(?) ON CONFLICT(budget_day) DO NOTHING").bind(budgetDay),
    env.DB.prepare(requestInsert).bind(requestId,userId,date,nonce,requestHash,now,budgetDay,budgetReserve,
      providerSnapshot?.id??null,providerSnapshot?.version??null,period.id,userId,now,now,env.ENVIRONMENT,
      budgetDay,budgetReserve,budgetLimit,providerSnapshot?.id??null,providerSnapshot?.id??null,providerSnapshot?.version??null,userId),
    env.DB.prepare("UPDATE subscription_daily_usage SET reserved=reserved+1,version=version+1,last_reservation_ref=?,updated_at=? WHERE period_id=? AND day_index=? AND used+reserved<(SELECT daily_limit FROM subscription_periods WHERE id=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=? AND status='reserved')")
      .bind(nonce,now,period.id,day.dayIndex,period.id,userId,requestId,nonce),
    env.DB.prepare("INSERT INTO subscription_ai_allocations(id,user_id,request_id,period_id,day_index,state,created_at) SELECT ?,?,?,?,?,'reserved',? WHERE EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?) AND EXISTS(SELECT 1 FROM subscription_daily_usage WHERE period_id=? AND day_index=? AND last_reservation_ref=?) AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=?)")
      .bind(allocationId,userId,requestId,period.id,day.dayIndex,now,userId,requestId,nonce,period.id,day.dayIndex,nonce,userId,requestId),
    env.DB.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) SELECT ?,user_id,period_id,request_id,day_index,'reserve',? FROM subscription_ai_allocations WHERE id=? AND state='reserved' AND EXISTS(SELECT 1 FROM subscription_daily_usage WHERE period_id=? AND day_index=? AND last_reservation_ref=?)")
      .bind(eventId,now,allocationId,period.id,day.dayIndex,nonce),
    env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd+? WHERE budget_day=? AND reserved_micro_usd+settled_micro_usd+?<=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)")
      .bind(budgetReserve,budgetDay,budgetReserve,budgetLimit,userId,requestId,nonce),
    env.DB.prepare("UPDATE site_daily_usage SET used=used+1 WHERE quota_date=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)")
      .bind(date,userId,requestId,nonce),
    ...invariant(env,nonce,
      "EXISTS(SELECT 1 FROM ai_requests r JOIN subscription_ai_allocations a ON a.user_id=r.user_id AND a.request_id=r.request_id JOIN subscription_daily_usage d ON d.period_id=a.period_id AND d.day_index=a.day_index JOIN subscription_periods p ON p.id=a.period_id JOIN subscription_usage_events e ON e.user_id=r.user_id AND e.request_id=r.request_id AND e.event_type='reserve' WHERE r.user_id=? AND r.request_id=? AND r.reservation_nonce=? AND r.status='reserved' AND a.id=? AND a.state='reserved' AND d.last_reservation_ref=? AND d.used+d.reserved<=p.daily_limit AND d.reserved>0 AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.user_id=r.user_id AND x.request_id=r.request_id)) AND EXISTS(SELECT 1 FROM ai_budget_days WHERE budget_day=? AND reserved_micro_usd>=?) AND EXISTS(SELECT 1 FROM site_daily_usage WHERE quota_date=? AND used>0)",
      [userId,requestId,nonce,allocationId,nonce,budgetDay,budgetReserve,date])
  ];
  try{
    await env.DB.batch(statements);
    return true;
  }catch{
    const current=await env.DB.prepare("SELECT request_id FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId,requestId).first();
    if(current)throw new ApiFailure(409,'GENERATION_RESERVATION_CONFLICT','原请求已存在，请恢复该次生成。');
    const after=await subscriptionAccount(env,userId,now);
    if(after.status!=='active'||after.remainingToday===0)return false;
    const inFlight=await env.DB.prepare("SELECT 1 pending FROM ai_requests WHERE user_id=? AND status='reserved' AND (COALESCE(generation_phase,'unknown')<>'awaiting_delivery' OR raw_response IS NULL OR response_expires_at IS NULL) LIMIT 1").bind(userId).first();
    if(inFlight)throw new ApiFailure(409,'GENERATION_IN_PROGRESS','上一条回复仍在生成，请稍后重试。',3);
    const budget=await env.DB.prepare("SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days WHERE budget_day=?").bind(budgetDay).first<{reserved_micro_usd:number;settled_micro_usd:number}>();
    if((budget?.reserved_micro_usd??0)+(budget?.settled_micro_usd??0)+budgetReserve>budgetLimit)
      throw new ApiFailure(503,'AI_BUDGET_EXHAUSTED','AI 成本安全预算已用完，请稍后再试。');
    throw new ApiFailure(409,'SUBSCRIPTION_RESERVATION_CONFLICT','订阅次数状态刚刚变化，请重试。');
  }
}

/**
 * Only delivery ACK consumes one reserved subscription slot. Identical ACKs
 * return idempotently at the caller's already-confirmed request check.
 */
export async function confirmSubscribedDelivery(env:Env,userId:string,requestId:string,now=nowMs()):Promise<boolean>{
  if(!subscriptionsEnabled(env))return false;
  const a=await pendingSubscriptionAllocation(env,userId,requestId);
  if(!a)return false;
  const claim=uuid();
  try{
    const batch=await env.DB.batch([
      env.DB.prepare("UPDATE ai_requests SET status='succeeded',consumed=1,delivery_confirmed_at=?,delivery_confirmation_id=? WHERE user_id=? AND request_id=? AND status='reserved' AND generation_phase='awaiting_delivery' AND raw_response IS NOT NULL AND EXISTS(SELECT 1 FROM subscription_ai_allocations WHERE id=? AND state='reserved') AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations WHERE user_id=? AND request_id=?)")
        .bind(now,claim,userId,requestId,a.id,userId,requestId),
      env.DB.prepare("UPDATE subscription_ai_allocations SET state='consumed',consumed_at=?,finalization_ref=? WHERE id=? AND state='reserved' AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND status='succeeded' AND delivery_confirmation_id=?)")
        .bind(now,claim,a.id,userId,requestId,claim),
      env.DB.prepare("UPDATE subscription_daily_usage SET reserved=reserved-1,used=used+1,version=version+1,last_finalization_ref=?,updated_at=? WHERE period_id=? AND day_index=? AND reserved>0 AND EXISTS(SELECT 1 FROM subscription_ai_allocations WHERE id=? AND state='consumed' AND finalization_ref=?)")
        .bind(claim,now,a.period_id,a.day_index,a.id,claim),
      env.DB.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) SELECT ?,user_id,period_id,request_id,day_index,'consume',? FROM subscription_ai_allocations WHERE id=? AND state='consumed' AND finalization_ref=? AND EXISTS(SELECT 1 FROM subscription_daily_usage WHERE period_id=? AND day_index=? AND last_finalization_ref=?) ON CONFLICT(user_id,request_id,event_type) DO NOTHING")
        .bind(uuid(),now,a.id,claim,a.period_id,a.day_index,claim),
      ...invariant(env,claim,
        "EXISTS(SELECT 1 FROM ai_requests r JOIN subscription_ai_allocations a ON a.user_id=r.user_id AND a.request_id=r.request_id JOIN subscription_daily_usage d ON d.period_id=a.period_id AND d.day_index=a.day_index JOIN subscription_periods p ON p.id=d.period_id WHERE r.user_id=? AND r.request_id=? AND r.status='succeeded' AND r.consumed=1 AND r.delivery_confirmation_id=? AND a.state='consumed' AND a.finalization_ref=? AND d.last_finalization_ref=? AND d.used+d.reserved<=p.daily_limit AND EXISTS(SELECT 1 FROM subscription_usage_events e WHERE e.user_id=r.user_id AND e.request_id=r.request_id AND e.event_type='consume') AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.user_id=r.user_id AND x.request_id=r.request_id))",
        [userId,requestId,claim,claim,claim])
    ]);
    return batch[0].meta.changes===1;
  }catch{
    const state=await env.DB.prepare("SELECT status,delivery_confirmation_id FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId,requestId).first<{status:string;delivery_confirmation_id:string|null}>();
    if(state?.status==='succeeded'&&state.delivery_confirmation_id)return true;
    throw new ApiFailure(409,'DELIVERY_CONFIRMATION_CONFLICT','订阅额度确认发生冲突，请检查回复状态。');
  }
}

type ReleaseMode = 'provider_failed' | 'provider_timeout' | 'provider_abandoned' | 'delivery_expired';

/** Atomic release; stale unknown provider requests conservatively settle budget. */
async function releaseSubscribedAllocation(env:Env,userId:string,requestId:string,now:number,mode:ReleaseMode,cost?:RequestCost):Promise<boolean>{
  const a=await pendingSubscriptionAllocation(env,userId,requestId);
  if(!a)return false;
  const claim=uuid(),isDelivery=mode==='delivery_expired',isTimeout=mode==='provider_timeout',isAbandoned=mode==='provider_abandoned';
  const reqWhere=isDelivery
    ? "status='reserved' AND generation_phase='awaiting_delivery' AND response_expires_at IS NOT NULL AND response_expires_at<? AND delivery_confirmation_id IS NULL"
    : (isTimeout||isAbandoned)
    ? "status IN ('reserved','uncertain') AND generation_phase='generating' AND raw_response IS NULL AND response_expires_at IS NULL"+(isTimeout?" AND created_at<?":"")+" AND delivery_confirmation_id IS NULL AND budget_finalization_ref IS NULL"
    : "status='reserved' AND generation_phase='generating' AND raw_response IS NULL AND response_expires_at IS NULL AND delivery_confirmation_id IS NULL AND budget_finalization_ref IS NULL";
  const reqArgs=isDelivery?[now]:isTimeout?[now-10*60_000]:[];
  const reqStmt=isDelivery
    ? env.DB.prepare("UPDATE ai_requests SET status='upstream_failed',generation_phase='unknown',completed_at=?,refunded_at=? WHERE user_id=? AND request_id=? AND "+reqWhere+" AND EXISTS(SELECT 1 FROM subscription_ai_allocations WHERE id=? AND state='reserved')").bind(now,now,userId,requestId,...reqArgs,a.id)
    : env.DB.prepare("UPDATE ai_requests SET status='upstream_failed',generation_phase='unknown',completed_at=?,refunded_at=?,budget_finalization_ref=? WHERE user_id=? AND request_id=? AND "+reqWhere+" AND EXISTS(SELECT 1 FROM subscription_ai_allocations WHERE id=? AND state='reserved')").bind(now,now,claim,userId,requestId,...reqArgs,a.id);
  const statements=[
    reqStmt,
    env.DB.prepare("UPDATE subscription_ai_allocations SET state='released',released_at=?,finalization_ref=? WHERE id=? AND state='reserved' AND EXISTS(SELECT 1 FROM ai_requests r WHERE r.user_id=? AND r.request_id=? AND r.status='upstream_failed' AND r.completed_at=? AND "+(isDelivery?"r.response_expires_at<?":"r.budget_finalization_ref=?")+")")
      .bind(now,claim,a.id,userId,requestId,now,isDelivery?now:claim),
    env.DB.prepare("UPDATE subscription_daily_usage SET reserved=reserved-1,version=version+1,last_finalization_ref=?,updated_at=? WHERE period_id=? AND day_index=? AND reserved>0 AND EXISTS(SELECT 1 FROM subscription_ai_allocations WHERE id=? AND state='released' AND finalization_ref=?)")
      .bind(claim,now,a.period_id,a.day_index,a.id,claim),
    env.DB.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) SELECT ?,user_id,period_id,request_id,day_index,'release',? FROM subscription_ai_allocations WHERE id=? AND state='released' AND finalization_ref=? AND EXISTS(SELECT 1 FROM subscription_daily_usage WHERE period_id=? AND day_index=? AND last_finalization_ref=?) ON CONFLICT(user_id,request_id,event_type) DO NOTHING")
      .bind(uuid(),now,a.id,claim,a.period_id,a.day_index,claim)
  ];
  if(!isDelivery){
    const settled=cost && Number.isSafeInteger(cost.costMicroUsd) && cost.costMicroUsd>=0 ? cost.costMicroUsd : null;
    // Timeout and explicit unknown provider errors retain the full reserved
    // budget estimate unless the upstream provided a verified lower cost.
    statements.push(
      env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd-(SELECT budget_reserved_micro_usd FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?),settled_micro_usd=settled_micro_usd+COALESCE(?,(SELECT budget_reserved_micro_usd FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)) WHERE budget_day=(SELECT budget_day FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?) AND reserved_micro_usd>=(SELECT budget_reserved_micro_usd FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=?)")
        .bind(userId,requestId,claim,settled,userId,requestId,claim,userId,requestId,claim,userId,requestId,claim),
      env.DB.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at,provider_config_id,provider_config_version,usage_quality) SELECT user_id,request_id,?,?,COALESCE(?,0),COALESCE(?,budget_reserved_micro_usd),?,provider_config_id,provider_config_version,? FROM ai_requests WHERE user_id=? AND request_id=? AND budget_finalization_ref=? ON CONFLICT(user_id,request_id) DO NOTHING")
        .bind(cost?.model??'unknown-timeout-estimated',cost?.inputTokens??0,cost?.outputTokens??0,settled,now,cost?.usageQuality??'estimated',userId,requestId,claim)
    );
  }
  statements.push(...invariant(env,claim,
    "EXISTS(SELECT 1 FROM ai_requests r JOIN subscription_ai_allocations a ON a.user_id=r.user_id AND a.request_id=r.request_id JOIN subscription_daily_usage d ON d.period_id=a.period_id AND d.day_index=a.day_index JOIN subscription_periods p ON p.id=d.period_id WHERE r.user_id=? AND r.request_id=? AND r.status='upstream_failed' AND a.state='released' AND a.finalization_ref=? AND d.last_finalization_ref=? AND d.used+d.reserved<=p.daily_limit AND EXISTS(SELECT 1 FROM subscription_usage_events e WHERE e.user_id=r.user_id AND e.request_id=r.request_id AND e.event_type='release') AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.user_id=r.user_id AND x.request_id=r.request_id))"+(isDelivery?"":" AND EXISTS(SELECT 1 FROM ai_budget_days d JOIN ai_requests r ON r.budget_day=d.budget_day WHERE r.user_id=? AND r.request_id=? AND r.budget_finalization_ref=? AND d.reserved_micro_usd>=0)"),
    isDelivery?[userId,requestId,claim,claim]:[userId,requestId,claim,claim,userId,requestId,claim]));
  try{
    const r=await env.DB.batch(statements);
    return r[0].meta.changes===1;
  }catch{
    const current=await pendingSubscriptionAllocation(env,userId,requestId);
    if(!current)return false;
    throw new ApiFailure(409,'SUBSCRIPTION_RELEASE_CONFLICT','订阅额度预留释放发生冲突。');
  }
}

/** No API/public endpoint: called after provider failure only. */
export async function failSubscribedGeneration(env:Env,userId:string,requestId:string,now=nowMs(),cost?:RequestCost):Promise<boolean>{
  if(!subscriptionsEnabled(env))return false;
  return releaseSubscribedAllocation(env,userId,requestId,now,'provider_failed',cost);
}

/** Bounded cleanup for stale generation and expired delivery reservations. */
export async function cleanupSubscribedReservations(env:Env,now=nowMs(),userId?:string,explicitRequestId?:string):Promise<void>{
  if(!subscriptionsEnabled(env))return;
  if((env.ENVIRONMENT==='production'||env.ENVIRONMENT==='staging')){
    const args: (string|number)[]=[explicitRequestId??now-10*60_000];
    let extra='';
    if(userId){extra+=' AND r.user_id=?';args.push(userId);}
    const scope=explicitRequestId?" AND r.request_id=?":" AND r.created_at<?";
    const rows=await env.DB.prepare("SELECT r.user_id,r.request_id FROM ai_requests r JOIN subscription_ai_allocations a ON a.user_id=r.user_id AND a.request_id=r.request_id AND a.state='reserved' WHERE r.status IN ('reserved','uncertain') AND r.generation_phase='generating' AND r.raw_response IS NULL AND r.response_expires_at IS NULL AND r.delivery_confirmation_id IS NULL AND r.budget_finalization_ref IS NULL"+scope+extra+" ORDER BY r.created_at LIMIT "+MAX_CLEANUP_PER_CALL).bind(...args).all<{user_id:string;request_id:string}>();
    for(const row of rows.results){
      try{await releaseSubscribedAllocation(env,row.user_id,row.request_id,now,explicitRequestId?'provider_abandoned':'provider_timeout');}
      catch(err){if(!(err instanceof ApiFailure&&err.code==='SUBSCRIPTION_RELEASE_CONFLICT'))throw err;}
    }
  }
  const args2:(string|number)[]=[now];
  let whereUser='';
  if(userId){whereUser=' AND r.user_id=?';args2.push(userId);}
  const expired=await env.DB.prepare("SELECT r.user_id,r.request_id FROM ai_requests r JOIN subscription_ai_allocations a ON a.user_id=r.user_id AND a.request_id=r.request_id AND a.state='reserved' WHERE r.status='reserved' AND r.generation_phase='awaiting_delivery' AND r.response_expires_at IS NOT NULL AND r.response_expires_at<?"+whereUser+" ORDER BY r.response_expires_at LIMIT "+MAX_CLEANUP_PER_CALL).bind(...args2).all<{user_id:string;request_id:string}>();
  for(const row of expired.results){
    try{await releaseSubscribedAllocation(env,row.user_id,row.request_id,now,'delivery_expired');}
    catch(err){if(!(err instanceof ApiFailure&&err.code==='SUBSCRIPTION_RELEASE_CONFLICT'))throw err;}
  }
}

/** Called by authenticated recovery flow for an explicit abandoned request. */
export async function abandonStaleSubscribedGeneration(env:Env,now:number,userId:string,requestId:string):Promise<void>{
  if(!subscriptionsEnabled(env))return;
  await cleanupSubscribedReservations(env,now,userId,requestId);
}
