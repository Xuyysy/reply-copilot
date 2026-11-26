import worker from '../../src/index.ts';
import {consumeMail,resetMockCalls,mockCalls} from './mock-fetch.mjs';
import {measureEnv} from './measure.mjs';
const routes=/^\/(?:health|v1\/(?:auth\/(?:login|register|verify-registration|request-password-reset|reset-password)|me|usage|entitlements|extension\/bootstrap|ai\/(?:generate|requests\/[a-f0-9-]{36}\/delivered)|admin\/(?:reauth|security\/password|dashboard|content)|orders|payments\/mk99\/notify))$/;
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),caseId=request.headers.get('x-xrh-case')||'';
  if(!env.ACCEPTANCE_TOKEN||request.headers.get('x-xrh-test-token')!==env.ACCEPTANCE_TOKEN||!/^case-[0-9]{1,4}$/.test(caseId)||(!routes.test(url.pathname)&&url.pathname!=='/__synthetic_cleanup'))return new Response(null,{status:404});
  const ip=request.headers.get('x-xrh-test-ip');if(!/^192\.0\.2\.[1-9][0-9]{0,2}$/.test(ip||''))return new Response(null,{status:400});
  console.log('XRH_CLOUD_CASE',caseId);
  const h=new Headers(request.headers);h.delete('x-xrh-test-token');h.delete('x-xrh-case');h.delete('x-xrh-test-ip');h.set('CF-Connecting-IP',ip);
  const incoming=new Request(request,{headers:h});
  resetMockCalls();const {env:measured,tally}=measureEnv(env);
  const finish=res=>{const headers=new Headers(res.headers);headers.set('x-xrh-local-budget',JSON.stringify({...tally,externalCalls:mockCalls()}));return new Response(res.body,{status:res.status,statusText:res.statusText,headers});};
  if(url.pathname==='/__synthetic_cleanup'){await worker.scheduled({scheduledTime:Date.now(),cron:'0 3 * * *',noRetry(){}},measured,ctx);return finish(Response.json({ok:true,kind:'HTTP_INVOKED_CLEANUP_NOT_CRON'}));}
  let email=null;
  if(['/v1/auth/register','/v1/auth/request-password-reset'].includes(url.pathname)){email=(await incoming.clone().json()).email;if(!/^synthetic-[a-z0-9-]+@example\.test$/.test(email))return new Response(null,{status:400});}
  const res=await worker.fetch(incoming,measured,ctx);const headers=new Headers(res.headers);
  if(email){const code=consumeMail(email);if(code)headers.set('x-xrh-synthetic-code',code);}
  return finish(new Response(res.body,{status:res.status,statusText:res.statusText,headers}));
 },
 async scheduled(controller,env,ctx){console.log('XRH_CLOUD_CRON',controller.scheduledTime);await worker.scheduled(controller,env,ctx);}
};
