// EXCLUSIVELY for a separate Cloudflare Free test account.
// Never import customer D1, account IDs, payment config, or production secrets.
import { PasswordVerifierDO } from "../../cf-free-password-do/src/index";
import { verifyPassword } from "../../../src/password-auth";
export { PasswordVerifierDO };

const PROBE_KIND = "xrh-cf-free-isolated-probe";
const PILOT_ENV = "dedicated-synthetic-free-account";
const SYNTHETIC_PEPPER = "xrh-isolated-free-pilot-pepper-2026-synthetic-only";
const KNOWN_PASSWORD = "xrh-cf-free-synthetic-password-2026!";
const BAD_PASSWORD = "xrh-cf-free-synthetic-incorrect-2026!";
const HASHES: Record<number, string> = Object.freeze({
  10000: "pbkdf2-sha256:10000:2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a:ba222757ea94c990bfc38dccbc0cb8f9287c8b71dd66dea5b606f4177f56eab9",
  60000: "pbkdf2-sha256:60000:2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a:b4b2120f08b6a6503cf9e1527eddd58204a01bd6e8633b6501487f3235330fb2",
  100000: "pbkdf2-sha256:100000:2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a:ebbc4afb93674092a8dde207896b0e827fa1a030c74cded57ec4f90d77b038d2",
  210000: "pbkdf2-sha256:210000:2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a:b728f1fbcb81dd8d25b4d37ce8a3dd2ab131c3313e32c597e66b6ce0658e51af",
});
interface PilotEnv {
  PILOT_ENV?: string;
  PASSWORD_PEPPER?: string;
  PILOT_ACCESS_TOKEN?: string;
  PASSWORD_VERIFY_DO?: DurableObjectNamespace<PasswordVerifierDO>;
}
function json(data: object, status=200): Response {
  return new Response(JSON.stringify(data),{
    status,headers:{"Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex,nofollow"}
  });
}
async function allowed(request: Request, expected: string): Promise<boolean> {
  const raw=request.headers.get("Authorization") || "";
  if(expected.length<40 || raw.length>256 || !raw.startsWith("Bearer "))return false;
  const supplied=raw.slice(7);
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest("SHA-256",enc.encode(supplied)),
    crypto.subtle.digest("SHA-256",enc.encode(expected))
  ]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);
  let diff=supplied.length^expected.length;
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
  return diff===0;
}
export default {
  async fetch(request: Request, env: PilotEnv): Promise<Response> {
    try {
      const path=new URL(request.url).pathname;
      if(path!=="/__pilot"&&path!=="/probe")return json({ok:false,code:"NOT_FOUND"},404);
      // No port to Production: both the flag and the pepper MUST match this
      // explicitly public, fake-only fixture. This cannot use live hashes.
      if(env.PILOT_ENV!==PILOT_ENV || env.PASSWORD_PEPPER!==SYNTHETIC_PEPPER ||
        typeof env.PILOT_ACCESS_TOKEN!=="string" || env.PILOT_ACCESS_TOKEN.length<40)
        return json({ok:false,code:"NOT_CONFIGURED"},503);
      if(!await allowed(request,env.PILOT_ACCESS_TOKEN))
        return json({ok:false,code:"UNAUTHORIZED"},401);
      if(path==="/__pilot"&&request.method==="GET")
        return json({ok:true,kind:PROBE_KIND,protocol:1,syntheticOnly:true,freeCertified:false});
      if(path!=="/probe"||request.method!=="POST")
        return json({ok:false,code:"METHOD_NOT_ALLOWED"},405);
      const len=Number(request.headers.get("Content-Length"));
      if(Number.isFinite(len)&&len>128)return json({ok:false,code:"BAD_INPUT"},400);
      const raw=await request.text();
      if(raw.length>128)return json({ok:false,code:"BAD_INPUT"},400);
      let body:unknown;
      try {body=JSON.parse(raw);}catch{return json({ok:false,code:"BAD_INPUT"},400);}
      if(!body||typeof body!=="object"||Array.isArray(body))
        return json({ok:false,code:"BAD_INPUT"},400);
      const input=body as Record<string,unknown>;
      if(Object.keys(input).some(k=>!["mode","rounds","wrong"].includes(k))||
         (input.mode!=="http"&&input.mode!=="do") ||
         (input.rounds!==10000&&input.rounds!==60000&&input.rounds!==100000&&input.rounds!==210000)||
         typeof input.wrong!=="boolean")
        return json({ok:false,code:"BAD_INPUT"},400);
      const rounds=input.rounds as number;
      const password=input.wrong ? BAD_PASSWORD : KNOWN_PASSWORD;
      // This map is entirely synthetic: the caller cannot submit a hash,
      // password, username or configurable work factor.
      const stored=HASHES[rounds];
      let verified:boolean;
      if(input.mode==="http"){
        verified=await verifyPassword(env,password,stored);
      }else{
        if(!env.PASSWORD_VERIFY_DO)return json({ok:false,code:"VERIFIER_UNAVAILABLE"},503);
        const result=await env.PASSWORD_VERIFY_DO.getByName("synthetic-legacy-factor-"+rounds).verify(password,stored);
        if(typeof result!=="boolean")return json({ok:false,code:"VERIFIER_UNAVAILABLE"},503);
        verified=result;
      }
      return json({ok:true,kind:PROBE_KIND,mode:input.mode,rounds,verified,
        syntheticOnly:true,freeCertified:false});
    }catch{
      // Never reflect exceptions, PBKDF2 parameters beyond allowlisted
      // round counts, credentials, stack traces or provider details.
      return json({ok:false,code:"PILOT_UNAVAILABLE"},503);
    }
  }
};
