import type { Env } from './types';
import { ApiFailure } from './types';
import { requireAdminSession } from './admin-auth';
import { response } from './http';
import { subscriptionsEnabled } from './subscription-account';

// Read-only initial admin surface. Mutation, refund and activation endpoints
// must not be added until the complete payment/ledger state machine is proven.
function requireSubscriptionFeature(env: Env): void {
  if (!subscriptionsEnabled(env))
    throw new ApiFailure(404, 'NOT_FOUND', '接口不存在。');
}

export async function adminSubscriptionPlans(request: Request, env: Env): Promise<Response> {
  await requireAdminSession(request,env);
  requireSubscriptionFeature(env);
  const rows=await env.DB.prepare(`SELECT id,plan_code,version,price_fen,daily_limit,duration_days,
    name_zh,name_en,description_zh,description_en,active,current,updated_at
    FROM subscription_plan_versions WHERE current=1
    ORDER BY daily_limit`).all();
  return response({plans:rows.results},200,env,request);
}

export async function adminSubscriptionUsers(request: Request, env: Env): Promise<Response> {
  await requireAdminSession(request,env);
  requireSubscriptionFeature(env);
  const params=new URL(request.url).searchParams;
  const status=params.get('status')??'';
  const plan=params.get('plan')??'';
  if (status && !['active','queued','expired','refund_pending','revoked'].includes(status))
    throw new ApiFailure(400,'INVALID_FILTER','订阅状态筛选无效。');
  if (plan && !['basic','pro','max','ultra'].includes(plan))
    throw new ApiFailure(400,'INVALID_FILTER','订阅档位筛选无效。');
  const now=Date.now();
  const rows=await env.DB.prepare(`SELECT p.id period_id,p.user_id,u.email,u.username,u.status account_status,
    p.status period_status,v.plan_code,p.daily_limit,p.start_at,p.end_at,p.created_at,
    o.id order_id,o.kind order_kind,o.amount_fen,o.status order_status,
    t.status payment_status,t.risk_state,
    COALESCE(d.used,0) used_today,COALESCE(d.reserved,0) reserved_today
    FROM subscription_periods p
    JOIN users u ON u.id=p.user_id
    JOIN subscription_plan_versions v ON v.id=p.plan_version_id
    JOIN subscription_orders o ON o.id=p.source_order_id
    LEFT JOIN subscription_payment_transactions t ON t.order_id=o.id
    LEFT JOIN subscription_daily_usage d ON d.period_id=p.id AND d.day_index=
      CASE WHEN p.start_at IS NOT NULL AND p.end_at IS NOT NULL
        AND p.start_at<=? AND p.end_at>? THEN CAST((?-p.start_at)/86400000 AS INTEGER) ELSE -1 END
    WHERE (?='' OR p.status=?) AND (?='' OR v.plan_code=?)
    ORDER BY p.created_at DESC,p.id DESC LIMIT 100`)
      .bind(now,now,now,status,status,plan,plan).all();
  return response({users:rows.results.map((row:Record<string,unknown>)=>{
    const active=row.period_status==='active'&&typeof row.start_at==='number'&&
      typeof row.end_at==='number'&&row.start_at<=now&&now<row.end_at&&
      row.order_status==='paid'&&row.payment_status==='paid'&&row.risk_state==='clear';
    const used=Number(row.used_today)||0,reserved=Number(row.reserved_today)||0;
    return {...row,effective_status:active?'active':row.period_status==='active'?'expired_or_unverified':row.period_status,
      remaining_today:active?Math.max(0,Number(row.daily_limit)-used-reserved):0};
  })},200,env,request);
}
