import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseAlipayRecipient,sealAlipayRecipient,openAlipayRecipient,recipientAppendPlan,alipayDestinationPlan} from '../src/partner-alipay.mjs';

const secret='17'.repeat(32),ctx={environment:'development',userId:'p',version:1,keyId:'fixture-key'};
const info={account:'demo@example.test',name:'测试姓名'};
test('strict input, randomized AES-GCM and authenticated environment/user/version/key context',async()=>{
 for(const bad of [{...info,password:'fake'},{...info,account:'not-an-account'},{...info,name:'12'},{...info,name:'test\nname'}])assert.throws(()=>parseAlipayRecipient(bad));
 const a=await sealAlipayRecipient(info,ctx,secret),b=await sealAlipayRecipient(info,ctx,secret);
 assert.notEqual(a.nonceHex,b.nonceHex);
 assert.notEqual(a.ciphertextHex,b.ciphertextHex);
 assert.equal(a.accountMask,'d***@***');assert.equal(a.nameMask,'测**');
 assert.deepEqual(await openAlipayRecipient(a,ctx,secret),info);
 for(const patch of [{environment:'staging'},{userId:'q'},{version:2},{keyId:'wrong'}])
  await assert.rejects(()=>openAlipayRecipient(a,{...ctx,...patch},secret));
 await assert.rejects(()=>openAlipayRecipient(a,ctx,'18'.repeat(32)));
 const tampered={...a,ciphertextHex:(a.ciphertextHex[0]==='0'?'1':'0')+a.ciphertextHex.slice(1)};
 await assert.rejects(()=>openAlipayRecipient(tampered,ctx,secret));
 await assert.rejects(()=>sealAlipayRecipient(info,ctx,'too-short'));
});
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
 CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
 CREATE TABLE partner_payouts(id TEXT PRIMARY KEY,partner_user_id TEXT,status TEXT);
 INSERT INTO users VALUES('a','admin','active',1,NULL,0),('p','user','active',1,NULL,0),('q','user','active',1,NULL,0);
 INSERT INTO partner_payouts VALUES('x','p','reserved'),('y','q','reserved');`);
 for(const name of ['partners_v1a_policy_proposal.sql','partners_alipay_recipient_proposal.sql'])
  db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 db.exec("INSERT INTO partner_policy_versions VALUES('p',1,'active','standard',2000,12,1,'a','test only')");
 return db;
}
function run(db,p){return Number(db.prepare(p.sql).run(...p.params).changes);}
test('default-off and authorized owner; version CAS; reserved payout destination stays unchanged',async t=>{
 const db=fixture(t);
 const a=await sealAlipayRecipient(info,ctx,secret),append={userId:'p',expectedVersion:0,now:10,sealed:a};
 assert.equal(run(db,recipientAppendPlan(append)),0);
 db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_alipay_recipient_enabled')");
 assert.equal(run(db,recipientAppendPlan({...append,userId:'q'})),0);
 assert.equal(run(db,recipientAppendPlan(append)),1);
 assert.equal(run(db,recipientAppendPlan(append)),0);
 assert.equal(run(db,alipayDestinationPlan({payoutId:'x',userId:'p',version:1})),1);
 assert.throws(()=>run(db,alipayDestinationPlan({payoutId:'y',userId:'p',version:1})),/ownership mismatch/);
 const b=await sealAlipayRecipient({account:'other@example.test',name:'测试姓名'},{...ctx,version:2},secret);
 assert.equal(run(db,recipientAppendPlan({...append,expectedVersion:1,now:20,sealed:b})),1);
 assert.equal(db.prepare("SELECT recipient_version FROM partner_alipay_payout_destinations WHERE payout_id='x'").get().recipient_version,1);
 assert.throws(()=>db.exec("UPDATE partner_alipay_payout_destinations SET recipient_version=2 WHERE payout_id='x'"),/immutable/);
 assert.throws(()=>db.exec("UPDATE partner_alipay_recipients SET account_mask='other'"),/immutable/);
 assert.throws(()=>db.exec("DELETE FROM partner_alipay_recipients WHERE version=1"),/FOREIGN KEY/);
 db.exec("INSERT INTO partner_policy_versions VALUES('p',2,'paused','standard',2000,12,21,'a','test only')");
 assert.equal(run(db,recipientAppendPlan({...append,expectedVersion:2,now:22,sealed:b})),0);
});
test('recipient routes are scoped, CSRF guarded and do not return encrypted or full data',()=>{
 const source=readFileSync(new URL('../src/partner-recipient.ts',import.meta.url),'utf8');
 assert.match(source,/sessionFor\(request,env\)/);
 assert.match(source,/if\(write\)await requireCsrf\(request,env,token\)/);
 assert.match(source,/session\.kind!=="web"/);
 assert.match(source,/SELECT version,account_mask,name_mask,created_at/);
 assert.match(source,/bind\(session\.user_id\)/);
});
