import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cleanProductionOutput} from '../scripts/clean-production-output.mjs';

test('production build removes stale output before writing production assets',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'reply-production-build-'));
  const output=path.join(root,'dist');
  try {
    mkdirSync(path.join(output,'_astro'),{recursive:true});
    writeFileSync(path.join(output,'_astro','staging-only.js'),'https://api-staging.x-reply-helper.top');
    cleanProductionOutput(output);
    assert.equal(existsSync(path.join(output,'_astro','staging-only.js')),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
