import type {Env,Session} from "./types";
import {ApiFailure} from "./types";
import {requireCsrf,sessionFor} from "./auth";
import {jsonBody,nowMs,uuid} from "./security";
import {response} from "./http";
import {balance} from "./quota";

async function webAction(request:Request,env:Env):Promise<Session>{
  const {session,token}=await sessionFor(request,env);
  if(session.kind!=="web") throw new ApiFailure(403,"FORBIDDEN","请在官网登录。");
  await requireCsrf(request,env,token); return session;
}
function safeId(value:string):string{if(!/^[a-z0-9_-]{1,64}$/i.test(value))throw new ApiFailure(400,"INVALID_REQUEST","标识无效。");return value;}
export async function packages(request:Request,env:Env):Promise<Response>{
  const rows=await env.DB.prepare("SELECT id,name_zh,name_en,credits,price_cents,promo_price_cents,currency,sort_order FROM recharge_packages WHERE active=1 ORDER BY sort_order,id").all();
  return response({packages:rows.results,paymentAvailable:false},200,env,request);
}
export async function createOrder(request:Request,env:Env):Promise<Response>{
  const session=await webAction(request,env); const body=await jsonBody(request,1024); const packageId=safeId(String(body.packageId||""));
  const pkg=await env.DB.prepare("SELECT id,name_zh,credits,price_cents,promo_price_cents,currency FROM recharge_packages WHERE id=? AND active=1").bind(packageId).first<{id:string;name_zh:string;credits:number;price_cents:number;promo_price_cents:number|null;currency:string}>();
  if(!pkg)throw new ApiFailure(404,"PACKAGE_NOT_FOUND","套餐不存在或已下架。");
  // An order is only a quote snapshot. No payment channel is active and no credit is granted.
  const id=uuid(); const now=nowMs(); const amount=pkg.promo_price_cents??pkg.price_cents;
  await env.DB.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)").bind(id,session.user_id,pkg.id,pkg.name_zh,pkg.credits,amount,pkg.currency,now).run();
  return response({order:{id,packageName:pkg.name_zh,credits:pkg.credits,amountCents:amount,currency:pkg.currency,status:"pending",feeCents:null,totalCents:null},paymentAvailable:false,message:"支付尚未开放，订单不会扣款或发放额度。"},201,env,request);
}
export async function admin(request:Request,env:Env,write=false):Promise<Session>{
  const {session,token}=await sessionFor(request,env);
  if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","管理员需要网页登录。");
  const user=await env.DB.prepare("SELECT role,status FROM users WHERE id=?").bind(session.user_id).first<{role:string;status:string}>();
  if(user?.role!=="admin"||user.status!=="active")throw new ApiFailure(403,"FORBIDDEN","没有管理员权限。");
  if(!env.ADMIN_ACCESS_SECRET || env.ADMIN_ACCESS_SECRET.length<32)throw new ApiFailure(503,"ADMIN_NOT_CONFIGURED","管理员访问保护尚未配置。");
  const supplied=request.headers.get("X-Admin-Access")||"";
  const a=new TextEncoder().encode(supplied); const b=new TextEncoder().encode(env.ADMIN_ACCESS_SECRET);
  let difference=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a[i]||0)^(b[i]||0);
  if(difference)throw new ApiFailure(403,"ADMIN_CHALLENGE_REQUIRED","管理员安全口令无效。");
  if(write)await requireCsrf(request,env,token);
  return session;
}
export async function adminDashboard(request:Request,env:Env):Promise<Response>{
  await admin(request,env);const now=nowMs();const day=new Date(now).toISOString().slice(0,10);const month=day.slice(0,7);
  const [users,verified,todayUsers,todayAi,monthAi,grant,paidSpent,revenue,cost,errors,dailyCost,costSetting]=await Promise.all([
    env.DB.prepare("SELECT count(*) n FROM users").first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM users WHERE email_verified_at IS NOT NULL").first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM users WHERE created_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM ai_requests WHERE status='succeeded' AND completed_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT count(*) n FROM ai_requests WHERE status='succeeded' AND completed_at>=?").bind(Date.parse(`${month}-01T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(amount),0) n FROM credit_grants").first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(-sum(paid_delta),0) n FROM credit_ledger WHERE kind='generation_debit'").first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(amount_cents),0) n FROM recharge_orders WHERE status='paid' AND paid_at>=?").bind(Date.parse(`${month}-01T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(input_tokens),0) inputTokens,COALESCE(sum(output_tokens),0) outputTokens,COALESCE(sum(estimated_cost_micro_usd),0) costMicroUsd FROM ai_usage_costs WHERE created_at>=?").bind(Date.parse(`${month}-01T00:00:00Z`)).first(),
    env.DB.prepare("SELECT count(*) n FROM ai_requests WHERE status IN ('upstream_failed','uncertain') AND created_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT COALESCE(sum(estimated_cost_micro_usd),0) n FROM ai_usage_costs WHERE created_at>=?").bind(Date.parse(`${day}T00:00:00Z`)).first<{n:number}>(),
    env.DB.prepare("SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'").first<{value:string}>(),
  ]);
  const budgetLimitMicroUsd=Number(costSetting?.value||0),dailyCostMicroUsd=dailyCost?.n||0;
  return response({users:users?.n||0,verifiedUsers:verified?.n||0,todayUsers:todayUsers?.n||0,todayGenerations:todayAi?.n||0,monthGenerations:monthAi?.n||0,totalFreeGranted:grant?.n||0,paidCreditsSpent:paidSpent?.n||0,monthRevenueCents:revenue?.n||0,cost:cost||{inputTokens:0,outputTokens:0,costMicroUsd:0},dailyCostMicroUsd,budgetLimitMicroUsd,costWarning:budgetLimitMicroUsd>0&&dailyCostMicroUsd>=budgetLimitMicroUsd*0.8,circuitOpen:budgetLimitMicroUsd>0&&dailyCostMicroUsd>=budgetLimitMicroUsd,abnormalRequests:errors?.n||0},200,env,request);
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
  const kind=body.kind;const delta=body.delta;const reason=typeof body.reason==="string"?body.reason.trim():"";
  if((kind!=="free"&&kind!=="paid")||!Number.isInteger(delta)||Math.abs(Number(delta))>10000||delta===0||reason.length<8||reason.length>500||body.confirm!==true)throw new ApiFailure(400,"INVALID_ADJUSTMENT","调整需要类型、非零次数、原因和二次确认。");
  const before=await balance(env,userId);const next=kind==="free"?before.freeRemaining+Number(delta):before.paidRemaining+Number(delta);
  if(next<0)throw new ApiFailure(409,"INSUFFICIENT_CREDITS","余额不足。");
  const now=nowMs();const reference=uuid();
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE credit_accounts SET ${kind==="free"?"free_balance":"paid_balance"}=${kind==="free"?"free_balance":"paid_balance"}+?,version=version+1,last_adjustment_ref=?,updated_at=? WHERE user_id=? AND ${kind==="free"?"free_balance":"paid_balance"}+?>=0`).bind(delta,reference,now,userId,delta),
    env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at) SELECT ?,?,'admin_adjustment',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND last_adjustment_ref=?)`).bind(uuid(),userId,kind==="free"?delta:0,kind==="paid"?delta:0,reference,actor.user_id,reason,now,userId,reference),
    env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at) SELECT ?,?,'credit_adjustment',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND last_adjustment_ref=?)").bind(uuid(),actor.user_id,userId,reason,JSON.stringify(before),JSON.stringify({kind,delta}),now,userId,reference),
  ]);
  if(results[0].meta.changes!==1)throw new ApiFailure(409,"ADJUSTMENT_FAILED","额度调整未完成。");
  return response({ok:true,quota:await balance(env,userId)},200,env,request);
}
export async function adminPackages(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({packages:(await env.DB.prepare("SELECT * FROM recharge_packages ORDER BY sort_order,id").all()).results},200,env,request);}
export async function adminPackageUpdate(request:Request,env:Env,id:string):Promise<Response>{
  const actor=await admin(request,env,true);const body=await jsonBody(request,2048);
  const credits=Number(body.credits),price=Number(body.priceCents),promo=body.promoPriceCents===null?null:Number(body.promoPriceCents),active=body.active===true?1:0,sort=Number(body.sortOrder);
  const nameZh=typeof body.nameZh==="string"?body.nameZh.trim():"";const nameEn=typeof body.nameEn==="string"?body.nameEn.trim():"";
  if(!Number.isInteger(credits)||credits<1||credits>100000||!Number.isInteger(price)||price<0||price>1000000||(promo!==null&&(!Number.isInteger(promo)||promo<0||promo>price))||!Number.isInteger(sort)||nameZh.length<1||nameZh.length>80||nameEn.length<1||nameEn.length>80)throw new ApiFailure(400,"INVALID_PACKAGE","套餐信息无效。");
  const before=await env.DB.prepare("SELECT * FROM recharge_packages WHERE id=?").bind(id).first();if(!before)throw new ApiFailure(404,"PACKAGE_NOT_FOUND","套餐不存在。");
  const now=nowMs();await env.DB.batch([
    env.DB.prepare("UPDATE recharge_packages SET name_zh=?,name_en=?,credits=?,price_cents=?,promo_price_cents=?,active=?,sort_order=?,updated_at=? WHERE id=?").bind(nameZh,nameEn,credits,price,promo,active,sort,now,id),
    env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at) VALUES(?,?,'package_update',?,'管理员修改套餐',?,?,?)").bind(uuid(),actor.user_id,id,JSON.stringify(before),JSON.stringify(body),now),
  ]);return response({ok:true},200,env,request);
}
export async function adminOrders(request:Request,env:Env):Promise<Response>{await admin(request,env);return response({orders:(await env.DB.prepare("SELECT recharge_orders.*,users.email FROM recharge_orders JOIN users ON users.id=recharge_orders.user_id ORDER BY recharge_orders.created_at DESC LIMIT 100").all()).results},200,env,request);}
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

export async function settleMockOrder(request:Request,env:Env,orderId:string):Promise<Response>{
  const actor=await admin(request,env,true);
  if(env.ENVIRONMENT!=="development"||env.AI_MOCK!=="1"||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.WEB_ORIGIN))throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  const body=await jsonBody(request,1024);
  const eventId=typeof body.eventId==="string"&&/^[a-zA-Z0-9_-]{8,80}$/.test(body.eventId)?body.eventId:"";
  const amount=body.amountCents;const currency=body.currency;
  if(!eventId||!Number.isInteger(amount)||currency!=="USD")throw new ApiFailure(400,"INVALID_PAYMENT","模拟付款数据无效。");
  const order=await env.DB.prepare("SELECT user_id,credits,amount_cents,currency,status,credited_at FROM recharge_orders WHERE id=?").bind(orderId).first<{user_id:string;credits:number;amount_cents:number;currency:string;status:string;credited_at:number|null}>();
  if(!order)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  if(order.amount_cents!==amount||order.currency!==currency)throw new ApiFailure(409,"PAYMENT_MISMATCH","支付金额或币种与订单不符。");
  if(order.status==="paid"&&order.credited_at)return response({ok:true,alreadyProcessed:true,quota:await balance(env,order.user_id)},200,env,request);
  if(order.status!=="pending"&&order.status!=="awaiting_payment")throw new ApiFailure(409,"ORDER_NOT_PAYABLE","订单状态不可支付。");
  const now=nowMs();const paymentEventId=uuid();
  const results=await env.DB.batch([
    env.DB.prepare("INSERT INTO payment_events(id,order_id,provider,provider_event_id,event_type,amount_cents,currency,received_at) SELECT ?,?,'local_mock',?,'paid',?,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_events WHERE provider='local_mock' AND provider_event_id=?) ON CONFLICT(provider,provider_event_id) DO NOTHING").bind(paymentEventId,orderId,eventId,amount,currency,now,eventId),
    env.DB.prepare("UPDATE recharge_orders SET status='paid',payment_method='local_mock',provider_reference=?,fee_cents=0,total_cents=amount_cents,paid_at=? WHERE id=? AND status IN ('pending','awaiting_payment') AND EXISTS(SELECT 1 FROM payment_events WHERE id=?)").bind(eventId,now,orderId,paymentEventId),
    env.DB.prepare("UPDATE credit_accounts SET paid_balance=paid_balance+?,version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND status='paid' AND credited_at IS NULL AND provider_reference=?)").bind(order.credits,now,order.user_id,orderId,eventId),
    env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) SELECT ?,?,'purchase_grant',0,?,?,? WHERE EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND status='paid' AND credited_at IS NULL AND provider_reference=?) ON CONFLICT(kind,reference_id) DO NOTHING").bind(uuid(),order.user_id,order.credits,orderId,now,orderId,eventId),
    env.DB.prepare("UPDATE recharge_orders SET credited_at=? WHERE id=? AND status='paid' AND credited_at IS NULL AND provider_reference=?").bind(now,orderId,eventId),
    env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,after_json,created_at) SELECT ?,?,'local_mock_payment',?,'仅本地测试模拟到账',?,? WHERE EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND provider_reference=?)").bind(uuid(),actor.user_id,orderId,JSON.stringify({eventId,amount,currency}),now,orderId,eventId),
  ]);
  if(results[0].meta.changes!==1||results[1].meta.changes!==1||results[2].meta.changes!==1||results[3].meta.changes!==1||results[4].meta.changes!==1)throw new ApiFailure(409,"PAYMENT_NOT_CONFIRMED","模拟付款未完成，额度未发放。");
  return response({ok:true,quota:await balance(env,order.user_id)},200,env,request);
}
