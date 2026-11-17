import type {Env} from './types';
import {ApiFailure} from './types';
import {DEFAULT_MOMENTUM_CONFIG,validateMomentumConfig,createMomentumDay,selectMomentumReminder} from '../../domain/creator-momentum.js';
import {requireAdminSession} from './admin-auth';
import {operation,commitOperation} from './admin-operations';
import {jsonBody,nowMs} from './security';
import {takeRate} from './auth';
import {response} from './http';
import {subscriptionAccount} from './subscription-account';
const KEY='creator_momentum_v1';
type Row={value:string};
function parse(raw?:string){try{return validateMomentumConfig(JSON.parse(raw??''));}catch{return {...DEFAULT_MOMENTUM_CONFIG,enabled:false};}}
async function current(env:Env){const row=await env.DB.prepare('SELECT value FROM system_settings WHERE key=?').bind(KEY).first<Row>();return {row,config:parse(row?.value)};}
// Read-only purchase proof. No balance field is a purchase entitlement.
export async function creatorFeature(env:Env,userId:string){
 const row=await env.DB.prepare(`SELECT (SELECT value FROM system_settings WHERE key=?) config,
 EXISTS(SELECT 1 FROM users u JOIN recharge_orders o ON o.user_id=u.id JOIN payment_transactions t ON t.order_id=o.id
 WHERE u.id=? AND u.status='active' AND u.archived_at IS NULL AND o.status='paid' AND o.paid_at IS NOT NULL AND o.credited_at IS NOT NULL
 AND t.provider='xiaodou' AND t.status='paid' AND t.paid_at IS NOT NULL AND t.risk_state='clear' AND t.provider_trade_id IS NOT NULL AND t.amount_fen>0
 AND t.principal_refunded_fen<t.base_amount_fen
 AND EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id AND l.user_id=u.id AND l.paid_delta>0)
 AND NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status IN ('requested','pending','unknown'))
 AND NOT EXISTS(SELECT 1 FROM credit_batches b WHERE b.source_order_id=o.id AND b.status IN ('refund_pending','manual_review'))) eligible`).bind(KEY,userId).first<{config:string|null;eligible:number}>();
 // A verified, currently active subscription also proves paid eligibility.
 // Never use available credit balance to infer that money was received.
 const fiatEligible=row?.eligible===1;
 // BoltUtil intentionally never creates fiat payment_transactions rows. Verify
 // its independent signed/status-queried settlement before granting access.
 // Do not access crypto tables before their environment-specific D1 migration.
 let cryptoEligible=false;
 if(!fiatEligible && (env.ENVIRONMENT==='production'||env.ENVIRONMENT==='staging') && env.BOLTUTIL_SCHEMA_READY==='1'){
   const crypto=await env.DB.prepare(`SELECT EXISTS(
     SELECT 1 FROM recharge_orders o
     JOIN users u ON u.id=o.user_id
     JOIN boltutil_orders b ON b.credit_order_id=o.id AND b.user_id=o.user_id AND b.product_type='credits'
     WHERE o.user_id=? AND u.status='active' AND u.archived_at IS NULL
       AND o.payment_method='boltutil' AND o.status='paid'
       AND o.paid_at IS NOT NULL AND o.credited_at IS NOT NULL
       AND b.status='paid' AND b.paid_at IS NOT NULL AND b.applied_at IS NOT NULL
       AND b.tx_hash IS NOT NULL AND b.receiving_address IS NOT NULL
       AND b.payable_usdt_micros>=1000000 AND b.paid_usdt_micros>=b.payable_usdt_micros
       AND EXISTS(SELECT 1 FROM boltutil_payment_events e
         WHERE e.external_order_id=b.external_order_id AND e.network=b.network AND e.tx_hash=b.tx_hash
           AND e.status IN ('CONFIRMED','COMPLETED') AND e.body_sha256 IS NOT NULL AND e.body_sha256<>'')
       AND EXISTS(SELECT 1 FROM credit_ledger l
         WHERE l.user_id=o.user_id AND l.kind='purchase_grant' AND l.reference_id=o.id AND l.paid_delta>0)
       AND NOT EXISTS(SELECT 1 FROM credit_batches cb
         WHERE cb.source_order_id=o.id AND cb.status IN ('refund_pending','manual_review','refunded'))
   ) eligible`).bind(userId).first<{eligible:number}>();
   cryptoEligible=crypto?.eligible===1;
 }
 // Existing fiat and active subscription proofs remain authoritative.
 const eligible=fiatEligible||cryptoEligible||(await subscriptionAccount(env,userId)).status==='active';
 return {eligible,policy:parse(row?.config??undefined)};
}
async function history(env:Env){
 const rows=await env.DB.prepare("SELECT id,before_json,after_json,created_at FROM admin_audit_logs WHERE action IN ('creator_momentum_update','creator_momentum_restore') AND target_id=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(KEY).all<{id:string;before_json:string;after_json:string;created_at:number}>();
 const versions=new Map<string,{config:ReturnType<typeof parse>;createdAt:number}>();
 for(const row of rows.results??[])for(const text of [row.after_json,row.before_json]){try{const config=validateMomentumConfig(JSON.parse(text));if(!versions.has(config.version))versions.set(config.version,{config,createdAt:row.created_at});}catch{}}
 return [...versions.values()];
}
export async function adminCreator(request:Request,env:Env,action:'read'|'save'|'restore'|'simulate'){
 if(action==='simulate'&&env.ENVIRONMENT!=='staging')throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const actor=await requireAdminSession(request,env,action!=='read');
 if(action==='read'){const [{config},versions]=await Promise.all([current(env),history(env)]);return response({config,paidOnly:true,simulationAvailable:env.ENVIRONMENT==='staging',versions:versions.map(v=>({id:v.config.version,createdAt:v.createdAt}))},200,env,request);}
 if(!await takeRate(env,`creator-config:${actor.user_id}`,20,60000,nowMs()))throw new ApiFailure(429,'RATE_LIMITED','操作过于频繁，请稍后重试。');
 const body=await jsonBody(request,65536);
 if(action==='simulate'){
  if(![1,2,3].includes(body.stage as number))throw new ApiFailure(400,'INVALID_STAGE','请选择有效阶段。');
  const {config}=await current(env);const day=createMomentumDay(nowMs(),config,()=>0.5);day.count=day.thresholds[Number(body.stage)-1];const stage=selectMomentumReminder(day,{eligible:true,enabled:true,globalEnabled:true},nowMs());return response({simulated:true,stage,titleZh:config.titleZh,titleEn:config.titleEn,bodyZh:config.bodyZh,bodyEn:config.bodyEn,paidOnly:true,noCreditsConsumed:true},200,env,request);
 }
 const op=await operation(env,actor,body,action==='save'?'creator_momentum_update':'creator_momentum_restore',KEY);
 const {row,config:before}=await current(env);
 if(op.replayed)return response({ok:true,config:before,replayed:true},200,env,request);
 if(body.expectedVersion!==before.version)throw new ApiFailure(409,'CONFIG_CONFLICT','配置已变化，请刷新后重试。');
 let next:ReturnType<typeof parse>;
 try{
  const value=action==='restore'?(await history(env)).find(v=>v.config.version===body.versionId)?.config:body.config;
  if(!value)throw Error('missing');next=validateMomentumConfig({...value as object,version:op.id});
 }catch{throw new ApiFailure(400,'INVALID_CREATOR_CONFIG','请检查三阶段阈值、每日提醒上限及双语文案。');}
 // A stale read causes NOT NULL failure, rolling back operation + audit together.
 await commitOperation(env,op,[env.DB.prepare(`INSERT INTO system_settings(key,value,updated_at,updated_by) VALUES(?,?,?,?)
 ON CONFLICT(key) DO UPDATE SET value=CASE WHEN system_settings.value=? THEN excluded.value ELSE NULL END,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(KEY,JSON.stringify(next),nowMs(),actor.user_id,row?.value??null)],before,next);
 return response({ok:true,config:next},200,env,request);
}
