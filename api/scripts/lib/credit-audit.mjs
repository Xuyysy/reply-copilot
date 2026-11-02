/** Bounded, read-only audit. No repair/remote/credential logic belongs here. */
const DAY=86400000;
export const AUDIT_LIMITS=Object.freeze({defaultWindowMs:DAY,maxWindowMs:7*DAY,defaultLimit:200,maxLimit:500,maxPages:5,defaultReadBudget:5000});
const integer=(value,min,max,label)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError('Invalid '+label);return value};
export function auditOptions(input={},now=Date.now()){
 const until=integer(input.until??now,1,now,'until');
 const since=integer(input.since??until-DAY,0,until-1,'since');
 const window=until-since;
 if(window>AUDIT_LIMITS.maxWindowMs)throw new RangeError('Window exceeds 7 days; full history requires a separately authorized offline review');
 if(window>DAY&&input.confirmExpandedWindow!==true)throw new RangeError('Expanded window requires explicit confirmation');
 const limit=integer(input.limit??200,1,500,'limit'),pages=integer(input.pages??1,1,5,'pages');
 const rowsReadBudget=integer(input.rowsReadBudget??5000,1,20000,'read budget');
 let after=null;
 if(input.after){const c=input.after;
  if(typeof c.userId!=='string'||!c.userId||c.userId.length>128||typeof c.requestId!=='string'||!c.requestId||c.requestId.length>128)throw new RangeError('Invalid cursor identity');
  after={createdAt:integer(c.createdAt,since,until-1,'cursor time'),userId:c.userId,requestId:c.requestId};
 }
 return {since,until,limit,pages,rowsReadBudget,after};
}
export function auditPage(plan,after=plan.after){
 const continuation=after?' AND (r.created_at,r.user_id,r.request_id)>(?,?,?)':'';
 // MATERIALIZED forces the LIMIT before the full-key point lookups. The status
 // + time range uses ai_requests_new_status_idx, already present since0002.
 const sql=`WITH page AS MATERIALIZED (
   SELECT r.user_id,r.request_id,r.created_at,r.consumed,r.generation_phase,r.delivery_confirmed_at,r.delivery_confirmation_id
   FROM ai_requests r WHERE r.status='succeeded' AND r.created_at>=? AND r.created_at<?${continuation}
   ORDER BY r.created_at,r.user_id,r.request_id LIMIT ?
  ) SELECT p.user_id,p.request_id,p.created_at,p.consumed,p.generation_phase,p.delivery_confirmed_at,p.delivery_confirmation_id,
   a.state allocation_state,a.credits allocation_credits,b.bucket allocation_bucket,c.request_id cost_request_id,l.reference_id debit_reference,l.free_delta,l.paid_delta
  FROM page p LEFT JOIN ai_credit_allocations a ON a.user_id=p.user_id AND a.request_id=p.request_id
   LEFT JOIN credit_batches b ON b.id=a.credit_batch_id
   LEFT JOIN ai_usage_costs c ON c.user_id=p.user_id AND c.request_id=p.request_id
   LEFT JOIN credit_ledger l ON l.kind='generation_debit' AND l.reference_id=p.user_id||':'||p.request_id AND l.user_id=p.user_id
  ORDER BY p.created_at,p.user_id,p.request_id`;
 return {sql,args:[plan.since,plan.until,...(after?[after.createdAt,after.userId,after.requestId]:[]),plan.limit]};
}
export function summarizeAuditRows(rows){
 const counts={checked:rows.length,modern:0,legacyUnattributed:0,missingAllocations:0,missingCosts:0,missingDebits:0,invalidDebit:0};
 for(const r of rows){
  const modern=r.delivery_confirmation_id!=null||r.delivery_confirmed_at!=null||r.allocation_state!=null;
  if(!modern){counts.legacyUnattributed++;continue;}
  counts.modern++;
  if(r.allocation_state!=='consumed')counts.missingAllocations++;
  if(r.cost_request_id==null)counts.missingCosts++;
  if(r.debit_reference==null)counts.missingDebits++;
  else {
   const debitMatches=r.allocation_bucket==='free'?r.free_delta===-1&&r.paid_delta===0
    :r.allocation_bucket==='paid'?r.free_delta===0&&r.paid_delta===-1
    :(r.free_delta===-1&&r.paid_delta===0)||(r.free_delta===0&&r.paid_delta===-1);
   if(r.consumed!==1||!debitMatches)counts.invalidDebit++;
  }
 }
 return counts;
}
export async function runCreditAudit(db,input={},now=Date.now()){
 const plan=auditOptions(input,now),counts=summarizeAuditRows([]);
 const metrics={queries:0,rowsRead:0,rowsWritten:0,durationMs:0},warnings=[];
 let after=plan.after,complete=false,stoppedBecause='page_limit';
 for(let i=0;i<plan.pages;i++){
  const q=auditPage(plan,after),result=await db.prepare(q.sql).bind(...q.args).all();
  if(result.success===false)throw new Error('Audit query failed');
  metrics.queries++;
  const meta=result.meta||{};
  metrics.rowsRead=Number.isSafeInteger(meta.rows_read)&&metrics.rowsRead!==null?metrics.rowsRead+meta.rows_read:null;
  metrics.rowsWritten=Number.isSafeInteger(meta.rows_written)&&metrics.rowsWritten!==null?metrics.rowsWritten+meta.rows_written:null;
  if(meta.rows_written>0)throw new Error('Read-only audit unexpectedly wrote rows');
  metrics.durationMs+=Number(meta.duration)||0;
  const rows=result.results||[],summary=summarizeAuditRows(rows);
  for(const k of Object.keys(counts))counts[k]+=summary[k];
  if(rows.length){const last=rows.at(-1);after={createdAt:last.created_at,userId:last.user_id,requestId:last.request_id};}
  const overBudget=metrics.rowsRead!==null&&metrics.rowsRead>=plan.rowsReadBudget;
  if(overBudget)warnings.push('Read budget reached; no further pages executed');
  if(rows.length<plan.limit){complete=true;stoppedBecause='window_exhausted';break;}
  if(overBudget){stoppedBecause='read_budget';break;}
 }
 if(metrics.rowsRead===null)warnings.push('rows_read unavailable; record count is not a substitute');
 return {window:{since:plan.since,until:plan.until},limit:plan.limit,counts,metrics,complete,stoppedBecause,warnings,nextCursor:complete?null:after};
}
