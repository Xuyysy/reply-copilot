import type {Env} from "./types";
import {ApiFailure} from "./types";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {jsonBody,nowMs,uuid} from "./security";
import {alipayStartPlan,alipayOutcomePlan} from "./partner-transfer.mjs";
import {openAlipayRecipient} from "./partner-alipay.mjs";
import {allHistoryPayoutGuard,setPayoutApprovePlan} from "./partner-payout-set-review.mjs";
type RequestRow={id:string;partner_user_id:string;recipient_version:number;amount_fen:number;status:string;payout_id:string|null;payout_status:string|null;started_at:number|null;key_id:string;nonce_hex:string;ciphertext_hex:string};
function conflict():never{throw new ApiFailure(409,'PARTNER_PAYOUT_REVIEW_CONFLICT','结算状态或证据不符合，请重新核对。');}
export function payoutReviewPilot(env:Env){return ['development','staging'].includes(env.ENVIRONMENT)&&env.PARTNER_PAYOUT_REVIEW_ENABLED==='1';}
export async function adminPayoutReview(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true);
 if(!['development','staging'].includes(env.ENVIRONMENT))throw new ApiFailure(404,'NOT_FOUND','功能未开放。');
 const b=await jsonBody(request,2048);
 if(Object.keys(b).some(k=>!['requestId','action','reason','operationId','reviewed','amountFen','reference'].includes(k))||
 typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.requestId)||
 typeof b.operationId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.operationId)||
 typeof b.reason!=='string'||b.reason.trim().length<8||b.reason.trim().length>500||b.reviewed!==true||
 !['approve','start','paid','no_transfer'].includes(String(b.action)))throw new ApiFailure(400,'PARTNER_PAYOUT_INVALID','操作或人工核对参数无效。');
 const action=String(b.action),now=nowMs();
 // Final reconciliation remains possible with the feature switch off.
 if((action==='approve'||action==='start')&&!payoutReviewPilot(env))throw new ApiFailure(404,'NOT_FOUND','功能未开放。');
 const q=await env.DB.prepare(`SELECT q.id,q.partner_user_id,q.recipient_version,q.amount_fen,q.status,q.payout_id,p.status payout_status,
 s.started_at,r.key_id,r.nonce_hex,r.ciphertext_hex
 FROM partner_alipay_requests q JOIN partner_alipay_recipients r ON r.user_id=q.partner_user_id AND r.version=q.recipient_version
 LEFT JOIN partner_payouts p ON p.id=q.payout_id LEFT JOIN partner_alipay_transfer_starts s ON s.payout_id=p.id WHERE q.id=?`).bind(b.requestId).first<RequestRow>();
 if(!q)conflict();
 if(action==='paid'||action==='no_transfer'){
  if(!q.payout_id||q.payout_status!=='reserved'||!q.started_at)conflict();
  if(action==='paid'&&(typeof b.amountFen!=='number'||b.amountFen!==q.amount_fen||typeof b.reference!=='string'||!b.reference.trim()||b.reference.trim().length>160))conflict();
  if(action==='no_transfer'&&(b.amountFen!==0||b.reference!==null))conflict();
  const p=alipayOutcomePlan({payoutId:q.payout_id,actorId:actor.user_id,now,outcome:action,amountFen:action==='paid'?q.amount_fen:0,reference:action==='paid'?String(b.reference):null,reason:b.reason});
  try{const r=await env.DB.prepare(p.sql).bind(...p.params).run();if(r.meta.changes!==1)conflict();}
  catch{conflict();}
  return response({ok:true,state:action==='paid'?'paid':'cancelled',pilot:true},200,env,request);
 }
 if(action==='approve'&&(q.status!=='pending'||q.amount_fen<1000))conflict();
 if(action==='start'&&(!q.payout_id||q.payout_status!=='reserved'||q.started_at!==null))conflict();
 const guard=allHistoryPayoutGuard({partnerId:q.partner_user_id,operationId:b.operationId});
 let work;
 let recipient:{account:string;name:string}|null=null;
 if(action==='approve'){
  work=setPayoutApprovePlan({requestId:q.id,recipientVersion:q.recipient_version,payoutId:uuid(),partnerId:q.partner_user_id,actorId:actor.user_id,amountFen:q.amount_fen,now,reason:b.reason});
 }else{
  const key=env.PARTNER_ALIPAY_ENCRYPTION_KEY;
  if(!key||env.PARTNER_ALIPAY_KEY_ID!==q.key_id)conflict();
  // Decrypt exact immutable request destination, but never return it until
  // the start (which also serves as the reveal audit) is atomically committed.
  try{recipient=await openAlipayRecipient({keyId:q.key_id,nonceHex:q.nonce_hex,ciphertextHex:q.ciphertext_hex},{environment:env.ENVIRONMENT,userId:q.partner_user_id,version:q.recipient_version,keyId:q.key_id},key);}catch{conflict();}
  // Prevent a competing start from exposing the recipient twice. Do not
  // rely on connection-local changes() across D1 statements.
  const claim='start:'+b.operationId;
  work=[
   {sql:"INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM partner_alipay_transfer_starts WHERE payout_id=?) THEN 1 ELSE 0 END",params:[claim,q.payout_id!]},
   alipayStartPlan({payoutId:q.payout_id!,actorId:actor.user_id,now,reason:b.reason}),
   {sql:"INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM partner_alipay_transfer_starts WHERE payout_id=? AND started_by=? AND started_at=?) THEN 1 ELSE 0 END",params:[claim+':done',q.payout_id!,actor.user_id,now]},
   {sql:"DELETE FROM partner_recovery_assertions WHERE id IN (?,?)",params:[claim,claim+':done']}
  ];
 }
 try{await env.DB.batch([guard.check,...work,guard.cleanup].map(p=>env.DB.prepare(p.sql).bind(...p.params)));}catch{conflict();}
 return response({ok:true,state:action==='approve'?'reserved':'reconciling',pilot:true,...(recipient?{recipient,amountFen:q.amount_fen}: {})},200,env,request);
}
