import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPrivateVerifierPlan} from '../scripts/lib/cf-free-private-release-gate.mjs';
function valid(){
 const env=(e,n)=>({apiName:'reply-copilot-api-'+e,ownerName:'reply-copilot-password-verifier-'+e,
 apiVersionId:'00000000-0000-0000-0000-00000000000'+n,dbId:'00000000-0000-0000-0000-00000000001'+n,rollbackVersionId:'00000000-0000-0000-0000-00000000002'+n,
 privateConfig:{workers_dev:false,preview_urls:false,observability:{enabled:false},routes:[],bindings:[{name:'PASSWORD_PEPPER',type:'secret_text'},{name:'PASSWORD_VERIFY_DO',class_name:'PasswordVerifierDO',storage:'sqlite'}]},
 apiBinding:{name:'PASSWORD_VERIFY_DO',class_name:'PasswordVerifierDO',script_name:'reply-copilot-password-verifier-'+e},
 currentFlags:{PASSWORD_VERIFY_DO_ENABLED:'ABSENT',PASSWORD_FREE_CPU_ENABLED:'1',PASSWORD_FREE_TINY_CPU_ENABLED:'1',PASSWORD_LEGACY_MIGRATION_ENABLED:'1'},
 enableFlags:{PASSWORD_VERIFY_DO_ENABLED:'1',PASSWORD_FREE_CPU_ENABLED:'0',PASSWORD_FREE_TINY_CPU_ENABLED:'0',PASSWORD_LEGACY_MIGRATION_ENABLED:'0'},
 rollbackFlags:{PASSWORD_VERIFY_DO_ENABLED:'0',PASSWORD_FREE_CPU_ENABLED:'0',PASSWORD_FREE_TINY_CPU_ENABLED:'0',PASSWORD_LEGACY_MIGRATION_ENABLED:'0'},
 pepperParityAttested:true,paidRollbackRehearsed:true,unrelatedBindingsPreserved:true});
 return {candidateSha:'a'.repeat(40),baselineSha:'b'.repeat(40),environments:{staging:env('staging',1),production:env('production',2)}};
}
test('structurally complete private plan never authorizes deployment or certifies Free',()=>{
 const r=assessPrivateVerifierPlan(valid());assert.equal(r.bindingPlanStructurallyReady,true);assert.equal(r.decision,'NO_GO');assert.equal(r.deploymentAuthorized,false);assert.equal(r.freeCertified,false);
});
test('private plan rejects unsafe cross-environment, ingress, secret, rollback and flag configurations',()=>{
 const cases=[
 [p=>p.environments.staging.apiBinding.script_name=p.environments.production.ownerName,'STAGING:CROSS_ENV_OR_UNEXPECTED_BINDING'],
 [p=>p.environments.production.dbId=p.environments.staging.dbId,'ENVIRONMENT_RESOURCE_COLLISION'],
 [p=>p.environments.production.privateConfig.workers_dev=true,'PRODUCTION:PRIVATE_CONFIG_NOT_ISOLATED'],
 [p=>p.environments.production.privateConfig.routes.push('example.test/*'),'PRODUCTION:PRIVATE_CONFIG_NOT_ISOLATED'],
 [p=>p.environments.production.privateConfig.bindings.push({name:'DB',type:'d1'}),'PRODUCTION:PRIVATE_CONFIG_NOT_ISOLATED'],
 [p=>p.environments.production.privateConfig.bindings[0].text='synthetic-secret','PRODUCTION:PRIVATE_CONFIG_NOT_ISOLATED'],
 [p=>p.environments.production.currentFlags.PASSWORD_LEGACY_MIGRATION_ENABLED='UNKNOWN','PRODUCTION:LIVE_FLAGS_NOT_ATTESTED'],
 [p=>p.environments.production.rollbackFlags.PASSWORD_LEGACY_MIGRATION_ENABLED='1','PRODUCTION:ROLLBACK_FLAGS_NOT_SAFE'],
 [p=>p.environments.production.enableFlags.PASSWORD_FREE_TINY_CPU_ENABLED='1','PRODUCTION:ENABLE_FLAGS_NOT_SAFE'],
 [p=>p.environments.production.pepperParityAttested=false,'PRODUCTION:PEPPER_PARITY_NOT_ATTESTED'],
 [p=>p.environments.production.paidRollbackRehearsed=false,'PRODUCTION:PAID_ROLLBACK_NOT_REHEARSED'],
 [p=>p.environments.production.unrelatedBindingsPreserved=false,'PRODUCTION:UNRELATED_BINDINGS_NOT_ATTESTED']
 ];
 for(const [change,code] of cases){const p=valid();change(p);const r=assessPrivateVerifierPlan(p);assert.equal(r.bindingPlanStructurallyReady,false,code);assert.ok(r.blockers.includes(code),code);assert.equal(r.decision,'NO_GO');}
 assert.equal(assessPrivateVerifierPlan(null).bindingPlanStructurallyReady,false);
});
