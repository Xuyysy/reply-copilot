import type {Env,Session} from "./types";
import {ApiFailure} from "./types";
import {jsonBody,nowMs,uuid} from "./security";
import {response} from "./http";
import {balance} from "./quota";
import {requireAdminSession} from "./admin-auth";
import {DEEPSEEK_MODEL} from "./ai";
export async function admin(request:Request,env:Env,write=false):Promise<Session>{
  return requireAdminSession(request,env,write);
}
export async function adminDashboard(request:Request,env:Env):Promise<Response>{
  await admin(request,env);const now=nowMs();const day=new Date(now).toISOString().slice(0,10);const month=day.slice(0,7);
  const [users,verified,todayUsers,todayAi,monthAi,grant,paidSpent,revenue,legacyRevenue,cost,errors,dailyCost,costSetting,budget,aiEnabled,todayCost]=await Promise.all([
    env.DB.prepare("SELECT count(*) n FROM users").first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM users WHERE email_verified_at IS NOT NULL").first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM users WHERE created_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM ai_requests WHERE status='succeeded' AND completed_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM ai_requests WHERE status='succeeded' AND completed_at>=?").bind(Date.parse(`${month}-01T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(amount),0) n FROM credit_grants").first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(-sum(paid_delta),0) n FROM credit_ledger WHERE kind='generation_debit'").first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(t.amount_fen-COALESCE((SELECT sum(r.amount_fen) FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status='succeeded'),0)),0) n FROM payment_transactions t WHERE t.provider='xiaodou' AND t.status IN ('paid','refunded') AND t.paid_at>=?").bind(Date.parse(`${month}-01T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(amount_cents),0) n FROM recharge_orders WHERE status='paid' AND paid_at>=? AND NOT EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=recharge_orders.id)").bind(Date.parse(`${month}-01T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(input_tokens),0) inputTokens,COALESCE(sum(output_tokens),0) outputTokens,COALESCE(sum(estimated_cost_micro_usd),0) costMicroUsd FROM ai_usage_costs WHERE created_at>=?").bind(Date.parse(`${month}-01T00:00:00Z`)).first(),
    env.DB.prepare("SELECT count(*) n FROM ai_requests WHERE status IN ('upstream_failed','uncertain') AND created_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(estimated_cost_micro_usd),0) n FROM ai_usage_costs WHERE created_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'").first<{value:string}>(),
    env.DB.prepare("SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days WHERE budget_day=?").bind(day).first<{reserved_micro_usd:number;settled_micro_usd:number}>(),
    env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_enabled'").first<{value:string}>(),
    env.DB.prepare("SELECT COALESCE(sum(input_tokens),0) inputTokens,COALESCE(sum(output_tokens),0) outputTokens,COALESCE(sum(estimated_cost_micro_usd),0) costMicroUsd FROM ai_usage_costs WHERE created_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first(),
  ]);
  const budgetLimitMicroUsd=Number(costSetting?.value||0),dailyCostMicroUsd=budget?.settled_micro_usd??dailyCost?.n??0,reservedCostMicroUsd=budget?.reserved_micro_usd||0,committed=dailyCostMicroUsd+reservedCostMicroUsd;
  const displayedAiMode=env.AI_MODE || (env.AI_MOCK==="1"?"mock":"unconfigured");
  return response({users:users?.n||0,verifiedUsers:verified?.n||0,todayUsers:todayUsers?.n||0,todayGenerations:todayAi?.n||0,monthGenerations:monthAi?.n||0,totalFreeGranted:grant?.n||0,paidCreditsSpent:paidSpent?.n||0,monthRevenueCents:legacyRevenue?.n||0,monthRevenueFen:revenue?.n||0,cost:cost||{inputTokens:0,outputTokens:0,costMicroUsd:0},todayCost:todayCost||{inputTokens:0,outputTokens:0,costMicroUsd:0},dailyCostMicroUsd,reservedCostMicroUsd,budgetLimitMicroUsd,budgetUsedPercent:budgetLimitMicroUsd>0?Math.min(100,Math.round(committed/budgetLimitMicroUsd*100)):null,costWarning:budgetLimitMicroUsd>0&&committed>=budgetLimitMicroUsd*0.8,circuitOpen:budgetLimitMicroUsd>0&&committed>=budgetLimitMicroUsd,abnormalRequests:errors?.n||0,aiService:{enabled:aiEnabled?.value==="1",mode:displayedAiMode,provider:displayedAiMode==="mock"?"Mock AI":displayedAiMode==="unconfigured"?"未配置":"DeepSeek",model:displayedAiMode==="mock"?"mock":displayedAiMode==="unconfigured"?"—":DEEPSEEK_MODEL,keyConfigured:Boolean(env.DEEPSEEK_API_KEY)}},200,env,request);
}
export async function adminUsers(request:Request,env:Env):Promise<Response>{
  await admin(request,env);const search=(new URL(request.url).searchParams.get("q")||"").trim().slice(0,100);
  const rows=await env.DB.prepare("SELECT users.id,username,email,email_verified_at,users.created_at,status,role,COALESCE(free_balance,0) free_balance,COALESCE(paid_balance,0) paid_balance,(SELECT count(*) FROM ai_requests WHERE user_id=users.id AND status='succeeded') generations FROM users LEFT JOIN credit_accounts ON credit_accounts.user_id=users.id WHERE ?='' OR username LIKE ? OR email LIKE ? ORDER BY users.created_at DESC LIMIT 100").bind(search,`%${search}%`,`%${search}%`).all();
  return response({users:rows.results},200,env,request);
}
export async function adminUserStatus(request:Request,env:Env,userId:string):Promise<Response>{
  const actor=await admin(request,env,true);const body=await jsonBody(request,1024);const status=body.status;
  if(status!=="active"&&status!=="frozen")throw new ApiFailure(400,"INVALID_STATUS","状态无效。");
  if(actor.user_id===userId)throw new ApiFailure(400,"SELF_MODIFICATION_DENIED","不能修改自己的管理账户状态。");
  const before=await env.DB.prepare("SELECT status FROM users WHERE id=?").bind(userId).first<{status:string}>();
  if(!before)throw new ApiFailure(404,"USER_NOT_FOUND","账户不存在。");
  const now=nowMs();await env.DB.batch([
    env.DB.prepare("UPDATE users SET status=? WHERE id=?").bind(status,userId),
    env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at) VALUES(?,?,'user_status',?,?,?,?,?)").bind(uuid(),actor.user_id,userId,"管理员修改账户状态",JSON.stringify(before),JSON.stringify({status}),now),
  ]);
  return response({ok:true},200,env,request);
}
export async function adminAdjust(request:Request,env:Env,userId:string):Promise<Response>{
  const actor=await admin(request,env,true);const body=await jsonBody(request,1024);
  const kind=body.kind;const delta=Number(body.delta);const reason=typeof body.reason==="string"?body.reason.trim():"";
  if((kind!=="free"&&kind!=="paid")||!Number.isInteger(delta)||Math.abs(Number(delta))>10000||delta===0||reason.length<8||reason.length>500||body.confirm!==true)throw new ApiFailure(400,"INVALID_ADJUSTMENT","调整需要类型、非零次数、原因和二次确认。");
  const before=await balance(env,userId);const next=kind==="free"?before.freeRemaining+Number(delta):before.paidRemaining+Number(delta);
  if(next<0)throw new ApiFailure(409,"INSUFFICIENT_CREDITS","余额不足。");
  const now=nowMs(),reference=uuid(),statements=[];
  if(delta<0){
    let remaining=-Number(delta);
    const lots=await env.DB.prepare("SELECT id,remaining_credits,generation_reserved_credits,refund_reserved_credits FROM credit_batches WHERE user_id=? AND bucket=? AND remaining_credits-generation_reserved_credits-refund_reserved_credits>0 ORDER BY CASE source_kind WHEN 'legacy_paid' THEN 0 WHEN 'purchase' THEN 1 ELSE 2 END,COALESCE(paid_at,granted_at),granted_at,id").bind(userId,kind).all<{id:string;remaining_credits:number;generation_reserved_credits:number;refund_reserved_credits:number}>();
    for(const lot of lots.results){if(remaining<=0)break;const take=Math.min(remaining,lot.remaining_credits-lot.generation_reserved_credits-lot.refund_reserved_credits);if(take>0){statements.push(env.DB.prepare("UPDATE credit_batches SET remaining_credits=remaining_credits-?,permanently_revoked_credits=permanently_revoked_credits+? WHERE id=? AND remaining_credits-generation_reserved_credits-refund_reserved_credits>=?").bind(take,take,lot.id,take));remaining-=take;}}
    if(remaining>0)throw new ApiFailure(409,"INSUFFICIENT_CREDITS","可用额度不足，无法完成调整。");
  }
  statements.push(env.DB.prepare(`UPDATE credit_accounts SET ${kind==="free"?"free_balance":"paid_balance"}=${kind==="free"?"free_balance":"paid_balance"}+?,version=version+1,last_adjustment_ref=?,updated_at=? WHERE user_id=? AND ${kind==="free"?"free_balance":"paid_balance"}+?>=${kind==="paid"?"paid_reserved_for_refunds+paid_generation_reserved":"free_generation_reserved"}`).bind(delta,reference,now,userId,delta));
  if(delta>0)statements.push(env.DB.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,history_confidence,status) SELECT ?,?,?, 'admin_adjustment',?,?,0,0,0,0,?,'tracked','active' WHERE EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND last_adjustment_ref=?)").bind(uuid(),userId,kind,delta,delta,now,userId,reference));
  statements.push(
    env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at) SELECT ?,?,'admin_adjustment',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND last_adjustment_ref=?)`).bind(uuid(),userId,kind==="free"?delta:0,kind==="paid"?delta:0,reference,actor.user_id,reason,now,userId,reference),
    env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at) SELECT ?,?,'credit_adjustment',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND last_adjustment_ref=?)").bind(uuid(),actor.user_id,userId,reason,JSON.stringify(before),JSON.stringify({kind,delta}),now,userId,reference),
    env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM credit_accounts a WHERE a.user_id=? AND a.free_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='free') AND a.paid_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid')) THEN 1 ELSE 0 END`).bind(reference,userId,userId,userId),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(reference),
  );
  try{const results=await env.DB.batch(statements);if(results.at(-2)?.meta.changes!==1)throw new Error("credit reconciliation failed");}catch{throw new ApiFailure(409,"ADJUSTMENT_FAILED","额度调整未完成或额度账本需要核对。");}
  return response({ok:true,quota:await balance(env,userId)},200,env,request);
}
export async function adminPackages(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({packages:(await env.DB.prepare("SELECT * FROM recharge_packages ORDER BY sort_order,id").all()).results},200,env,request);}
export async function adminPackageUpdate(request:Request,env:Env,id:string):Promise<Response>{
  const actor=await admin(request,env,true);const body=await jsonBody(request,2048);
  const credits=Number(body.credits),price=Number(body.priceCents),promo=body.promoPriceCents===null?null:Number(body.promoPriceCents),priceCnyFen=body.priceCnyFen===null||body.priceCnyFen===""?null:Number(body.priceCnyFen),active=body.active===true?1:0,sort=Number(body.sortOrder);
  const nameZh=typeof body.nameZh==="string"?body.nameZh.trim():"";const nameEn=typeof body.nameEn==="string"?body.nameEn.trim():"";
  if(!Number.isInteger(credits)||credits<1||credits>100000||!Number.isInteger(price)||price<0||price>1000000||(promo!==null&&(!Number.isInteger(promo)||promo<0||promo>price))||(priceCnyFen!==null&&(!Number.isInteger(priceCnyFen)||priceCnyFen<1||priceCnyFen>10000000))||!Number.isInteger(sort)||nameZh.length<1||nameZh.length>80||nameEn.length<1||nameEn.length>80)throw new ApiFailure(400,"INVALID_PACKAGE","套餐信息无效。");
  const before=await env.DB.prepare("SELECT * FROM recharge_packages WHERE id=?").bind(id).first();if(!before)throw new ApiFailure(404,"PACKAGE_NOT_FOUND","套餐不存在。");
  const now=nowMs();await env.DB.batch([
    env.DB.prepare("UPDATE recharge_packages SET name_zh=?,name_en=?,credits=?,price_cents=?,promo_price_cents=?,price_cny_fen=?,active=?,sort_order=?,updated_at=? WHERE id=?").bind(nameZh,nameEn,credits,price,promo,priceCnyFen,active,sort,now,id),
    env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at) VALUES(?,?,'package_update',?,'管理员修改套餐',?,?,?)").bind(uuid(),actor.user_id,id,JSON.stringify(before),JSON.stringify(body),now),
  ]);return response({ok:true},200,env,request);
}
export async function adminOrders(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({orders:(await env.DB.prepare("SELECT o.*,u.email,t.amount_fen,t.currency payment_currency,t.provider,t.status payment_status,t.provider_fee_projection_status,t.provider_fee_projection_issue FROM recharge_orders o JOIN users u ON u.id=o.user_id LEFT JOIN payment_transactions t ON t.order_id=o.id ORDER BY o.created_at DESC LIMIT 100").all()).results},200,env,request);}
export async function adminSettings(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({settings:(await env.DB.prepare("SELECT key,value FROM system_settings ORDER BY key").all()).results},200,env,request);}
export async function adminSettingUpdate(request:Request,env:Env,key:string):Promise<Response>{
  const actor=await admin(request,env,true);const body=await jsonBody(request,1024);const value=String(body.value??"");
  const numeric:{[key:string]:[number,number]}={signup_grant:[1,1000],registration_enabled:[0,1],ai_enabled:[0,1],daily_cost_limit_micro_usd:[1,1000000000]};
  if(!(key in numeric)&&key!=="announcement")throw new ApiFailure(400,"INVALID_SETTING","设置项无效。");
  if(key==="announcement"?value.length>500:(!/^\d+$/.test(value)||Number(value)<numeric[key][0]||Number(value)>numeric[key][1]))throw new ApiFailure(400,"INVALID_SETTING","设置值无效。");
  const before=await env.DB.prepare("SELECT value FROM system_settings WHERE key=?").bind(key).first();const now=nowMs();
  await env.DB.batch([
    env.DB.prepare("UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key=?").bind(value,now,actor.user_id,key),
    env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at) VALUES(?,?,'setting_update',?,'管理员修改系统设置',?,?,?)").bind(uuid(),actor.user_id,key,JSON.stringify(before),JSON.stringify({value}),now),
  ]);return response({ok:true},200,env,request);
}
export async function adminLedger(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({ledger:(await env.DB.prepare("SELECT credit_ledger.*,users.email FROM credit_ledger JOIN users ON users.id=credit_ledger.user_id ORDER BY credit_ledger.created_at DESC LIMIT 100").all()).results},200,env,request);}
