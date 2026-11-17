import type {Env} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';

// One administrator-triggered aggregate over user identities. Never return
// hashes, salts, email addresses, user IDs or pepper. Do not poll this endpoint;
// it is deliberately NOT part of the regularly refreshed admin dashboard.
export const AUTH_CPU_READINESS_SQL = `SELECT
 COUNT(*) passwordAccounts,
 COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) activeAccounts,
 COALESCE(SUM(CASE WHEN status='active' AND password_hash LIKE 'pbkdf2-sha256:60000:%' THEN 1 ELSE 0 END),0) activeFreeHashes,
 COALESCE(SUM(CASE WHEN status='active' AND password_hash LIKE 'pbkdf2-sha256:100000:%' THEN 1 ELSE 0 END),0) active100kHashes,
 COALESCE(SUM(CASE WHEN status='active' AND password_hash LIKE 'pbkdf2-sha256:210000:%' THEN 1 ELSE 0 END),0) active210kHashes,
 COALESCE(SUM(CASE WHEN status<>'active' AND password_hash NOT LIKE 'pbkdf2-sha256:60000:%' THEN 1 ELSE 0 END),0) inactiveLegacyHashes
 FROM users WHERE password_hash IS NOT NULL`;

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
