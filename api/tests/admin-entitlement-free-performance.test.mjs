import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {createAdminEntitlementActivity} from '../src/admin-entitlement-activity.mjs';

test('CF Free: subscription-only history never scans unrelated lifetime credit ledger in isolated D1',{timeout:120000},async()=>{
 let outbound=0;
 const mf=new Miniflare({workers:[{config:{
   name:'cf-free-entitlement-isolated',compatibilityDate:'2026-10-14',
   env:{DB:{type:'d1',id:'synthetic-entitlement-only'}},
   manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("local")}}'}}}
 },dev:{outboundService:{type:'fetcher',handler:()=>{outbound++;throw Error('No external calls allowed')}}}}]});
 try{
  const db=await mf.getD1Database('DB');
  for(const ddl of [
   'CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE)',
   'CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,user_id TEXT,created_at INTEGER,kind TEXT,free_delta INTEGER,paid_delta INTEGER,reference_id TEXT,reason TEXT)',
   'CREATE INDEX credit_ledger_created_idx ON credit_ledger(created_at DESC)',
   'CREATE TABLE subscription_usage_events(id TEXT PRIMARY KEY,user_id TEXT,created_at INTEGER,period_id TEXT,event_type TEXT,day_index INTEGER,request_id TEXT)',
   'CREATE TABLE subscription_periods(id TEXT PRIMARY KEY,plan_version_id TEXT,daily_limit INTEGER)',
   'CREATE TABLE subscription_plan_versions(id TEXT PRIMARY KEY,plan_code TEXT,daily_limit INTEGER)',
   'CREATE TABLE subscription_orders(id TEXT PRIMARY KEY,user_id TEXT,applied_at INTEGER,updated_at INTEGER,status TEXT,kind TEXT,plan_version_id TEXT,amount_fen INTEGER)'
  ])await db.prepare(ddl).run();
  await db.prepare("INSERT INTO users(id,email) VALUES('u0','local@example.test')").run();
  const now=Date.now();
  await db.prepare(`WITH RECURSIVE seq(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM seq WHERE i+1<12000)
    INSERT INTO credit_ledger(id,user_id,created_at,kind,free_delta,paid_delta,reference_id)
    SELECT 'old-'||i,'u0',${now}-i,'generation_debit',-1,0,'r-'||i FROM seq`).run();
  const statements=[];
  const wrapper={prepare(sql){return {bind(...args){return {async all(){
   const r=await db.prepare(sql).bind(...args).all();
   statements.push({sql,read:Number(r.meta?.rows_read??0),written:Number(r.meta?.rows_written??0)});
   return r;
  }}}}}};
  const endpoint=createAdminEntitlementActivity({
   requireAdminSession:async()=>({id:'local-admin'}),response:body=>Response.json(body),
   ApiFailure:class extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
  });
  const query=async extra=>{
   const url=new URL('https://staging.example.test/v1/admin/entitlement-activity?'+extra);
   const res=await endpoint(new Request(url),{DB:wrapper});
   assert.equal(res.status,200);return res.json();
  };
  const sub=await query('source=subscription');
  assert.equal(sub.items.length,0);
  assert.equal(statements.length,3,'credit source branch is skipped completely');
  assert.ok(statements.every(s=>!s.sql.includes('credit_ledger')&&s.written===0));
  statements.length=0;
  const first=await query('source=free');
  assert.equal(first.items.length,50);assert.equal(first.hasMore,true);
  assert.equal(statements.length,1,'free source uses only the credit ledger');
  assert.ok(statements[0].sql.includes('ORDER BY l.created_at DESC,l.id DESC LIMIT ?'));
  assert.ok(statements[0].read<600,JSON.stringify(statements[0]));
  const second=await query('source=free&cursor='+encodeURIComponent(first.nextCursor));
  assert.equal(second.items.length,50);
  assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,100);
  assert.ok(statements[1].read<600,JSON.stringify(statements[1]));
  console.log(JSON.stringify({event:'cf_free_entitlement_source_bound_local_only',historyRows:12000,
   subSourceQueries:3,subSourceLedgerReads:0,firstPageRowsRead:statements[0].read,secondPageRowsRead:statements[1].read}));
 }finally{await mf.dispose();assert.equal(outbound,0);}
});
