import type {Env} from "../types";
import {nowMs,uuid} from "../security";
import {boltReadSchemaReady} from "./environment";
import {boltRequest} from "./client";
import {decimalMicros,equalAddress,type BoltNetwork} from "./contract";

/** Original closed invoices remain retained for audit and late-payment review.
 * Only an authenticated provider status query can release an unpaid checkout.
 * EXPIRED is not an irreversible money verdict; later confirmed transfers
 * must be held for review by settleBoltPayment, never silently fulfilled. */
type Candidate={
 id:string;external_order_id:string;user_id:string;subscription_order_id:string;
 network:BoltNetwork;payable_usdt_micros:number|null;receiving_address:string|null;
 expires_at:number|null;
};
const TERMINAL=new Set(["EXPIRED","FAILED","CANCELLED"]);

function isUnpaidTerminalProof(order:Candidate,data:Record<string,unknown>,now:number):boolean{
 if(!TERMINAL.has(String(data.status))||data.externalOrderId!==order.external_order_id||
    data.currency!=="USDT"||data.network!==order.network||
    typeof order.receiving_address!=="string"||typeof data.destinationAddress!=="string"||
    !equalAddress(order.receiving_address,data.destinationAddress,order.network)||
    !Number.isSafeInteger(order.payable_usdt_micros)||Number(order.payable_usdt_micros)<1000000||
    order.expires_at===null||(data.status==="EXPIRED"&&order.expires_at>now)||
    data.manuallyAccepted===true||data.txHash!=null&&data.txHash!==""||
    data.paidAt!=null&&data.paidAt!==""||data.confirmedAt!=null&&data.confirmedAt!==""||
    data.completedAt!=null&&data.completedAt!==""||
    data.settlementType!=null&&data.settlementType!=="")return false;
 try{
   if(decimalMicros(data.amount)!==BigInt(order.payable_usdt_micros!))return false;
   if(data.paidAmount!=null&&decimalMicros(data.paidAmount)!==0n)return false;
 }catch{return false;}
 return true;
}

/** Called with data returned by the authenticated BoltUtil status endpoint,
 * never with browser text or a webhook alone. All order changes are one
 * guarded D1 transaction; any changed payment evidence aborts the batch. */
export async function closeProviderConfirmedUnpaidBoltSubscription(
 env:Env,externalOrderId:string,data:Record<string,unknown>
):Promise<boolean>{
 if(!boltReadSchemaReady(env))return false;
 const order=await env.DB.prepare(
   "SELECT b.id,b.external_order_id,b.user_id,b.subscription_order_id,b.network,"+
   "b.payable_usdt_micros,b.receiving_address,b.expires_at "+
   "FROM boltutil_orders b JOIN subscription_orders o ON o.id=b.subscription_order_id AND o.user_id=b.user_id "+
   "WHERE b.external_order_id=? AND b.product_type='subscription' AND b.status IN ('pending','unknown') "+
   "AND b.paid_at IS NULL AND b.applied_at IS NULL AND b.tx_hash IS NULL AND b.paid_usdt_micros IS NULL "+
   "AND o.status IN ('pending','unknown') AND o.paid_at IS NULL AND o.applied_at IS NULL "+
   "AND NOT EXISTS(SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=b.external_order_id) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=o.id) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id)"
 ).bind(externalOrderId).first<Candidate>();
 const now=nowMs();
 if(!order||!isUnpaidTerminalProof(order,data,now))return false;
 const claim=uuid();
 const b=env.DB.prepare(
   "UPDATE boltutil_orders SET status='closed',updated_at=? "+
   "WHERE id=? AND external_order_id=? AND user_id=? AND subscription_order_id=? "+
   "AND product_type='subscription' AND status IN ('pending','unknown') "+
   "AND paid_at IS NULL AND applied_at IS NULL AND paid_usdt_micros IS NULL AND tx_hash IS NULL "+
   "AND payable_usdt_micros=? AND (expires_at<=? OR ?<>'EXPIRED') "+
   "AND NOT EXISTS(SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=boltutil_orders.external_order_id) "+
   "AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=boltutil_orders.subscription_order_id "+
   "AND o.user_id=boltutil_orders.user_id AND o.status IN ('pending','unknown') "+
   "AND o.paid_at IS NULL AND o.applied_at IS NULL)"
 ).bind(now,order.id,order.external_order_id,order.user_id,order.subscription_order_id,
   order.payable_usdt_micros,now,String(data.status));
 const s=env.DB.prepare(
   "UPDATE subscription_orders SET status='closed',updated_at=? "+
   "WHERE id=? AND user_id=? AND status IN ('pending','unknown') AND paid_at IS NULL AND applied_at IS NULL "+
   "AND EXISTS(SELECT 1 FROM boltutil_orders b WHERE b.id=? AND b.subscription_order_id=subscription_orders.id "+
   "AND b.user_id=subscription_orders.user_id AND b.status='closed' AND b.paid_at IS NULL "+
   "AND b.applied_at IS NULL AND b.tx_hash IS NULL AND b.paid_usdt_micros IS NULL "+
   "AND NOT EXISTS(SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=b.external_order_id)) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=subscription_orders.id) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=subscription_orders.id)"
 ).bind(now,order.subscription_order_id,order.user_id,order.id);
 const assert=env.DB.prepare(
   "INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS("+
   "SELECT 1 FROM boltutil_orders b JOIN subscription_orders o ON o.id=b.subscription_order_id "+
   "AND o.user_id=b.user_id WHERE b.id=? AND b.external_order_id=? AND b.user_id=? "+
   "AND o.id=? AND b.status='closed' AND o.status='closed' AND b.paid_at IS NULL "+
   "AND b.applied_at IS NULL AND b.tx_hash IS NULL AND o.paid_at IS NULL AND o.applied_at IS NULL "+
   "AND NOT EXISTS(SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=b.external_order_id) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
   ") THEN 1 ELSE 0 END"
 ).bind(claim,order.id,order.external_order_id,order.user_id,order.subscription_order_id);
 try{
   await env.DB.batch([b,s,assert,env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)]);
   return true;
 }catch{
   // A concurrent paid event, held order or missing evidence wins; no partial close.
   return false;
 }
}

/** At most one independently authenticated provider lookup per new checkout.
 * Provider outages or inconclusive payment states keep the original lock. */
export async function reconcileClosedBoltSubscriptionsForUser(env:Env,userId:string):Promise<number>{
 if(!boltReadSchemaReady(env)||!env.BOLTUTIL_API_KEY||!env.BOLTUTIL_WEBHOOK_SECRET)return 0;
 const row=await env.DB.prepare(
   "SELECT b.external_order_id FROM boltutil_orders b "+
   "JOIN subscription_orders o ON o.id=b.subscription_order_id AND o.user_id=b.user_id "+
   "WHERE b.user_id=? AND b.product_type='subscription' AND b.status IN ('pending','unknown') "+
   "AND o.status IN ('pending','unknown') AND o.paid_at IS NULL AND o.applied_at IS NULL "+
   "AND b.paid_at IS NULL AND b.applied_at IS NULL AND b.tx_hash IS NULL AND b.paid_usdt_micros IS NULL "+
   "AND b.receiving_address IS NOT NULL AND b.payable_usdt_micros IS NOT NULL AND b.expires_at IS NOT NULL "+
   "AND NOT EXISTS(SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=b.external_order_id) "+
   "ORDER BY b.created_at DESC LIMIT 1"
 ).bind(userId).first<{external_order_id:string}>();
 if(!row)return 0;
 try{
   const provider=await boltRequest(env,"/api/v1/order/status",{externalOrderId:row.external_order_id});
   return await closeProviderConfirmedUnpaidBoltSubscription(env,row.external_order_id,provider)?1:0;
 }catch{return 0;}
}
