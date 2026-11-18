import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './helpers/payment-v2.mjs';

const proposedIndexes=readFileSync(new URL('../sql-proposals/0026_admin_v2_read_indexes.sql',import.meta.url),'utf8');

function plan(sql,params=[]){
 const f=fixture();
 try{
  // Explicit local application: this SQL is NOT automatically part of any
  // Staging/Production migration chain until separately approved.
  f.sql.exec(proposedIndexes);
  return f.sql.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map(x=>String(x.detail));
 }
 finally{f.sql.close();}
}
function uses(details,name){
 assert.ok(details.some(x=>x.includes(name)),
   'Expected '+name+' in isolated SQLite plan; instead got: '+details.join(' | '));
}

test('Admin V2: all-user subscription orders use recent created_at index',()=>{
 uses(plan(`SELECT o.id,o.user_id,u.email FROM subscription_orders o
   JOIN users u ON u.id=o.user_id
   WHERE o.created_at>=? AND o.created_at<?
   ORDER BY o.created_at DESC,o.id DESC LIMIT 41`,[Date.now()-90*86400000,Date.now()]),
  'admin_subscription_orders_recent_idx');
});
test('Admin V2: real credit receipts use paid_at index instead of scanning all historical payments',()=>{
 uses(plan(`SELECT COUNT(*) n,COALESCE(SUM(t.amount_fen),0) gross
  FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id
  WHERE t.paid_at>=? AND t.paid_at<? AND t.status IN ('paid','refunded')
    AND t.merchant_provider IN ('mk99','xiaodou')
    AND t.currency='CNY' AND t.amount_fen>0
    AND EXISTS (SELECT 1 FROM provider_payment_events e
       WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
         AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen
         AND e.currency='CNY' AND e.body_sha256 IS NOT NULL)`,
 [Date.now()-90*86400000,Date.now()]),'admin_credit_receipts_paid_idx');
});
test('Admin V2: real subscription receipts use paid_at index instead of scanning all historical payments',()=>{
 uses(plan(`SELECT o.kind,COUNT(*) n,COALESCE(SUM(o.amount_fen),0) gross
  FROM subscription_orders o
  JOIN subscription_payment_transactions t ON t.order_id=o.id
  WHERE t.paid_at>=? AND t.paid_at<? AND t.status IN ('paid','refunded')
    AND t.merchant_provider IN ('mk99','xiaodou')
    AND t.currency='CNY' AND t.amount_fen=o.amount_fen
    AND EXISTS(SELECT 1 FROM subscription_payment_events e
       WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
         AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen
         AND e.body_sha256 IS NOT NULL)
  GROUP BY o.kind`,
 [Date.now()-90*86400000,Date.now()]),'admin_subscription_receipts_paid_idx');
});
test('Admin V2: paid but unfulfilled subscription alert uses recent subscription order index',()=>{
 const rows=plan(`SELECT o.id order_id,o.user_id,t.paid_at FROM subscription_orders o
   JOIN subscription_payment_transactions t ON t.order_id=o.id
   WHERE o.created_at>=? AND t.status='paid' AND t.paid_at IS NOT NULL AND t.paid_at<=?
     AND o.applied_at IS NULL AND t.merchant_provider IN ('mk99','xiaodou')
     AND t.currency='CNY' AND t.amount_fen=o.amount_fen AND t.amount_fen>0
   ORDER BY o.created_at DESC LIMIT 8`,
  [Date.now()-30*86400000,Date.now()-5*60000]);
 uses(rows,'admin_subscription_orders_recent_idx');
});
