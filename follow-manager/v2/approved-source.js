// Transport-independent adapter for a separately reviewed and authorized
// first-party identity + relationship source. It performs no X requests,
// endpoint discovery, credential extraction, header inspection or replay.
import {stableId} from "./model.js";
import {LIVE_SOURCE} from "./store.js";
import {parseRelationshipResponse} from "./response-adapter.js";

const HANDLE=/^[A-Za-z0-9_]{1,15}$/;
const KINDS=new Set(["following","followers"]);
const fail=code=>{throw Error(code)};
const stableCounts=c=>c&&["following","followers"].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0&&c[k]<=50000);
const same=(a,b)=>a?.ownerUserId===b.ownerUserId&&a?.sessionId===b.sessionId&&
 typeof a?.handle==="string"&&a.handle.toLowerCase()===b.handle.toLowerCase();

// Reviewed transport MUST obtain viewerUserId from an independently checked
// authenticated-self response, not from a profile or relation-list target.
// currentBinding must check the active signed-in account without network calls.
export function createApprovedFollowSource({binding,transport,clock=()=>new Date().toISOString()}={}){
 if(!stableId(binding?.ownerUserId)||!HANDLE.test(binding?.handle??"")||
  typeof binding.sessionId!=="string"||!binding.sessionId||binding.sessionId.length>128||
  !transport||typeof transport.currentBinding!=="function"||
  typeof transport.readSelf!=="function"||typeof transport.readPage!=="function")fail("source_unavailable");
 const local=Object.freeze({ownerUserId:binding.ownerUserId,handle:binding.handle,sessionId:binding.sessionId});
 let closed=false,expected=null;
 const assertOpen=signal=>{if(closed||signal?.aborted)fail("cancelled")};
 async function check(signal){
  assertOpen(signal);const current=await transport.currentBinding({signal});assertOpen(signal);
  if(!same(current,local))fail("identity_changed");
 }
 async function readIdentity({refresh=false,signal}={}){
  await check(signal);
  const v=await transport.readSelf({refresh:refresh===true,signal});
  await check(signal);
  // BOTH the viewer and the self-profile must match the signed-in binding.
  // A matching list target alone never authenticates the viewer.
  if(v?.viewerUserId!==local.ownerUserId||v?.profileUserId!==local.ownerUserId||
   typeof v.handle!=="string"||v.handle.toLowerCase()!==local.handle.toLowerCase())fail("identity_changed");
  if(!stableCounts(v.counts))fail("invalid_count");
  if(expected&&!["following","followers"].every(k=>expected[k]===v.counts[k]))fail("count_changed");
  expected=Object.freeze({following:v.counts.following,followers:v.counts.followers});
  return {source:LIVE_SOURCE,ownerUserId:local.ownerUserId,sessionId:local.sessionId,
   identityEvidence:"self_profile_and_session",counts:expected};
 }
 async function page({ownerUserId,kind,cursor,signal}={}){
  if(ownerUserId!==local.ownerUserId||!KINDS.has(kind)||
   !(cursor===null||typeof cursor==="string"&&cursor.length>0&&cursor.length<=512))fail("invalid_context");
  if(!expected)fail("identity_required");
  await check(signal);
  const raw=await transport.readPage({ownerUserId:local.ownerUserId,kind,cursor,signal});
  await check(signal);
  if(!raw||!Number.isInteger(raw.status)||raw.status<100||raw.status>599)fail("unexpected_status");
  const parsed=parseRelationshipResponse({ownerUserId:local.ownerUserId,kind,cursor,
   expected:expected[kind],observedAt:clock(),status:raw.status,payload:raw.payload});
  // Only the strict parser's explicit Bottom termination may end a list.
  // A magic cursor string or a matching count alone is not end evidence.
  return {ownerUserId:local.ownerUserId,kind,...parsed,coverage:"authorized_observed",
   terminalEvidence:parsed.terminal?"explicit_or_count_confirmed":null};
 }
 async function close(){closed=true;expected=null;await transport.close?.();}
 return Object.freeze({kind:LIVE_SOURCE,readIdentity,page,close});
}
