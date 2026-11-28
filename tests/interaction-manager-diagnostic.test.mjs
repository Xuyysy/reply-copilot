import test from 'node:test';import assert from 'node:assert/strict';
import {diagnosticSummary,safeSyncDiagnostic} from '../interaction-manager/sync/diagnostic.js';
test('diagnostic allowlist excludes all arbitrary strings, raw metadata and invalid status',()=>{
 assert.deepEqual(safeSyncDiagnostic('private','private',900),{stage:'read',reason:'sync_failed',httpStatus:null});
 const text=diagnosticSummary({ownerUserId:'123',diagnostic:{stage:'connect',reason:'forbidden',httpStatus:null,url:'secret'},sources:[{source:'notification',diagnostic:{stage:'validate',reason:'schema_changed',httpStatus:200,raw:'secret'}},{source:'secret',diagnostic:{stage:'read',reason:'schema_changed',httpStatus:200}}]});
 assert.equal(text,'task | connect | forbidden | HTTP unknown\nnotification | validate | schema_changed | HTTP 200');
});

test('bounded per-source phases never include request/body details',()=>{
 const detail={routeKind:'graphql',readPhase:'project',httpStatus:200,url:'fixture-sensitive-url',cookies:'fixture-sensitive-cookie'};
 assert.deepEqual(safeSyncDiagnostic('read','schema_changed',detail.httpStatus,detail),{stage:'read',reason:'schema_changed',httpStatus:200,routeKind:'graphql',readPhase:'project'});
 assert.deepEqual(safeSyncDiagnostic('read','schema_changed',200,{routeKind:'hidden-endpoint',readPhase:'project'}),{stage:'read',reason:'schema_changed',httpStatus:200});
 const summary=diagnosticSummary({sources:[{source:'notification',diagnostic:{stage:'read',reason:'schema_changed',...detail}}]});
 assert.equal(summary,'notification | read | schema_changed | HTTP 200 | graphql | project');
 assert.ok(!summary.includes('fixture-sensitive'));
});
