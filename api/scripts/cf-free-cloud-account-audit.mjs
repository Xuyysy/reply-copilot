#!/usr/bin/env node
// Read-only account-isolation preflight. Never deploys or approves a plan.
// Outputs fixed reason codes only: no account IDs, names, worker names or tokens.
import {pathToFileURL} from 'node:url';

const ENDPOINT='https://api.cloudflare.com/client/v4';
const PRODUCTION_PREFIX='reply-copilot';
export const ACCOUNT_ID=/^[0-9a-f]{32}$/i;

export function parseAccountAuditArgs(args,env={}){
  const parsed={audit:false,expectedAccountId:null,token:env.CF_FREE_PILOT_READ_TOKEN};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--audit-read-only'){parsed.audit=true;continue;}
    if(args[i]==='--expected-account-id'){parsed.expectedAccountId=args[++i];continue;}
    throw Error('Unsupported read-only account audit argument');
  }
  if(!parsed.audit||!ACCOUNT_ID.test(parsed.expectedAccountId||'')||
     typeof parsed.token!=='string'||parsed.token.length<20||parsed.token.length>1024)
    throw Error('Explicit read-only audit flag, exact account ID and scoped API token required');
  return parsed;
}
function reason(list,name){if(!list.includes(name))list.push(name);}
function envelope(payload){
  if(!payload||payload.success!==true||!Array.isArray(payload.result))
    throw Error('Incomplete Cloudflare API response');
  return payload.result;
}
async function readOnlyGet(path,token,fetchImpl){
  // Never allow arbitrary URLs or non-Cloudflare hosts in the caller.
  const response=await fetchImpl(ENDPOINT+path,{
    method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(15000)
  });
  if(!response?.ok)throw Error('Read-only Cloudflare endpoint inaccessible');
  return response.json();
}

/**
 * This audit can establish a narrow isolation prerequisite, NEVER plan eligibility.
 * Billing API "no paid subscription" is not positive proof of a Free plan.
 */
export async function auditPilotAccount({
  expectedAccountId,token,fetchImpl=fetch
}){
  if(!ACCOUNT_ID.test(expectedAccountId||'')||
     typeof token!=='string'||token.length<20||token.length>1024)
    throw Error('Invalid read-only audit input');
  const blockers=[];
  const report={
    kind:'XRH_ISOLATED_FREE_ACCOUNT_PREFLIGHT',
    decision:'NO_GO',deploymentAuthorized:false,freePlanVerified:false,
    canProveAccountIsFree:false,productionUnaffected:true,
    accountMatch:false,emptyWorkerAccount:false,
    billingReadStatus:'NOT_ATTEMPTED',blockers
  };
  let accounts;
  try{
    const payload=await readOnlyGet('/accounts?page=1&per_page=50',token,fetchImpl);
    accounts=envelope(payload);
    const info=payload.result_info;
    // A token with multiple accessible accounts can select the wrong account;
    // too many accounts or incomplete pagination is never acceptable.
    if(accounts.length!==1||info?.total_pages>1||info?.total_count>1){
      reason(blockers,'ACCOUNT_TOKEN_NOT_SINGLE_ACCOUNT_SCOPED');
      return report;
    }
    if(!accounts[0]||accounts[0].id!==expectedAccountId){
      reason(blockers,'EXPECTED_ACCOUNT_ID_MISMATCH');return report;
    }
    report.accountMatch=true;
  }catch{
    reason(blockers,'ACCOUNT_READ_ACCESS_UNAVAILABLE');return report;
  }
  let scripts;
  try{
    scripts=envelope(await readOnlyGet('/accounts/'+expectedAccountId+'/workers/scripts',token,fetchImpl));
    if(scripts.some(x=>typeof x?.id!=='string')){
      reason(blockers,'WORKER_LIST_INCOMPLETE');return report;
    }
    if(scripts.some(x=>x.id.startsWith(PRODUCTION_PREFIX)))
      reason(blockers,'REPLY_HELPER_WORKER_PRESENT');
    if(scripts.length!==0)
      reason(blockers,'ISOLATED_ACCOUNT_HAS_EXISTING_WORKERS');
    report.emptyWorkerAccount=scripts.length===0;
  }catch{
    reason(blockers,'WORKER_INVENTORY_UNAVAILABLE');return report;
  }
  // Billing must be explicitly readable to rule out known Paid subscriptions.
  // This still CANNOT attest Free by itself, because Free might be absent from
  // the subscriptions list rather than represented by an explicit plan record.
  let subscriptions;
  try{
    subscriptions=envelope(await readOnlyGet(
      '/accounts/'+expectedAccountId+'/subscriptions',token,fetchImpl));
    report.billingReadStatus='READ_ONLY';
    if(subscriptions.some(s=>{
      const labels=[s?.product?.name,s?.product?.id,s?.rate_plan?.id,s?.rate_plan?.name]
        .filter(x=>typeof x==='string').join(' ').toLowerCase();
      const active=!s?.status||!['cancelled','canceled','expired'].includes(String(s.status).toLowerCase());
      return active&&/workers?/.test(labels)&&/(paid|standard|pro|bundled)/.test(labels);
    }))reason(blockers,'WORKERS_PAID_SUBSCRIPTION_SEEN');
  }catch{
    report.billingReadStatus='UNAVAILABLE';
    reason(blockers,'BILLING_READ_UNAVAILABLE');
  }
  // Even no subscriptions is not a verifiable Workers Free attestation.
  reason(blockers,'FREE_PLAN_NOT_INDEPENDENTLY_ATTESTED');
  if(!report.emptyWorkerAccount)
    reason(blockers,'ACCOUNT_ISOLATION_NOT_MET');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const {expectedAccountId,token}=parseAccountAuditArgs(process.argv.slice(2),process.env);
    const r=await auditPilotAccount({expectedAccountId,token});
    process.stdout.write(JSON.stringify(r,null,2)+'\n');
  }catch{
    console.error('Read-only Free-account preflight unavailable or invalid; no deployment authorized.');
  }
  process.exitCode=2; // NO_GO is intentionally nonzero, even when account is empty.
}
