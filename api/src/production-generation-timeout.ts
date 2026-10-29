import type { Env } from './types';
import { uuid } from './security';

/** Production only. Provider timeout is 25s; 10min without a result is abandoned.
 * Release user reservations, never grant credits or erase possible provider cost.
 * A per-batch claim gates every mutation against late completion / repeated reads.
 */
export async function releaseStaleProductionGenerations(env: Env, now: number, userId?: string): Promise<void> {
  if (env.ENVIRONMENT !== 'production') return;
  const cutoff = now - 10 * 60_000;
  const eligible = `status IN ('reserved','uncertain') AND consumed=0 AND generation_phase='generating'
    AND raw_response IS NULL AND response_expires_at IS NULL AND created_at<?
    AND delivery_confirmed_at IS NULL AND delivery_confirmation_id IS NULL AND budget_finalization_ref IS NULL
    ${userId ? 'AND user_id=?' : ''}
    AND EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.user_id=ai_requests.user_id AND x.request_id=ai_requests.request_id AND x.state='reserved')`;
  const args = userId ? [cutoff,userId] : [cutoff];
  // The existing budget_finalization_ref has a unique index: claim each
  // request independently, and bound global scheduled work per invocation.
  const rows = await env.DB.prepare(`SELECT user_id,request_id FROM ai_requests WHERE ${eligible} ORDER BY created_at LIMIT 20`).bind(...args).all<{user_id:string;request_id:string}>();
  for (const row of rows.results || []) {
  const claim = uuid();
  const owned = `SELECT r.user_id||':'||r.request_id FROM ai_requests r WHERE r.budget_finalization_ref=? AND r.status='upstream_failed'`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE ai_requests SET status='upstream_failed',generation_phase='unknown',completed_at=?,refunded_at=?,budget_finalization_ref=? WHERE ${eligible} AND user_id=? AND request_id=?`).bind(now,now,claim,...args,row.user_id,row.request_id),
    env.DB.prepare(`UPDATE ai_credit_allocations SET state='released',released_at=? WHERE state='reserved' AND user_id||':'||request_id IN (${owned})`).bind(now,claim),
    env.DB.prepare(`UPDATE credit_batches SET generation_reserved_credits=generation_reserved_credits-(SELECT COALESCE(SUM(x.credits),0) FROM ai_credit_allocations x WHERE x.credit_batch_id=credit_batches.id AND x.state='released' AND x.user_id||':'||x.request_id IN (${owned}))
      WHERE EXISTS(SELECT 1 FROM ai_credit_allocations x WHERE x.credit_batch_id=credit_batches.id AND x.state='released' AND x.user_id||':'||x.request_id IN (${owned}))`).bind(claim,claim),
    env.DB.prepare(`UPDATE credit_accounts SET
      free_generation_reserved=free_generation_reserved-(SELECT COALESCE(SUM(x.credits),0) FROM ai_credit_allocations x JOIN credit_batches b ON b.id=x.credit_batch_id WHERE x.user_id=credit_accounts.user_id AND b.bucket='free' AND x.state='released' AND x.user_id||':'||x.request_id IN (${owned})),
      paid_generation_reserved=paid_generation_reserved-(SELECT COALESCE(SUM(x.credits),0) FROM ai_credit_allocations x JOIN credit_batches b ON b.id=x.credit_batch_id WHERE x.user_id=credit_accounts.user_id AND b.bucket='paid' AND x.state='released' AND x.user_id||':'||x.request_id IN (${owned})),version=version+1,updated_at=?
      WHERE user_id IN (SELECT user_id FROM ai_requests WHERE budget_finalization_ref=?)`).bind(claim,claim,now,claim),
    // The provider outcome is unknown: retain the full estimate as settled cost.
    env.DB.prepare(`UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd-(SELECT COALESCE(SUM(r.budget_reserved_micro_usd),0) FROM ai_requests r WHERE r.budget_day=ai_budget_days.budget_day AND r.budget_finalization_ref=?),settled_micro_usd=settled_micro_usd+(SELECT COALESCE(SUM(r.budget_reserved_micro_usd),0) FROM ai_requests r WHERE r.budget_day=ai_budget_days.budget_day AND r.budget_finalization_ref=?) WHERE budget_day IN (SELECT budget_day FROM ai_requests WHERE budget_finalization_ref=?)`).bind(claim,claim,claim),
    env.DB.prepare(`INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at)
      SELECT user_id,request_id,'unknown-timeout-estimated',0,0,budget_reserved_micro_usd,? FROM ai_requests WHERE budget_finalization_ref=? ON CONFLICT(user_id,request_id) DO NOTHING`).bind(now,claim),
    env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at)
      SELECT lower(hex(randomblob(16))),user_id,'generation_release',0,0,user_id||':'||request_id,'生成超时且无交付结果，释放预占；上游成本按预估保留',? FROM ai_requests WHERE budget_finalization_ref=? ON CONFLICT(kind,reference_id) DO NOTHING`).bind(now,claim),
    env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN NOT EXISTS(
      SELECT 1 FROM credit_accounts a WHERE a.user_id IN (SELECT user_id FROM ai_requests WHERE budget_finalization_ref=?) AND (
      a.free_balance<>(SELECT COALESCE(SUM(remaining_credits),0) FROM credit_batches WHERE user_id=a.user_id AND bucket='free') OR
      a.paid_balance<>(SELECT COALESCE(SUM(remaining_credits),0) FROM credit_batches WHERE user_id=a.user_id AND bucket='paid') OR
      a.free_generation_reserved<>(SELECT COALESCE(SUM(generation_reserved_credits),0) FROM credit_batches WHERE user_id=a.user_id AND bucket='free') OR
      a.paid_generation_reserved<>(SELECT COALESCE(SUM(generation_reserved_credits),0) FROM credit_batches WHERE user_id=a.user_id AND bucket='paid')))
      AND NOT EXISTS(SELECT 1 FROM ai_requests r WHERE r.budget_finalization_ref=? AND (
        NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.user_id=r.user_id AND l.kind='generation_release' AND l.reference_id=r.user_id||':'||r.request_id) OR
        NOT EXISTS(SELECT 1 FROM ai_budget_days d WHERE d.budget_day=r.budget_day AND d.reserved_micro_usd>=0))) THEN 1 ELSE 0 END`).bind(claim,claim,claim),
    env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(claim),
  ]);
  }
}
