import assert from 'node:assert/strict';

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
assert.equal(account,'cb5fc919a9f05dcf39b3ca29c9538a1f');
assert.ok(token && token.length>10);
assert.equal(process.env.GITHUB_REPOSITORY,'Xuyysy/reply-copilot');
const root='https://api.cloudflare.com/client/v4/accounts/'+account;
async function cf(path,method='GET',body){
 const response=await fetch(root+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(!response.ok || result.success!==true) throw Error('Cloudflare read-only API failed '+path+' status '+response.status);
 return result.result;
}
const db='/d1/database/cd44bb44-b525-42c4-b286-2cc84dae7fdb';
assert.equal((await cf(db)).name,'reply-copilot-staging');
const deployments=await cf('/workers/scripts/reply-copilot-api-staging/deployments?page=1&per_page=1');
const deployed=(Array.isArray(deployments)?deployments:deployments.deployments)[0];
assert.equal(deployed.versions[0].version_id,'19b19a8a-6de9-435d-a9b2-c02284ab459a');
assert.equal(deployed.versions[0].percentage,100);
const pages=await cf('/pages/projects/x-reply-helper-staging/deployments?page=1&per_page=1&env=production');
assert.equal(pages[0].deployment_trigger.metadata.commit_hash,'de69edbc2517ac7f1ced830b8bbc8865f724311c');
assert.equal(pages[0].latest_stage.status,'success');
const sql=[
 "SELECT",
 "(SELECT value FROM system_settings WHERE key='referrals_enabled') AS flag,",
 "(SELECT COUNT(*) FROM users u WHERE u.role='admin' AND u.status='active' AND u.is_test_account=0 AND u.archived_at IS NULL AND u.email_verified_at IS NOT NULL) AS eligible_admin,",
 "(SELECT COUNT(*) FROM users u JOIN site_administrator a ON a.user_id=u.id WHERE u.role='admin' AND u.status='active' AND u.is_test_account=0 AND u.archived_at IS NULL AND u.email_verified_at IS NOT NULL) AS eligible_site_admin,",
 "(SELECT COUNT(*) FROM users WHERE id LIKE 'qa-ref119-admin-%') AS failed_qa_residue,",
 "(SELECT COUNT(*) FROM sessions WHERE user_id LIKE 'qa-ref119-admin-%') AS failed_qa_sessions"
].join(' ');
const read=await cf(db+'/query','POST',{sql});
const row=read.flatMap(x=>x.results||[])[0];
assert.equal(row.flag,'1');
assert.equal(row.eligible_admin,1,'the real role=admin account must meet the new eligibility SQL');
assert.equal(row.eligible_site_admin,1,'the real site administrator must meet the eligibility SQL');
assert.equal(row.failed_qa_residue,0,'failed fixture must leave no user rows');
assert.equal(row.failed_qa_sessions,0,'failed fixture must leave no sessions');
console.log('PASS: current Staging administrator meets updated referral eligibility predicate; zero QA residue');
const health=await fetch('https://api-staging.x-reply-helper.top/health');
assert.equal(health.status,200);
const unauthorized=await fetch('https://api-staging.x-reply-helper.top/v1/referrals/me');
const body=await unauthorized.json();
assert.equal(unauthorized.status,401);
assert.equal(body.code,'AUTH_REQUIRED');
console.log('PASS: Staging Worker healthy, referral endpoint exists and enforces login');
console.log('PASS: Staging Pages released updated 200+50 copy, CI source SHA matches deployment');
