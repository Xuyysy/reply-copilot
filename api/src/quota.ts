import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { nowMs, shanghaiDay, uuid } from "./security";

export type Balance = { freeRemaining: number; paidRemaining: number; totalRemaining: number };
export type Reservation = { kind: "new" | "replay"; quota: Balance; raw?: string };
type StoredRequest = { status: string; request_hash: string; raw_response: string | null; response_expires_at: number | null };

export async function balance(env: Env, userId: string): Promise<Balance> {
  const row = await env.DB.prepare("SELECT free_balance,paid_balance FROM credit_accounts WHERE user_id=?").bind(userId).first<{free_balance:number;paid_balance:number}>();
  const freeRemaining = row?.free_balance ?? 0;
  const paidRemaining = row?.paid_balance ?? 0;
  return { freeRemaining, paidRemaining, totalRemaining: freeRemaining + paidRemaining };
}
async function existing(env: Env, userId: string, requestId: string): Promise<StoredRequest | null> {
  return env.DB.prepare("SELECT status,request_hash,raw_response,response_expires_at FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId, requestId).first<StoredRequest>();
}
async function replay(env: Env, userId: string, requestId: string, hash: string, row: StoredRequest, now: number): Promise<Reservation> {
  if (row.request_hash !== hash) throw new ApiFailure(409, "IDEMPOTENCY_CONFLICT", "同一请求标识不能用于不同内容。");
  if (row.status === "succeeded" && row.raw_response && row.response_expires_at && row.response_expires_at > now) return { kind: "replay", raw: row.raw_response, quota: await balance(env, userId) };
  if (row.status === "reserved") throw new ApiFailure(409, "GENERATION_IN_PROGRESS", "这条回复仍在生成，请稍后再试。", 3);
  if (row.status === "succeeded") throw new ApiFailure(409, "IDEMPOTENCY_RESULT_EXPIRED", "原结果已过保留期，请重新生成。");
  if (row.status === "upstream_failed") throw new ApiFailure(409, "GENERATION_FAILED", "这次生成已失败且额度已返还，请重新生成。", 1);
  throw new ApiFailure(503, "GENERATION_STATUS_UNKNOWN", "这次生成的结果尚未确认，请稍后重试或联系支持。");
}
export async function reserveGeneration(env: Env, session: Session, requestId: string, requestHash: string, budgetReserve: number): Promise<Reservation> {
  const now = nowMs();
  const prior = await existing(env, session.user_id, requestId);
  if (prior) return replay(env, session.user_id, requestId, requestHash, prior, now);
  const siteCap = Number(env.SITE_DAILY_CAP);
  if (!Number.isInteger(siteCap) || siteCap < 1 || siteCap > 100_000) throw new ApiFailure(503, "BUDGET_NOT_CONFIGURED", "托管 AI 预算尚未配置。");
  const date = shanghaiDay(now);
  const budgetDay = new Date(now).toISOString().slice(0, 10);
  if (!Number.isSafeInteger(budgetReserve) || budgetReserve < 0) throw new ApiFailure(503, "BUDGET_NOT_CONFIGURED", "AI 成本预留无效。");
  const setting = await env.DB.prepare("SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'").first<{value:string}>();
  const budgetLimit = Number(setting?.value);
  if (!Number.isSafeInteger(budgetLimit) || budgetLimit < 1) throw new ApiFailure(503, "BUDGET_NOT_CONFIGURED", "AI 成本预算尚未配置。");
  const nonce = uuid();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO site_daily_usage(quota_date,used) VALUES(?,0) ON CONFLICT(quota_date) DO NOTHING").bind(date),
    env.DB.prepare("INSERT INTO ai_budget_days(budget_day) VALUES(?) ON CONFLICT(budget_day) DO NOTHING").bind(budgetDay),
    env.DB.prepare(`INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,credit_source,budget_day,budget_reserved_micro_usd)
      SELECT ?,?,?,?,'reserved',1,?,?,CASE WHEN free_balance>0 THEN 'free' ELSE 'paid' END,?,?
      FROM credit_accounts WHERE user_id=? AND free_balance+paid_balance>0
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')
      AND EXISTS(SELECT 1 FROM site_daily_usage WHERE quota_date=? AND used<?)
      AND EXISTS(SELECT 1 FROM ai_budget_days WHERE budget_day=? AND reserved_micro_usd+settled_micro_usd+?<=?)
      AND NOT EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND status='reserved')
      ON CONFLICT(user_id,request_id) DO NOTHING`).bind(requestId,session.user_id,date,nonce,requestHash,now,budgetDay,budgetReserve,session.user_id,session.user_id,date,siteCap,budgetDay,budgetReserve,budgetLimit,session.user_id),
    env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd+? WHERE budget_day=? AND reserved_micro_usd+settled_micro_usd+?<=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)").bind(budgetReserve,budgetDay,budgetReserve,budgetLimit,session.user_id,requestId,nonce),
    env.DB.prepare(`UPDATE credit_accounts SET free_balance=free_balance-CASE WHEN (SELECT credit_source FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)='free' THEN 1 ELSE 0 END,
      paid_balance=paid_balance-CASE WHEN (SELECT credit_source FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)='paid' THEN 1 ELSE 0 END,
      version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)`).bind(session.user_id,requestId,nonce,session.user_id,requestId,nonce,now,session.user_id,session.user_id,requestId,nonce),
    env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at)
      SELECT ?,?,'generation_debit',CASE WHEN credit_source='free' THEN -1 ELSE 0 END,CASE WHEN credit_source='paid' THEN -1 ELSE 0 END,?,?
      FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?`).bind(uuid(),session.user_id,`${session.user_id}:${requestId}`,now,session.user_id,requestId,nonce),
    env.DB.prepare("UPDATE site_daily_usage SET used=used+1 WHERE quota_date=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)").bind(date,session.user_id,requestId,nonce),
  ]);
  if (results[2].meta.changes === 1 && results[3].meta.changes === 1 && results[4].meta.changes === 1 && results[5].meta.changes === 1 && results[6].meta.changes === 1) return { kind: "new", quota: await balance(env, session.user_id) };
  const concurrent = await existing(env, session.user_id, requestId);
  if (concurrent) return replay(env, session.user_id, requestId, requestHash, concurrent, now);
  const user = await env.DB.prepare("SELECT status FROM users WHERE id=?").bind(session.user_id).first<{status:string}>();
  if (user?.status === "frozen") throw new ApiFailure(403, "ACCOUNT_FROZEN", "账户已暂停，请联系支持。");
  if ((await balance(env, session.user_id)).totalRemaining < 1) throw new ApiFailure(402, "INSUFFICIENT_CREDITS", "生成次数已用完，请前往官网查看充值套餐。");
  const site = await env.DB.prepare("SELECT used FROM site_daily_usage WHERE quota_date=?").bind(date).first<{used:number}>();
  if ((site?.used ?? 0) >= siteCap) throw new ApiFailure(503, "HOSTED_BUDGET_EXHAUSTED", "今日托管 AI 安全预算已用完，请稍后再试。");
  const budget = await env.DB.prepare("SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days WHERE budget_day=?").bind(budgetDay).first<{reserved_micro_usd:number;settled_micro_usd:number}>();
  if ((budget?.reserved_micro_usd || 0) + (budget?.settled_micro_usd || 0) + budgetReserve > budgetLimit) throw new ApiFailure(503, "AI_BUDGET_EXHAUSTED", "AI 成本安全预算已用完，请稍后再试。");
  throw new ApiFailure(429, "GENERATION_IN_PROGRESS", "已有一条回复正在生成，请稍后再试。", 3);
}
export async function finishGeneration(env: Env, userId: string, requestId: string, raw: string | null, usage?: {model:string;inputTokens:number;outputTokens:number;costMicroUsd:number}): Promise<void> {
  const now = nowMs();
  const ref = uuid();
  const row = await env.DB.prepare("SELECT budget_reserved_micro_usd FROM ai_requests WHERE user_id=? AND request_id=? AND status='reserved'").bind(userId,requestId).first<{budget_reserved_micro_usd:number}>();
  if (!row) return;
  // A missing provider usage report is charged at the reserved maximum, never zero.
  const actual = usage && Number.isSafeInteger(usage.costMicroUsd) && usage.costMicroUsd >= 0 ? Math.max(usage.costMicroUsd,0) : row.budget_reserved_micro_usd;
  const settled = actual;
  if (raw) {
    await env.DB.batch([
      env.DB.prepare("UPDATE ai_requests SET status='succeeded',raw_response=?,completed_at=?,response_expires_at=?,budget_finalization_ref=? WHERE user_id=? AND request_id=? AND status='reserved'").bind(raw,now,now+10*60_000,ref,userId,requestId),
      env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd-(SELECT budget_reserved_micro_usd FROM ai_requests WHERE budget_finalization_ref=?),settled_micro_usd=settled_micro_usd+? WHERE budget_day=(SELECT budget_day FROM ai_requests WHERE budget_finalization_ref=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE budget_finalization_ref=?)").bind(ref,settled,ref,ref),
      env.DB.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ai_requests WHERE budget_finalization_ref=?) ON CONFLICT(user_id,request_id) DO NOTHING").bind(userId,requestId,usage?.model || "unknown",usage?.inputTokens || 0,usage?.outputTokens || 0,settled,now,ref),
    ]);
    return;
  }
  // A confirmed unusable result is refunded exactly once. Unknown outcomes stay reserved for review.
  await env.DB.batch([
    env.DB.prepare("UPDATE ai_requests SET status='upstream_failed',completed_at=?,refunded_at=?,budget_finalization_ref=? WHERE user_id=? AND request_id=? AND status='reserved'").bind(now,now,ref,userId,requestId),
    env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd-(SELECT budget_reserved_micro_usd FROM ai_requests WHERE budget_finalization_ref=?),settled_micro_usd=settled_micro_usd+? WHERE budget_day=(SELECT budget_day FROM ai_requests WHERE budget_finalization_ref=?) AND EXISTS(SELECT 1 FROM ai_requests WHERE budget_finalization_ref=?)").bind(ref,settled,ref,ref),
    env.DB.prepare(`UPDATE credit_accounts SET free_balance=free_balance+CASE WHEN (SELECT credit_source FROM ai_requests WHERE user_id=? AND request_id=? AND refunded_at=?)='free' THEN 1 ELSE 0 END,
      paid_balance=paid_balance+CASE WHEN (SELECT credit_source FROM ai_requests WHERE user_id=? AND request_id=? AND refunded_at=?)='paid' THEN 1 ELSE 0 END,
      version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND refunded_at=?)
      AND NOT EXISTS(SELECT 1 FROM credit_ledger WHERE kind='generation_refund' AND reference_id=?)`).bind(userId,requestId,now,userId,requestId,now,now,userId,userId,requestId,now,`${userId}:${requestId}`),
    env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at)
      SELECT ?,?,'generation_refund',CASE WHEN credit_source='free' THEN 1 ELSE 0 END,CASE WHEN credit_source='paid' THEN 1 ELSE 0 END,?,?
      FROM ai_requests WHERE user_id=? AND request_id=? AND refunded_at=? ON CONFLICT(kind,reference_id) DO NOTHING`).bind(uuid(),userId,`${userId}:${requestId}`,now,userId,requestId,now),
    env.DB.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) SELECT ?,?,?,?,?,?,? WHERE ?>0 AND EXISTS(SELECT 1 FROM ai_requests WHERE budget_finalization_ref=?) ON CONFLICT(user_id,request_id) DO NOTHING").bind(userId,requestId,usage?.model||"unknown-estimated",usage?.inputTokens||0,usage?.outputTokens||0,settled,now,settled,ref),
  ]);
}
