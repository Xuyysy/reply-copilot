import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

test('opt-in staging build removes debugger and keeps the staging backend',()=>{
 execFileSync(process.execPath,['scripts/build.js','staging'],{env:{...process.env,REPLY_COPILOT_STAGING_NO_DEBUGGER:'1',REPLY_COPILOT_WEBSITE_URL:'https://staging.x-reply-helper.top',REPLY_COPILOT_API_URL:'https://api-staging.x-reply-helper.top'}});
 const manifest=JSON.parse(readFileSync('dist/staging/manifest.json','utf8'));
 assert.equal(manifest.permissions.includes('debugger'),false);
 assert.deepEqual(manifest.host_permissions,['https://api-staging.x-reply-helper.top/*']);
 assert.equal(existsSync('dist/staging/services/native-input-service.js'),false);
 assert.equal(existsSync('dist/staging/services/staging-delivery-coordinator.js'),true);
 for(const name of ['background/service-worker.js','content/content-script.js','content/composer-adapter.js']) assert.doesNotMatch(readFileSync('dist/staging/'+name,'utf8'),/chrome\.debugger|Input\.insertText/);
 const content=readFileSync('dist/staging/content/content-script.js','utf8');
 assert.match(content,/matchedComposer\(current\.post\)\.editor === current\.editor/);
 assert.match(content,/document\.visibilityState === "visible"/);
 assert.match(content,/current\.attemptedInput\.has\(requestId\)/);
 assert.match(content,/document\.activeElement !== current\.editor/);
});
test('production build retains the existing store identity and debugger implementation',()=>{
 execFileSync(process.execPath,['scripts/build.js','production'],{env:{...process.env,REPLY_COPILOT_STAGING_NO_DEBUGGER:'1',REPLY_COPILOT_WEBSITE_URL:'https://app.x-reply-helper.top',REPLY_COPILOT_API_URL:'https://api.x-reply-helper.top'}});
 const manifest=JSON.parse(readFileSync('dist/production/manifest.json','utf8'));
 const identity=JSON.parse(readFileSync('config/extension-store-identity.json','utf8'));
 assert.equal(manifest.key,identity.publicKey);
 assert.equal(manifest.permissions.includes('debugger'),true);
 assert.equal(existsSync('dist/production/services/staging-delivery-coordinator.js'),false);
 assert.match(readFileSync('dist/production/background/service-worker.js','utf8'),/chrome\.debugger/);
});
