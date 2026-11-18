import {adminHistoricalStats} from "./admin-historical-stats";
import {RECENT_LEDGER_SQL,USER_USAGE_SQL,GENERATION_TOTALS_SQL} from "./admin-read-queries.js";
import {ADMIN_EXACT_GENERATIONS_SQL} from './admin-user-directory-queries.js';
import {operation,commitOperation} from "./admin-operations";
import {projectPackagePricing} from "./pricing";
import type {Env,Session} from "./types";
import {ApiFailure} from "./types";
import {jsonBody,nowMs,uuid} from "./security";
import {response} from "./http";
import {balance} from "./quota";
import {requireAdminSession} from "./admin-auth";
import {aiCostDetails} from "./ai-cost-dashboard";
export async function admin(request:Request,env:Env,write=false):Promise<Session>{
  return requireAdminSession(request,env,write);
}
export async function adminDashboard(request:Request,env:Env):Promise<Response>{
  await admin(request,env);const now=nowMs();const day=new Date(now).toISOString().slice(0,10);const month=day.slice(0,7);
  const view=new URL(request.url).searchParams.get('view');
  // Historical bookkeeping is collapsed in the operator UI. Never scan the
  // full credit ledger, grants and lifetime orders until an admin expands it.
  // Keep the original full response for legacy callers without a view.
  if(view==='history')return response(await adminHistoricalStats(env,now,day),200,env,request);
  // Exact month/today ACK counts still scan delivered rows even with 0021's
  // partial index. Keep legacy full API; defer only known UI overview/cost.
  if(view==='generations'){
    const dayStart=Date.parse(day+'T00:00:00Z'),monthStart=Date.parse(month+'-01T00:00:00Z');
    const exact=await env.DB.prepare(GENERATION_TOTALS_SQL).bind(dayStart,monthStart,now).first<{monthGenerations:number;todayGenerations:number}>();
    return response({todayGenerations:Number(exact?.todayGenerations||0),monthGenerations:Number(exact?.monthGenerations||0)},200,env,request);
  }
  const summaryOnly=view==='overview';
  const deferHistory=summaryOnly||view==='cost';
  const deferGenerationTotals=summaryOnly||view==='cost';
  const dayStart=Date.parse(`${day}T00:00:00Z`),monthStart=Date.parse(`${month}-01T00:00:00Z`);
  const [history,generations,revenue,legacyRevenue,errors,settings,budget,activeUsers,recentAudits,modelCosts]=await Promise.all([
    deferHistory
      ? env.DB.prepare("SELECT COUNT(*) newUsers7d FROM users WHERE created_at>=?").bind(now-7*86400000).first<{newUsers7d:number}>()
      : adminHistoricalStats(env,now,day),
    deferGenerationTotals?Promise.resolve(null):env.DB.prepare(GENERATION_TOTALS_SQL).bind(dayStart,monthStart,now).first<{monthGenerations:number;todayGenerations:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(t.amount_fen-COALESCE((SELECT sum(r.amount_fen) FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status='succeeded'),0)),0) n FROM payment_transactions t WHERE t.provider='xiaodou' AND t.status IN ('paid','refunded') AND t.paid_at>=?").bind(monthStart).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(amount_cents),0) n FROM recharge_orders WHERE status='paid' AND paid_at>=? AND NOT EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=recharge_orders.id)").bind(monthStart).first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM ai_requests WHERE status IN ('upstream_failed','uncertain') AND created_at>=?").bind(dayStart).first<{n:number}>(),
    env.DB.prepare("SELECT key,value FROM system_settings WHERE key IN ('daily_cost_limit_micro_usd','ai_enabled')").all<{key:string;value:string}>(),
    env.DB.prepare("SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days WHERE budget_day=?").bind(day).first<{reserved_micro_usd:number;settled_micro_usd:number}>(),
    env.DB.prepare("SELECT count(DISTINCT s.user_id) n FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>? AND s.revoked_at IS NULL AND u.status='active'").bind(now).first<{n:number}>(),
    env.DB.prepare("SELECT id,actor_user_id,action,target_id,reason,created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 10").all(),
    summaryOnly?Promise.resolve(null):aiCostDetails(env,env.AI_MODE || (env.AI_MOCK==="1"?"mock":"unconfigured"),dayStart,monthStart),
  ]);
  const settingsMap=new Map(settings.results.map(row=>[row.key,row.value]));
  const costSetting={value:settingsMap.get('daily_cost_limit_micro_usd')},aiEnabled={value:settingsMap.get('ai_enabled')};
  const budgetLimitMicroUsd=Number(costSetting?.value||0),
    dailyCostMicroUsd=budget?.settled_micro_usd??modelCosts?.todayCost.costMicroUsd??0,
    reservedCostMicroUsd=budget?.reserved_micro_usd||0,committed=dailyCostMicroUsd+reservedCostMicroUsd;
  return response({...history,activeUsers:activeUsers?.n||0,recentAudits:recentAudits.results,
    ...(generations?{todayGenerations:Number(generations.todayGenerations||0),monthGenerations:Number(generations.monthGenerations||0)}:{}),
    monthRevenueCents:legacyRevenue?.n||0,monthRevenueFen:revenue?.n||0,
    ...(modelCosts?{cost:modelCosts.cost,todayCost:modelCosts.todayCost}:{}),
    dailyCostMicroUsd,reservedCostMicroUsd,budgetLimitMicroUsd,remainingBudgetMicroUsd:Math.max(0,budgetLimitMicroUsd-committed),budgetDay:day,
    budgetUsedPercent:budgetLimitMicroUsd>0?Math.min(100,Math.round(committed/budgetLimitMicroUsd*100)):null,
    costWarning:budgetLimitMicroUsd>0&&committed>=budgetLimitMicroUsd*0.8,circuitOpen:budgetLimitMicroUsd>0&&committed>=budgetLimitMicroUsd,
    abnormalRequests:errors?.n||0,detailScope:summaryOnly?'overview':'full',
    ...(modelCosts?{costByModel:modelCosts.costByModel,aiService:{enabled:aiEnabled?.value==="1",...modelCosts.service}}:{})},200,env,request);
}
export async function adminUsers(request:Request,env:Env):Promise<Response>{
  await admin(request,env);const search=(new URL(request.url).searchParams.get("q")||"").trim().slice(0,100);
  const rows=await env.DB.prepare("SELECT users.id,username,email,email_verified_at,users.created_at,status,role,is_test_account,archived_at,COALESCE(free_balance,0) free_balance,COALESCE(paid_balance,0) paid_balance,(SELECT count(*) FROM ai_requests WHERE user_id=users.id AND status='succeeded') generations FROM users LEFT JOIN credit_accounts ON credit_accounts.user_id=users.id WHERE ?='' OR username LIKE ? OR email LIKE ? OR users.id LIKE ? ORDER BY users.created_at DESC LIMIT 100").bind(search,`%${search}%`,`%${search}%`,`%${search}%`).all();
  return response({users:rows.results},200,env,request);
}
export async function adminUserStatus(request:Request,env:Env,userId:string):Promise<Response>{
 return changeStatus(request,env,[userId]);
}
async function changeStatus(request:Request,env:Env,ids?:string[]):Promise<Response>{
 const actor=await admin(request,env,true),body=await jsonBody(request,10000),status=body.status;
 const userIds=ids??body.userIds;
 if(!Array.isArray(userIds)||!userIds.length||userIds.length>200||userIds.some(id=>typeof id!=="string"||id.length>64)||new Set(userIds).size!==userIds.length||(status!=="active"&&status!=="frozen"))throw new ApiFailure(400,"INVALID_STATUS","账户或状态无效。");
 if(userIds.includes(actor.user_id))throw new ApiFailure(400,"SELF_MODIFICATION_DENIED","不能冻结或归档管理员自身。");
 const op=await operation(env,actor,body,"user_status",[...userIds].sort().join(","));
 if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 const before=(await env.DB.prepare("SELECT id,status FROM users WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(userIds)).all()).results;
 if(before.length!==userIds.length)throw new ApiFailure(404,"USER_NOT_FOUND","账户不存在。");
 await commitOperation(env,op,[env.DB.prepare("UPDATE users SET status=?,archived_at=CASE WHEN ?='active' THEN NULL ELSE archived_at END WHERE id IN (SELECT value FROM json_each(?))").bind(status,status,JSON.stringify(userIds))],before,{userIds,status});
 return response({ok:true},200,env,request);
}
export async function adminBulkStatus(request:Request,env:Env):Promise<Response>{return changeStatus(request,env);}
export async function adminAdjust(request:Request,env:Env,userId:string):Promise<Response>{
  const actor=await admin(request,env,true);const body=await jsonBody(request,1024);
  const kind=body.kind;const delta=Number(body.delta);const reason=typeof body.reason==="string"?body.reason.trim():"";
  if((kind!=="free"&&kind!=="paid")||!Number.isInteger(delta)||Math.abs(Number(delta))>10000||delta===0||reason.length<8||reason.length>500||body.confirm!==true)throw new ApiFailure(400,"INVALID_ADJUSTMENT","调整需要类型、非零次数、原因和二次确认。");
  const op=await operation(env,actor,body,"credit_adjustment",userId);
  if(op.replayed)return response({ok:true,replayed:true,quota:await balance(env,userId)},200,env,request);
  const account=await env.DB.prepare("SELECT version FROM credit_accounts WHERE user_id=?").bind(userId).first<{version:number}>();
  if(!account)throw new ApiFailure(404,"USER_NOT_FOUND","账户不存在。");
  const before=await balance(env,userId);const next=kind==="free"?before.freeRemaining+Number(delta):before.paidRemaining+Number(delta);
  if(next<0)throw new ApiFailure(409,"INSUFFICIENT_CREDITS","余额不足。");
  const now=nowMs(),reference=op.id,statements:D1PreparedStatement[]=[];
  if(delta<0){
    let remaining=-Number(delta);
    const lots=await env.DB.prepare("SELECT id,remaining_credits,generation_reserved_credits,refund_reserved_credits FROM credit_batches WHERE user_id=? AND bucket=? AND remaining_credits-generation_reserved_credits-refund_reserved_credits>0 ORDER BY CASE source_kind WHEN 'legacy_paid' THEN 0 WHEN 'purchase' THEN 1 ELSE 2 END,COALESCE(paid_at,granted_at),granted_at,id").bind(userId,kind).all<{id:string;remaining_credits:number;generation_reserved_credits:number;refund_reserved_credits:number}>();
    for(const lot of lots.results){if(remaining<=0)break;const take=Math.min(remaining,lot.remaining_credits-lot.generation_reserved_credits-lot.refund_reserved_credits);if(take>0){statements.push(env.DB.prepare("UPDATE credit_batches SET remaining_credits=remaining_credits-?,permanently_revoked_credits=permanently_revoked_credits+? WHERE id=? AND remaining_credits-generation_reserved_credits-refund_reserved_credits>=?").bind(take,take,lot.id,take));remaining-=take;}}
    if(remaining>0)throw new ApiFailure(409,"INSUFFICIENT_CREDITS","可用额度不足，无法完成调整。");
  }
  statements.push(env.DB.prepare(`UPDATE credit_accounts SET ${kind==="free"?"free_balance":"paid_balance"}=${kind==="free"?"free_balance":"paid_balance"}+?,version=version+1,last_adjustment_ref=?,updated_at=? WHERE user_id=? AND version=? AND ${kind==="free"?"free_balance":"paid_balance"}+?>=${kind==="paid"?"paid_reserved_for_refunds+paid_generation_reserved":"free_generation_reserved"}`).bind(delta,reference,now,userId,account.version,delta));
  if(delta>0)statements.push(env.DB.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,history_confidence,status) SELECT ?,?,?, 'admin_adjustment',?,?,0,0,0,0,?,'tracked','active' WHERE EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND last_adjustment_ref=?)").bind(uuid(),userId,kind,delta,delta,now,userId,reference));
  statements.push(
    env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at) SELECT ?,?,'admin_adjustment',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND last_adjustment_ref=?)`).bind(uuid(),userId,kind==="free"?delta:0,kind==="paid"?delta:0,reference,actor.user_id,reason,now,userId,reference),
    env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM credit_accounts a WHERE a.user_id=? AND a.last_adjustment_ref=? AND EXISTS(SELECT 1 FROM credit_ledger WHERE reference_id=? AND kind='admin_adjustment') AND a.free_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='free') AND a.paid_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid')) THEN 1 ELSE 0 END`).bind(reference,userId,reference,reference,userId,userId),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(reference),
  );
  await commitOperation(env,op,statements,before,{kind,delta});
  return response({ok:true,quota:await balance(env,userId)},200,env,request);
}
export async function adminPackages(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({packages:(await env.DB.prepare("SELECT * FROM recharge_packages ORDER BY sort_order,id").all()).results},200,env,request);}
export async function adminPackageUpdate(request:Request,env:Env,id:string):Promise<Response>{return savePackage(request,env,id,false);}
export async function adminPackageCreate(request:Request,env:Env):Promise<Response>{return savePackage(request,env,"",true);}
async function savePackage(request:Request,env:Env,id:string,create:boolean):Promise<Response>{
 const actor=await admin(request,env,true),body=await jsonBody(request,20000);
 if(create)id=typeof body.id==="string"?body.id:"";
 if(!/^[a-z0-9_-]{1,64}$/.test(id))throw new ApiFailure(400,"INVALID_PACKAGE","套餐ID无效。");
 const credits=Number(body.credits),price=Number(body.priceCents),promo=body.promoPriceCents==null||body.promoPriceCents===""?null:Number(body.promoPriceCents),cny=body.priceCnyFen==null||body.priceCnyFen===""?null:Number(body.priceCnyFen),sort=Number(body.sortOrder),fee=Number(body.feeRateBps??150),fx=body.exchangeRateMicros==null||body.exchangeRateMicros===""?null:Number(body.exchangeRateMicros),mode=body.settlementMode??"fixed_cny";
 const zh=typeof body.nameZh==="string"?body.nameZh.trim():"",en=typeof body.nameEn==="string"?body.nameEn.trim():"",dzh=typeof body.descriptionZh==="string"?body.descriptionZh.trim():"",den=typeof body.descriptionEn==="string"?body.descriptionEn.trim():"";
 if(!Number.isSafeInteger(credits)||credits<1||credits>100000||!Number.isSafeInteger(price)||price<1||price>1000000||(promo!==null&&(!Number.isSafeInteger(promo)||promo<1||promo>price))||!Number.isSafeInteger(sort)||Math.abs(sort)>10000||!zh||zh.length>80||!en||en.length>80||dzh.length>2000||den.length>2000||!Number.isInteger(fee)||fee<0||fee>3000||!["fixed_cny","usd_exchange"].includes(String(mode)))throw new ApiFailure(400,"INVALID_PACKAGE","套餐信息无效。");
 if((cny!==null&&(!Number.isSafeInteger(cny)||cny<1||cny>10000000))||(fx!==null&&(!Number.isSafeInteger(fx)||fx<1||fx>1000000000)))throw new ApiFailure(400,"INVALID_PACKAGE","结算金额或汇率超出允许范围。");
 const projected=projectPackagePricing({price_cents:price,promo_price_cents:promo,price_cny_fen:cny,settlement_mode:String(mode),exchange_rate_micros:fx,fee_rate_bps:fee});
 if(projected.totalPaymentFen>10000000)throw new ApiFailure(400,"INVALID_PACKAGE","套餐支付金额过高。");
 const labelZh=typeof body.recommendedLabelZh==='string'?body.recommendedLabelZh.trim():'',labelEn=typeof body.recommendedLabelEn==='string'?body.recommendedLabelEn.trim():'';
 if(labelZh.length>50||labelEn.length>50)throw new ApiFailure(400,"INVALID_PACKAGE","推荐标签最多50字。");
 const op=await operation(env,actor,body,create?"package_create":"package_update",id);if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 const before=await env.DB.prepare("SELECT * FROM recharge_packages WHERE id=?").bind(id).first();
 if(create?Boolean(before):!before)throw new ApiFailure(409,"PACKAGE_CONFLICT","套餐不存在或ID已被使用。");
 const now=nowMs(),values=[zh,en,credits,price,promo,cny,body.active===true?1:0,sort,dzh,den,mode,fx,fee,now];
 const statement=create?env.DB.prepare("INSERT INTO recharge_packages(name_zh,name_en,credits,price_cents,promo_price_cents,price_cny_fen,active,sort_order,description_zh,description_en,settlement_mode,exchange_rate_micros,fee_rate_bps,updated_at,id,currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'USD')").bind(...values,id):env.DB.prepare("UPDATE recharge_packages SET name_zh=?,name_en=?,credits=?,price_cents=?,promo_price_cents=?,price_cny_fen=?,active=?,sort_order=?,description_zh=?,description_en=?,settlement_mode=?,exchange_rate_micros=?,fee_rate_bps=?,updated_at=? WHERE id=?").bind(...values,id);
 await commitOperation(env,op,[statement,env.DB.prepare("UPDATE recharge_packages SET recommended_label_zh=?,recommended_label_en=?,featured=? WHERE id=?").bind(labelZh,labelEn,body.featured===true?1:0,id)],before,{id,...body});return response({ok:true},200,env,request);
}
export async function adminOrders(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({orders:(await env.DB.prepare("SELECT o.*,u.email,t.amount_fen,t.currency payment_currency,CASE WHEN t.merchant_provider='mk99' THEN 'mk99' ELSE t.provider END provider,t.status payment_status,t.provider_fee_projection_status,t.provider_fee_projection_issue FROM recharge_orders o JOIN users u ON u.id=o.user_id LEFT JOIN payment_transactions t ON t.order_id=o.id ORDER BY o.created_at DESC LIMIT 100").all()).results},200,env,request);}
export async function adminSettings(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({settings:(await env.DB.prepare("SELECT key,value FROM system_settings WHERE key IN ('signup_grant','registration_enabled','ai_enabled','daily_cost_limit_micro_usd','announcement') ORDER BY key").all()).results},200,env,request);}
export async function adminSettingUpdate(request:Request,env:Env,key:string):Promise<Response>{
  const actor=await admin(request,env,true);const body=await jsonBody(request,1024);const value=String(body.value??"");
  const numeric:{[key:string]:[number,number]}={signup_grant:[1,1000],registration_enabled:[0,1],ai_enabled:[0,1],daily_cost_limit_micro_usd:[1,1000000000]};
  if(!(key in numeric)&&key!=="announcement")throw new ApiFailure(400,"INVALID_SETTING","设置项无效。");
  if(key==="announcement"?value.length>500:(!/^\d+$/.test(value)||Number(value)<numeric[key][0]||Number(value)>numeric[key][1]))throw new ApiFailure(400,"INVALID_SETTING","设置值无效。");
  const op=await operation(env,actor,body,"setting_update",key),before=await env.DB.prepare("SELECT value FROM system_settings WHERE key=?").bind(key).first();
  if(!before)throw new ApiFailure(404,"NOT_FOUND","设置项不存在。");
  await commitOperation(env,op,[env.DB.prepare("UPDATE system_settings SET value=?,updated_at=?,updated_by=? WHERE key=?").bind(value,nowMs(),actor.user_id,key)],before,{value});return response({ok:true},200,env,request);
}
export async function adminLedger(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({ledger:(await env.DB.prepare(RECENT_LEDGER_SQL).all()).results},200,env,request);}

export async function adminAudits(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({audits:(await env.DB.prepare("SELECT id,actor_user_id,action,target_id,reason,created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100").all()).results},200,env,request);}
export async function adminUserDetail(request:Request,env:Env,userId:string):Promise<Response>{
 await admin(request,env);
 const view=new URL(request.url).searchParams.get('view');
 // For existing callers, no view still returns the original exact count.
 if(view==='generations'){
   const exists=await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(userId).first();
   if(!exists)throw new ApiFailure(404,'USER_NOT_FOUND','账户不存在。');
   const exact=await env.DB.prepare(ADMIN_EXACT_GENERATIONS_SQL).bind(userId).first<{generations:number}>();
   return response({generations:Number(exact?.generations||0)},200,env,request);
 }
 const light=view==='light';
 const user=await env.DB.prepare("SELECT id,email,username,status,role,created_at,is_test_account,archived_at,admin_note,(SELECT max(ts) FROM (SELECT max(s.created_at) ts FROM sessions s WHERE s.user_id=users.id UNION ALL SELECT max(r.created_at) FROM ai_requests r WHERE r.user_id=users.id UNION ALL SELECT max(o.paid_at) FROM recharge_orders o WHERE o.user_id=users.id)) last_active_at FROM users WHERE id=?").bind(userId).first();if(!user)throw new ApiFailure(404,"USER_NOT_FOUND","账户不存在。");
 const [orders,ledger,usage,exact]=await Promise.all([env.DB.prepare("SELECT id,package_name,credits,amount_cents,status,created_at FROM recharge_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(userId).all(),env.DB.prepare("SELECT id,kind,free_delta,paid_delta,reference_id,reason,created_at FROM credit_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(userId).all(),env.DB.prepare(USER_USAGE_SQL).bind(userId).all(),light?Promise.resolve(null):env.DB.prepare(ADMIN_EXACT_GENERATIONS_SQL).bind(userId).first<{generations:number}>()]);
 return response({user:{...user,generations:light?null:Number(exact?.generations||0)},quota:await balance(env,userId),orders:orders.results,ledger:ledger.results,usage:usage.results},200,env,request);
}
export async function adminTestAccount(request:Request,env:Env,userId:string,archive=false):Promise<Response>{
 const actor=await admin(request,env,true),body=await jsonBody(request,2048);if(userId===actor.user_id)throw new ApiFailure(400,"SELF_MODIFICATION_DENIED","不能将管理员归档为测试账户。");
 const before=await env.DB.prepare("SELECT id,is_test_account,status,archived_at FROM users WHERE id=?").bind(userId).first<{id:string;is_test_account:number;status:string;archived_at:number|null}>();if(!before)throw new ApiFailure(404,"USER_NOT_FOUND","账户不存在。");
 const op=await operation(env,actor,body,archive?"user_archive":"mark_test_account",userId);if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 if(archive){if(before.is_test_account!==1)throw new ApiFailure(409,"NOT_TEST_ACCOUNT","请先明确标记为测试账户。");
 const payments=await env.DB.prepare("SELECT (SELECT count(*) FROM recharge_orders WHERE user_id=?) + (SELECT count(*) FROM subscription_orders WHERE user_id=?) n").bind(userId,userId).first<{n:number}>();if(payments?.n)throw new ApiFailure(409,"FINANCIAL_HISTORY_PROTECTED","存在支付或待核对订单，不能归档，请使用冻结功能保留全部记录。");}
 const statement=archive?env.DB.prepare("UPDATE users SET status='frozen',archived_at=? WHERE id=? AND is_test_account=1 AND NOT EXISTS(SELECT 1 FROM recharge_orders WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM subscription_orders WHERE user_id=?)").bind(nowMs(),userId,userId,userId):env.DB.prepare("UPDATE users SET is_test_account=? WHERE id=?").bind(body.isTestAccount===true?1:0,userId);
 const statements=[statement];
 if(archive){statements.push(env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=? AND archived_at IS NOT NULL AND status='frozen') AND NOT EXISTS(SELECT 1 FROM recharge_orders WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM subscription_orders WHERE user_id=?) THEN 1 ELSE 0 END").bind(op.id,userId,userId,userId),env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(op.id));}
 await commitOperation(env,op,statements,before,{archived:archive,isTestAccount:body.isTestAccount});return response({ok:true},200,env,request);
}
