import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {test} from "node:test";

const root=new URL("../",import.meta.url);
const migrations=["0001_init.sql","0002_credits.sql","0003_adjustment_guard.sql","0004_staging_safety.sql","0005_xiaodou_payments.sql","0006_payment_fee_refund_snapshots.sql","0007_credit_batches.sql"];

test("0008 marks only legacy succeeded and consumed generation phases as unknown without changing credits",()=>{
  const db=new DatabaseSync(":memory:");
  for(const file of migrations.slice(0,6))db.exec(readFileSync(new URL(`migrations/${file}`,root),"utf8"));
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('u','u@example.test',1,1,'u','hash')").run();
  db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('u',193,0,1,1)").run();
  db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES('grant','u','signup_grant',200,0,'grant',1)").run();
  for(let i=0;i<7;i++)db.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,completed_at) VALUES(?, 'u','2026-10-17',?,'succeeded',1,?,1,2)").run(`old-${i}`,`nonce-old-${i}`,`hash-${i}`);
  db.exec(readFileSync(new URL("migrations/0007_credit_batches.sql",root),"utf8"));

  const addRequest=db.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,raw_response,delivery_confirmed_at,delivery_confirmation_id) VALUES(?, 'u','2026-10-17',?,?,?,?,?,?,?, ?,?)");
  addRequest.run("in-flight","nonce-in-flight","reserved",0,"h1",3,"generating",null,null,null);
  addRequest.run("awaiting-ack","nonce-awaiting","reserved",0,"h2",4,"awaiting_delivery",'{"ok":true}',null,null);
  addRequest.run("not-consumed","nonce-not-consumed","succeeded",0,"h3",5,"generating",null,null,null);
  addRequest.run("already-awaiting","nonce-already-awaiting","succeeded",1,"h4",6,"awaiting_delivery",'{"ok":true}',null,null);
  addRequest.run("acknowledged","nonce-acknowledged","succeeded",1,"h5",7,"generating",'{"ok":true}',8,"ack-id");
  addRequest.run("uncertain","nonce-uncertain","uncertain",0,"h6",9,"generating",null,null,null);
  addRequest.run("reserved-completed","nonce-reserved-completed","succeeded",1,"h7",10,"generating",'{"ok":true}',null,null);
  db.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('alloc-in-flight','u','in-flight','legacy-free:u',1,'reserved',3)").run();
  db.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('alloc-awaiting','u','awaiting-ack','legacy-free:u',1,'reserved',4)").run();
  db.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('alloc-reserved-completed','u','reserved-completed','legacy-free:u',1,'reserved',10)").run();
  db.prepare("UPDATE credit_batches SET generation_reserved_credits=3 WHERE id='legacy-free:u'").run();
  db.prepare("UPDATE credit_accounts SET free_generation_reserved=3 WHERE user_id='u'").run();

  const before={
    account:{...db.prepare("SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts WHERE user_id='u'").get()},
    batches:{...db.prepare("SELECT grant_credits,remaining_credits,consumed_credits,generation_reserved_credits,refund_reserved_credits,history_confidence,status FROM credit_batches WHERE id='legacy-free:u'").get()},
    ledger:{...db.prepare("SELECT COUNT(*) AS rows,SUM(free_delta) AS free_delta,SUM(paid_delta) AS paid_delta FROM credit_ledger WHERE user_id='u'").get()},
  };
  const migration=readFileSync(new URL("migrations/0008_generation_phase_legacy_repair.sql",root),"utf8");
  db.exec(migration);

  for(let i=0;i<7;i++){
    const row=db.prepare("SELECT status,consumed,generation_phase FROM ai_requests WHERE user_id='u' AND request_id=?").get(`old-${i}`);
    assert.deepEqual({...row},{status:"succeeded",consumed:1,generation_phase:"unknown"});
  }
  for(const [id,phase,status,consumed] of [
    ["in-flight","generating","reserved",0],
    ["awaiting-ack","awaiting_delivery","reserved",0],
    ["not-consumed","generating","succeeded",0],
    ["already-awaiting","awaiting_delivery","succeeded",1],
    ["acknowledged","generating","succeeded",1],
    ["uncertain","generating","uncertain",0],
    ["reserved-completed","generating","succeeded",1],
  ])assert.deepEqual({...db.prepare("SELECT generation_phase AS phase,status,consumed FROM ai_requests WHERE user_id='u' AND request_id=?").get(id)},{phase,status,consumed});

  const after={
    account:{...db.prepare("SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts WHERE user_id='u'").get()},
    batches:{...db.prepare("SELECT grant_credits,remaining_credits,consumed_credits,generation_reserved_credits,refund_reserved_credits,history_confidence,status FROM credit_batches WHERE id='legacy-free:u'").get()},
    ledger:{...db.prepare("SELECT COUNT(*) AS rows,SUM(free_delta) AS free_delta,SUM(paid_delta) AS paid_delta FROM credit_ledger WHERE user_id='u'").get()},
  };
  assert.deepEqual(after,before,"repair must not change balances, lots, reservations, or ledger");
  db.exec(migration);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_requests WHERE user_id='u' AND request_id LIKE 'old-%' AND status='succeeded' AND consumed=1 AND generation_phase='unknown'").get().n,7,"re-running the data repair must be harmless");
  db.close();
});
