/* Read-only, bounded admin projection. Never changes balances or payments.
 * Apply every filter and keyset cursor before each source's top-K; merging
 * top-K from each branch is equivalent to the original global UNION top-K. */
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
   WHERE e.created_at>=? AND e.created_at<? AND e.event_type<>'reserve'`,
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
 ];
 const VALID_SOURCES=['all','subscription','free','paid','mixed','unknown'];
 const CREDIT_SOURCE="CASE WHEN l.free_delta<>0 AND l.paid_delta<>0 THEN 'mixed' WHEN l.free_delta<>0 THEN 'free' WHEN l.paid_delta<>0 THEN 'paid' ELSE 'unknown' END";
 const BRANCHES=JOINED.map((sql,i)=>{
   const alias=i===0?'l':i===1?'e':'o';
   const at=i===0?'l.created_at':i===1?'e.created_at':i===2?'o.applied_at':'o.updated_at';
   const prefix=['credit:','usage:','order:','refund:'][i];
   // JOIN users before LIMIT, not after: deleted/orphan users must never
   // truncate a page that used to include only valid user records.
   const joined=sql.replace(' FROM ', ',u.email FROM ')
       .replace(' WHERE ',` JOIN users u ON u.id=${alias}.user_id WHERE `);
   return {sql:joined,alias,at,prefix,subscription:i!==0};
 });
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
  let cursorAt=null,cursorId=null;
  const cursor=p.get('cursor');
  if(cursor){
   const match=/^([0-9]{1,15}):((?:credit|usage|order|refund):[A-Za-z0-9_-]{1,100})$/.exec(cursor);
   if(!match)throw new ApiFailure(400,'INVALID_FILTER','分页游标无效。');
   cursorAt=Number(match[1]);cursorId=match[2];
   if(!Number.isSafeInteger(cursorAt)||cursorAt<from||cursorAt>=to)
    throw new ApiFailure(400,'INVALID_FILTER','分页时间无效。');
  }
  const limit=50;
  const jobs=BRANCHES.filter(b=>source==='all'||(b.subscription?source==='subscription':source!=='subscription'))
   .map(b=>{
     const where=[],args=[from,to];
     if(q){
       where.push(q.includes('@')?'u.email=? COLLATE NOCASE':b.alias+'.user_id=?');
       args.push(q);
     }
     if(!b.subscription&&source!=='all'){
       where.push('('+CREDIT_SOURCE+')=?');args.push(source);
     }
     if(cursorAt!==null){
       where.push('('+b.at+'<? OR ('+b.at+'=? AND '+JSON.stringify(b.prefix)+'||'+b.alias+'.id<?))');
       args.push(cursorAt,cursorAt,cursorId);
     }
     // The prefix is constant within one branch, so the raw row ID preserves
     // the same binary DESC order as the globally prefixed ID.
     const sql=b.sql+(where.length?' AND '+where.join(' AND '):'')
       +' ORDER BY '+b.at+' DESC,'+b.alias+'.id DESC LIMIT ?';
     args.push(limit+1);
     return {sql,args};
   });
  // At most four bounded and independently filtered branches; do not
  // materialize a lifetime cross-ledger UNION just to return one page.
  const pages=await Promise.all(jobs.map(j=>env.DB.prepare(j.sql).bind(...j.args).all()));
  const rows=pages.flatMap(page=>page.results||[]).sort((a,b)=>
    Number(b.occurred_at)-Number(a.occurred_at)||(a.id<b.id?1:a.id>b.id?-1:0)
  ).slice(0,limit+1);
  const items=rows.slice(0,limit),hasMore=rows.length>limit,last=items.at(-1);
  return response({items,hasMore,nextCursor:hasMore&&last?last.occurred_at+':'+last.id:null,
   range:{from,to},limit,definition:'Event audit only: subscription orders, releases and consumed daily allowance are not permanent credits. Temporary subscription reservations are hidden from this view, but remain in source audit data. Failed releases do not debit a user.'},200,env,request);
 };
}
