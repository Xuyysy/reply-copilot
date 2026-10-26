import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareProductionSecretBundle} from '../scripts/production-secret-bundle.mjs';

const merchantKeys=generateKeyPairSync('rsa',{modulusLength:2048});
const platformKeys=generateKeyPairSync('rsa',{modulusLength:2048});
const validValues=()=>({
  DEEPSEEK_API_KEY:'deepseek-private-example',
  MAIL_API_KEY:'resend-private-example',
  MK99_PID:'208812345678',
  MK99_PRIVATE_KEY:merchantKeys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  MK99_PLATFORM_PUBLIC_KEY:platformKeys.publicKey.export({type:'spki',format:'pem'}).toString(),
});

test('writes only the five required Production secrets to a mode-0600 file and returns no values',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'reply-secret-bundle-'));
  try {
    const result=prepareProductionSecretBundle(validValues(),dir);
    const json=readFileSync(result.path,'utf8');
    assert.deepEqual(Object.keys(JSON.parse(json)).sort(),[
      'DEEPSEEK_API_KEY','MAIL_API_KEY','MK99_PID','MK99_PRIVATE_KEY','MK99_PLATFORM_PUBLIC_KEY',
    ].sort());
    assert.equal(statSync(result.path).mode & 0o777,0o600);
    assert.equal(JSON.stringify(result).includes('deepseek-private-example'),false);
    assert.equal(JSON.stringify(result).includes('resend-private-example'),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('rejects missing or malformed credentials without creating a bundle',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'reply-secret-bundle-'));
  try {
    assert.throws(()=>prepareProductionSecretBundle({...validValues(),MK99_PID:'not-a-pid'},dir),/invalid Production credential format/i);
    assert.throws(()=>prepareProductionSecretBundle({...validValues(),MK99_PRIVATE_KEY:'not-pem'},dir),/invalid Production credential format/i);
    assert.throws(()=>prepareProductionSecretBundle({...validValues(),MK99_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nQUJDRA==\n-----END PRIVATE KEY-----'},dir),/invalid Production credential format/i);
    assert.throws(()=>prepareProductionSecretBundle({...validValues(),MK99_PLATFORM_PUBLIC_KEY:'-----BEGIN PUBLIC KEY-----\nQUJDRA==\n-----END PUBLIC KEY-----'},dir),/invalid Production credential format/i);
    assert.throws(()=>prepareProductionSecretBundle({...validValues(),MAIL_API_KEY:''},dir),/missing required Production credential/i);
    assert.deepEqual(readdirSync(dir),[]);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('accepts a documented 2088-prefixed numeric MK99 PID without an undocumented length ceiling',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'reply-secret-bundle-'));
  try {
    const pid='2088'+'7'.repeat(48);
    const result=prepareProductionSecretBundle({...validValues(),MK99_PID:pid},dir);
    assert.equal(JSON.parse(readFileSync(result.path,'utf8')).MK99_PID,pid);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
