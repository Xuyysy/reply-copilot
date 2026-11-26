import type {Env} from "./types";
import {refundCandidatePlan,confirmedRefundAmount,refundSyncPlan} from "./partner-refund-sync.mjs";
import {subscriptionRefundCandidatePlan,subscriptionRefundSyncPlan} from "./partner-subscription-refund.mjs";
import {refundSweepPagePlan,refundSweepAdvancePlan} from "./partner-refund-sweep.mjs";

// Also recheck the scheduled switch in the same SQL write, not merely
// at invocation start. Manual reconciliation keeps its own independent gate.
function scheduledWrite(plan:{sql:string;params:unknown[]}){
 return {...plan,sql:plan.sql.replace("ON CONFLICT DO NOTHING","AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_scheduled_refund_sync_enabled' AND value='1') ON CONFLICT DO NOTHING")};
}
// Internal only. Recheck persisted evidence in the guarded reversal statement.
// Do not infer partial subscription refunds or turn risk holds into reversals.
async function syncOne(env:Env,domain:string,orderId:string,now:number){
 if(domain==='subscription'){
  const q=subscriptionRefundCandidatePlan(orderId);
  const rows=(await env.DB.prepare(q.sql).bind(...q.params).all<Record<string,unknown>>()).results;
  const work=await subscriptionRefundSyncPlan({orderId,rows,now});
  if(!work?.write)return;
  const p=scheduledWrite(work.write);
  await env.DB.prepare(p.sql).bind(...p.params).run();
  return;
 }
 const q=refundCandidatePlan(orderId);
 const rows=(await env.DB.prepare(q.sql).bind(...q.params).all<Record<string,unknown>>()).results;
 if(confirmedRefundAmount(rows)===null)return;
 const work=refundSyncPlan({orderId,rows,now});
 if(work){const p=scheduledWrite(work);await env.DB.prepare(p.sql).bind(...p.params).run();}
}

// No D1 access when absent or production; independent of accrual switches.
// Per invocation at most three historical commission rows per domain.
// A cursor CAS prevents concurrent sweeps from overwriting newer progress.
// Failed writes may be revisited on the next cycle; reversal is idempotent.
export async function scheduledPartnerRefundSync(env:Env,now:number):Promise<void>{
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_SCHEDULED_REFUND_SYNC_ENABLED!=='1')return;
 try{
  const gate=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_refund_sync_enabled','partner_scheduled_refund_sync_enabled') AND value='1'").first<{n:number}>();
  if(gate?.n!==2)return;
  for(const domain of ['recharge','subscription']){
   try{
    const cursor=await env.DB.prepare("SELECT order_id,generation FROM partner_refund_sweep_cursors WHERE order_domain=?").bind(domain).first<{order_id:string;generation:number}>();
    if(!cursor)continue;
    const page=refundSweepPagePlan({orderDomain:domain,afterId:cursor.order_id,limit:3});
    const rows=(await env.DB.prepare(page.sql).bind(...page.params).all<{order_id:string}>()).results;
    for(const row of rows){
     try{await syncOne(env,domain,row.order_id,now);}
     catch{console.warn("PARTNER_REFUND_SWEEP_ORDER_FAILED");}
    }
    if(!rows.length&&!cursor.order_id)continue;
    const advance=refundSweepAdvancePlan({orderDomain:domain,oldId:cursor.order_id,nextId:rows.length?rows[rows.length-1].order_id:'',generation:cursor.generation,now,wrap:!rows.length});
    await env.DB.prepare(advance.sql).bind(...advance.params).run();
   }catch{console.warn("PARTNER_REFUND_SWEEP_DOMAIN_FAILED");}
  }
 }catch{console.warn("PARTNER_REFUND_SWEEP_FAILED");}
}
