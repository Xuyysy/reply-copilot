import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { rehearseXiaodou0025Locally } from '../scripts/xiaodou-production-local-rehearsal.mjs';

test('0025 remains an unapproved SQL proposal, outside the 24 auto-deploy migrations', () => {
  const files = readdirSync(new URL('../api/migrations/', import.meta.url)).filter(x => /^\d{4}.*\.sql$/.test(x)).sort();
  assert.equal(files.length, 24);
  assert.equal(files.at(-1), '0024_subscription_upgrade_quotes.sql');
  assert.equal(files.some(x => x.startsWith('0025')), false);
  const sql = readFileSync(new URL('../api/sql-proposals/0025_subscription_xiaodou_rsa2.sql', import.meta.url), 'utf8');
  assert.match(sql, /PRAGMA defer_foreign_keys = on/);
  assert.match(sql, /PRAGMA foreign_key_check/);
  assert.doesNotMatch(sql, /PRAGMA\s+defer_foreign_keys\s*=\s*off\s*;/i,
    'Ending deferral early can silently suppress pending FK violations');
});

test('local SQLite rejects an unresolved deferred foreign key at COMMIT and rolls back', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))');
    db.exec('BEGIN IMMEDIATE');
    db.exec('PRAGMA defer_foreign_keys=ON');
    db.exec('INSERT INTO child(id,parent_id) VALUES (1,999)');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 1);
    assert.throws(() => db.exec('COMMIT'), /FOREIGN KEY constraint failed/i);
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT count(*) AS n FROM child').get().n, 0);
  } finally {
    db.close();
  }
});

test('offline 0025 rehearsal preserves MK99 financial proof, allows RSA2 schema and never grants entitlements', () => {
  const result = rehearseXiaodou0025Locally();
  assert.equal(result.execution, 'local-memory-only');
  assert.equal(result.remoteD1Touched, false);
  assert.equal(result.productionMigrations, 24);
  assert.equal(result.historicalMk99TransactionPreserved, true);
  assert.equal(result.historicalMk99EventPreserved, true);
  assert.equal(result.xiaodouSchemaAccepted, true);
  assert.equal(result.foreignKeysValid, true);
  assert.equal(result.noEntitlementsGranted, true);
  assert.equal(result.purchaseDefaultStillClosed, true);
  assert.equal(result.productionReady, false);
  assert.equal(result.requiresSeparateRemoteD1AndMerchantApproval, true);
});

test('offline rehearsal contains no network, remote D1 or deployment path', () => {
  const source = readFileSync(new URL('../scripts/xiaodou-production-local-rehearsal.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|\bchild_process\b|https?:\/\/api\.cloudflare\.com|wrangler d1/);
  assert.match(source, /new DatabaseSync\(':memory:'\)/);
  assert.match(source, /productionReady: false/);
});
