import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {measure} from './helpers/d1-performance.mjs';
import {SUBSCRIPTION_RELEVANT_PERIOD_SQL} from '../src/subscription-account-queries.js';

// Only a synthetic, in-memory Miniflare database. No remote D1 SQL, and no
// application/network requests. Matches the existing 0022 subscription index.
test('CF Free subscription preflight remains index-covered for a large historical dataset',{timeout:120000},async()=>{
 let external=0;
 const mf=new Miniflare({workers:[{config:{
  name:'cf-free-subscription-local',compatibilityDate:'2026-10-14',
  env:{DB:{type:'d1',id:'synthetic-subscription-candidate'}},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("isolated")}}'}}}
 },dev:{outboundService:{type:'fetcher',handler:()=>{external++;throw Error('External calls forbidden')}}}}]});
 try{
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE subscription_periods(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,status TEXT NOT NULL,start_at INTEGER,end_at INTEGER)').run();
  await db.prepare('CREATE INDEX subscription_periods_user_status_idx ON subscription_periods(user_id,status,start_at,end_at)').run();
  const count=12000;
  const seq=`WITH RECURSIVE seq(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM seq WHERE i+1<${count})`;
  await db.prepare(`${seq} INSERT INTO subscription_periods(id,user_id,status,start_at,end_at)
    SELECT 'old-'||i,CASE WHEN i%5=0 THEN 'historical-user' ELSE 'other-'||(i%2000) END,
    CASE WHEN i%2=0 THEN 'expired' ELSE 'revoked' END,1,2592000001 FROM seq`).run();
  await db.prepare("INSERT INTO subscription_periods(id,user_id,status) VALUES('queue','queued-user','queued')").run();
  await db.prepare("INSERT INTO subscription_periods(id,user_id,status,start_at,end_at) VALUES('active','paid-user','active',1,2592000001)").run();
  for(const [user,expected] of [['new-user',0],['historical-user',0],['queued-user',1],['paid-user',1]]){
   const measured=await measure(db,SUBSCRIPTION_RELEVANT_PERIOD_SQL,[user]);
   assert.equal(measured.rowsWritten,0);
   assert.equal(measured.results.length,expected,`candidate mismatch for ${user}`);
   assert.ok(measured.plan.some(s=>/USING COVERING INDEX subscription_periods_user_status_idx/i.test(s)),JSON.stringify(measured.plan));
   // SQLite IN probes can count up to three index rows even with a covering
   // index. This must remain constant-size, not scale with the 12k history.
   assert.ok(measured.rowsRead<=4,JSON.stringify({user,rowsRead:measured.rowsRead}));
  }
  console.log(JSON.stringify({event:'cf_free_subscription_preflight_local_only',historicalRows:count,scope:'synthetic D1 index lookup and safe paid eligibility'}));
 }finally{await mf.dispose();assert.equal(external,0,'no network requests attempted');}
});
