import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AccountStateService} from '../services/account-state-service.js';
import {StorageService} from '../services/storage-service.js';
import {ACCOUNT_TOKEN_KEY,ACCOUNT_DEVICE_ID_KEY,ACCOUNT_PENDING_DEVICE_KEY} from '../services/account-client.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('expired tokens and network outages produce distinct account states',async()=>{
  const config={channel:'production',hostedApiUrl:'https://api.example.test'};
  const make=error=>new AccountStateService({config,client:{token:async()=> 'token',fetchCurrentUser:async()=>{throw error;},fetchEntitlement:async()=>({}),fetchUsage:async()=>({})}});
  assert.equal((await make(Object.assign(new Error('expired'),{code:'AUTH_REQUIRED'})).getState()).status,'auth_expired');
  assert.equal((await make(Object.assign(new Error('offline'),{code:'NETWORK_ERROR'})).getState()).status,'auth_unavailable');
});
test('auto generation toggle uses existing behavior preferences and survives reads',async()=>{
  const data={behaviorPreferences:{autoGenerateOnReply:true,defaultReplyMode:'natural'}};
  const local={get:async key=>({[key]:data[key]}),set:async patch=>Object.assign(data,patch)};
  const storage=new StorageService({local});
  await storage.setBehaviorPreferences({autoGenerateOnReply:false});
  assert.equal((await storage.getBehaviorPreferences()).autoGenerateOnReply,false);
  assert.equal(data.behaviorPreferences.defaultReplyMode,'natural');
  await storage.setBehaviorPreferences({autoGenerateOnReply:true});
  assert.equal((await storage.getBehaviorPreferences()).autoGenerateOnReply,true);
});
test('brand icon assets match manifest sizes',()=>{
  const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.name,'x-Reply-Helper');
  assert.equal(manifest.short_name,'x-Reply-Helper');
  assert.equal(manifest.action.default_title,'x-Reply-Helper');
  assert.match(manifest.description,/x-Reply-Helper/);
  assert.match(readFileSync(path.join(root,'icons/x-reply-helper.svg'),'utf8'),/<title id="title">x-Reply-Helper<\/title>/);
  for(const size of [16,32,48,128]){
    const location=manifest.icons[String(size)];
    assert.equal(location,manifest.action.default_icon[String(size)]);
    const file=readFileSync(path.join(root,location));
    assert.equal(file.subarray(1,4).toString(),'PNG');
    assert.equal(file.readUInt32BE(16),size);
    assert.equal(file.readUInt32BE(20),size);
  }
});
test('brand rename keeps existing account storage keys',()=>{
  assert.equal(ACCOUNT_TOKEN_KEY,'replyCopilotAccountToken');
  assert.equal(ACCOUNT_DEVICE_ID_KEY,'replyCopilotDeviceId');
  assert.equal(ACCOUNT_PENDING_DEVICE_KEY,'replyCopilotPendingDevice');
});
