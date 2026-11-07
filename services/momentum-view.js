import {DEFAULT_MOMENTUM_CONFIG,validateMomentumConfig} from '../domain/creator-momentum.js';

const publicPolicy=({ranges,maxReminders,cooldownMinutes,...policy})=>policy;
const locked=status=>({status,available:false,eligible:false,enabled:false,policy:publicPolicy(DEFAULT_MOMENTUM_CONFIG)});
export function createMomentumView({accountStates,client,momentum,storage,broadcast,clock=Date.now}){
 let cached=null,pending=null,epoch=0,backlog=null;
 const invalidate=()=>{epoch++;cached=null;pending=null;};
 const fresh=(token,owner)=>cached?.token===token&&cached.owner===owner&&clock()>=cached.at&&clock()-cached.at<60000;
 function refresh(token,owner){
  if(pending?.token===token&&pending.owner===owner)return pending.promise;
  const entry={token,owner};const revision=epoch;
  entry.promise=(async()=>{
   const data=await client.request('/v1/entitlements?feature=interactionMomentum',{expectedToken:token});
   const f=data.features?.interactionMomentum;
   if(epoch!==revision||await client.token()!==token||epoch!==revision||f?.ownerId!==owner||typeof f.eligible!=='boolean')throw Error('FEATURE_UNVERIFIED');
   const value={token,owner,eligible:f.eligible,policy:validateMomentumConfig(f.policy),at:clock()};
   cached=value;return value;
  })().finally(()=>{if(pending===entry)pending=null;});
  pending=entry;return entry.promise;
 }
 async function view(message){
  const revision=epoch,token=await client.token();
  if(!token)return locked('guest');
  const owner=accountStates.peekState()?.user?.userId;
  if(['frozen','auth_expired','auth_unavailable'].includes(accountStates.peekState()?.status))return locked('unverified');
  if(!owner||accountStates.cachedToken!==token||epoch!==revision)return locked('unverified');
  const sameAccount=async()=>epoch===revision&&accountStates.cachedToken===token&&accountStates.peekState()?.user?.userId===owner&&await client.token()===token&&epoch===revision;
  const actionable=message.claim===true||message.refresh===true||message.dnd===true||typeof message.enabled==='boolean';
  if(message.enabled===true||!fresh(token,owner)&&actionable){try{await refresh(token,owner);}catch{return locked('unverified');}}
  if(!await sameAccount())return locked('unverified');
  const proof=fresh(token,owner)?cached:null;
  if(!proof)return locked('unverified');
  const eligible=proof.eligible;
  const settled=await momentum.drain(storage);
  if(!settled){
   if(!backlog)backlog=(async()=>{for(let i=0;i<32;i++)if(await momentum.drain(storage))break;await broadcast();})().catch(()=>{}).finally(()=>{backlog=null;});
   // Backlog blocks claiming a reminder, not saving a verified preference.
  }
  if(!await sameAccount())return locked('unverified');
  if(!fresh(token,owner)||cached!==proof)return locked('unverified');
  const policy=proof.policy;
  const result=await momentum.view(owner,policy,{eligible,available:true,enabled:message.enabled===false?false:eligible&&message.enabled===true?true:undefined,claim:settled&&(message.claim===true||message.enabled===true),dnd:message.dnd===true});
  if(!await sameAccount())return locked('unverified');
  return {status:eligible?'paid':'free',available:true,eligible,enabled:eligible&&result.enabled===true,policy:publicPolicy(policy),reminder:result.reminder};
 }
 view.invalidate=invalidate;
 view.policyFor=owner=>cached?.owner===owner?cached.policy:null;
 return view;
}
