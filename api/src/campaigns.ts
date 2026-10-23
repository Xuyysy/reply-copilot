import type {Env} from './types';
import {ApiFailure} from './types';
import {requireAdminSession} from './admin-auth';
import {sessionFor,requireCsrf} from './auth';
import {operation,commitOperation} from './admin-operations';
import {jsonBody,nowMs,uuid} from './security';
import {response} from './http';
type Campaign={id:string;name:string;audience:string;amount:number;bucket:'free'|'paid';reason:string;created_by:string;created_at:number;future_eligible:number;ends_at:number|null;status:string};
export const activityPredicate=`(EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.created_at>=?) OR EXISTS(SELECT 1 FROM ai_requests r WHERE r.user_id=u.id AND r.created_at>=?) OR EXISTS(SELECT 1 FROM recharge_orders o WHERE o.user_id=u.id AND o.paid_at>=?))`;
function campaignInput(body:Record<string,unknown>){
 const name=typeof body.name==='string'?body.name.trim():'',amount=Number(body.amount),kind=body.kind??'free',audience=body.audience;
 const userIds=Array.isArray(body.userIds)?[...new Set(body.userIds)]:[];
 if(!name||name.length>100||!Number.isInteger(amount)||amount<1||amount>10000||!['free','paid'].includes(String(kind))||!['all','active30','unpaid','paid','selected'].includes(String(audience))||userIds.length>200||userIds.some(x=>typeof x!=='string'||x.length>64)||(audience==='selected'&&!userIds.length))throw new ApiFailure(400,'INVALID_CAMPAIGN','请填写活动名称、次数、额度类型及发放对象。');
 const futureEligible=body.futureEligible===true,endsAt=body.endsAt==null||body.endsAt===''?null:Number(body.endsAt);
 if(futureEligible&&(!['all','unpaid'].includes(String(audience))||!Number.isSafeInteger(endsAt)||endsAt!<=nowMs()||endsAt!>nowMs()+90*86400000))throw new ApiFailure(400,'INVALID_CAMPAIGN','新用户活动仅支持全部或未付费对象，并需设置90天内的截止时间。');
 return {name,amount,kind:kind as 'free'|'paid',audience:String(audience),userIds:userIds as string[],futureEligible,endsAt:futureEligible?endsAt:null};
}
function audienceQuery(input:ReturnType<typeof campaignInput>){
 let where="u.status='active' AND u.archived_at IS NULL",args:(number|string)[]=[];
 if(input.audience==='paid'||input.audience==='unpaid')where+=`${input.audience==='unpaid'?' AND NOT':' AND'} EXISTS(SELECT 1 FROM recharge_orders o WHERE o.user_id=u.id AND o.credited_at IS NOT NULL)`;
 if(input.audience==='active30'){where+=' AND '+activityPredicate;const since=nowMs()-30*86400000;args.push(since,since,since);}
 if(input.audience==='selected'){where+=' AND u.id IN (SELECT value FROM json_each(?))';args.push(JSON.stringify(input.userIds));}
 return {where,args};
}
export async function campaignStats(env:Env,id:string){const row=await env.DB.prepare("SELECT count(*) total,COALESCE(sum(state='succeeded'),0) succeeded,COALESCE(sum(state='failed'),0) failed,COALESCE(sum(state!='succeeded'),0) remaining FROM credit_campaign_recipients WHERE campaign_id=?").bind(id).first();return row??{total:0,succeeded:0,failed:0,remaining:0};}
export async function previewCampaign(request:Request,env:Env){await requireAdminSession(request,env);const {token}=await sessionFor(request,env);await requireCsrf(request,env,token);const input=campaignInput(await jsonBody(request,20000)),q=audienceQuery(input);const row=await env.DB.prepare(`SELECT count(*) n FROM users u WHERE ${q.where}`).bind(...q.args).first<{n:number}>();return response({recipientCount:row?.n??0,totalCredits:(row?.n??0)*input.amount,activityDefinition:'近30天登录、生成请求或成功付款；冻结和归档账户除外'},200,env,request);}
export async function createCampaign(request:Request,env:Env){
 const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,20000),input=campaignInput(body),q=audienceQuery(input);
 const op=await operation(env,actor,body,'campaign_create','campaign');
 const id=op.id;if(op.replayed)return response({ok:true,campaignId:id},200,env,request);
 const n=(await env.DB.prepare(`SELECT count(*) n FROM users u WHERE ${q.where}`).bind(...q.args).first<{n:number}>())?.n??0;
 if(body.confirm!==true||body.expectedCount!==n)throw new ApiFailure(409,'CAMPAIGN_PREVIEW_CHANGED','对象人数发生变化，请重新预览确认。');
 if(input.futureEligible){const active=await env.DB.prepare("SELECT count(*) n FROM credit_campaigns WHERE future_eligible=1 AND status='active' AND ends_at>?").bind(nowMs()).first<{n:number}>();if((active?.n??0)>=3)throw new ApiFailure(409,'FUTURE_CAMPAIGN_LIMIT','同时面向新用户的活动最多3个，请先结束旧活动。');}
 const now=nowMs();
 await commitOperation(env,op,[
 env.DB.prepare("INSERT INTO credit_campaigns(id,name,audience,amount,bucket,reason,created_by,created_at,future_eligible,ends_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,input.name,input.audience,input.amount,input.kind,op.reason,actor.user_id,now,input.futureEligible?1:0,input.endsAt),
 env.DB.prepare(`INSERT INTO credit_campaign_recipients(campaign_id,user_id) SELECT ?,u.id FROM users u WHERE ${q.where}`).bind(id,...q.args),
 env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN (SELECT count(*) FROM credit_campaign_recipients WHERE campaign_id=?)=? AND (SELECT count(*) FROM credit_campaigns WHERE future_eligible=1 AND status='active' AND ends_at>?)<=3 THEN 1 ELSE 0 END").bind(id,id,n,now),
 env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(id)
 ],null,{name:input.name,recipientCount:n,totalCredits:n*input.amount,futureEligible:input.futureEligible,endsAt:input.endsAt});
 return response({ok:true,campaignId:id},201,env,request);
}
// Stable campaign/user references and one D1 batch keep lots, balance and ledger in lockstep.
export function campaignGrantStatements(env:Env,c:Campaign,userId:string,operationId:string,now:number):D1PreparedStatement[]{
 const ref=`campaign:${c.id}:${userId}`,field=c.bucket==='free'?'free_balance':'paid_balance';
 return [
 env.DB.prepare("UPDATE credit_campaign_recipients SET state='issuing',operation_id=?,error_code=NULL WHERE campaign_id=? AND user_id=? AND state IN ('pending','failed') AND EXISTS(SELECT 1 FROM users u JOIN credit_accounts a ON a.user_id=u.id WHERE u.id=? AND u.status='active' AND u.archived_at IS NULL) AND EXISTS(SELECT 1 FROM credit_campaigns WHERE id=? AND status='active')").bind(operationId,c.id,userId,userId,c.id),
 env.DB.prepare(`UPDATE credit_accounts SET ${field}=${field}+?,version=version+1,last_adjustment_ref=?,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM credit_campaign_recipients WHERE campaign_id=? AND user_id=? AND state='issuing' AND operation_id=?)`).bind(c.amount,ref,now,userId,c.id,userId,operationId),
 env.DB.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) SELECT ?,?,?,'admin_adjustment',?,?,?,'tracked','active' WHERE EXISTS(SELECT 1 FROM credit_campaign_recipients WHERE campaign_id=? AND user_id=? AND state='issuing' AND operation_id=?)").bind(ref,userId,c.bucket,c.amount,c.amount,now,c.id,userId,operationId),
 env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at) SELECT ?,?,'admin_adjustment',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_campaign_recipients WHERE campaign_id=? AND user_id=? AND state='issuing' AND operation_id=?)").bind(ref,userId,c.bucket==='free'?c.amount:0,c.bucket==='paid'?c.amount:0,ref,c.created_by,`福利活动：${c.name}；${c.reason}`,now,c.id,userId,operationId),
 env.DB.prepare("UPDATE credit_campaign_recipients SET state='succeeded',granted_at=? WHERE campaign_id=? AND user_id=? AND state='issuing' AND operation_id=? AND EXISTS(SELECT 1 FROM credit_ledger WHERE reference_id=? AND kind='admin_adjustment')").bind(now,c.id,userId,operationId,ref),
 env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN r.state='succeeded' AND a.free_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='free') AND a.paid_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid') THEN 1 ELSE 0 END FROM credit_campaign_recipients r JOIN credit_accounts a ON a.user_id=r.user_id WHERE r.campaign_id=? AND r.user_id=? AND r.operation_id=?").bind(ref,userId,userId,c.id,userId,operationId),
 env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(ref)
 ];
}
async function getCampaign(env:Env,id:string):Promise<Campaign>{const c=await env.DB.prepare('SELECT * FROM credit_campaigns WHERE id=?').bind(id).first<Campaign>();if(!c)throw new ApiFailure(404,'CAMPAIGN_NOT_FOUND','活动不存在。');return c;}
export async function listCampaigns(request:Request,env:Env){await requireAdminSession(request,env);const rows=(await env.DB.prepare("SELECT c.*,(SELECT count(*) FROM credit_campaign_recipients r WHERE r.campaign_id=c.id) recipients,(SELECT count(*) FROM credit_campaign_recipients r WHERE r.campaign_id=c.id AND state='succeeded') succeeded FROM credit_campaigns c ORDER BY c.created_at DESC LIMIT 100").all()).results;return response({campaigns:rows},200,env,request);}
export async function campaignDetail(request:Request,env:Env,id:string){await requireAdminSession(request,env);const campaign=await getCampaign(env,id),stats=await campaignStats(env,id);return response({campaign,stats},200,env,request);}
export async function runCampaign(request:Request,env:Env,id:string){
 const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,2048),c=await getCampaign(env,id),op=await operation(env,actor,body,'campaign_run',id);
 if(op.replayed)return response({processed:0,replayed:true,stats:await campaignStats(env,id)},200,env,request);
 if(c.status!=='active')throw new ApiFailure(409,'CAMPAIGN_CLOSED','活动已结束。');
 await commitOperation(env,op,[],null,{action:'batch_requested',maxBatchSize:3});
 if(op.replayed)return response({processed:0,replayed:true,stats:await campaignStats(env,id)},200,env,request);
 const recipients=(await env.DB.prepare("SELECT user_id FROM credit_campaign_recipients WHERE campaign_id=? AND state IN ('pending','failed') ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END,user_id LIMIT 3").bind(id).all<{user_id:string}>()).results;
 let processed=0;
 for(const item of recipients){const attempt=uuid();try{await env.DB.batch(campaignGrantStatements(env,c,item.user_id,attempt,nowMs()));const result=await env.DB.prepare('SELECT state FROM credit_campaign_recipients WHERE campaign_id=? AND user_id=?').bind(id,item.user_id).first<{state:string}>();if(result?.state==='succeeded')processed++;else await env.DB.prepare("UPDATE credit_campaign_recipients SET state='failed',error_code='ACCOUNT_UNAVAILABLE' WHERE campaign_id=? AND user_id=? AND state!='succeeded'").bind(id,item.user_id).run();}
 catch{await env.DB.prepare("UPDATE credit_campaign_recipients SET state='failed',error_code='GRANT_RETRY_REQUIRED' WHERE campaign_id=? AND user_id=? AND state!='succeeded'").bind(id,item.user_id).run();}}
 return response({processed,batchSize:3,stats:await campaignStats(env,id)},200,env,request);
}
export async function closeCampaign(request:Request,env:Env,id:string){const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,2048),op=await operation(env,actor,body,'campaign_close',id),c=await getCampaign(env,id);await commitOperation(env,op,[env.DB.prepare("UPDATE credit_campaigns SET status='closed' WHERE id=?").bind(id)],{status:c.status},{status:'closed'});return response({ok:true},200,env,request);}
export async function futureCampaignStatements(env:Env,userId:string,now:number):Promise<D1PreparedStatement[]>{
 // Discover eligible activities inside the same registration transaction, not in a stale pre-query.
 const tag=`future-registration:${userId}`;
 return [
 env.DB.prepare("INSERT INTO credit_campaign_recipients(campaign_id,user_id,operation_id) SELECT c.id,?,? FROM credit_campaigns c WHERE c.future_eligible=1 AND c.status='active' AND c.ends_at>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') ORDER BY c.created_at,c.id LIMIT 3 ON CONFLICT(campaign_id,user_id) DO NOTHING").bind(userId,tag,now,userId),
 env.DB.prepare("UPDATE credit_campaign_recipients SET state='issuing' WHERE user_id=? AND operation_id=? AND state='pending'").bind(userId,tag),
 env.DB.prepare("UPDATE credit_accounts SET free_balance=free_balance+COALESCE((SELECT sum(c.amount) FROM credit_campaigns c JOIN credit_campaign_recipients r ON r.campaign_id=c.id WHERE r.user_id=? AND r.operation_id=? AND r.state='issuing' AND c.bucket='free'),0),paid_balance=paid_balance+COALESCE((SELECT sum(c.amount) FROM credit_campaigns c JOIN credit_campaign_recipients r ON r.campaign_id=c.id WHERE r.user_id=? AND r.operation_id=? AND r.state='issuing' AND c.bucket='paid'),0),version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM credit_campaign_recipients WHERE user_id=? AND operation_id=? AND state='issuing')").bind(userId,tag,userId,tag,now,userId,userId,tag),
 env.DB.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) SELECT 'campaign:'||c.id||':'||r.user_id,r.user_id,c.bucket,'admin_adjustment',c.amount,c.amount,?,'tracked','active' FROM credit_campaigns c JOIN credit_campaign_recipients r ON r.campaign_id=c.id WHERE r.user_id=? AND r.operation_id=? AND r.state='issuing'").bind(now,userId,tag),
 env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at) SELECT 'campaign:'||c.id||':'||r.user_id,r.user_id,'admin_adjustment',CASE c.bucket WHEN 'free' THEN c.amount ELSE 0 END,CASE c.bucket WHEN 'paid' THEN c.amount ELSE 0 END,'campaign:'||c.id||':'||r.user_id,c.created_by,'福利活动：'||c.name||'；'||c.reason,? FROM credit_campaigns c JOIN credit_campaign_recipients r ON r.campaign_id=c.id WHERE r.user_id=? AND r.operation_id=? AND r.state='issuing'").bind(now,userId,tag),
 env.DB.prepare("UPDATE credit_campaign_recipients SET state='succeeded',granted_at=? WHERE user_id=? AND operation_id=? AND state='issuing' AND EXISTS(SELECT 1 FROM credit_ledger l WHERE l.reference_id='campaign:'||credit_campaign_recipients.campaign_id||':'||credit_campaign_recipients.user_id AND l.kind='admin_adjustment')").bind(now,userId,tag),
 env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN a.free_balance=(SELECT sum(remaining_credits) FROM credit_batches WHERE user_id=? AND bucket='free') AND a.paid_balance=COALESCE((SELECT sum(remaining_credits) FROM credit_batches WHERE user_id=? AND bucket='paid'),0) AND NOT EXISTS(SELECT 1 FROM credit_campaign_recipients WHERE user_id=? AND operation_id=? AND state!='succeeded') THEN 1 ELSE 0 END FROM credit_accounts a WHERE a.user_id=? AND EXISTS(SELECT 1 FROM credit_campaign_recipients WHERE user_id=? AND operation_id=?)").bind(tag,userId,userId,userId,tag,userId,userId,tag),
 env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(tag)
 ];
}
