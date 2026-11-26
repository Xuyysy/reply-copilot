// QA-only exact-run OIDC grant. No identity tokens or passwords in logs.
// Trust is installed out of band as exact signed claims + bounded expiry.
const issuer='https://token.actions.githubusercontent.com';
const keysUrl=issuer+'/.well-known/jwks';
const fields=['iss','aud','repository','repository_id','event_name','ref','head_ref','base_ref','sha','workflow_ref','workflow_sha','run_id','runner_environment'];
const enc=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const hash=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const deny=(code=403)=>new Response(JSON.stringify({ok:false}),{status:code,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
async function identity(req,env){
 if(req.method!=='POST'||!env.QA_OIDC_TRUST||!env.QA_OIDC_GRANT_KEY)return null;
 const now=Math.floor(Date.now()/1000);
 const trust=JSON.parse(env.QA_OIDC_TRUST);
 if(!Number.isSafeInteger(trust.until)||trust.until<=now||trust.until>now+3600||fields.some(k=>typeof trust[k]!=='string'||!trust[k]))return null;
 if(trust.iss!==issuer||trust.repository!=='Xuyysy/reply-copilot'||trust.repository_id!=='1418927757'||trust.event_name!=='pull_request'||trust.ref!=='refs/pull/259/merge'||trust.head_ref!=='chatgpt/partners-staging-qa-20261125'||trust.base_ref!=='chatgpt/partners-v1a-foundation-20261125'||trust.workflow_ref!=='Xuyysy/reply-copilot/.github/workflows/partners-hosted-acceptance.yml@refs/pull/259/merge'||trust.runner_environment!=='github-hosted'||trust.aud!==env.API_ORIGIN+'/internal-qa'||!/^\d+$/.test(trust.run_id)||!/^[a-f0-9]{40}$/.test(trust.sha)||!/^[a-f0-9]{40}$/.test(trust.workflow_sha))return null;
 const a=req.headers.get('Authorization')||'';
 if(a.length>16000||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(a))return null;
 const [h,p,s]=a.slice(7).split('.');
 const header=JSON.parse(new TextDecoder().decode(decode(h))),claims=JSON.parse(new TextDecoder().decode(decode(p)));
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||fields.some(k=>claims[k]!==trust[k]))return null;
 if(!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.nbf)||claims.exp<=now||claims.nbf>now+30||claims.iat>now+30||claims.iat<now-600||claims.exp-claims.iat>900)return null;
 const r=await fetch(keysUrl,{redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!r.ok)return null;
 const {keys}=await r.json();
 const matches=Array.isArray(keys)?keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')):[];
 if(matches.length!==1)return null;
 const key=await crypto.subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s),enc.encode(h+'.'+p)))return null;
 return trust;
}
export async function qaGrant(req,env,path){
 try{
  const trust=await identity(req,env);if(!trust)return deny();
  const now=Date.now();
  if(path==='/internal-qa/close'){
   const row=await env.DB.prepare("SELECT run_id FROM qa_hosted_grants WHERE run_id=? AND state='issued'").bind(trust.run_id).first();
   if(!row)return deny(409);
   await env.DB.batch([
    env.DB.prepare("UPDATE qa_hosted_grants SET state='closed',ciphertext='',gate_hash='' WHERE run_id=? AND state='issued'").bind(trust.run_id),
    env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id IN ('qa-admin','qa-partner-a','qa-buyer-b','qa-buyer-c','qa-outsider-d','qa-excluded-e','qa-partner-f') AND revoked_at IS NULL").bind(now),
    env.DB.prepare("UPDATE users SET password_hash=NULL WHERE id IN ('qa-admin','qa-partner-a','qa-buyer-b','qa-buyer-c','qa-outsider-d','qa-excluded-e','qa-partner-f')")
   ]);
   return new Response('{"ok":true}',{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(path!=='/internal-qa/exchange')return deny(404);
  const row=await env.DB.prepare("SELECT nonce,ciphertext,expires_at FROM qa_hosted_grants WHERE run_id=? AND state='ready' AND expires_at>?").bind(trust.run_id,now).first();
  if(!row||row.expires_at>trust.until*1000)return deny(409);
  const key=await crypto.subtle.importKey('raw',decode(env.QA_OIDC_GRANT_KEY),{name:'AES-GCM'},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(row.nonce),additionalData:enc.encode('partners-qa:'+trust.run_id)},key,decode(row.ciphertext));
  const update=await env.DB.prepare("UPDATE qa_hosted_grants SET state='issued',ciphertext='' WHERE run_id=? AND state='ready' AND expires_at>?").bind(trust.run_id,now).run();
  if(update.meta.changes!==1)return deny(409);
  return new Response(plain,{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
 }catch{return deny();}
}
export async function temporaryQaAccess(req,env){
 try{
  const a=req.headers.get('Authorization')||'';
  if(!/^Basic [A-Za-z0-9+/=]{60,200}$/.test(a))return false;
  const row=await env.DB.prepare("SELECT 1 ok FROM qa_hosted_grants WHERE state='issued' AND expires_at>? AND gate_hash=? LIMIT 1").bind(Date.now(),await hash(a)).first();
  return row?.ok===1;
 }catch{return false;}
}
