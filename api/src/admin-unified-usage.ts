import type {Env} from './types';
import {ApiFailure} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';

// Read-only admin projection. Subscription consumption and credit consumption
// remain separate authoritative ledgers; one acknowledged AI request is one row.
type UsageRow = {
  user_id:string; request_id:string; email:string; created_at:number;
  source:'subscription'|'free'|'paid'|'unknown'; source_evidence:string;
  period_id:string|null; period_plan:string|null; model:string|null;
  input_tokens:number|null; output_tokens:number|null;
  estimated_cost_micro_usd:number|null; usage_quality:string|null;
};
const DAY=86_400_000;
const SOURCE_SQL="CASE WHEN sa.state='consumed' THEN 'subscription' " +
  "WHEN ca.state='consumed' AND cb.bucket IN ('free','paid') THEN cb.bucket " +
  "WHEN sa.id IS NULL AND ca.id IS NULL AND r.credit_source IN ('free','paid') THEN r.credit_source " +
  "ELSE 'unknown' END";

export async function adminUnifiedUsage(request:Request,env:Env):Promise<Response>{
  await requireAdminSession(request,env);
  const p=new URL(request.url).searchParams;
  const source=p.get('source')||'all';
  if(!['all','subscription','free','paid','unknown'].includes(source))
    throw new ApiFailure(400,'INVALID_FILTER','使用来源筛选无效。');
  const q=(p.get('q')||'').trim();
  if(q.length>120)throw new ApiFailure(400,'INVALID_FILTER','用户筛选过长。');
  const now=Date.now(),from=p.has('from')?Number(p.get('from')):now-30*DAY;
  const to=p.has('to')?Number(p.get('to')):now+1;
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from||to>now+DAY||to-from>366*DAY)
    throw new ApiFailure(400,'INVALID_FILTER','时间区间无效（最长366天）。');
  const limit=50;
  const filters=[
    "r.status='succeeded'","r.consumed=1",
    "r.delivery_confirmation_id IS NOT NULL","r.delivery_confirmation_id<>''",
    "r.delivery_confirmed_at IS NOT NULL","r.delivery_confirmed_at>=?","r.delivery_confirmed_at<?"
  ];
  const args:(string|number)[]=[from,to];
  // Exact email/user ID lookup, not a cross-table wildcard search.
  if(q){filters.push(q.includes('@')?'u.email=? COLLATE NOCASE':'r.user_id=?');args.push(q);}
  if(source!=='all'){filters.push('('+SOURCE_SQL+')=?');args.push(source);}
  const cursor=p.get('cursor');
  if(cursor){
    const match=/^([0-9]{1,15}):([A-Za-z0-9_-]{1,100})$/.exec(cursor);
    if(!match)throw new ApiFailure(400,'INVALID_FILTER','分页游标无效。');
    const timestamp=Number(match[1]);
    if(!Number.isSafeInteger(timestamp)||timestamp<from||timestamp>=to)
      throw new ApiFailure(400,'INVALID_FILTER','分页时间无效。');
    filters.push('(r.delivery_confirmed_at<? OR (r.delivery_confirmed_at=? AND r.request_id<?))');
    args.push(timestamp,timestamp,match[2]);
  }
  // Partial index 0021_ai_delivery_statistics_index limits the delivered range.
  // Do NOT aggregate unbounded historic ledgers on each admin page visit.
  const sql=[
    'SELECT r.user_id,r.request_id,u.email,r.delivery_confirmed_at AS created_at,',
    SOURCE_SQL+' AS source,',
    "CASE WHEN sa.state='consumed' THEN 'subscription_allocation' "+
      "WHEN ca.state='consumed' THEN 'credit_allocation' "+
      "WHEN sa.id IS NULL AND ca.id IS NULL AND r.credit_source IN ('free','paid') THEN 'legacy_request' "+
      "ELSE 'unattributed' END AS source_evidence,",
    'sa.period_id,v.plan_code AS period_plan,c.model,c.input_tokens,c.output_tokens,',
    'c.estimated_cost_micro_usd,c.usage_quality',
    'FROM ai_requests r JOIN users u ON u.id=r.user_id',
    'LEFT JOIN subscription_ai_allocations sa ON sa.user_id=r.user_id AND sa.request_id=r.request_id',
    'LEFT JOIN ai_credit_allocations ca ON ca.user_id=r.user_id AND ca.request_id=r.request_id',
    'LEFT JOIN credit_batches cb ON cb.id=ca.credit_batch_id',
    'LEFT JOIN subscription_periods sp ON sp.id=sa.period_id',
    'LEFT JOIN subscription_plan_versions v ON v.id=sp.plan_version_id',
    'LEFT JOIN ai_usage_costs c ON c.user_id=r.user_id AND c.request_id=r.request_id',
    'WHERE '+filters.join(' AND '),
    'ORDER BY r.delivery_confirmed_at DESC,r.request_id DESC LIMIT ?'
  ].join(' ');
  const rows=(await env.DB.prepare(sql).bind(...args,limit+1).all<UsageRow>()).results||[];
  const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
  return response({
    items,hasMore,
    nextCursor:hasMore&&last?last.created_at+':'+last.request_id:null,
    range:{from,to},limit,
    definition:'ACK-proven successful deliveries; one row per (user_id,request_id); payments and grants are not generations'
  },200,env,request);
}
