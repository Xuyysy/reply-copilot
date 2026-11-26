// Isolated QA wrapper only. Never attach to shared Staging or production.
import api from './worker.mjs';
import assets from './assets.mjs';
const origin='https://reply-copilot-api-partners-qa.yyx0149.workers.dev';
const read=new Set(['/health','/v1/site','/v1/me','/v1/usage','/v1/activity','/v1/auth/csrf','/v1/referrals/me','/v1/partners/me','/v1/partners/alipay-recipient','/v1/partners/alipay-requests','/v1/subscriptions/orders','/v1/subscriptions/plans','/v1/boltutil/orders','/v1/boltutil/availability','/v1/admin/dashboard','/v1/admin/users','/v1/admin/packages','/v1/admin/orders','/v1/admin/settings','/v1/admin/commerce/summary','/v1/admin/ops-insights','/v1/admin/referrals','/v1/admin/partners/policy','/v1/admin/partners/order-preview','/v1/admin/partners/accrual-review','/v1/admin/partners/alipay-requests']);
const write=new Set(['/v1/auth/login','/v1/auth/logout','/v1/admin/reauth','/v1/referrals/link','/v1/partners/alipay-recipient','/v1/partners/alipay-requests','/v1/admin/partners/policy','/v1/admin/partners/accrual-review','/v1/admin/partners/alipay-requests','/v1/admin/partners/payout-review','/v1/admin/partners/discovery']);
function headers(extra={}){return {'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...extra};}
function deny(status,msg,extra={}){return new Response(msg,{status,headers:headers(extra)});}
function equal(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export default {
 async fetch(req,env){
  const u=new URL(req.url);
  if(u.origin!==origin||env.ENVIRONMENT!=='staging'||env.WEB_ORIGIN!==origin||env.API_ORIGIN!==origin||env.PAYMENTS_ENABLED!=='0'||env.AI_MODE!=='mock'||env.QA_ISOLATION!=='partners-qa-20261125'||!env.QA_ACCESS_SECRET||env.QA_ACCESS_SECRET.length<40)return deny(503,'QA isolation not configured');
  // Outer access is independent of the application's real user/administrator
  // session. All paths, including assets, fail closed without the secret.
  if(!equal(req.headers.get('Authorization')||'','Basic '+btoa('qa:'+env.QA_ACCESS_SECRET)))return deny(401,'Private QA only',{'WWW-Authenticate':'Basic realm="Private Partners QA", charset="UTF-8"'});
  if(u.pathname.startsWith('/v1/')||u.pathname==='/health'){
   const allowed=(req.method==='GET'&&read.has(u.pathname))||(req.method==='POST'&&write.has(u.pathname));
   if(!allowed)return deny(403,'Outside independent QA route allowlist');
   // Block real provider, registration/reset email and arbitrary admin writes
   // regardless of any database setting. Do not pass outer credentials to API.
   const h=new Headers(req.headers);h.delete('Authorization');
   const response=await api.fetch(new Request(req,{headers:h}),env);
   const out=new Headers(response.headers);for(const [k,v] of Object.entries(headers()))out.set(k,v);
   return new Response(response.body,{status:response.status,headers:out});
  }
  if(!['GET','HEAD'].includes(req.method))return deny(405,'Method not allowed');
  const p=decodeURIComponent(u.pathname);
  if(p.includes('..')||p.includes('\\'))return deny(404,'Not found');
  const key=Object.hasOwn(assets,p)?p:p.endsWith('/')?p+'index.html':p+'/index.html';
  const asset=assets[key];
  if(!asset)return deny(404,'Not found');
  const [type,body]=asset;
  const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0));
  return new Response(req.method==='HEAD'?null:bytes,{headers:headers({'Content-Type':type,'Content-Encoding':'gzip','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'"}),encodeBody:'manual'});
 },
 async scheduled(controller,env){
  if(env.ENVIRONMENT!=='staging'||env.QA_ISOLATION!=='partners-qa-20261125'||env.PAYMENTS_ENABLED!=='0'||env.AI_MODE!=='mock'||env.QA_SCHEDULED_ENABLED!=='1')return;
  await api.scheduled(controller,env);
 }
};
