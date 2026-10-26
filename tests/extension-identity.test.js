import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { extensionIdentity } from '../scripts/extension-identity.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key=publicKey.export({type:'spki',format:'der'}).toString('base64');
test('Chrome ID is stable for the Web Store public key',()=>{
 const expected=[...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].flatMap(b=>[b>>4,b&15]).map(n=>String.fromCharCode(97+n)).join('');
 assert.deepEqual(extensionIdentity(key),{key,id:expected});
 assert.equal(extensionIdentity(key,expected).id,expected);
 assert.throws(()=>extensionIdentity(key,'a'.repeat(32)),/mismatch/);
});
test('identity helper rejects private key, malformed base64 and invalid ID',()=>{
 for(const input of [privateKey.export({type:'pkcs8',format:'pem'}).toString(),'not a key',''])assert.throws(()=>extensionIdentity(input));
 assert.throws(()=>extensionIdentity(key,'invalid'));
});

test('checked-in Web Store public metadata matches the assigned identity', async()=>{
 const {readFileSync}=await import('node:fs');
 const identity=JSON.parse(readFileSync(new URL('../config/extension-store-identity.json',import.meta.url),'utf8'));
 assert.equal(identity.id,'fgfjajofkapebgphfidblngcjomkbdaj');
 assert.equal(extensionIdentity(identity.publicKey,identity.id).id,identity.id);
});

test('clean production builds bind the existing store ID and reject an override',async()=>{
 const {execFileSync}=await import('node:child_process');const {readFileSync}=await import('node:fs');
 const env={...process.env,REPLY_COPILOT_WEBSITE_URL:'https://app.x-reply-helper.top',REPLY_COPILOT_API_URL:'https://api.x-reply-helper.top',REPLY_COPILOT_EXTENSION_PUBLIC_KEY_FILE:'',REPLY_COPILOT_EXTENSION_ID:''};
 execFileSync(process.execPath,['scripts/build.js','production'],{cwd:new URL('..',import.meta.url),env,stdio:'pipe'});
 const manifest=JSON.parse(readFileSync(new URL('../dist/production/manifest.json',import.meta.url)));
 assert.equal(extensionIdentity(manifest.key).id,'fgfjajofkapebgphfidblngcjomkbdaj');
 assert.throws(()=>execFileSync(process.execPath,['scripts/build.js','production'],{cwd:new URL('..',import.meta.url),env:{...env,REPLY_COPILOT_EXTENSION_ID:'a'.repeat(32)},stdio:'pipe'}),/cannot differ/);
});
