import test from 'node:test';
import assert from 'node:assert/strict';
import { auditStorePackage } from '../scripts/store-release.mjs';
const manifest={manifest_version:3,permissions:['storage'],host_permissions:['https://api.x-reply-helper.top/*']};
const runtime='export const RUNTIME_CONFIG={channel:"production",websiteUrl:"https://app.x-reply-helper.top",hostedApiUrl:"https://api.x-reply-helper.top"};';
test('store package rejects staging and development destinations',()=>{
 assert.throws(()=>auditStorePackage({...manifest,host_permissions:['https://api-staging.x-reply-helper.top/*']},runtime));
 assert.throws(()=>auditStorePackage(manifest,runtime.replace('production','staging')));
 assert.throws(()=>auditStorePackage(manifest,runtime.replace('https://app.x-reply-helper.top','https://staging.x-reply-helper.top')));
});
test('store package requires MV3 and production origins',()=>{
 assert.doesNotThrow(()=>auditStorePackage(manifest,runtime));
 assert.throws(()=>auditStorePackage({...manifest,manifest_version:2},runtime));
 assert.throws(()=>auditStorePackage({...manifest,permissions:['storage','<all_urls>']},runtime));
});
