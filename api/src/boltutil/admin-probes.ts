import type {Env} from "../types";
import {ApiFailure} from "../types";
import {requireAdminSession} from "../admin-auth";
import {requireWebOrigin,jsonBody,nowMs,uuid} from "../security";
import {takeRate} from "../auth";
import {response} from "../http";
import {boltRequest,verifyBoltWebhook} from "./client";
import {NETWORKS,parseBoltNetwork,validReceivingAddress,verifiedPayment,decimalMicros,tokenRawUnits,equalAddress,type BoltNetwork} from "./contract";

type Probe={
 id:string;external_order_id:string;operation_id:string;admin_user_id:string;network:BoltNetwork;
 requested_usdt_micros:number;payable_usdt_micros:number|null;payable_token_raw:string|null;
 token_contract:string;receiving_address:string|null;checkout_url:string|null;expires_at:number|null;
 status:string;provider_status:string|null;tx_hash:string|null;paid_at:number|null;
 created_at:number;updated_at:number;
};
function enabled(env:Env):boolean{
 return env.ENVIRONMENT==="staging" && env.ADMIN_PORTAL_ENABLED==="1" &&
 env.BOLTUTIL_ADMIN_TEST_SCHEMA_READY==="1"&&env.BOLTUTIL_ADMIN_TEST_ENABLED==="1" &&
 !!env.BOLTUTIL_API_KEY&&!!env.BOLTUTIL_WEBHOOK_SECRET;
}
function requireEnabled(env:Env):void{
 if(!enabled(env))throw new ApiFailure(503,"BOLTUTIL_ADMIN_TEST_DISABLED","管理员 USDT 实付测试未开放。");
}
function present(p:Probe){return {
 id:p.id,externalOrderId:p.external_order_id,network:p.network,
 requestedAmount:"1.00",amount:p.payable_usdt_micros===null?null:(p.payable_usdt_micros/1e6).toFixed(6),
 address:p.receiving_address,checkoutUrl:p.checkout_url,expiresAt:p.expires_at,
 status:p.status,providerStatus:p.provider_status,txHash:p.tx_hash,paidAt:p.paid_at,
 createdAt:p.created_at,tokenContract:p.token_contract,
 noEntitlement:true,mainnet:true
};}
async function get(env:Env,id:string):Promise<Probe|null>{
 return env.DB.prepare("SELECT * FROM boltutil_admin_test_orders WHERE id=?").bind(id).first<Probe>();
}
export async function adminBoltTestList(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 if(!enabled(env))return response({enabled:false,orders:[],amount:"1.00",mainnet:true},200,env,request);
 const rows=await env.DB.prepare("SELECT * FROM boltutil_admin_test_orders ORDER BY created_at DESC LIMIT 20").all<Probe>();
 return response({enabled:true,orders:(rows.results??[]).map(present),amount:"1.00",mainnet:true},200,env,request);
}
/** Admin explicitly confirms a fixed 1-USDT mainnet order; no product/entitlement is associated. */
export async function adminBoltTestCreate(request:Request,env:Env):Promise<Response>{
 requireEnabled(env);
 const admin=await requireAdminSession(request,env,true);
 requireWebOrigin(request,env);
 const body=await jsonBody(request,2048);
 if(Object.keys(body).sort().join(",")!=="confirm,network,operationId,reason" ||
    body.confirm!=="I_ACCEPT_REAL_1_USDT_MAINNET" ||
    typeof body.reason!=="string"||body.reason.trim().length<8 ||
    typeof body.operationId!=="string"||!/^[0-9a-f-]{36}$/i.test(body.operationId))
   throw new ApiFailure(400,"BOLTUTIL_ADMIN_TEST_CONFIRMATION","请确认本次真实主网小额支付测试。");
 let network:BoltNetwork;
 try{network=parseBoltNetwork(body.network);}catch{throw new ApiFailure(400,"BOLTUTIL_NETWORK_INVALID","该网络不支持测试。");}
 if(!await takeRate(env,"bolt-admin-test-create:"+admin.user_id,2,60000,nowMs()))
   throw new ApiFailure(429,"BOLTUTIL_TEST_RATE_LIMIT","小额测试创建过于频繁。");
 const existing=await env.DB.prepare("SELECT * FROM boltutil_admin_test_orders WHERE operation_id=?")
   .bind(body.operationId).first<Probe>();
 if(existing){
   if(existing.network!==network)throw new ApiFailure(409,"BOLTUTIL_TEST_CONFLICT","操作已绑定其他链，请查看原单。");
   return response({order:present(existing),resumed:true},200,env,request);
 }
 const now=nowMs(),id=uuid(),external="BOLTTEST_"+id.replaceAll("-","").slice(0,24);
 const stmt=env.DB.prepare("INSERT INTO boltutil_admin_test_orders "+
 "(id,external_order_id,operation_id,admin_user_id,network,requested_usdt_micros,token_contract,status,created_at,updated_at) "+
 "SELECT ?,?,?,?,?,1000000,?,'creating',?,? WHERE "+
 "(SELECT COUNT(*) FROM boltutil_admin_test_orders WHERE created_at>=?)<3 AND "+
 "NOT EXISTS (SELECT 1 FROM boltutil_admin_test_orders WHERE network=? AND status IN ('creating','pending','unknown','manual_review'))")
 .bind(id,external,body.operationId,admin.user_id,network,NETWORKS[network].contract,now,now,now-86400000,network);
 const result=await stmt.run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"BOLTUTIL_TEST_LIMIT","已有未解决测试订单，或 24 小时内已创建 3 笔，请先核对。");
 let provider:Record<string,unknown>;
 try{
   provider=await boltRequest(env,"/api/v1/order/create",{
     externalOrderId:external,amount:"1.00",currency:"USDT",network,
     notifyUrl:env.API_ORIGIN+"/v1/boltutil/admin-test/webhook",
     returnUrl:env.WEB_ORIGIN+"/admin/"
   },{adminProbe:true});
   const pay=provider.payment as Record<string,unknown>|undefined;
   const time=provider.time as Record<string,unknown>|undefined;
   if(provider.merchantExternalId!==external||!pay||
      pay.currency!=="USDT"||pay.network!==network||
      pay.decimal!==NETWORKS[network].decimals ||
      !validReceivingAddress(pay.address,network)||
      typeof pay.rawAmount!=="string"||
      typeof provider.checkoutUrl!=="string"||
      !/^https:\/\/([a-z0-9-]+\.)*boltutil\.com\//i.test(provider.checkoutUrl)||
      !time||!Number.isSafeInteger(time.expireTimestamp)||Number(time.expireTimestamp)<=now)
       throw new Error("Untrusted merchant invoice snapshot");
   const micros=decimalMicros(pay.amount);
   if(micros<1000000n||micros>1100000n||pay.rawAmount!==tokenRawUnits(micros,network).toString())
     throw new Error("Merchant payable amount exceeds 1.10 USDT cap or wrong token units");
   await env.DB.prepare("UPDATE boltutil_admin_test_orders SET status='pending',provider_status='PENDING',"+
      "payable_usdt_micros=?,payable_token_raw=?,receiving_address=?,checkout_url=?,expires_at=?,updated_at=? "+
      "WHERE id=? AND status='creating'")
     .bind(Number(micros),pay.rawAmount,pay.address,provider.checkoutUrl,time.expireTimestamp,nowMs(),id).run();
 }catch{
   // An upstream timeout may have CREATED the invoice; preserve externalOrderId for read reconciliation.
   await env.DB.prepare("UPDATE boltutil_admin_test_orders SET status='unknown',updated_at=? WHERE id=? AND status='creating'")
      .bind(nowMs(),id).run();
 }
 const row=await get(env,id);
 return response({order:present(row!),resumed:false},row?.status==="pending"?201:202,env,request);
}
/** Only provider-confirmed EXACT mainnet payments may mark this diagnostic as paid.
 * No credit ledger or subscription table is referenced in this file. */
async function reconcile(env:Env,probe:Probe,eventId:string):Promise<Probe>{
 if(probe.status==="paid")return probe;
 const data=await boltRequest(env,"/api/v1/order/status",{externalOrderId:probe.external_order_id});
 if(data.externalOrderId!==probe.external_order_id||
    data.network!==probe.network||data.currency!=="USDT")
   throw new ApiFailure(409,"BOLTUTIL_TEST_PROVIDER_MISMATCH","平台查单身份不一致，请人工核查。");
 const status=String(data.status);
 if(!["CONFIRMED","COMPLETED"].includes(status)){
   if(["EXPIRED","FAILED","CANCELLED"].includes(status)&&probe.status==="pending"){
      await env.DB.prepare("UPDATE boltutil_admin_test_orders SET status=?,provider_status=?,updated_at=? WHERE id=? AND status='pending'")
       .bind(status==="EXPIRED"?"expired":"failed",status,nowMs(),probe.id).run();
   }else await env.DB.prepare("UPDATE boltutil_admin_test_orders SET provider_status=?,updated_at=? WHERE id=? AND status IN ('creating','pending','unknown')")
     .bind(status,nowMs(),probe.id).run();
   return (await get(env,probe.id))!;
 }
 try{
   if(probe.payable_usdt_micros===null||!probe.receiving_address||!probe.payable_token_raw)
     throw Error("Local payable snapshot absent");
   const proof=verifiedPayment(data);
   if(proof.externalOrderId!==probe.external_order_id||proof.network!==probe.network||
      !equalAddress(proof.address,probe.receiving_address,probe.network)||
      proof.amountMicros!==BigInt(probe.payable_usdt_micros)||
      probe.payable_token_raw!==tokenRawUnits(proof.amountMicros,probe.network).toString()||
      (probe.tx_hash!==null&&probe.tx_hash!==proof.txHash))
     throw Error("Payment evidence mismatch");
   await env.DB.batch([
     env.DB.prepare("INSERT INTO boltutil_admin_test_events(event_id,external_order_id,provider_status,network,tx_hash,created_at) "+
       "VALUES(?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING")
       .bind(eventId,probe.external_order_id,status,proof.network,proof.txHash,nowMs()),
     env.DB.prepare("UPDATE boltutil_admin_test_orders SET status='paid',provider_status=?,tx_hash=?,paid_at=COALESCE(paid_at,?),updated_at=? "+
       "WHERE id=? AND external_order_id=? AND status IN ('creating','pending','unknown','expired','failed') "+
       "AND (tx_hash IS NULL OR tx_hash=?)")
       .bind(status,proof.txHash,nowMs(),nowMs(),probe.id,probe.external_order_id,proof.txHash)
   ]);
 }catch{
   await env.DB.prepare("UPDATE boltutil_admin_test_orders SET status='manual_review',updated_at=? WHERE id=? AND status!='paid'")
     .bind(nowMs(),probe.id).run();
   throw new ApiFailure(409,"BOLTUTIL_TEST_PAYMENT_REVIEW","真实付款证据不一致，需人工核对，未发放任何权益。");
 }
 const next=await get(env,probe.id);
 if(next?.status!=="paid")throw new ApiFailure(409,"BOLTUTIL_TEST_PAYMENT_REVIEW","付款状态不确定，请人工核对。");
 return next;
}
export async function adminBoltTestRefresh(request:Request,env:Env,id:string):Promise<Response>{
 if(env.ENVIRONMENT!=="staging"||env.BOLTUTIL_ADMIN_TEST_SCHEMA_READY!=="1")
   throw new ApiFailure(404,"NOT_FOUND","接口不可用。");
 const admin=await requireAdminSession(request,env,true);
 requireWebOrigin(request,env);
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new ApiFailure(400,"INVALID_ORDER_ID","订单号不正确。");
 const row=await get(env,id);
 if(!row)throw new ApiFailure(404,"NOT_FOUND","测试订单不存在。");
 if(!await takeRate(env,"bolt-admin-test-refresh:"+admin.user_id,6,60000,nowMs()))
   throw new ApiFailure(429,"BOLTUTIL_TEST_RATE_LIMIT","平台查单次数过多。");
 const updated=await reconcile(env,row,"query:"+row.external_order_id+":"+nowMs());
 return response({order:present(updated)},200,env,request);
}
export async function adminBoltTestWebhook(request:Request,env:Env):Promise<Response>{
 if(env.ENVIRONMENT!=="staging"||env.BOLTUTIL_ADMIN_TEST_SCHEMA_READY!=="1"||!env.BOLTUTIL_WEBHOOK_SECRET)
   throw new ApiFailure(404,"NOT_FOUND","接口不可用。");
 const payload=await verifyBoltWebhook(request,env.BOLTUTIL_WEBHOOK_SECRET);
 if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new ApiFailure(400,"INVALID_WEBHOOK","回调内容无效。");
 const event=payload as Record<string,unknown>;
 if(typeof event.externalOrderId!=="string"||!/^BOLTTEST_[a-z0-9]{24}$/.test(event.externalOrderId)||
    typeof event.eventId!=="string"||!/^[A-Za-z0-9_-]{6,128}$/.test(event.eventId))
   throw new ApiFailure(400,"INVALID_WEBHOOK","回调订单标识无效。");
 const row=await env.DB.prepare("SELECT * FROM boltutil_admin_test_orders WHERE external_order_id=?")
   .bind(event.externalOrderId).first<Probe>();
 if(!row)throw new ApiFailure(404,"NOT_FOUND","测试订单不存在。");
 if(!["CONFIRMED","COMPLETED"].includes(String(event.status)))
   return response({ok:true,settled:false},200,env,request);
 const next=await reconcile(env,row,event.eventId);
 return response({ok:true,confirmed:next.status==="paid",entitlementApplied:false},200,env,request);
}
