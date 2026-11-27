import test from 'node:test';import assert from 'node:assert/strict';
import {diagnosticSummary,safeSyncDiagnostic} from '../interaction-manager/sync/diagnostic.js';
test('diagnostic allowlist excludes all arbitrary strings, raw metadata and invalid status',()=>{
 assert.deepEqual(safeSyncDiagnostic('private','private',900),{stage:'read',reason:'sync_failed',httpStatus:null});
 const text=diagnosticSummary({ownerUserId:'123',diagnostic:{stage:'connect',reason:'forbidden',httpStatus:null,url:'secret'},sources:[{source:'notification',diagnostic:{stage:'validate',reason:'schema_changed',httpStatus:200,raw:'secret'}},{source:'secret',diagnostic:{stage:'read',reason:'schema_changed',httpStatus:200}}]});
 assert.equal(text,'task | connect | forbidden | HTTP unknown\nnotification | validate | schema_changed | HTTP 200');
});
