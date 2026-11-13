/* Read-only, bounded admin projection. Never changes balances or payments. */
export function createAdminEntitlementActivity({requireAdminSession,response,ApiFailure}){
 const DAY=86400000;
 const JOINED=[
  `SELECT 'credit:'||l.id AS id,l.user_id,l.created_at AS occurred_at,
   CASE WHEN l.free_delta<>0 AND l.paid_delta<>0 THEN 'mixed'
        WHEN l.free_delta<>0 THEN 'free'
        WHEN l.paid_delta<>0 THEN 'paid' ELSE 'unknown' END AS source,
   l.kind AS event_type,l.free_delta,l.paid_delta,
   NULL AS subscription_delta,NULL AS plan_code,NULL AS daily_limit,NULL AS day_index,
   NULL AS amount_fen,NULL AS order_status,l.reference_id AS reference_id,l.reason
   FROM credit_ledger l WHERE l.created_at>=? AND l.created_at<?`,
  `SELECT 'usage:'||e.id AS id,e.user_id,e.created_at AS occurred_at,
   'subscription' AS source,'subscription_'||e.event_type AS event_type,
   0 AS free_delta,0 AS paid_delta,
   CASE WHEN e.event_type='consume' THEN -1 ELSE 0 END AS subscription_delta,
   pv.plan_code,sp.daily_limit,e.day_index,
   NULL AS amount_fen,NULL AS order_status,e.request_id AS reference_id,NULL AS reason
   FROM subscription_usage_events e JOIN subscription_periods sp ON sp.id=e.period_id
   JOIN subscription_plan_versions pv ON pv.id=sp.plan_version_id
   WHERE e.created_at>=? AND e.created_at<?`,
  `SELECT 'order:'||o.id AS id,o.user_id,o.applied_at AS occurred_at,
   'subscription' AS source,'subscription_'||o.kind AS event_type,
   0 AS free_delta,0 AS paid_delta,NULL AS subscription_delta,
   pv.plan_code,pv.daily_limit,NULL AS day_index,
   o.amount_fen,o.status AS order_status,o.id AS reference_id,NULL AS reason
   FROM subscription_orders o JOIN subscription_plan_versions pv ON pv.id=o.plan_version_id
   WHERE o.applied_at>=? AND o.applied_at<? AND o.status IN ('paid','refund_pending','refunded')`,
  `SELECT 'refund:'||o.id AS id,o.user_id,o.updated_at AS occurred_at,
   'subscription' AS source,'subscription_refund' AS event_type,
   0 AS free_delta,0 AS paid_delta,NULL AS subscription_delta,
   pv.plan_code,pv.daily_limit,NULL AS day_index,
   o.amount_fen,o.status AS order_status,o.id AS reference_id,
   '退款状态记录（非额外扣次）' AS reason
   FROM subscription_orders o JOIN subscription_plan_versions pv ON pv.id=o.plan_version_id
   WHERE o.status='refunded' AND o.applied_at IS NOT NULL
    AND o.updated_at>=? AND o.updated_at<?`
 ].join(' UNION ALL ');
 const VALID_SOURCES=['all','subscription','free','paid','mixed','unknown'];
 return async function adminEntitlementActivity(request,env){
  await requireAdminSession(request,env);
  const p=new URL(request.url).searchParams;
  const source=p.get('source')||'all';
  if(!VALID_SOURCES.includes(source))throw new ApiFailure(400,'INVALID_FILTER','权益来源筛选无效。');
  const q=(p.get('q')||'').trim();
  if(q.length>120)throw new ApiFailure(400,'INVALID_FILTER','用户筛选过长。');
  const now=Date.now();
  const from=p.has('from')?Number(p.get('from')):now-30*DAY;
  const to=p.has('to')?Number(p.get('to')):now+1;
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from||to>now+DAY||to-from>366*DAY)
   throw new ApiFailure(400,'INVALID_FILTER','时间区间无效（最长366天）。');
  const where=[];
  const args=[from,to,from,to,from,to,from,to];
  if(q){where.push(q.includes('@')?'u.email=? COLLATE NOCASE':'c.user_id=?');args.push(q);}
  if(source!=='all'){where.push('c.source=?');args.push(source);}
  const cursor=p.get('cursor');
  if(cursor){
   const match=/^([0-9]{1,15}):((?:credit|usage|order|refund):[A-Za-z0-9_-]{1,100})$/.exec(cursor);
   if(!match)throw new ApiFailure(400,'INVALID_FILTER','分页游标无效。');
   const at=Number(match[1]);
   if(!Number.isSafeInteger(at)||at<from||at>=to)
    throw new ApiFailure(400,'INVALID_FILTER','分页时间无效。');
   where.push('(c.occurred_at<? OR (c.occurred_at=? AND c.id<?))');
   args.push(at,at,match[2]);
  }
  const conditions=where.length?' WHERE '+where.join(' AND '):'';
  const query='WITH changes AS ('+JOINED+') SELECT c.*,u.email FROM changes c JOIN users u ON u.id=c.user_id'
    +conditions+' ORDER BY c.occurred_at DESC,c.id DESC LIMIT ?';
  const limit=50;
  const rows=(await env.DB.prepare(query).bind(...args,limit+1).all()).results||[];
  const items=rows.slice(0,limit),hasMore=rows.length>limit,last=items.at(-1);
  return response({items,hasMore,nextCursor:hasMore&&last?last.occurred_at+':'+last.id:null,
   range:{from,to},limit,definition:'Event audit only: subscription orders, reservations, releases and consumed daily allowance are not permanent credits. Failed releases do not debit a user.'},200,env,request);
 };
}
