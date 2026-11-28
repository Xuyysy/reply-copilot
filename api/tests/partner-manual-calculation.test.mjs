import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPaymentEvidence} from '../src/partner-payment-proof.mjs';
import {commissionFen,termEnd,candidateInTerm,manualCandidatePlan,manualEvidenceBatchPlan,summarizeManualOrders,requestableFen,manualOrderEstimate} from '../src/partner-manual-calculation.mjs';

test('manual report uses integer fen, historical rate and calendar term',()=>{
 assert.equal(commissionFen(10001,2000),2000);
 assert.equal(commissionFen(1,2000),0);
 assert.throws(()=>commissionFen(100.1,2000));
 assert.equal(termEnd(Date.UTC(2026,0,31),1),Date.UTC(2026,1,28));
 const c={paid_at:Date.UTC(2026,1,28),registered_at:Date.UTC(2026,0,1),first_authorized_at:Date.UTC(2026,0,31),term_months:1,rate_bps:2000};
 assert.equal(candidateInTerm(c),false);assert.equal(candidateInTerm({...c,term_months:null}),true);
});
test('manual reporting read plans are bounded and parameterized',()=>{
 const p=manualCandidatePlan('recharge','partner');assert.equal(p.params[0],'partner');assert.equal(p.params[1],101);
 assert.match(p.sql,/v.effective_at<=o.paid_at/);assert.match(p.sql,/p.status='active'/);
 for(const d of ['recharge','subscription']){const q=manualEvidenceBatchPlan(d,['a','b']);assert.deepEqual(q.params,['a','b']);assert.match(q.sql,/IN \(\?,\?\) LIMIT 121$/);}
 assert.throws(()=>manualEvidenceBatchPlan('recharge',['a','a']));
 assert.throws(()=>manualEvidenceBatchPlan('recharge',["bad'"]));
});
test('missing or ambiguous evidence does not produce a balance',()=>{
 const c={order_id:'a',buyer_id:'buyer',paid_at:100,registered_at:1,first_authorized_at:1,term_months:null,rate_bps:2000,buyer_eligible:1};
 const e=manualOrderEstimate('recharge',c,[]);assert.equal(e.state,'review');assert.equal(e.commissionFen,null);
 const v={state:'verified',commissionFen:2000};
 assert.equal(summarizeManualOrders([v,e],1000,true).differenceFen,1000);
 assert.equal(summarizeManualOrders([v,e],3000,true).differenceFen,-1000);
 assert.equal(requestableFen(summarizeManualOrders([v,e],3000,true),false),null);
 assert.equal(summarizeManualOrders([v],3000,true).differenceFen,-1000);
 assert.equal(summarizeManualOrders([v],1000,false).estimatedFen,null);
});
test('application minimum is exactly 1000 fen and one outstanding request',()=>{
 const s={complete:true,reviewCount:0,differenceFen:999};
 assert.equal(requestableFen(s,false),null);
 assert.equal(requestableFen({...s,differenceFen:1000},false),1000);
 assert.equal(requestableFen({...s,differenceFen:5600},false),5600);
 assert.equal(requestableFen({...s,differenceFen:1000},true),null);
 assert.equal(requestableFen({...s,differenceFen:1000,reviewCount:1},false),1000);
 assert.equal(requestableFen({...s,differenceFen:1000,complete:false},false),null);
 assert.equal(requestableFen({...s,differenceFen:-1},false),null);
 assert.equal(requestableFen({...s,differenceFen:1000000000001},false),null);
});

test('automatic Xiaodou RSA2 and Epay recharge use their actual trusted payment contracts',()=>{
 const row={transaction_count:1,merchant_provider:'xiaodou',payment_protocol:'rsa2',currency:'CNY',risk_state:'clear',refund_pending:0,order_status:'paid',payment_status:'paid',payment_proof:1,applied_proof:1,paid_at:100,applied_at:100,transaction_paid_at:100,provider_trade_id:'merchant-out',provider_payment_id:null,epay_trade_no:null,identity_count:1,principal_fen:1990,buyer_fen:1990,principal_refunded_fen:0,refund_proof_fen:0};
 assert.equal(classifyPaymentEvidence('recharge',[row]).eligible,true);
 const c={order_id:'order',buyer_id:'buyer',paid_at:100,registered_at:1,first_authorized_at:1,term_months:null,rate_bps:1500,buyer_eligible:1};
 assert.equal(manualOrderEstimate('recharge',c,[{...row,order_id:'order',buyer_id:'buyer'}]).commissionFen,298);
 assert.equal(classifyPaymentEvidence('recharge',[{...row,payment_protocol:'epay',epay_trade_no:'unique-epay'}]).eligible,true);
 for(const patch of [{merchant_provider:'mk99'},{payment_protocol:'epay'},{payment_protocol:'unknown'},{provider_trade_id:null},{provider_payment_id:''},{identity_count:2},{transaction_count:2},{transaction_paid_at:99},{risk_state:'manual_review'},{payment_proof:0},{applied_proof:0},{refund_pending:1}]){
  assert.equal(classifyPaymentEvidence('recharge',[{...row,...patch}]).eligible,false,JSON.stringify(patch));
 }
 assert.equal(classifyPaymentEvidence('subscription',[{...row,order_kind:'purchase'}]).eligible,false);
 assert.equal(classifyPaymentEvidence('recharge',[{...row,payment_protocol:'epay',epay_trade_no:'epay',provider_payment_id:'conflict'}]).eligible,false);
});
