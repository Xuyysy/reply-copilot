import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {fixture} from './helpers/payment-v2.mjs';

test('login uses email and NOCASE username unique indexes without scanning users',async()=>{
 const f=fixture(),password='local-query-plan-test-password',pepper='local-query-plan-test-pepper-not-a-secret';
 try{
  f.env.PASSWORD_PEPPER=pepper;const salt='00'.repeat(16);
  const digest=pbkdf2Sync(password+'\0'+pepper,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
  f.sql.prepare('UPDATE users SET username=?,password_hash=?').run('MixedCase_Name',`pbkdf2-sha256:100000:${salt}:${digest}`);
  const seen=[],original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{seen.push(sql);return original(sql)};
  const result=await f.call('/v1/auth/login',{body:{identity:'mixedcase_name',password}});
  assert.equal(result.status,200,JSON.stringify(result));
  const lookup=seen.find(sql=>sql.includes('password_hash,status FROM users'));
  const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+lookup).all('mixedcase_name','mixedcase_name').map(x=>x.detail);
  assert.ok(!plan.some(s=>/SCAN users/.test(s)),plan.join('\n'));
  assert.ok(plan.some(s=>s.includes('users_username_unique')),plan.join('\n'));
  assert.equal((await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password}})).status,200);
  assert.equal((await f.call('/v1/auth/login',{body:{identity:'mixedcase_name',password:'incorrect'}})).status,401);
 }finally{f.sql.close()}
});
