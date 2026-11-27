import test from 'node:test';
import assert from 'node:assert/strict';
import {commissionFen,termEnd,candidateInTerm,manualCandidatePlan,manualEvidenceBatchPlan,summarizeManualOrders,parseManualRecord,manualOrderEstimate} from '../src/partner-manual-calculation.mjs';

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
 assert.equal(summarizeManualOrders([v,e],1000,true).differenceFen,null);
 assert.equal(summarizeManualOrders([v],3000,true).differenceFen,-1000);
 assert.equal(summarizeManualOrders([v],1000,false).estimatedFen,null);
});
test('external record validation rejects unknown fields, invalid dates and floating fen',()=>{
 const r={userId:'p',operationId:'12345678-1234-1234-1234-123456789abc',amountFen:2000,transferredAt:100,reference:'Receipt_001',reason:'manual reconciliation'};
 assert.equal(parseManualRecord(r,100).reference,'receipt_001');
 for(const x of [{...r,amountFen:1.5},{...r,transferredAt:101},{...r,reason:'x'},{...r,reference:'a'},{...r,recipient:'not allowed'}])assert.throws(()=>parseManualRecord(x,100));
});
