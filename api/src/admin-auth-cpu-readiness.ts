import type {Env} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';
import {AUTH_CPU_READINESS_SQL} from './admin-auth-cpu-queries.js';

type Counts = {passwordAccounts:number;activeAccounts:number;activeFreeHashes:number;activeTinyHashes:number;active100kHashes:number;active210kHashes:number;inactiveLegacyHashes:number;inactiveNotTinyHashes:number};
export async function adminAuthCpuReadiness(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const raw=await env.DB.prepare(AUTH_CPU_READINESS_SQL).first<Counts>();
 const total=Number(raw?.activeAccounts||0);
 const ready=Number(raw?.activeFreeHashes||0);
 const readyTiny=Number(raw?.activeTinyHashes||0);
 const old100=Number(raw?.active100kHashes||0);
 const old210=Number(raw?.active210kHashes||0);
 const unsupported=Math.max(0,total-ready-readyTiny-old100-old210);
 const inactiveLegacy=Number(raw?.inactiveLegacyHashes||0);
 const inactiveNotTiny=Number(raw?.inactiveNotTinyHashes||0);
 const tinyMode=env.PASSWORD_FREE_CPU_ENABLED==='1'&&env.PASSWORD_FREE_TINY_CPU_ENABLED==='1';
 const tinyReady=total===readyTiny&&inactiveNotTiny===0;
 return response({
  mode:{creationIterations:env.PASSWORD_FREE_CPU_ENABLED==='1'?(tinyMode?10000:60000):100000,
    migrationEnabled:env.PASSWORD_FREE_CPU_ENABLED==='1'&&env.PASSWORD_LEGACY_MIGRATION_ENABLED==='1'},
  hashes:{passwordAccounts:Number(raw?.passwordAccounts||0),active:total,
    optimized60k:ready,legacy100k:old100,legacy210k:old210,
    unsupported,nonActiveLegacy:inactiveLegacy},
  passwordCpuMigrationComplete:tinyMode?tinyReady:(old100===0&&old210===0&&unsupported===0&&inactiveLegacy===0),
  tinyCpuReadiness:{targetIterations:10000,activeTenKHashes:readyTiny,
    activeNotTenKHashes:Math.max(0,total-readyTiny),inactiveNotTenKHashes:inactiveNotTiny,
    allPasswordHashesTenK:tinyReady,enabled:tinyMode},
  freePlanCertified:false,
  note:'Password-only readiness; Cloudflare per-request CPU and D1 metrics still require separate verification.'
 },200,env,request);
}
