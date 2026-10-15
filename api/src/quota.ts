import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { nextShanghaiReset, nowMs, shanghaiDay, uuid } from "./security";

export type Reservation = { kind: "new" | "replay"; quota: { dailyLimit: number; dailyUsed: number; dailyRemaining: number; resetAt: string }; raw?: string };
type StoredRequest = { status: string; request_hash: string; raw_response: string | null; response_expires_at: number | null };

async function existing(env: Env, userId: string, requestId: string): Promise<StoredRequest | null> {
  return env.DB.prepare("SELECT status,request_hash,raw_response,response_expires_at FROM ai_requests WHERE user_id=? AND request_id=?").bind(userId, requestId).first<StoredRequest>();
}
async function quota(env: Env, userId: string, now: number) {
  const row = await env.DB.prepare("SELECT used,daily_limit FROM daily_usage WHERE user_id=? AND quota_date=?").bind(userId, shanghaiDay(now)).first<{used:number;daily_limit:number}>();
  const dailyLimit = row?.daily_limit ?? 30;
  const dailyUsed = row?.used ?? 0;
  return { dailyLimit, dailyUsed, dailyRemaining: Math.max(0, dailyLimit - dailyUsed), resetAt: nextShanghaiReset(now) };
}
export async function reserveGeneration(env: Env, session: Session, requestId: string, requestHash: string): Promise<Reservation> {
  const now = nowMs();
  const previous = await existing(env, session.user_id, requestId);
  if (previous) return replay(env, session.user_id, requestId, requestHash, previous, now);
  const date = shanghaiDay(now);
  const nonce = uuid();
  const siteCap = Number(env.SITE_DAILY_CAP);
  if (!Number.isInteger(siteCap) || siteCap < 1 || siteCap > 100_000) throw new ApiFailure(503, "BUDGET_NOT_CONFIGURED", "托管 AI 预算尚未配置。");
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE ai_requests SET status='uncertain',completed_at=? WHERE user_id=? AND status='reserved' AND created_at<?").bind(now, session.user_id, now - 120_000),
    env.DB.prepare("INSERT INTO daily_usage(user_id,quota_date,used,daily_limit) VALUES(?,?,0,30) ON CONFLICT(user_id,quota_date) DO NOTHING").bind(session.user_id, date),
    env.DB.prepare("INSERT INTO site_daily_usage(quota_date,used) VALUES(?,0) ON CONFLICT(quota_date) DO NOTHING").bind(date),
    env.DB.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at) SELECT ?,?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM trials WHERE user_id=? AND status='active' AND expires_at>?) AND EXISTS(SELECT 1 FROM daily_usage WHERE user_id=? AND quota_date=? AND used<daily_limit) AND EXISTS(SELECT 1 FROM site_daily_usage WHERE quota_date=? AND used<?) AND NOT EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND status='reserved') ON CONFLICT(user_id,request_id) DO NOTHING").bind(requestId, session.user_id, date, nonce, "reserved", requestHash, now, session.user_id, now, session.user_id, date, date, siteCap, session.user_id),
    env.DB.prepare("UPDATE daily_usage SET used=used+1 WHERE user_id=? AND quota_date=? AND used<daily_limit AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)").bind(session.user_id, date, session.user_id, requestId, nonce),
    env.DB.prepare("UPDATE site_daily_usage SET used=used+1 WHERE quota_date=? AND used<? AND EXISTS(SELECT 1 FROM ai_requests WHERE user_id=? AND request_id=? AND reservation_nonce=?)").bind(date, siteCap, session.user_id, requestId, nonce),
  ]);
  if (results[3].meta.changes === 1 && results[4].meta.changes === 1 && results[5].meta.changes === 1) return { kind: "new", quota: await quota(env, session.user_id, now) };
  const concurrent = await existing(env, session.user_id, requestId);
  if (concurrent) return replay(env, session.user_id, requestId, requestHash, concurrent, now);
  const trial = await env.DB.prepare("SELECT expires_at,status FROM trials WHERE user_id=?").bind(session.user_id).first<{expires_at:number;status:string}>();
  if (!trial || trial.status !== "active" || trial.expires_at <= now) throw new ApiFailure(403, "TRIAL_EXPIRED", "免费体验已结束。");
  if ((await quota(env, session.user_id, now)).dailyRemaining < 1) throw new ApiFailure(429, "QUOTA_EXCEEDED", "今日免费次数已用完，请明天再试。", 60);
  const site = await env.DB.prepare("SELECT used FROM site_daily_usage WHERE quota_date=?").bind(date).first<{used:number}>();
  if ((site?.used ?? 0) >= siteCap) throw new ApiFailure(503, "HOSTED_BUDGET_EXHAUSTED", "今日托管 AI 安全预算已用完，请稍后再试。");
  throw new ApiFailure(429, "GENERATION_IN_PROGRESS", "已有一条回复正在生成，请稍后再试。", 3);
}
async function replay(env: Env, userId: string, requestId: string, hash: string, row: StoredRequest, now: number): Promise<Reservation> {
  if (row.request_hash !== hash) throw new ApiFailure(409, "IDEMPOTENCY_CONFLICT", "相同请求标识不能用于不同内容。");
  if (row.status === "succeeded" && row.raw_response && row.response_expires_at && row.response_expires_at > now) return { kind: "replay", raw: row.raw_response, quota: await quota(env, userId, now) };
  if (row.status === "reserved") throw new ApiFailure(409, "GENERATION_IN_PROGRESS", "这条回复仍在生成，请稍后再试。", 3);
  if (row.status === "succeeded") throw new ApiFailure(409, "IDEMPOTENCY_RESULT_EXPIRED", "原结果已过保留期，请重新生成。");
  throw new ApiFailure(503, "GENERATION_STATUS_UNKNOWN", "这次生成未能确认结果。为避免重复扣费，请使用新的请求重试。");
}
export async function finishGeneration(env: Env, userId: string, requestId: string, raw: string | null): Promise<void> {
  const now = nowMs();
  await env.DB.prepare("UPDATE ai_requests SET status=?,raw_response=?,completed_at=?,response_expires_at=? WHERE user_id=? AND request_id=? AND status='reserved'").bind(raw ? "succeeded" : "upstream_failed", raw, now, raw ? now + 10 * 60_000 : null, userId, requestId).run();
}
