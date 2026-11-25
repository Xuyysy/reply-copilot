// Offline preflight for an independently reviewed binding plan, not a deploy tool.
// Accept sanitized metadata only. Never emit a deployable config or authorize Free.
import {isDeepStrictEqual} from 'node:util';
const names={staging:'reply-copilot-api-staging',production:'reply-copilot-api-production'};
const owner=e=>'reply-copilot-password-verifier-'+e;
const flags=['PASSWORD_VERIFY_DO_ENABLED','PASSWORD_FREE_CPU_ENABLED','PASSWORD_FREE_TINY_CPU_ENABLED','PASSWORD_LEGACY_MIGRATION_ENABLED'];
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(a,b)=>object(a)&&isDeepStrictEqual(a,b);
export function assessPrivateVerifierPlan(plan){
  const blockers=[];
  const fail=x=>{if(!blockers.includes(x))blockers.push(x);};
  if(!sha(plan?.candidateSha)||!sha(plan?.baselineSha))fail('SOURCE_IDENTITY_REQUIRED');
  if(!object(plan?.environments)||!isDeepStrictEqual(Object.keys(plan.environments).sort(),['production','staging']))fail('ENVIRONMENT_SET_INVALID');
  for(const env of ['staging','production']){
    const p=plan?.environments?.[env];
    const prefix=env.toUpperCase()+':';
    const bad=x=>fail(prefix+x);
    if(!object(p)){bad('PLAN_MISSING');continue;}
    if(p.apiName!==names[env]||p.ownerName!==owner(env))bad('WRONG_ENVIRONMENT_TARGET');
    if(!uuid(p.apiVersionId)||!uuid(p.dbId)||!uuid(p.rollbackVersionId))bad('RESOURCE_IDENTITY_REQUIRED');
    if(!exact(p.privateConfig,{workers_dev:false,preview_urls:false,observability:{enabled:false},
      routes:[],bindings:[{name:'PASSWORD_PEPPER',type:'secret_text'},{name:'PASSWORD_VERIFY_DO',class_name:'PasswordVerifierDO',storage:'sqlite'}]}))bad('PRIVATE_CONFIG_NOT_ISOLATED');
    if(!exact(p.apiBinding,{name:'PASSWORD_VERIFY_DO',class_name:'PasswordVerifierDO',script_name:owner(env)}))bad('CROSS_ENV_OR_UNEXPECTED_BINDING');
    if(!object(p.currentFlags)||!isDeepStrictEqual(Object.keys(p.currentFlags).sort(),[...flags].sort())||
       Object.values(p.currentFlags).some(x=>!['0','1','ABSENT'].includes(x)))bad('LIVE_FLAGS_NOT_ATTESTED');
    else if(p.currentFlags.PASSWORD_VERIFY_DO_ENABLED==='1')bad('ALREADY_ENABLED_REVIEW_SEPARATELY');
    if(!exact(p.enableFlags,{PASSWORD_VERIFY_DO_ENABLED:'1',PASSWORD_FREE_CPU_ENABLED:'0',PASSWORD_FREE_TINY_CPU_ENABLED:'0',PASSWORD_LEGACY_MIGRATION_ENABLED:'0'}))bad('ENABLE_FLAGS_NOT_SAFE');
    if(!exact(p.rollbackFlags,{PASSWORD_VERIFY_DO_ENABLED:'0',PASSWORD_FREE_CPU_ENABLED:'0',PASSWORD_FREE_TINY_CPU_ENABLED:'0',PASSWORD_LEGACY_MIGRATION_ENABLED:'0'}))bad('ROLLBACK_FLAGS_NOT_SAFE');
    if(p.pepperParityAttested!==true)bad('PEPPER_PARITY_NOT_ATTESTED');
    if(p.paidRollbackRehearsed!==true)bad('PAID_ROLLBACK_NOT_REHEARSED');
    if(p.unrelatedBindingsPreserved!==true)bad('UNRELATED_BINDINGS_NOT_ATTESTED');
  }
  const s=plan?.environments?.staging,p=plan?.environments?.production;
  if(s&&p&&(s.dbId===p.dbId||s.apiVersionId===p.apiVersionId||s.rollbackVersionId===p.rollbackVersionId||s.ownerName===p.ownerName))fail('ENVIRONMENT_RESOURCE_COLLISION');
  return {kind:'OFFLINE_PRIVATE_VERIFIER_PLAN_REVIEW',decision:'NO_GO',deploymentAuthorized:false,freeCertified:false,
    bindingPlanStructurallyReady:blockers.length===0,blockers,
    outstanding:['INDEPENDENT_CLOUD_EVIDENCE','COMPLETE_UTC_QUOTAS','EXPLICIT_RELEASE_AUTHORIZATION'],
    caveat:'Structure and attestations only; booleans are not verified cloud evidence. No deployment, SQL or plan change.'};
}
