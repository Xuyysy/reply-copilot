import type {Env} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';
import {AUTH_CPU_READINESS_SQL} from './admin-auth-cpu-queries.js';

type Counts = {passwordAccounts:number;activeAccounts:number;activeFreeHashes:number;active100kHashes:number;active210kHashes:number;inactiveLegacyHashes:number};
export async function adminAuthCpuReadiness(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const raw=await env.DB.prepare(AUTH_CPU_READINESS_SQL).first<Counts>();
 const total=Number(raw?.activeAccounts||0);
 const ready=Number(raw?.activeFreeHashes||0);
 const old100=Number(raw?.active100kHashes||0);
 const old210=Number(raw?.active210kHashes||0);
 const unsupported=Math.max(0,total-ready-old100-old210);
 const inactiveLegacy=Number(raw?.inactiveLegacyHashes||0);
 return response({
  mode:{creationIterations:env.PASSWORD_FREE_CPU_ENABLED==='1'?60000:100000,
    migrationEnabled:env.PASSWORD_FREE_CPU_ENABLED==='1'&&env.PASSWORD_LEGACY_MIGRATION_ENABLED==='1'},
  hashes:{passwordAccounts:Number(raw?.passwordAccounts||0),active:total,
    optimized60k:ready,legacy100k:old100,legacy210k:old210,
    unsupported,nonActiveLegacy:inactiveLegacy},
  passwordCpuMigrationComplete:old100===0&&old210===0&&unsupported===0&&inactiveLegacy===0,
  freePlanCertified:false,
  note:'Password-only readiness; Cloudflare per-request CPU and D1 metrics still require separate verification.'
 },200,env,request);
}
