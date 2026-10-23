import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './helpers/payment-v2.mjs';
const statements=readFileSync(new URL('../sql/payment-consistency-audit.sql',import.meta.url),'utf8').split(';').map(s=>s.replace(/^\s*--[^\n]*(?:\n|$)/gm,'').trim()).filter(Boolean);
test('Payment consistency audit is read-only, returns summaries, and detects a mismatched balance',()=>{const f=fixture();try{for(const sql of statements)assert.match(sql,/^SELECT /);const before=f.sql.prepare('SELECT total_changes() n').get().n;for(const sql of statements){const r=f.sql.prepare(sql).get();assert.equal(r.anomalies,0);assert.deepEqual(Object.keys(r).sort(),['anomalies','check_name']);}assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);f.sql.prepare('UPDATE credit_accounts SET paid_balance=1').run();assert.equal(f.sql.prepare(statements.find(s=>s.includes("'account_batch_balance_mismatch'"))).get().anomalies,1);}finally{f.sql.close();}});
