// Recovery retains pending entitlement redemption while restoring only the
// previous registration grant policy. Never deploy the pre-0019 Worker after
// pending accounts exist, and never undo the additive migration.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(new URL('../package.json',import.meta.url));
const {build}=require('esbuild');
export const registrationBaseline='57bf3d80ec31f6a45bc2845d43ee522a63eefbfe';
export async function buildSignupRollback(outdir,{format='esm',platform='browser'}={}) {
  const historical=execFileSync('git',['show',`${registrationBaseline}:api/src/password-auth.ts`],{cwd:root,encoding:'utf8'});
  const current=readFileSync(path.join(root,'api/src/password-auth.ts'),'utf8');
  // Restore ONLY the original signup grant statements. Never replace current
  // password verification, login, reset, registration validation or referrals.
  const historicalStart=historical.indexOf('    env.DB.prepare("INSERT INTO credit_accounts(',historical.indexOf('export async function verifyRegistration('));
  const historicalEnd=historical.indexOf('    session.statement,',historicalStart);
  const currentStart=current.indexOf('    // Register the account without spendable signup credits.',current.indexOf('export async function verifyRegistration('));
  const currentEnd=current.indexOf('    session.statement,',currentStart);
  if(historicalStart<0||historicalEnd<=historicalStart||currentStart<0||currentEnd<=currentStart||
      !current.slice(currentStart,currentEnd).includes('INSERT INTO signup_benefit_claims')||
      !historical.slice(historicalStart,historicalEnd).includes('INSERT INTO credit_ledger'))
    throw Error('Signup rollback transformation source mismatch');
  const source=current.slice(0,currentStart)+historical.slice(historicalStart,historicalEnd)+current.slice(currentEnd);
  mkdirSync(outdir,{recursive:true});
  const outfile=path.join(outdir,format==='cjs'?'index.cjs':'index.js');
  await build({entryPoints:[path.join(root,'api/src/index.ts')],bundle:true,format,platform,target:'es2022',outfile,sourcemap:true,
    plugins:[{name:'pending-compatible-registration-rollback',setup(build){build.onLoad({filter:/[/\\]password-auth\.ts$/},()=>({contents:source,loader:'ts',resolveDir:path.join(root,'api/src')}));}}]});
  writeFileSync(path.join(outdir,'recovery-source.json'),JSON.stringify({release:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),registrationBaseline,override:'api/src/password-auth.ts: signup grant statements only',retains:['current password verification and RPC','current registration validation and referrals','pending redemption','signup device uniqueness','admin unlimited tests','all other release code']},null,2));
  return outfile;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Provide private output directory');
  await buildSignupRollback(path.resolve(process.argv[2]));
}
