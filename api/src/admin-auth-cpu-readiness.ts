import type {Env} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';
import {AUTH_CPU_READINESS_SQL} from './admin-auth-cpu-queries.js';

type Counts = {
 passwordAccounts:number;activeAccounts:number;activeFastHashes:number;activeFreeHashes:number;
 active100kHashes:number;active210kHashes:number;inactiveLegacyHashes:number;inactiveNotFastHashes:number;
};
export async function adminAuthCpuReadiness(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 // Deliberate admin-only summary; no plaintext, hashes or user identifiers.
 const raw=await env.DB.prepare(AUTH_CPU_READINESS_SQL).first<Counts>();
 const total=Number(raw?.activeAccounts||0);
 const fast=Number(raw?.activeFastHashes||0);
 const free=Number(raw?.activeFreeHashes||0);
 const old100=Number(raw?.active100kHashes||0);
 const old210=Number(raw?.active210kHashes||0);
 const unsupported=Math.max(0,total-fast-free-old100-old210);
 const inactiveLegacy=Number(raw?.inactiveLegacyHashes||0);
 const inactiveNotFast=Number(raw?.inactiveNotFastHashes||0);
 const fastMode=env.PASSWORD_FAST_CPU_ENABLED==='1';
 const migrationEnabled=env.PASSWORD_LEGACY_MIGRATION_ENABLED==='1' &&
   (fastMode || env.PASSWORD_FREE_CPU_ENABLED==='1');
 const baseHashes={
  passwordAccounts:Number(raw?.passwordAccounts||0),active:total,
  optimized60k:free,legacy100k:old100,legacy210k:old210,
  unsupported:fastMode?unsupported:unsupported+fast,nonActiveLegacy:inactiveLegacy
 };
 const mode=fastMode?
   {creationIterations:10000,migrationEnabled,legacyCostGuardEnabled:env.PASSWORD_LEGACY_COST_GUARD_ENABLED==='1'}:
   {creationIterations:env.PASSWORD_FREE_CPU_ENABLED==='1'?60000:100000,migrationEnabled};
 const hashes=fastMode?
   {...baseHashes,unsupported,optimized10k:fast,legacy60k:free,nonActiveNonFast:inactiveNotFast}:
   baseHashes;
 const passwordCpuMigrationComplete=fastMode?
   total===fast&&unsupported===0&&inactiveNotFast===0:
   old100===0&&old210===0&&baseHashes.unsupported===0&&inactiveLegacy===0;
 return response({
  mode,hashes,passwordCpuMigrationComplete,
  freePlanCertified:false,
  note:'Password-only readiness, not proof of 10ms CPU or all-account D1 Free readiness. Do not switch plans or enable the legacy guard without complete UTC-day checks.'
 },200,env,request);
}
