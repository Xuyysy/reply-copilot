import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync,existsSync} from "node:fs";

const dir=new URL("../migrations/",import.meta.url);
const proposals=new URL("../sql-proposals/",import.meta.url);
const read=(name,root)=>readFileSync(new URL(name,root),"utf8");
const tables=["credit_accounts","credit_batches","credit_ledger",
 "subscription_orders","subscription_payment_transactions","recharge_orders"];
const state=db=>Object.fromEntries(tables.map(name=>[
 name,{
  schema:db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql,
  rows:db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()
 }
]));
test("real Staging 0025, reserved Admin 0026 and referral 0027 form a safe local forward migration",()=>{
 const db=new DatabaseSync(":memory:");
 try {
  db.exec("PRAGMA foreign_keys=ON");
  const names=readdirSync(dir).filter(n=>n.endsWith(".sql")).sort();
  assert.equal(names.at(-1),"0024_subscription_upgrade_quotes.sql");
  for(const name of names) db.exec(read(name,dir));
  // These are isolated SQLite operations, never remote Cloudflare D1.
  db.exec(read("0025_subscription_xiaodou_rsa2.sql",proposals));
  db.exec(read("0026_admin_v2_read_indexes.sql",proposals));
  const before=state(db);
  assert.equal(existsSync(new URL("0027_referral_rewards_v1.sql",dir)),false);
  db.exec(read("0027_referral_rewards_v1.sql",proposals));
  assert.deepEqual(state(db),before,"Referral migration cannot rewrite financial tables");
  const namesOfNewTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'referral_%' ORDER BY name")
    .all().map(row=>row.name);
  assert.deepEqual(namesOfNewTables,["referral_awards","referral_codes","referral_invites"]);
  assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='referrals_enabled'").get().value,"0");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
 }finally{db.close();}
});
