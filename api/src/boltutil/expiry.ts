import type {Env} from "../types";
import {uuid,nowMs} from "../security";
import {boltReadSchemaReady} from "./environment";

/**
 * Local cashier deadline policy. A provider-issued expires_at is an immutable
 * deadline for OUR checkout; it is NOT proof that a token transfer cannot
 * arrive later. Only payment-evidence-free pending invoices may be released.
 * A later verified transfer must be recorded and held for manual review.
 */
type Candidate={
  id:string;external_order_id:string;user_id:string;
  product_type:"credits"|"subscription";credit_order_id:string|null;
  subscription_order_id:string|null;expires_at:number;
};
const evidenceFree=`b.status IN ('pending','unknown') AND b.expires_at IS NOT NULL
  AND b.payable_usdt_micros IS NOT NULL AND b.receiving_address IS NOT NULL
  AND b.paid_at IS NULL AND b.applied_at IS NULL AND b.tx_hash IS NULL
  AND b.paid_usdt_micros IS NULL AND NOT EXISTS
  (SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=b.external_order_id)`;

async function closeOne(env:Env,order:Candidate,now:number,manual=false):Promise<boolean>{
  const claim=uuid();
  const b=env.DB.prepare(`UPDATE boltutil_orders AS b SET status='closed',updated_at=?
    WHERE id=? AND user_id=? AND external_order_id=? AND ${evidenceFree}
    ${manual?"":"AND MIN(b.expires_at,b.created_at+1800000)<=?"}`)
    .bind(now,order.id,order.user_id,order.external_order_id,...(manual?[]:[now]));
  const joined=order.product_type==='subscription'
    ?env.DB.prepare(`UPDATE subscription_orders SET status='closed',updated_at=?
      WHERE id=? AND user_id=? AND status IN ('pending','unknown')
      AND paid_at IS NULL AND applied_at IS NULL
      AND EXISTS(SELECT 1 FROM boltutil_orders b WHERE b.subscription_order_id=subscription_orders.id
        AND b.id=? AND b.user_id=subscription_orders.user_id AND b.status='closed'
        AND b.paid_at IS NULL AND b.applied_at IS NULL AND b.tx_hash IS NULL)
      AND NOT EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id)
      AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=subscription_orders.id)
      AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=subscription_orders.id)`)
      .bind(now,order.subscription_order_id,order.user_id,order.id)
    :env.DB.prepare(`UPDATE recharge_orders SET status='expired'
      WHERE id=? AND user_id=? AND payment_method='boltutil'
      AND status IN ('pending','awaiting_payment') AND paid_at IS NULL AND credited_at IS NULL
      AND EXISTS(SELECT 1 FROM boltutil_orders b WHERE b.credit_order_id=recharge_orders.id
        AND b.id=? AND b.user_id=recharge_orders.user_id AND b.status='closed'
        AND b.paid_at IS NULL AND b.applied_at IS NULL AND b.tx_hash IS NULL)
      AND NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=recharge_orders.id)
      AND NOT EXISTS(SELECT 1 FROM credit_batches cb WHERE cb.source_order_id=recharge_orders.id)`)
      .bind(order.credit_order_id,order.user_id,order.id);
  const relevant=order.product_type==='subscription'
    ?`EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=b.subscription_order_id
      AND o.user_id=b.user_id AND o.status='closed' AND o.paid_at IS NULL
      AND o.applied_at IS NULL AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id))`
    :`EXISTS(SELECT 1 FROM recharge_orders o WHERE o.id=b.credit_order_id
      AND o.user_id=b.user_id AND o.status='expired' AND o.paid_at IS NULL
      AND o.credited_at IS NULL AND NOT EXISTS(SELECT 1 FROM credit_ledger l
        WHERE l.kind='purchase_grant' AND l.reference_id=o.id))`;
  const assertion=env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM boltutil_orders b
      WHERE b.id=? AND b.user_id=? AND b.external_order_id=?
      AND b.status='closed' AND b.paid_at IS NULL AND b.applied_at IS NULL
      AND b.tx_hash IS NULL AND b.paid_usdt_micros IS NULL
      AND NOT EXISTS(SELECT 1 FROM boltutil_payment_events e
        WHERE e.external_order_id=b.external_order_id)
      AND ${relevant}) THEN 1 ELSE 0 END`)
    .bind(claim,order.id,order.user_id,order.external_order_id);
  try{
    await env.DB.batch([b,joined,assertion,
      env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)]);
    return true;
  }catch{return false;}
}

/** Authenticated owner-triggered cleanup on account open, invoice refresh or
 * new checkout. Nothing is written on GET and no remote BoltUtil API is called.
 * Cap at 3 local expired invoices per request to bound D1 consumption.
 */
export async function closeExpiredUnpaidBoltOrdersForUser(
 env:Env,userId:string,onlyOrderId?:string
):Promise<number>{
 if(!boltReadSchemaReady(env))return 0;
 const now=nowMs();
 const sql=`SELECT b.id,b.external_order_id,b.user_id,b.product_type,b.credit_order_id,
   b.subscription_order_id,b.expires_at FROM boltutil_orders b
   WHERE b.user_id=? AND ${onlyOrderId?"b.id=? AND ":""} ${evidenceFree}
   AND MIN(b.expires_at,b.created_at+1800000)<=?
   ORDER BY b.expires_at ASC LIMIT 3`;
 const query=env.DB.prepare(sql).bind(...(onlyOrderId?[userId,onlyOrderId,now]:[userId,now]));
 const orders=await query.all<Candidate>();
 let count=0;
 for(const order of orders.results??[])if(await closeOne(env,order,now))count++;
 return count;
}

/** Explicit user cancellation before the deadline. Only fully unpaid, evidence-
 * free originals can be locally closed. It does NOT cancel a merchant invoice
 * or prevent a previously submitted transfer from being received on-chain. */
export async function cancelUnpaidBoltOrderForUser(
 env:Env,userId:string,orderId:string
):Promise<boolean>{
 if(!boltReadSchemaReady(env))return false;
 const order=await env.DB.prepare(`SELECT b.id,b.external_order_id,b.user_id,b.product_type,
   b.credit_order_id,b.subscription_order_id,b.expires_at
   FROM boltutil_orders b WHERE b.user_id=? AND b.id=? AND ${evidenceFree}`)
   .bind(userId,orderId).first<Candidate>();
 if(!order)return false;
 return closeOne(env,order,nowMs(),true);
}
