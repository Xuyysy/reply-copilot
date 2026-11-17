import type {Env} from './types';
import {ApiFailure} from './types';
import {requireAdminSession} from './admin-auth';
import {operation,commitOperation} from './admin-operations';
import {activityPredicate} from './campaigns';
import {jsonBody} from './security';
import {response} from './http';
import {ADMIN_USER_DIRECTORY_SELECT} from './admin-user-directory-queries.js';
export function userFilters(request:Request){
 const p=new URL(request.url).searchParams,q=(p.get('q')??'').trim().slice(0,100),where=["(?='' OR instr(lower(u.email),lower(?))>0 OR instr(lower(COALESCE(u.username,'')),lower(?))>0 OR instr(lower(u.id),lower(?))>0)"],args:(string|number)[]=[q,q,q,q];
 for(const [key,operator] of [['registeredFrom','>='],['registeredTo','<=']] as const){const v=p.get(key);if(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw new ApiFailure(400,'INVALID_FILTER','时间筛选无效。');where.push(`u.created_at${operator}?`);args.push(n);}}
 const since=p.get('activeSince');if(since){const n=Number(since);if(!Number.isSafeInteger(n)||n<0)throw new ApiFailure(400,'INVALID_FILTER','时间筛选无效。');where.push(activityPredicate);args.push(n,n,n);}
 const paid=p.get('paid');if(paid==='paid'||paid==='unpaid'){
  // Include verified subscription purchases; local_mock never proves real payment.
  // Do not equate a pending order, local mock or a remaining credit balance with a paid customer.
  const paidProof = "(EXISTS(SELECT 1 FROM recharge_orders o WHERE o.user_id=u.id AND o.credited_at IS NOT NULL) " +
    "OR EXISTS(SELECT 1 FROM subscription_orders so JOIN subscription_payment_transactions st ON st.order_id=so.id " +
    "WHERE so.user_id=u.id AND so.status='paid' AND so.paid_at IS NOT NULL AND so.applied_at IS NOT NULL " +
    "AND st.status='paid' AND st.paid_at IS NOT NULL AND st.risk_state='clear' " +
    "AND st.currency='CNY' AND st.amount_fen=so.amount_fen AND st.merchant_provider IN ('mk99','xiaodou') " +
    "AND EXISTS(SELECT 1 FROM subscription_payment_events se WHERE se.transaction_id=st.id " +
    "AND se.merchant_provider=st.merchant_provider AND se.event_type='PAYMENT_SUCCEEDED' " +
    "AND se.amount_fen=so.amount_fen AND se.body_sha256 IS NOT NULL)))";
  where.push(paid==='unpaid'?'NOT '+paidProof:paidProof);
}
 return {where:where.join(' AND '),args};
}
export async function filteredUsers(request:Request,env:Env){
 await requireAdminSession(request,env);
 const f=userFilters(request);
 // Use an indexable, LIMIT-bounded directory projection. Avoid computing
 // lifetime scans for every row on every admin dashboard refresh.
 const rows=await env.DB.prepare(`${ADMIN_USER_DIRECTORY_SELECT} WHERE ${f.where}
   ORDER BY u.created_at DESC,u.id LIMIT 200`).bind(...f.args).all();
 return response({users:rows.results,perUserStats:'detail_only'},200,env,request);
}
export async function saveUserNote(request:Request,env:Env,id:string){const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,5000);if(typeof body.note!=='string'||body.note.length>2000)throw new ApiFailure(400,'INVALID_NOTE','备注最多2000字。');const before=await env.DB.prepare('SELECT admin_note FROM users WHERE id=?').bind(id).first();if(!before)throw new ApiFailure(404,'USER_NOT_FOUND','用户不存在。');const op=await operation(env,actor,body,'user_note',id);await commitOperation(env,op,[env.DB.prepare('UPDATE users SET admin_note=? WHERE id=?').bind(body.note.trim(),id)],before,{note:body.note.trim()});return response({ok:true},200,env,request);}
function orderQuery(request:Request){const p=new URL(request.url).searchParams,q=(p.get('q')??'').trim().slice(0,100),status=p.get('status')??'',where=["(?='' OR instr(lower(o.id),lower(?))>0 OR instr(lower(u.email),lower(?))>0 OR instr(lower(COALESCE(t.provider_trade_id,'')),lower(?))>0)"],args:(string|number)[]=[q,q,q,q];if(status){if(!['paid','pending','unknown','failed','closed','refunded','awaiting_payment'].includes(status))throw new ApiFailure(400,'INVALID_FILTER','订单状态筛选无效。');where.push('COALESCE(t.status,o.status)=?');args.push(status==='awaiting_payment'?'pending':status);}return {where:where.join(' AND '),args};}
const orderSelect=`SELECT o.id,o.user_id,o.package_name,o.credits,o.amount_cents,o.status,o.credited_at,o.created_at,o.paid_at,u.email,CASE WHEN t.merchant_provider='mk99' THEN 'mk99' ELSE t.provider END provider,CASE WHEN t.merchant_provider='mk99' THEN 'mk99' ELSE t.payment_protocol END payment_protocol,t.amount_fen,t.currency payment_currency,t.status payment_status,(SELECT provider_code FROM payment_attempts a WHERE a.transaction_id=t.id ORDER BY a.attempt_number DESC LIMIT 1) latest_error_code FROM recharge_orders o JOIN users u ON u.id=o.user_id LEFT JOIN payment_transactions t ON t.order_id=o.id`;
export async function filteredOrders(request:Request,env:Env){await requireAdminSession(request,env);const f=orderQuery(request),rows=await env.DB.prepare(`${orderSelect} WHERE ${f.where} ORDER BY o.created_at DESC LIMIT 200`).bind(...f.args).all();return response({orders:rows.results},200,env,request);}
export async function adminOrderDetail(request:Request,env:Env,id:string){await requireAdminSession(request,env);const order=await env.DB.prepare(orderSelect+' WHERE o.id=?').bind(id).first();if(!order)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');const [events,attempts]=await Promise.all([
 env.DB.prepare('SELECT e.id,e.provider_event_id,e.event_type,e.amount_fen,e.currency,e.received_at created_at FROM provider_payment_events e JOIN payment_transactions t ON t.id=e.transaction_id WHERE t.order_id=? ORDER BY e.received_at DESC LIMIT 100').bind(id).all(),
 env.DB.prepare('SELECT a.id,a.attempt_number,a.state status,a.provider_code error_code,a.provider_request_id,a.created_at,a.updated_at FROM payment_attempts a JOIN payment_transactions t ON t.id=a.transaction_id WHERE t.order_id=? ORDER BY a.attempt_number DESC LIMIT 100').bind(id).all()
 ]);return response({order,events:events.results,attempts:attempts.results,reconciliation:'merchant_verification_required'},200,env,request);}
function csvCell(value:unknown):string{let s=value==null?'':String(value);if(/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export async function exportAdminCsv(request:Request,env:Env){const actor=await requireAdminSession(request,env);const p=new URL(request.url).searchParams,type=p.get('type'),ids=(p.get('ids')??'').split(',').filter(Boolean);if(!['users','orders'].includes(type??'')||!ids.length||ids.length>200||ids.some(id=>! /^[0-9a-f-]{36}$/i.test(id)))throw new ApiFailure(400,'INVALID_EXPORT','请选择最多200条记录。');const marks='SELECT value FROM json_each(?)';const cols=type==='users'?['id','email','username','status','created_at','free_balance','paid_balance']:['id','user_id','package_name','credits','amount_fen','payment_currency','status','payment_status','created_at','credited_at'];const query=type==='users'?`SELECT u.id,u.email,u.username,u.status,u.created_at,COALESCE(a.free_balance,0) free_balance,COALESCE(a.paid_balance,0) paid_balance FROM users u LEFT JOIN credit_accounts a ON a.user_id=u.id WHERE u.id IN (${marks})`:`${orderSelect} WHERE o.id IN (${marks})`;const rows=(await env.DB.prepare(query).bind(JSON.stringify(ids)).all<Record<string,unknown>>()).results;const csv='\uFEFF'+[cols.map(csvCell).join(','),...rows.map(row=>cols.map(col=>csvCell(row[col])).join(','))].join('\r\n');
 // Export is a read operation; audit contains only type/count, never exported personal data.
 await env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,after_json,created_at) VALUES(?,?,'csv_export',?,'管理员导出选中记录',?,?)").bind(crypto.randomUUID(),actor.user_id,type!,JSON.stringify({count:rows.length}),Date.now()).run();
 const out=response(null,200,env,request,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="reply-copilot-${type}.csv"`});return new Response(csv,{status:200,headers:out.headers});}
