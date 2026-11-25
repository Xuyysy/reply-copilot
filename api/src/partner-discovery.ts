import type {Env} from "./types";
import {ApiFailure} from "./types";
import {requireAdminSession} from "./admin-auth";
import {jsonBody,nowMs} from "./security";
import {response} from "./http";
import {discoveryPagePlan,discoveryEnqueuePlan,cursorAdvancePlan,discoveryRepairPagePlan} from "./partner-discovery.mjs";
import {refundCandidatePlan,confirmedRefundAmount,refundSyncPlan} from "./partner-refund-sync.mjs";
import {subscriptionRefundCandidatePlan,subscriptionRefundSyncPlan} from "./partner-subscription-refund.mjs";

// Explicit admin-triggered bounded pilot, NOT a live cron or payment hook.
// No production access; no automatic accrual. Existing refunds remain
// reconcilable independently of the new-accrual switch.
export async function adminPartnerDiscovery(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env,true);
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_DISCOVERY_ENABLED!=='1')
 throw new ApiFailure(404,'NOT_FOUND','功能未开放。');
 const b=await jsonBody(request,1024),now=nowMs();
 if(b.action==='refund_sync'){
  if(typeof b.orderId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.orderId))throw new ApiFailure(400,'INVALID_REQUEST','订单参数无效。');
  const flag=await env.DB.prepare("SELECT value FROM system_settings WHERE key='partner_refund_sync_enabled'").first<{value:string}>();
  if(flag?.value!=='1')throw new ApiFailure(409,'PARTNER_SYNC_DISABLED','退款同步尚未开启。');
  if(b.domain!==undefined&&!['recharge','subscription'].includes(String(b.domain)))throw new ApiFailure(400,'INVALID_REQUEST','订单类型无效。');
  if(b.domain==='subscription'){
   const candidate=subscriptionRefundCandidatePlan(b.orderId);
   const rows=(await env.DB.prepare(candidate.sql).bind(...candidate.params).all<Record<string,unknown>>()).results;
   const work=await subscriptionRefundSyncPlan({orderId:b.orderId,rows,now});
   if(!work)return response({ok:false,state:'review'},409,env,request);
   if(!await env.DB.prepare(work.proof.sql).bind(...work.proof.params).first())return response({ok:false,state:'review'},409,env,request);
   if(!work.write)return response({ok:true,state:'unchanged'},200,env,request);
   const r=await env.DB.prepare(work.write.sql).bind(...work.write.params).run();
   return response({ok:r.meta.changes===1,state:r.meta.changes===1?'recorded':'conflict'},r.meta.changes===1?200:409,env,request);
  }
  const q=refundCandidatePlan(b.orderId);
  const rows=(await env.DB.prepare(q.sql).bind(...q.params).all<Record<string,unknown>>()).results;
  const amount=confirmedRefundAmount(rows);
  if(amount===null)return response({ok:false,state:'review'},409,env,request);
  const plan=refundSyncPlan({orderId:b.orderId,rows,now});
  if(!plan)return response({ok:true,state:'unchanged'},200,env,request);
  const result=await env.DB.prepare(plan.sql).bind(...plan.params).run();
  return response({ok:result.meta.changes===1,state:result.meta.changes===1?'recorded':'conflict'},result.meta.changes===1?200:409,env,request);
 }
 if(b.action!=='discover'||!['recharge','subscription'].includes(String(b.domain)))throw new ApiFailure(400,'INVALID_REQUEST','操作参数无效。');
 const domain=String(b.domain);
 return response(await discoverPartnerPage(env,domain,now,20),200,env,request);
}

// Shared with the scheduled pilot. No public invocation without admin guard.
export async function discoverPartnerPage(env:Env,domain:string,now:number,limit=5,scheduled=false){
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_DISCOVERY_ENABLED!=='1')
 throw new ApiFailure(404,'NOT_FOUND','功能未开放。');
 const gate=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_discovery_enabled') AND value='1'").first<{n:number}>();
 if(gate?.n!==3)throw new ApiFailure(409,'PARTNER_DISCOVERY_DISABLED','订单发现尚未开启。');
 const cursor=await env.DB.prepare("SELECT applied_at,order_id FROM partner_discovery_cursors WHERE order_domain=?").bind(domain).first<{applied_at:number;order_id:string}>();
 if(!cursor)throw new ApiFailure(409,'PARTNER_DISCOVERY_NOT_CONFIGURED','扫描起点未配置。');
 const p=discoveryPagePlan({domain,afterAt:cursor.applied_at,afterId:cursor.order_id,now,limit});
 const rows=(await env.DB.prepare(p.sql).bind(...p.params).all<{order_id:string;paid_at:number;applied_at:number}>()).results;
 if(!rows.length)return {ok:true,scanned:0,enqueued:0};
 const last=rows[rows.length-1],advance=cursorAdvancePlan({domain,oldAt:cursor.applied_at,oldId:cursor.order_id,nextAt:last.applied_at,nextId:last.order_id,now});
 const claim='discover:'+domain;
 const plans=[
 {sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN
 EXISTS(SELECT 1 FROM partner_discovery_cursors WHERE order_domain=? AND applied_at=? AND order_id=?)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_discovery_enabled') AND value='1')=3
 ${scheduled?"AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_scheduled_discovery_enabled' AND value='1')":""}
 THEN 1 ELSE 0 END`,params:[claim,domain,cursor.applied_at,cursor.order_id]},
 ...rows.map(r=>discoveryEnqueuePlan({domain,orderId:r.order_id,now})),advance,
 {sql:"INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM partner_discovery_cursors WHERE order_domain=? AND applied_at=? AND order_id=?) THEN 1 ELSE 0 END",params:[claim+':done',domain,last.applied_at,last.order_id]},
 {sql:"DELETE FROM partner_recovery_assertions WHERE id IN (?,?)",params:[claim,claim+':done']}
 ];
 let result;
 try{result=await env.DB.batch(plans.map(x=>env.DB.prepare(x.sql).bind(...x.params)));}
 catch{throw new ApiFailure(409,'PARTNER_DISCOVERY_CONFLICT','扫描状态已变化，请重新查询。');}
 return {ok:true,scanned:rows.length,enqueued:result.slice(1,rows.length+1).reduce((n,r)=>n+(r.meta.changes||0),0),pilot:true};
}

// No writes if the pilot or accrual gates are disabled. Each sweep has a
// five-candidate limit, and all candidate inserts remain idempotent.
export async function repairPartnerPage(env:Env,domain:string,now:number,fromAt:number){
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_DISCOVERY_ENABLED!=='1')
 throw new ApiFailure(404,'NOT_FOUND','功能未开放。');
 const gate=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_discovery_enabled') AND value='1'").first<{n:number}>();
 if(gate?.n!==3)return {scanned:0,enqueued:0};
 const cursor=await env.DB.prepare("SELECT applied_at FROM partner_discovery_cursors WHERE order_domain=?").bind(domain).first<{applied_at:number}>();
 if(!cursor)return {scanned:0,enqueued:0};
 const plan=discoveryRepairPagePlan({domain,fromAt,now,limit:5});
 const rows=(await env.DB.prepare(plan.sql).bind(...plan.params).all<{order_id:string}>()).results;
 if(!rows.length)return {scanned:0,enqueued:0};
 const plans=rows.map(r=>{const p=discoveryEnqueuePlan({domain,orderId:r.order_id,now});p.sql=p.sql.replace('ON CONFLICT(order_domain,order_id) DO NOTHING',"AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_scheduled_discovery_enabled' AND value='1') ON CONFLICT(order_domain,order_id) DO NOTHING");return p;});
 const result=await env.DB.batch(plans.map(p=>env.DB.prepare(p.sql).bind(...p.params)));
 return {scanned:rows.length,enqueued:result.reduce((n,r)=>n+(r.meta.changes||0),0)};
}
