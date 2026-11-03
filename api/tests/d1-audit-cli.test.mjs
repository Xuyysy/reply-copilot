import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {fixture} from './helpers/payment-v2.mjs';
const script=fileURLToPath(new URL('../scripts/audit-generation-credits.mjs',import.meta.url));
const run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
test('maintenance CLI has no remote mode, refuses broad reads, and never changes a local database',()=>{
 for(const args of [['--remote'],['--database','https://api.example.test'],['--database','d9df7d23-9b9c-44ac-a33a-c24474c15691'],['--database','/not-present','--since','0'],['--database','/not-present','--limit','501']])assert.equal(run(args).status,1);
 const dir=mkdtempSync(path.join(tmpdir(),'d1-audit-cli-')),f=fixture();try{
  const database=path.join(dir,'snapshot.sqlite'),report=path.join(dir,'private-report.json');f.sql.exec(`VACUUM INTO '${database}'`);
  const hash=()=>createHash('sha256').update(readFileSync(database)).digest('hex'),before=hash();
  const result=run(['--database',database,'--report-file',report]);assert.equal(result.status,0,result.stderr);
  const value=JSON.parse(result.stdout);assert.equal(value.counts.checked,0);assert.equal(value.metrics.rowsRead,null);
  assert.ok(!result.stdout.includes('v2@example.test'));assert.ok(!Object.hasOwn(value,'nextCursor'));
  assert.equal(statSync(report).mode&0o777,0o600);assert.equal(hash(),before);
 }finally{f.sql.close();rmSync(dir,{recursive:true,force:true})}
});
