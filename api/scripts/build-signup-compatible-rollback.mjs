// Recovery retains pending entitlement redemption while restoring only the
// previous registration grant policy. Never deploy the pre-0019 Worker after
// pending accounts exist, and never undo the additive migration.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(new URL('../package.json',import.meta.url));
const {build}=require('esbuild');
export const registrationBaseline='57bf3d80ec31f6a45bc2845d43ee522a63eefbfe';
export async function buildSignupRollback(outdir,{format='esm',platform='browser'}={}) {
  const source=execFileSync('git',['show',`${registrationBaseline}:api/src/password-auth.ts`],{cwd:root,encoding:'utf8'});
  mkdirSync(outdir,{recursive:true});
  const outfile=path.join(outdir,format==='cjs'?'index.cjs':'index.js');
  await build({entryPoints:[path.join(root,'api/src/index.ts')],bundle:true,format,platform,target:'es2022',outfile,sourcemap:true,
    plugins:[{name:'pending-compatible-registration-rollback',setup(build){build.onLoad({filter:/[/\\]password-auth\.ts$/},()=>({contents:source,loader:'ts',resolveDir:path.join(root,'api/src')}));}}]});
  writeFileSync(path.join(outdir,'recovery-source.json'),JSON.stringify({release:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),registrationBaseline,override:'api/src/password-auth.ts',retains:['pending redemption','signup device uniqueness','admin unlimited tests','all other release code']},null,2));
  return outfile;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Provide private output directory');
  await buildSignupRollback(path.resolve(process.argv[2]));
}
