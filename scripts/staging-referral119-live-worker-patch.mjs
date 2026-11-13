/**
 * Only for the exact Staging PR109 + PR116 LIVE compiled Worker. Do not deploy
 * a whole branch over the deployed script. This builds a reviewable candidate
 * string; it never calls Cloudflare, touches D1, or deploys by itself.
 */
function one(source,needle,replacement,label){
 const i=source.indexOf(needle);
 if(i<0 || source.indexOf(needle,i+needle.length)>=0)throw Error("Ref119 patch guard: "+label);
 return source.slice(0,i)+replacement+source.slice(i+needle.length);
}
function segment(source,begin,end,transform,label){
 const i=source.indexOf(begin),j=source.indexOf(end,i+begin.length);
 if(i<0||j<0||source.indexOf(begin,i+begin.length)>=0)throw Error("Ref119 ambiguous segment: "+label);
 const old=source.slice(i,j),next=transform(old);
 if(old===next)throw Error("Ref119 segment unchanged: "+label);
 return source.slice(0,i)+next+source.slice(j);
}
function line(source,regex,mapper,label){
 const hits=[...source.matchAll(new RegExp(regex.source,regex.flags.includes("g")?regex.flags:regex.flags+"g"))];
 if(hits.length!==1)throw Error("Ref119 expected one "+label+" matched "+hits.length);
 return source.replace(regex,mapper);
}
export function transpileReferralSource(typescriptSource,planSource){
 if(!typescriptSource.includes("export async function adminReferralOverview") || !planSource.includes("export function referralAwardPlan"))throw Error("Wrong referral source files");
 let ts=typescriptSource.replace(/^import [^\n]*\n/gm,"").replace(/\bexport (?=(?:async )?function )/g,"");
 const signatures=[...ts.matchAll(/((?:async\s+)?function\s+\w+)\(([^)]*)\)\s*:\s*(?:Promise<[^>]+>|D1PreparedStatement|void|string\|null)\s*\{/g)];
 if(signatures.length!==11)throw Error("Ref119 function signature count drift "+signatures.length);
 ts=ts.replace(/((?:async\s+)?function\s+\w+)\(([^)]*)\)\s*:\s*(?:Promise<[^>]+>|D1PreparedStatement|void|string\|null)\s*\{/g,
  (_a,fn,args)=>fn+"("+args.replace(/:\s*(?:Env|Request|unknown|string\|null|string|number)\b/g,"")+") {");
 ts=ts.replace(/\.first<\{[^>]*\}>/g,".first");
 if(/(?:^|\W)(?:export|import|Promise<|D1PreparedStatement)(?:\W|$)/m.test(ts)||ts.includes(".first<"))throw Error("Ref119 TypeScript syntax remains");
 const plan=planSource.replace(/^export /gm,"").replace(/\bmake\b/g,"referralMake");
 if(/\bexport\b/.test(plan))throw Error("Ref119 plan exports remain");
 return "/* REFERRAL119_STAGING_RUNTIME_OVERLAY_20261113 */\n"+plan+"\n"+ts+"\n";
}
export function patchLiveStagingWorker(script,typescriptSource,planSource){
 if(typeof script!=="string" || script.length<500000 || !script.includes("STAGING_V3_HOTPATCH_20261112") || script.includes("REFERRAL119_STAGING_RUNTIME_OVERLAY_20261113"))throw Error("Ref119 wrong live Worker baseline");
 const injection=transpileReferralSource(typescriptSource,planSource);
 script=segment(script,"async function register(","__name(register, \"register\");",section=>{
  section=one(section,'  if (diagnostics) diagnostics.stage = "registration_code_hash";',
  '  const referralEnabled=await referralsEnabled(env);\n  const referralCode=referralEnabled?await eligibleReferralCode(env,body.referralCode):null;\n  if (diagnostics) diagnostics.stage = "registration_code_hash";',"register attribution");
  const start=section.indexOf("  let inserted;\n  try {");
  const end=section.indexOf("  } catch (error) {",start);
  if(start<0||end<0||!section.slice(start,end).includes("INSERT INTO pending_registrations")||!section.slice(start,end).includes("ON CONFLICT(email)"))throw Error("Ref119 register SQL drift");
  const replacement=[
   "  let inserted;",
   '  const referralColumn=referralEnabled?",referral_code":"";',
   '  const referralValue=referralEnabled?",?":"";',
   '  const immutableReferral=referralEnabled?",referral_code=COALESCE(pending_registrations.referral_code,excluded.referral_code)":"";',
   '  const registerSql="INSERT INTO pending_registrations(email,username,password_hash,code_hash,created_at,expires_at,sent_at,attempts"+referralColumn+") VALUES(?,?,?,?,?,?,?,0"+referralValue+") "+',
   '    "ON CONFLICT(email) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,code_hash=excluded.code_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0"+',
   '    immutableReferral+" WHERE pending_registrations.sent_at<=?";',
   '  const registerValues=[email,username,passwordHash,codeHash,now,now+600000,now,...(referralEnabled?[referralCode]:[]),now-60000];',
   "  try {",
   "    inserted=await env.DB.prepare(registerSql).bind(...registerValues).run();",
   ""
  ].join("\n");
  return section.slice(0,start)+replacement+section.slice(end);
 },"register");
 script=segment(script,"async function verifyRegistration(","__name(verifyRegistration, \"verifyRegistration\");",section=>{
  const old='  const row = await env.DB.prepare("SELECT username,password_hash,code_hash,expires_at,attempts FROM pending_registrations WHERE email=?").bind(email).first();';
  const updated='  const referralEnabled=await referralsEnabled(env);\n  const row = await env.DB.prepare("SELECT username,password_hash,code_hash,expires_at,attempts"+(referralEnabled?",referral_code":"")+" FROM pending_registrations WHERE email=?").bind(email).first();';
  section=one(section,old,updated,"verify referral column");
  section=one(section,"      ...futureGrants,\n","      ...futureGrants,\n      ...(referralEnabled && row.referral_code ? [referralRegistrationStatement(env,userId,row.referral_code,now)] : []),\n","transactional registration attribution");
  return section;
 },"verify registration");
 script=segment(script,"async function acknowledgeDelivery(","async function recoveryState(",section=>{
  section=line(section,/^  if \(state\?\.status === "succeeded" && state\.delivery_confirmation_id\) return response\((.*)\);$/m,
   (_s,expr)=>'  if (state?.status === "succeeded" && state.delivery_confirmation_id) { await bestEffortReferralAward(env,userId); return response('+expr+'); }',"ACK replay");
  section=line(section,/^    if \(await confirmSubscribedDelivery\(env, userId, requestId, now\)\)\n      return response\((.*)\);$/m,
   (_s,expr)=>'    if (await confirmSubscribedDelivery(env, userId, requestId, now)) { await bestEffortReferralAward(env,userId); return response('+expr+'); }',"subscription ACK");
  section=line(section,/^    if \(after\?\.status === "succeeded" && after\.delivery_confirmation_id\)\n      return response\((.*)\);$/m,
   (_s,expr)=>'    if (after?.status === "succeeded" && after.delivery_confirmation_id) { await bestEffortReferralAward(env,userId); return response('+expr+'); }',"subscription replay");
  section=line(section,/^    if \(current2\?\.status === "succeeded" && current2\.delivery_confirmation_id\) return response\((.*)\);$/m,
   (_s,expr)=>'    if (current2?.status === "succeeded" && current2.delivery_confirmation_id) { await bestEffortReferralAward(env,userId); return response('+expr+'); }',"ACK conflict replay");
  section=one(section,"  return response({ ok: true, alreadyConfirmed: false, requestId, quota: await balance(env, userId) }, 200, env, request);",
   "  await bestEffortReferralAward(env,userId);\n  return response({ ok: true, alreadyConfirmed: false, requestId, quota: await balance(env, userId) }, 200, env, request);","ACK new success");
  return section;
 },"ACK");
 script=segment(script,"var index_default = {","__name(index_default",section=>{
  const needle='      if (request.method === "POST" && path === "/v1/feedback") return await feedback(request, env);';
  const insert=[
   '      if (request.method === "GET" && path === "/v1/referrals/me") return await myReferrals(request,env);',
   '      if (request.method === "POST" && path === "/v1/referrals/link") return await createReferralLink(request,env);',
   '      if (request.method === "GET" && path === "/v1/admin/referrals") return await adminReferralOverview(request,env);',
   needle
  ].join("\n");
  return one(section,needle,insert,"referral HTTP routes");
 },"route");
 script=one(script,"var index_default = {",injection+"var index_default = {","module functions");
 if(!script.includes("STAGING_V3_HOTPATCH_20261112")||!script.includes("REFERRAL119_STAGING_RUNTIME_OVERLAY_20261113"))throw Error("Ref119 output markers missing");
 return {script,patchId:"REFERRAL119_STAGING_RUNTIME_OVERLAY_20261113"};
}
